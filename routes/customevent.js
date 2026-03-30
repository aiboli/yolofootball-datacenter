var express = require("express");
var router = express.Router();
const { randomUUID } = require("crypto");
const { createDatabase } = require("../common/database");
const { createNotificationRepository } = require("../common/notificationRepository");
const {
  buildCustomEventBetPlacedNotification,
} = require("../common/notifications");
const {
  ACTIVE_EVENT_STATUS,
  CANCELED_EVENT_STATUS,
  COMPLETED_EVENT_STATUS,
  EXPECTED_OPTION_SHAPE,
  LOCKED_EVENT_STATUS,
  SUPPORTED_EVENT_STATUSES,
  normalizeFixtureId,
  normalizeFixtureState,
  normalizeOddData,
  normalizeStatus,
  hydrateCustomEvent,
  calculateExposureForStake,
  getOptionForResult,
  buildEmptyLiabilityByResult,
  buildEventHistoryEntry,
  toCurrency,
} = require("../common/customEvent");

const notificationRepository = createNotificationRepository();

const createDatabaseClient = () => {
  const database = createDatabase();

  return {
    database,
    customEventsContainer: database.container("customevents"),
    usersContainer: database.container("users"),
    ordersContainer: database.container("orders"),
  };
};

const escapeCosmosString = (value) => String(value).replace(/"/g, '\\"');

const normalizeCreatorFilter = (value) => {
  if (typeof value !== "string") {
    return null;
  }

  const trimmedValue = value.trim();
  return trimmedValue.length > 0 ? trimmedValue : null;
};

const normalizePositiveAmount = (value) => {
  const numericValue = Number.parseFloat(value);
  if (!Number.isFinite(numericValue) || numericValue <= 0) {
    return null;
  }

  return toCurrency(numericValue);
};

const normalizeNonNegativeAmount = (value) => {
  const numericValue = Number.parseFloat(value);
  if (!Number.isFinite(numericValue) || numericValue < 0) {
    return null;
  }

  return toCurrency(numericValue);
};

const normalizeSearchPayload = (body) => {
  const fixtureIds = Array.isArray(body?.fixture_ids)
    ? body.fixture_ids
        .map((fixtureId) => normalizeFixtureId(fixtureId))
        .filter((fixtureId) => Number.isInteger(fixtureId))
    : [];
  const createdBy = normalizeCreatorFilter(body?.created_by);
  const excludeCreatedBy = normalizeCreatorFilter(body?.exclude_created_by);

  return {
    fixtureIds,
    status: body?.status || ACTIVE_EVENT_STATUS,
    createdBy,
    excludeCreatedBy,
    hasInvalidFixtureIds:
      Array.isArray(body?.fixture_ids) && fixtureIds.length !== body.fixture_ids.length,
    hasConflictingCreatorFilters: !!createdBy && !!excludeCreatedBy,
    hasInvalidStatus:
      body?.status !== undefined && !SUPPORTED_EVENT_STATUSES.has(body?.status),
  };
};

const buildSearchQuery = ({ fixtureIds, status, excludeCreatedBy, createdBy }) => {
  const filters = [];
  if (Array.isArray(fixtureIds) && fixtureIds.length > 0) {
    filters.push(`c.fixture_id IN (${fixtureIds.join(",")})`);
  }
  if (status) {
    filters.push(`c.status = "${escapeCosmosString(status)}"`);
  }
  if (excludeCreatedBy) {
    filters.push(`c.created_by != "${escapeCosmosString(excludeCreatedBy)}"`);
  }
  if (createdBy) {
    filters.push(`c.created_by = "${escapeCosmosString(createdBy)}"`);
  }

  return `SELECT * FROM c${filters.length > 0 ? ` WHERE ${filters.join(" AND ")}` : ""}`;
};

const groupEventsByFixture = (events) => {
  const groupedEvents = {};

  events.forEach((event) => {
    const serializedEvent = serializeEvent(event);
    const fixtureKey = String(serializedEvent.fixture_id);
    if (!groupedEvents[fixtureKey]) {
      groupedEvents[fixtureKey] = [];
    }
    groupedEvents[fixtureKey].push(serializedEvent);
  });

  return groupedEvents;
};

const normalizeEventIds = (ids) => {
  if (!Array.isArray(ids)) {
    return {
      ids: [],
      hasInvalidIds: false,
    };
  }

  const normalizedIds = ids
    .filter((id) => typeof id === "string")
    .map((id) => id.trim())
    .filter((id) => id.length > 0);

  return {
    ids: normalizedIds,
    hasInvalidIds: normalizedIds.length !== ids.length,
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

const findUserByName = async (usersContainer, userName) => {
  const query = {
    query: `SELECT * FROM c user WHERE user.user_name = "${escapeCosmosString(userName)}"`,
  };
  const readUsers = await usersContainer.items.query(query).fetchAll();
  return readUsers.resources?.[0] || null;
};

const readEventById = async (customEventsContainer, eventId) => {
  const eventResponse = await customEventsContainer.item(eventId, eventId).read();
  return eventResponse.resource || null;
};

const changeUserBalance = async (
  usersContainer,
  userName,
  delta,
  { rejectInsufficientFunds = false } = {}
) => {
  const currentUser = await findUserByName(usersContainer, userName);
  if (!currentUser) {
    const error = new Error("user not found");
    error.statusCode = 404;
    throw error;
  }

  const nextBalance = toCurrency(Number(currentUser.account_balance || 0) + Number(delta || 0));
  if (rejectInsufficientFunds && nextBalance < 0) {
    const error = new Error("insufficient balance");
    error.statusCode = 409;
    throw error;
  }

  currentUser.account_balance = nextBalance;
  const replaceResult = await replaceDocument(usersContainer, currentUser.id, currentUser);
  return replaceResult.resource;
};

const updateUserCreatedBidIds = async (usersContainer, userName, eventId) => {
  if (!userName) {
    return;
  }

  const currentUser = await findUserByName(usersContainer, userName);
  if (!currentUser) {
    return;
  }

  const createdBidIds = Array.isArray(currentUser.created_bid_ids)
    ? currentUser.created_bid_ids
    : [];
  if (!createdBidIds.includes(eventId)) {
    createdBidIds.push(eventId);
  }
  currentUser.created_bid_ids = createdBidIds;
  await replaceDocument(usersContainer, currentUser.id, currentUser);
};

const updateUserOrderIds = async (
  usersContainer,
  userName,
  orderId,
  { remove = false } = {}
) => {
  if (!userName || !orderId) {
    return;
  }

  const currentUser = await findUserByName(usersContainer, userName);
  if (!currentUser) {
    const error = new Error("user not found");
    error.statusCode = 404;
    throw error;
  }

  const orderIds = Array.isArray(currentUser.order_ids) ? currentUser.order_ids : [];
  currentUser.order_ids = remove
    ? orderIds.filter((currentOrderId) => currentOrderId !== orderId)
    : orderIds.includes(orderId)
      ? orderIds
      : orderIds.concat(orderId);

  await replaceDocument(usersContainer, currentUser.id, currentUser);
};

const serializeEvent = (event) => {
  const hydratedEvent = hydrateCustomEvent(event);

  return {
    id: hydratedEvent.id,
    fixture_id: hydratedEvent.fixture_id,
    fixture_state: hydratedEvent.fixture_state,
    created_by: hydratedEvent.created_by,
    create_date: hydratedEvent.create_date,
    status: hydratedEvent.status,
    market: hydratedEvent.market,
    odd_data: hydratedEvent.odd_data,
    pool_fund: hydratedEvent.pool_fund,
    matched_pool_fund: hydratedEvent.matched_pool_fund,
    invested_pool_fund: hydratedEvent.invested_pool_fund,
    actual_return: hydratedEvent.actual_return,
    associated_order_ids: hydratedEvent.associated_order_ids,
    liability_by_result: hydratedEvent.liability_by_result,
    max_stake_by_result: hydratedEvent.max_stake_by_result,
    remaining_liability: hydratedEvent.remaining_liability,
    bet_count: hydratedEvent.bet_count,
    can_accept_bets: hydratedEvent.can_accept_bets,
    settlement_summary: hydratedEvent.settlement_summary,
  };
};

const serializeDashboardEvent = (event) => ({
  ...serializeEvent(event),
  event_history: Array.isArray(event?.event_history) ? event.event_history : [],
});

const serializeOrder = (order) => ({
  id: order.id,
  orderdate: order.orderdate,
  fixture_id: normalizeFixtureId(order.fixture_id),
  fixtures_ids: Array.isArray(order.fixtures_ids)
    ? order.fixtures_ids.map((fixtureId) => normalizeFixtureId(fixtureId)).filter(Number.isInteger)
    : [],
  bet_result: Number.parseInt(order.bet_result, 10),
  odd_rate: Number.parseFloat(order.odd_rate),
  odd_mount: toCurrency(order.odd_mount || 0),
  win_return: toCurrency(order.win_return || 0),
  is_win: order.is_win === true,
  state: order.state || "pending",
  fixture_state: order.fixture_state || "notstarted",
  fixture_states: Array.isArray(order.fixture_states) ? order.fixture_states : [],
  actual_return: toCurrency(order.actual_return || 0),
  created_by: order.created_by || "ano",
  order_type: order.order_type || "single",
  selection_count: Number(order.selection_count || 1),
  selections: Array.isArray(order.selections) ? order.selections : [],
  order_source: order.order_source || "standard",
  custom_event_id: order.custom_event_id || null,
  counterparty_user_name: order.counterparty_user_name || null,
});

const searchEvents = async (req, res) => {
  const normalizedPayload = normalizeSearchPayload(req.body || {});

  if (normalizedPayload.hasInvalidFixtureIds) {
    return res.status(400).json({ error: "fixture_ids must contain valid fixture ids" });
  }
  if (normalizedPayload.hasConflictingCreatorFilters) {
    return res
      .status(400)
      .json({ error: "created_by and exclude_created_by cannot be combined" });
  }
  if (normalizedPayload.hasInvalidStatus) {
    return res.status(400).json({ error: "unsupported status" });
  }
  if (normalizedPayload.fixtureIds.length === 0) {
    return res.status(200).json({ events_by_fixture: {} });
  }

  const { customEventsContainer } = createDatabaseClient();
  const query = buildSearchQuery(normalizedPayload);
  const result = await customEventsContainer.items.query(query).fetchAll();

  return res.status(200).json({
    events_by_fixture: groupEventsByFixture(result.resources || []),
  });
};

const findPendingCustomEventOrder = async (ordersContainer, { eventId, userName }) => {
  const query = {
    query:
      `SELECT * FROM c WHERE c.custom_event_id = "${escapeCosmosString(eventId)}"` +
      ` AND c.created_by = "${escapeCosmosString(userName)}"` +
      ` AND c.order_source = "custom_event" AND c.state = "pending"`,
  };
  const result = await ordersContainer.items.query(query).fetchAll();
  return result.resources?.[0] || null;
};

const revertPlacedBet = async ({
  customEventsContainer,
  usersContainer,
  eventId,
  orderId,
  userName,
  betResult,
  stake,
  exposure,
}) => {
  try {
    const currentEvent = await readEventById(customEventsContainer, eventId);
    if (currentEvent) {
      const liabilityByResult = {
        ...buildEmptyLiabilityByResult(),
        ...(currentEvent.liability_by_result || {}),
      };
      const nextEvent = {
        ...currentEvent,
        liability_by_result: {
          ...liabilityByResult,
          [betResult]: toCurrency(Number(liabilityByResult[betResult] || 0) - exposure),
        },
        matched_pool_fund: toCurrency(Number(currentEvent.matched_pool_fund || 0) - stake),
        invested_pool_fund: toCurrency(Number(currentEvent.invested_pool_fund || 0) - stake),
        associated_order_ids: (Array.isArray(currentEvent.associated_order_ids)
          ? currentEvent.associated_order_ids
          : []
        ).filter((currentOrderId) => currentOrderId !== orderId),
        event_history: Array.isArray(currentEvent.event_history)
          ? currentEvent.event_history.concat(
              buildEventHistoryEntry("rollback custom event bet placement", {
                order_id: orderId,
              })
            )
          : [buildEventHistoryEntry("rollback custom event bet placement", { order_id: orderId })],
      };
      await replaceDocument(customEventsContainer, eventId, nextEvent);
    }
  } catch (error) {
    // Best-effort rollback. The order route keeps the mutation path explicit even when cleanup fails.
  }

  try {
    await changeUserBalance(usersContainer, userName, stake);
  } catch (error) {
    // Best-effort rollback.
  }

  try {
    await updateUserOrderIds(usersContainer, userName, orderId, {
      remove: true,
    });
  } catch (error) {
    // Best-effort rollback.
  }
};

router.get("/all", async function (req, res, next) {
  try {
    const { customEventsContainer } = createDatabaseClient();
    const result = await customEventsContainer.items.query("SELECT * FROM c").fetchAll();
    return res.status(200).json((result.resources || []).map(serializeEvent));
  } catch (error) {
    return next(error);
  }
});

router.get("/", async function (req, res, next) {
  try {
    if (!req.query?.id) {
      return res.status(400).json({ error: "id is required" });
    }

    const { customEventsContainer } = createDatabaseClient();
    const event = await readEventById(customEventsContainer, req.query.id);
    if (!event) {
      return res.status(404).json({ error: "custom event not found" });
    }

    return res.status(200).json(serializeDashboardEvent(event));
  } catch (error) {
    return next(error);
  }
});

router.post("/search", async function (req, res, next) {
  try {
    return await searchEvents(req, res);
  } catch (error) {
    return next(error);
  }
});

router.post("/bulk", async function (req, res, next) {
  try {
    const normalizedEventIds = normalizeEventIds(req.body?.ids);
    if (normalizedEventIds.hasInvalidIds) {
      return res.status(400).json({ error: "ids must contain valid event ids" });
    }

    if (normalizedEventIds.ids.length === 0) {
      return res.status(200).json([]);
    }

    const { customEventsContainer } = createDatabaseClient();
    const query = {
      query: `SELECT * FROM c WHERE c.id IN ("${normalizedEventIds.ids
        .map((id) => escapeCosmosString(id))
        .join('","')}")`,
    };
    const result = await customEventsContainer.items.query(query).fetchAll();
    const eventsById = {};
    (result.resources || []).forEach((event) => {
      eventsById[event.id] = serializeDashboardEvent(event);
    });

    return res.status(200).json(
      normalizedEventIds.ids.map((id) => eventsById[id]).filter((event) => !!event)
    );
  } catch (error) {
    return next(error);
  }
});

router.post("/customevents", async function (req, res, next) {
  try {
    req.body = {
      fixture_ids: req.body?.fixture_ids || req.body?.ids || [],
      status: req.body?.status,
      created_by: req.body?.created_by,
      exclude_created_by: req.body?.exclude_created_by,
    };
    return await searchEvents(req, res);
  } catch (error) {
    return next(error);
  }
});

router.post("/", async function (req, res, next) {
  const fixtureId = normalizeFixtureId(req.body?.fixture_id);
  if (!Number.isInteger(fixtureId)) {
    return res.status(400).json({ error: "fixture_id is required" });
  }

  const normalizedOddData = normalizeOddData(req.body?.odd_data);
  if (!normalizedOddData) {
    return res.status(400).json({ error: "odd_data is invalid" });
  }

  if (req.body?.status && !SUPPORTED_EVENT_STATUSES.has(req.body.status)) {
    return res.status(400).json({ error: "unsupported status" });
  }

  const poolFund = normalizeNonNegativeAmount(req.body?.pool_fund);
  if (poolFund === null) {
    return res.status(400).json({ error: "pool_fund must be a non-negative number" });
  }

  const createdBy =
    normalizeCreatorFilter(req.body?.created_by) ||
    normalizeCreatorFilter(req.body?.user_name) ||
    "ano";
  const { customEventsContainer, usersContainer } = createDatabaseClient();
  const hasAuthenticatedOwner = createdBy !== "ano";
  let hasDeductedOwnerBalance = false;
  let hasCreatedEvent = false;

  try {
    if (hasAuthenticatedOwner && poolFund > 0) {
      await changeUserBalance(usersContainer, createdBy, -poolFund, {
        rejectInsufficientFunds: true,
      });
      hasDeductedOwnerBalance = true;
    } else if (hasAuthenticatedOwner) {
      const user = await findUserByName(usersContainer, createdBy);
      if (!user) {
        return res.status(404).json({ error: "user not found" });
      }
    }

    const eventToCreate = {
      id: `customevent-${randomUUID()}`,
      create_date: new Date().getTime(),
      fixture_id: fixtureId,
      fixture_state: normalizeFixtureState(req.body?.fixture_state),
      market: normalizedOddData.market,
      odd_data: normalizedOddData,
      status: normalizeStatus(req.body?.status),
      event_history: Array.isArray(req.body?.event_history) ? req.body.event_history : [],
      pool_fund: poolFund,
      matched_pool_fund: 0,
      invested_pool_fund: 0,
      associated_order_ids: [],
      actual_return: 0,
      liability_by_result: buildEmptyLiabilityByResult(),
      settlement_summary: null,
      created_by: createdBy,
    };

    const createResult = await customEventsContainer.items.create(eventToCreate);
    const createdEvent = createResult.resource;
    hasCreatedEvent = true;

    if (hasAuthenticatedOwner) {
      try {
        await updateUserCreatedBidIds(usersContainer, createdBy, createdEvent.id);
      } catch (metadataError) {
        // Event creation should succeed even if the profile backlink update fails.
      }
    }

    return res.status(200).json(serializeDashboardEvent(createdEvent));
  } catch (error) {
    if (hasAuthenticatedOwner && poolFund > 0 && hasDeductedOwnerBalance && !hasCreatedEvent) {
      try {
        await changeUserBalance(usersContainer, createdBy, poolFund);
      } catch (rollbackError) {
        // Best-effort rollback.
      }
    }

    if (error?.statusCode) {
      return res.status(error.statusCode).json({ error: error.message });
    }
    return next(error);
  }
});

router.put("/:eventid/fund", async function (req, res, next) {
  const eventId = req.params?.eventid;
  const userName = normalizeCreatorFilter(req.body?.user_name);
  const additionalPoolFund = normalizePositiveAmount(req.body?.additional_pool_fund);

  if (!eventId || !userName) {
    return res.status(400).json({ error: "event id and user_name are required" });
  }
  if (additionalPoolFund === null) {
    return res.status(400).json({ error: "additional_pool_fund must be greater than 0" });
  }

  const { customEventsContainer, usersContainer } = createDatabaseClient();
  let hasDeductedOwnerBalance = false;

  try {
    const currentEvent = await readEventById(customEventsContainer, eventId);
    if (!currentEvent) {
      return res.status(404).json({ error: "custom event not found" });
    }
    if (currentEvent.created_by !== userName) {
      return res.status(403).json({ error: "you can only fund your own custom event" });
    }
    if (currentEvent.status !== ACTIVE_EVENT_STATUS) {
      return res.status(409).json({ error: "custom event can only be funded while active" });
    }

    await changeUserBalance(usersContainer, userName, -additionalPoolFund, {
      rejectInsufficientFunds: true,
    });
    hasDeductedOwnerBalance = true;

    currentEvent.pool_fund = toCurrency(Number(currentEvent.pool_fund || 0) + additionalPoolFund);
    currentEvent.fixture_state = normalizeFixtureState(
      req.body?.fixture_state,
      currentEvent.fixture_state
    );
    currentEvent.event_history = Array.isArray(currentEvent.event_history)
      ? currentEvent.event_history
      : [];
    currentEvent.event_history.push(
      buildEventHistoryEntry("fund custom event", {
        amount: additionalPoolFund,
      })
    );

    const updateResult = await replaceDocument(customEventsContainer, eventId, currentEvent);
    return res.status(200).json(serializeDashboardEvent(updateResult.resource));
  } catch (error) {
    if (error?.statusCode) {
      return res.status(error.statusCode).json({ error: error.message });
    }

    if (additionalPoolFund !== null && userName && hasDeductedOwnerBalance) {
      try {
        await changeUserBalance(usersContainer, userName, additionalPoolFund);
      } catch (rollbackError) {
        // Best-effort rollback.
      }
    }

    return next(error);
  }
});

router.put("/:eventid/cancel", async function (req, res, next) {
  const eventId = req.params?.eventid;
  const userName = normalizeCreatorFilter(req.body?.user_name);

  if (!eventId || !userName) {
    return res.status(400).json({ error: "event id and user_name are required" });
  }

  const { customEventsContainer, usersContainer } = createDatabaseClient();
  let refundedPoolFund = 0;
  let hasRefundedPoolFund = false;

  try {
    const currentEvent = await readEventById(customEventsContainer, eventId);
    if (!currentEvent) {
      return res.status(404).json({ error: "custom event not found" });
    }
    if (currentEvent.created_by !== userName) {
      return res.status(403).json({ error: "you can only cancel your own custom event" });
    }
    if (currentEvent.status !== ACTIVE_EVENT_STATUS) {
      return res.status(409).json({ error: "custom event can only be canceled while active" });
    }
    if (Array.isArray(currentEvent.associated_order_ids) && currentEvent.associated_order_ids.length > 0) {
      return res.status(409).json({ error: "custom event with linked orders cannot be canceled" });
    }

    refundedPoolFund = Number(currentEvent.pool_fund || 0);
    if (refundedPoolFund > 0) {
      await changeUserBalance(usersContainer, userName, refundedPoolFund);
      hasRefundedPoolFund = true;
    }

    currentEvent.status = CANCELED_EVENT_STATUS;
    currentEvent.fixture_state = normalizeFixtureState(
      req.body?.fixture_state,
      currentEvent.fixture_state
    );
    currentEvent.actual_return = toCurrency(currentEvent.pool_fund || 0);
    currentEvent.event_history = Array.isArray(currentEvent.event_history)
      ? currentEvent.event_history
      : [];
    currentEvent.event_history.push(
      buildEventHistoryEntry("cancel custom event", {
        refunded_pool_fund: toCurrency(currentEvent.pool_fund || 0),
      })
    );

    const updateResult = await replaceDocument(customEventsContainer, eventId, currentEvent);
    return res.status(200).json(serializeDashboardEvent(updateResult.resource));
  } catch (error) {
    if (refundedPoolFund > 0 && hasRefundedPoolFund) {
      try {
        await changeUserBalance(usersContainer, userName, -refundedPoolFund);
      } catch (rollbackError) {
        // Best-effort rollback.
      }
    }
    return next(error);
  }
});

router.post("/:eventid/bets", async function (req, res, next) {
  const eventId = req.params?.eventid;
  const userName = normalizeCreatorFilter(req.body?.user_name);
  const betResult = Number.parseInt(req.body?.bet_result, 10);
  const stake = normalizePositiveAmount(req.body?.stake);

  if (!eventId || !userName) {
    return res.status(400).json({ error: "event id and user_name are required" });
  }
  if (!EXPECTED_OPTION_SHAPE.some((option) => option.result === betResult)) {
    return res.status(400).json({ error: "bet_result must be Home, Draw, or Away" });
  }
  if (stake === null) {
    return res.status(400).json({ error: "stake must be greater than 0" });
  }

  const { customEventsContainer, usersContainer, ordersContainer } = createDatabaseClient();
  const orderId = `order-${randomUUID()}`;
  let hasDeductedBalance = false;
  let hasUpdatedEvent = false;
  let hasAppendedOrderId = false;
  let exposure = 0;

  try {
    const existingPendingOrder = await findPendingCustomEventOrder(ordersContainer, {
      eventId,
      userName,
    });
    if (existingPendingOrder) {
      return res.status(409).json({ error: "you already have an active bet on this custom event" });
    }

    const currentEvent = await readEventById(customEventsContainer, eventId);
    if (!currentEvent) {
      return res.status(404).json({ error: "custom event not found" });
    }
    if (currentEvent.created_by === userName) {
      return res.status(403).json({ error: "you cannot bet on your own custom event" });
    }
    if (currentEvent.status !== ACTIVE_EVENT_STATUS) {
      return res.status(409).json({ error: "custom event is not accepting bets" });
    }

    const hydratedEvent = hydrateCustomEvent(currentEvent);
    const selectedOption = getOptionForResult(hydratedEvent.odd_data, betResult);
    if (!selectedOption) {
      return res.status(400).json({ error: "custom event is missing the requested outcome" });
    }

    const maxStakeForResult = Number(hydratedEvent.max_stake_by_result?.[betResult] || 0);
    if (!Number.isFinite(maxStakeForResult) || maxStakeForResult <= 0) {
      return res.status(409).json({ error: "no stake capacity remains for this outcome" });
    }
    if (stake > maxStakeForResult) {
      return res.status(409).json({
        error: `stake exceeds the remaining max of ${maxStakeForResult.toFixed(2)}`,
      });
    }

    await changeUserBalance(usersContainer, userName, -stake, {
      rejectInsufficientFunds: true,
    });
    hasDeductedBalance = true;

    exposure = calculateExposureForStake(selectedOption.odd, stake);
    const eventLiabilityByResult = {
      ...buildEmptyLiabilityByResult(),
      ...(currentEvent.liability_by_result || {}),
    };
    currentEvent.liability_by_result = {
      ...eventLiabilityByResult,
      [betResult]: toCurrency(Number(eventLiabilityByResult[betResult] || 0) + exposure),
    };
    currentEvent.matched_pool_fund = toCurrency(
      Number(currentEvent.matched_pool_fund || 0) + stake
    );
    currentEvent.invested_pool_fund = toCurrency(
      Number(currentEvent.invested_pool_fund || 0) + stake
    );
    currentEvent.associated_order_ids = Array.isArray(currentEvent.associated_order_ids)
      ? currentEvent.associated_order_ids.concat(orderId)
      : [orderId];
    currentEvent.fixture_state = normalizeFixtureState(
      req.body?.fixture_state,
      currentEvent.fixture_state
    );
    currentEvent.event_history = Array.isArray(currentEvent.event_history)
      ? currentEvent.event_history
      : [];
    currentEvent.event_history.push(
      buildEventHistoryEntry("place custom event bet", {
        order_id: orderId,
        bet_result: betResult,
        stake,
        odd_rate: Number(selectedOption.odd),
        created_by: userName,
      })
    );

    const updatedEventResponse = await replaceDocument(customEventsContainer, eventId, currentEvent);
    const updatedEvent = updatedEventResponse.resource;
    hasUpdatedEvent = true;

    await updateUserOrderIds(usersContainer, userName, orderId);
    hasAppendedOrderId = true;

    const orderToCreate = {
      id: orderId,
      orderdate: new Date().getTime(),
      fixture_id: hydratedEvent.fixture_id,
      fixtures_ids: [hydratedEvent.fixture_id],
      bet_result: betResult,
      odd_rate: Number(selectedOption.odd),
      odd_mount: stake,
      win_return: toCurrency(stake * Number(selectedOption.odd)),
      is_win: false,
      state: "pending",
      fixture_state: hydratedEvent.fixture_state || "notstarted",
      fixture_states: [hydratedEvent.fixture_state || "notstarted"],
      actual_return: 0,
      created_by: userName,
      order_type: "single",
      selection_count: 1,
      selections: [
        {
          fixture_id: hydratedEvent.fixture_id,
          bet_result: betResult,
          odd_rate: Number(selectedOption.odd),
          fixture_state: hydratedEvent.fixture_state || "notstarted",
          market: hydratedEvent.market || "match_winner",
          selection: selectedOption.label,
        },
      ],
      order_source: "custom_event",
      custom_event_id: eventId,
      counterparty_user_name: hydratedEvent.created_by,
    };

    const orderCreateResult = await ordersContainer.items.create(orderToCreate);
    const createdOrder = orderCreateResult.resource;

    try {
      const notifications = [
        buildCustomEventBetPlacedNotification({
          event: updatedEvent,
          order: createdOrder,
        }),
      ].filter(Boolean);
      if (notifications.length > 0) {
        await notificationRepository.upsertNotifications(notifications);
      }
    } catch (notificationError) {
      // Notification failures should not fail the bet placement.
    }

    return res.status(200).json({
      event: serializeDashboardEvent(updatedEvent),
      order: serializeOrder(createdOrder),
    });
  } catch (error) {
    if (userName && (hasDeductedBalance || hasUpdatedEvent || hasAppendedOrderId)) {
      await revertPlacedBet({
        customEventsContainer,
        usersContainer,
        eventId,
        orderId,
        userName,
        betResult,
        stake,
        exposure: hasUpdatedEvent ? exposure : 0,
      });
    }

    if (error?.statusCode) {
      return res.status(error.statusCode).json({ error: error.message });
    }
    return next(error);
  }
});

router.put("/:eventid", async function (req, res, next) {
  try {
    const eventId = req.params?.eventid;
    if (!eventId) {
      return res.sendStatus(400);
    }
    if (req.body?.status && !SUPPORTED_EVENT_STATUSES.has(req.body.status)) {
      return res.status(400).json({ error: "unsupported status" });
    }
    if (req.body?.odd_data && !normalizeOddData(req.body.odd_data)) {
      return res.status(400).json({ error: "odd_data is invalid" });
    }
    if (
      req.body?.fixture_state !== undefined &&
      !["notstarted", "ongoing", "finished", "canceled"].includes(req.body.fixture_state)
    ) {
      return res.status(400).json({ error: "unsupported fixture_state" });
    }

    const { customEventsContainer } = createDatabaseClient();
    const currentEvent = await readEventById(customEventsContainer, eventId);
    if (!currentEvent) {
      return res.sendStatus(404);
    }

    if (req.body?.status) {
      currentEvent.status = normalizeStatus(req.body.status, currentEvent.status);
    }
    if (req.body?.odd_data) {
      currentEvent.odd_data = normalizeOddData(req.body.odd_data) || currentEvent.odd_data;
    }
    if (req.body?.fixture_state) {
      currentEvent.fixture_state = normalizeFixtureState(
        req.body.fixture_state,
        currentEvent.fixture_state
      );
    }
    currentEvent.event_history = Array.isArray(currentEvent.event_history)
      ? currentEvent.event_history
      : [];
    currentEvent.event_history.push(
      buildEventHistoryEntry(
        req.body?.event_history_entry?.info || "update custom event",
        req.body?.event_history_entry?.data
      )
    );

    const updateResult = await replaceDocument(customEventsContainer, eventId, currentEvent);
    return res.status(200).json(serializeDashboardEvent(updateResult.resource));
  } catch (error) {
    return next(error);
  }
});

module.exports = router;
module.exports._private = {
  escapeCosmosString,
  normalizeCreatorFilter,
  normalizeSearchPayload,
  buildSearchQuery,
  groupEventsByFixture,
  normalizeEventIds,
  serializeEvent,
  serializeDashboardEvent,
  serializeOrder,
  findPendingCustomEventOrder,
  normalizePositiveAmount,
  normalizeNonNegativeAmount,
};
