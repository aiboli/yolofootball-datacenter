const { createDatabase } = require("../common/database");
const {
  ACTIVE_EVENT_STATUS,
  COMPLETED_EVENT_STATUS,
  LOCKED_EVENT_STATUS,
  buildEventHistoryEntry,
  hydrateCustomEvent,
  toCurrency,
} = require("../common/customEvent");
const {
  FINAL_FIXTURE_STATUSES,
  buildCustomEventSettledNotification,
  getFixtureStatus,
  mergeFixturesFromLeagueDocuments,
  resolveMatchWinnerResult,
} = require("../common/notifications");

const VOID_FIXTURE_STATUSES = new Set(["CANC", "ABD", "AWD", "WO"]);

const createContainers = () => {
  const database = createDatabase();

  return {
    ordersContainer: database.container("orders"),
    usersContainer: database.container("users"),
    customEventsContainer: database.container("customevents"),
    leaguesContainer: database.container("leagues"),
  };
};

const replaceDocument = async (container, id, document) => {
  const replaceOptions = document?._etag
    ? {
        accessCondition: {
          type: "IfMatch",
          condition: document._etag,
        },
      }
    : undefined;

  return container.item(id, id).replace(document, replaceOptions);
};

const escapeCosmosString = (value) => String(value).replace(/"/g, '\\"');

const findUserByName = async (usersContainer, userName) => {
  const query = {
    query: `SELECT * FROM c WHERE c.user_name = "${escapeCosmosString(userName)}"`,
  };
  const result = await usersContainer.items.query(query).fetchAll();
  return result.resources?.[0] || null;
};

const changeUserBalance = async (usersContainer, userName, amountDelta) => {
  if (!userName || userName === "ano" || !Number.isFinite(Number(amountDelta))) {
    return null;
  }

  const currentUser = await findUserByName(usersContainer, userName);
  if (!currentUser) {
    return null;
  }

  currentUser.account_balance = toCurrency(
    Number(currentUser.account_balance || 0) + Number(amountDelta || 0)
  );
  const replaceResult = await replaceDocument(usersContainer, currentUser.id, currentUser);
  return replaceResult.resource;
};

const normalizeOrderSelections = (order) => {
  if (Array.isArray(order?.selections) && order.selections.length > 0) {
    return order.selections.map((selection) => ({
      fixture_id: Number(selection.fixture_id),
      bet_result: Number(selection.bet_result),
      odd_rate: Number(selection.odd_rate),
      fixture_state: selection.fixture_state || "notstarted",
      market: selection.market || "match_winner",
      selection: selection.selection || null,
    }));
  }

  return [
    {
      fixture_id: Number(order?.fixture_id),
      bet_result: Number(order?.bet_result),
      odd_rate: Number(order?.odd_rate),
      fixture_state: order?.fixture_state || "notstarted",
      market: order?.market || "match_winner",
      selection: order?.selection || null,
    },
  ].filter((selection) => Number.isFinite(selection.fixture_id));
};

const getSelectionOutcome = (selection, fixture) => {
  const fixtureStatus = getFixtureStatus(fixture);
  if (!fixture || !fixtureStatus || !FINAL_FIXTURE_STATUSES.has(fixtureStatus)) {
    return {
      state: "pending",
      fixtureState: selection.fixture_state || "notstarted",
    };
  }

  if (VOID_FIXTURE_STATUSES.has(fixtureStatus)) {
    return {
      state: "void",
      fixtureState: "canceled",
    };
  }

  const actualResult = resolveMatchWinnerResult(fixture);
  if (!Number.isInteger(actualResult)) {
    return {
      state: "void",
      fixtureState: "canceled",
    };
  }

  return {
    state: Number(selection.bet_result) === actualResult ? "won" : "lost",
    fixtureState: "finished",
    actualResult,
  };
};

const evaluateStandardOrder = (order, fixtureMap) => {
  const selections = normalizeOrderSelections(order);
  if (selections.length === 0) {
    return {
      outcome: "pending",
      fixtureState: order.fixture_state || "notstarted",
      fixtureStates: [],
      selections,
    };
  }

  const selectionOutcomes = selections.map((selection) =>
    getSelectionOutcome(selection, fixtureMap[Number(selection.fixture_id)])
  );

  if (selectionOutcomes.some((result) => result.state === "lost")) {
    return {
      outcome: "lost",
      fixtureState: selectionOutcomes[0]?.fixtureState || "finished",
      fixtureStates: selectionOutcomes.map((result) => result.fixtureState),
      selections,
    };
  }

  if (selectionOutcomes.some((result) => result.state === "pending")) {
    return {
      outcome: "pending",
      fixtureState: selectionOutcomes[0]?.fixtureState || "ongoing",
      fixtureStates: selectionOutcomes.map((result) => result.fixtureState),
      selections,
    };
  }

  if (selectionOutcomes.every((result) => result.state === "won")) {
    return {
      outcome: "won",
      fixtureState: selectionOutcomes[0]?.fixtureState || "finished",
      fixtureStates: selectionOutcomes.map((result) => result.fixtureState),
      selections,
    };
  }

  return {
    outcome: "void",
    fixtureState: selectionOutcomes[0]?.fixtureState || "canceled",
    fixtureStates: selectionOutcomes.map((result) => result.fixtureState),
    selections,
  };
};

const settleStandardOrder = async ({ order, fixtureMap, ordersContainer, usersContainer }) => {
  const evaluation = evaluateStandardOrder(order, fixtureMap);
  if (evaluation.outcome === "pending") {
    return null;
  }

  order.selections = evaluation.selections;
  order.selection_count = evaluation.selections.length;
  order.fixtures_ids = evaluation.selections.map((selection) => Number(selection.fixture_id));
  order.fixture_states = evaluation.fixtureStates;
  order.fixture_state = evaluation.fixtureState;
  order.state = "completed";

  if (evaluation.outcome === "won") {
    order.is_win = true;
    order.actual_return = toCurrency(order.win_return || 0);
    await replaceDocument(ordersContainer, order.id, order);
    await changeUserBalance(usersContainer, order.created_by, Number(order.actual_return || 0));
    return order;
  }

  if (evaluation.outcome === "void") {
    order.is_win = false;
    order.actual_return = toCurrency(order.odd_mount || 0);
    await replaceDocument(ordersContainer, order.id, order);
    await changeUserBalance(usersContainer, order.created_by, Number(order.actual_return || 0));
    return order;
  }

  order.is_win = false;
  order.actual_return = 0;
  await replaceDocument(ordersContainer, order.id, order);
  return order;
};

const settleCustomEventGroup = async ({
  event,
  orders,
  fixture,
  ordersContainer,
  usersContainer,
  customEventsContainer,
  notificationRepository,
  now = new Date(),
}) => {
  const fixtureStatus = getFixtureStatus(fixture);
  if (!fixtureStatus || !FINAL_FIXTURE_STATUSES.has(fixtureStatus)) {
    return [];
  }

  const hydratedEvent = hydrateCustomEvent(event);
  const isVoidOutcome = VOID_FIXTURE_STATUSES.has(fixtureStatus) || !Number.isInteger(resolveMatchWinnerResult(fixture));
  const actualResult = isVoidOutcome ? null : resolveMatchWinnerResult(fixture);
  const settledOrders = [];
  let losingStakes = 0;
  let winningPayout = 0;
  let winningProfit = 0;
  let winningOrderCount = 0;
  let losingOrderCount = 0;
  let voidOrderCount = 0;

  for (const order of orders) {
    order.state = "completed";
    order.fixture_state = isVoidOutcome ? "canceled" : "finished";
    order.fixture_states = [order.fixture_state];
    order.selections = normalizeOrderSelections(order).map((selection) => ({
      ...selection,
      fixture_state: order.fixture_state,
    }));

    if (isVoidOutcome) {
      order.is_win = false;
      order.actual_return = toCurrency(order.odd_mount || 0);
      await replaceDocument(ordersContainer, order.id, order);
      await changeUserBalance(usersContainer, order.created_by, Number(order.actual_return || 0));
      voidOrderCount++;
      settledOrders.push(order);
      continue;
    }

    if (Number(order.bet_result) === actualResult) {
      order.is_win = true;
      order.actual_return = toCurrency(order.win_return || 0);
      await replaceDocument(ordersContainer, order.id, order);
      await changeUserBalance(usersContainer, order.created_by, Number(order.actual_return || 0));
      winningPayout += Number(order.actual_return || 0);
      winningProfit += Number(order.actual_return || 0) - Number(order.odd_mount || 0);
      winningOrderCount++;
      settledOrders.push(order);
      continue;
    }

    order.is_win = false;
    order.actual_return = 0;
    await replaceDocument(ordersContainer, order.id, order);
    losingStakes += Number(order.odd_mount || 0);
    losingOrderCount++;
    settledOrders.push(order);
  }

  const ownerCredit = isVoidOutcome
    ? Number(hydratedEvent.pool_fund || 0)
    : Number(hydratedEvent.pool_fund || 0) + losingStakes - winningProfit;

  await changeUserBalance(usersContainer, hydratedEvent.created_by, ownerCredit);

  event.status = COMPLETED_EVENT_STATUS;
  event.fixture_state = isVoidOutcome ? "canceled" : "finished";
  event.actual_return = toCurrency(ownerCredit);
  event.settlement_summary = {
    settled_at: new Date(now).toISOString(),
    outcome: isVoidOutcome ? "void" : "completed",
    result: isVoidOutcome ? null : actualResult,
    owner_credit: toCurrency(ownerCredit),
    total_staked: toCurrency(
      orders.reduce((total, order) => total + Number(order.odd_mount || 0), 0)
    ),
    winning_payout: toCurrency(winningPayout),
    winning_profit: toCurrency(winningProfit),
    winning_order_count: winningOrderCount,
    losing_order_count: losingOrderCount,
    void_order_count: voidOrderCount,
  };
  event.event_history = Array.isArray(event.event_history) ? event.event_history : [];
  event.event_history.push(
    buildEventHistoryEntry("settle custom event", {
      outcome: event.settlement_summary.outcome,
      result: event.settlement_summary.result,
      owner_credit: event.settlement_summary.owner_credit,
    })
  );

  const updatedEventResponse = await replaceDocument(customEventsContainer, event.id, event);
  const updatedEvent = updatedEventResponse.resource;

  try {
    const notifications = [
      buildCustomEventSettledNotification({
        event: updatedEvent,
        fixture,
        now,
      }),
    ].filter(Boolean);
    if (notifications.length > 0) {
      await notificationRepository.upsertNotifications(notifications);
    }
  } catch (error) {
    // Notification failures should not fail settlement.
  }

  return settledOrders;
};

const runOrderSettlementSweep = async ({
  notificationRepository,
  now = new Date(),
} = {}) => {
  const repository =
    notificationRepository ||
    require("../common/notificationRepository").createNotificationRepository();
  const { ordersContainer, usersContainer, customEventsContainer, leaguesContainer } =
    createContainers();

  const [ordersResult, customEventsResult, leagueDocumentsResult] = await Promise.all([
    ordersContainer.items.query(`SELECT * FROM c WHERE c.state = "pending"`).fetchAll(),
    customEventsContainer.items
      .query(
        `SELECT * FROM c WHERE c.status = "${ACTIVE_EVENT_STATUS}" OR c.status = "${LOCKED_EVENT_STATUS}"`
      )
      .fetchAll(),
    leaguesContainer.items.query("SELECT * FROM c").fetchAll(),
  ]);

  const fixtureMap = mergeFixturesFromLeagueDocuments(leagueDocumentsResult.resources || []);
  const pendingOrders = Array.isArray(ordersResult.resources) ? ordersResult.resources : [];
  const customEvents = Array.isArray(customEventsResult.resources) ? customEventsResult.resources : [];
  const customEventsById = {};
  customEvents.forEach((event) => {
    customEventsById[event.id] = event;
  });

  const settledOrders = [];
  const standardOrders = pendingOrders.filter((order) => order.order_source !== "custom_event");
  const customOrdersByEventId = {};

  pendingOrders
    .filter((order) => order.order_source === "custom_event" && order.custom_event_id)
    .forEach((order) => {
      if (!customOrdersByEventId[order.custom_event_id]) {
        customOrdersByEventId[order.custom_event_id] = [];
      }
      customOrdersByEventId[order.custom_event_id].push(order);
    });

  for (const order of standardOrders) {
    const settledOrder = await settleStandardOrder({
      order,
      fixtureMap,
      ordersContainer,
      usersContainer,
    });
    if (settledOrder) {
      settledOrders.push(settledOrder);
    }
  }

  for (const eventId of Object.keys(customOrdersByEventId)) {
    const event = customEventsById[eventId];
    if (!event) {
      continue;
    }
    const fixture = fixtureMap[Number(event.fixture_id)];
    const result = await settleCustomEventGroup({
      event,
      orders: customOrdersByEventId[eventId],
      fixture,
      ordersContainer,
      usersContainer,
      customEventsContainer,
      notificationRepository: repository,
      now,
    });
    settledOrders.push(...result);
  }

  for (const event of customEvents) {
    if (customOrdersByEventId[event.id]) {
      continue;
    }

    const fixture = fixtureMap[Number(event.fixture_id)];
    const fixtureStatus = getFixtureStatus(fixture);
    if (!fixtureStatus || !FINAL_FIXTURE_STATUSES.has(fixtureStatus)) {
      continue;
    }

    await settleCustomEventGroup({
      event,
      orders: [],
      fixture,
      ordersContainer,
      usersContainer,
      customEventsContainer,
      notificationRepository: repository,
      now,
    });
  }

  return settledOrders;
};

module.exports = {
  runOrderSettlementSweep,
};
