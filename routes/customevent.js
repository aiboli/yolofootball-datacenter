var express = require("express");
var router = express.Router();

const CosmosClient = require("@azure/cosmos").CosmosClient;

const ACTIVE_EVENT_STATUS = "active";
const SUPPORTED_EVENT_STATUSES = new Set([
  "active",
  "locked",
  "completed",
  "canceled",
]);
const SUPPORTED_FIXTURE_STATES = new Set([
  "notstarted",
  "ongoing",
  "finished",
  "canceled",
]);
const SUPPORTED_MARKET = "match_winner";
const EXPECTED_OPTION_SHAPE = [
  { result: 0, label: "Home" },
  { result: 1, label: "Draw" },
  { result: 2, label: "Away" },
];

const createDatabaseClient = () => {
  const config = {
    endpoint: "https://yolofootball-database.documents.azure.com:443/",
    key: "hOicNBuPcYclHNG3UHZA9zGKhXp9zrTeoxbagVWBWRql4nXsEbOykJkyxfKMA2cEOGuwvMAMIES8Ssg81bppFA==",
    databaseId: "yolofootball",
  };
  const client = new CosmosClient({
    endpoint: config.endpoint,
    key: config.key,
  });
  const database = client.database(config.databaseId);

  return {
    database,
    customEventsContainer: database.container("customevents"),
    usersContainer: database.container("users"),
  };
};

const escapeCosmosString = (value) => String(value).replace(/"/g, '\\"');

const normalizeFixtureId = (fixtureId) => {
  if (typeof fixtureId === "string" && fixtureId.includes("@")) {
    return parseInt(fixtureId.split("@")[1], 10);
  }

  return parseInt(fixtureId, 10);
};

const serializeEvent = (event) => ({
  id: event.id,
  fixture_id: parseInt(event.fixture_id, 10),
  fixture_state: event.fixture_state || "notstarted",
  created_by: event.created_by,
  create_date: event.create_date,
  status: event.status,
  market: event.market || event?.odd_data?.market || "match_winner",
  odd_data: event.odd_data,
});

const serializeDashboardEvent = (event) => ({
  id: event.id,
  fixture_id: parseInt(event.fixture_id, 10),
  fixture_state: event.fixture_state || "notstarted",
  created_by: event.created_by,
  create_date: event.create_date,
  status: event.status,
  market: event.market || event?.odd_data?.market || "match_winner",
  odd_data: event.odd_data,
  pool_fund: Number(event.pool_fund || 0),
  matched_pool_fund: Number(event.matched_pool_fund || 0),
  invested_pool_fund: Number(event.invested_pool_fund || 0),
  actual_return: Number(event.actual_return || 0),
  associated_order_ids: Array.isArray(event.associated_order_ids)
    ? event.associated_order_ids
    : [],
});

const normalizeCreatorFilter = (value) => {
  if (typeof value !== "string") {
    return null;
  }

  const trimmedValue = value.trim();
  return trimmedValue.length > 0 ? trimmedValue : null;
};

const normalizeFixtureState = (value, fallbackValue = "notstarted") => {
  return SUPPORTED_FIXTURE_STATES.has(value) ? value : fallbackValue;
};

const normalizeStatus = (value, fallbackValue = ACTIVE_EVENT_STATUS) => {
  return SUPPORTED_EVENT_STATUSES.has(value) ? value : fallbackValue;
};

const normalizeOddData = (oddData) => {
  if (
    !oddData ||
    oddData.market !== SUPPORTED_MARKET ||
    !Array.isArray(oddData.options) ||
    oddData.options.length !== EXPECTED_OPTION_SHAPE.length
  ) {
    return null;
  }

  const oddsByResult = {};
  oddData.options.forEach((option) => {
    const result = parseInt(option?.result, 10);
    const odd = parseFloat(option?.odd);

    if (Number.isInteger(result) && Number.isFinite(odd) && odd > 0) {
      oddsByResult[result] = odd;
    }
  });

  const normalizedOptions = EXPECTED_OPTION_SHAPE.map((expectedOption) => {
    if (!Object.prototype.hasOwnProperty.call(oddsByResult, expectedOption.result)) {
      return null;
    }

    return {
      result: expectedOption.result,
      label: expectedOption.label,
      odd: oddsByResult[expectedOption.result],
    };
  });

  if (normalizedOptions.some((option) => !option)) {
    return null;
  }

  return {
    market: SUPPORTED_MARKET,
    options: normalizedOptions,
  };
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

const normalizeEventHistoryEntry = (eventHistoryEntry) => {
  const info =
    typeof eventHistoryEntry?.info === "string" && eventHistoryEntry.info.trim().length > 0
      ? eventHistoryEntry.info.trim()
      : "update custom event";

  return {
    time: eventHistoryEntry?.time || new Date(),
    info,
  };
};

const applyEventUpdates = (currentEvent, body) => {
  const nextEvent = {
    ...currentEvent,
  };

  if (body?.status) {
    nextEvent.status = normalizeStatus(body.status);
  }
  if (body?.odd_data) {
    nextEvent.odd_data = normalizeOddData(body.odd_data) || currentEvent.odd_data;
  }
  if (body?.fixture_state) {
    nextEvent.fixture_state = normalizeFixtureState(body.fixture_state, currentEvent.fixture_state);
  }

  nextEvent.event_history = Array.isArray(currentEvent.event_history)
    ? [...currentEvent.event_history]
    : [];
  nextEvent.event_history.push(normalizeEventHistoryEntry(body?.event_history_entry));

  return nextEvent;
};

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

const updateUserCreatedBidIds = async (usersContainer, userName, eventId) => {
  if (!userName) {
    return;
  }

  const query = {
    query: `SELECT * FROM c user WHERE user.user_name = "${escapeCosmosString(userName)}"`,
  };
  const readUsers = await usersContainer.items.query(query).fetchAll();
  if (!readUsers.resources || readUsers.resources.length === 0) {
    return;
  }

  const currentUser = readUsers.resources[0];
  const createdBidIds = Array.isArray(currentUser.created_bid_ids)
    ? currentUser.created_bid_ids
    : [];
  if (!createdBidIds.includes(eventId)) {
    createdBidIds.push(eventId);
  }
  currentUser.created_bid_ids = createdBidIds;
  await usersContainer.item(currentUser.id, currentUser.id).replace(currentUser);
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
    const query = {
      query: `SELECT * FROM c WHERE c.id = "${escapeCosmosString(req.query.id)}"`,
    };
    const result = await customEventsContainer.items.query(query).fetchAll();
    if (!result.resources || result.resources.length === 0) {
      return res.status(404).json({ error: "custom event not found" });
    }

    return res.status(200).json(result.resources[0]);
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
      normalizedEventIds.ids
        .map((id) => eventsById[id])
        .filter((event) => !!event)
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
  try {
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

    const { customEventsContainer, usersContainer } = createDatabaseClient();
    const eventToCreate = {
      create_date: new Date().getTime(),
      fixture_id: fixtureId,
      fixture_state: normalizeFixtureState(req.body?.fixture_state),
      market: SUPPORTED_MARKET,
      odd_data: normalizedOddData,
      status: normalizeStatus(req.body?.status),
      event_history: Array.isArray(req.body?.event_history) ? req.body.event_history : [],
      pool_fund: Number(req.body?.pool_fund || 0),
      matched_pool_fund: Number(req.body?.matched_pool_fund || 0),
      invested_pool_fund: Number(req.body?.invested_pool_fund || 0),
      associated_order_ids: Array.isArray(req.body?.associated_order_ids)
        ? req.body.associated_order_ids
        : [],
      actual_return: Number(req.body?.actual_return || 0),
      created_by:
        normalizeCreatorFilter(req.body?.created_by) ||
        normalizeCreatorFilter(req.body?.user_name) ||
        "ano",
    };

    const createResult = await customEventsContainer.items.create(eventToCreate);
    const createdEvent = createResult.resource;
    await updateUserCreatedBidIds(usersContainer, req.body?.user_name, createdEvent.id);
    return res.status(200).json(createdEvent);
  } catch (error) {
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
      !SUPPORTED_FIXTURE_STATES.has(req.body.fixture_state)
    ) {
      return res.status(400).json({ error: "unsupported fixture_state" });
    }

    const { customEventsContainer } = createDatabaseClient();
    const eventResponse = await customEventsContainer.item(eventId, eventId).read();
    const currentEvent = eventResponse.resource;
    if (!currentEvent) {
      return res.sendStatus(404);
    }

    const updateResult = await customEventsContainer
      .item(eventId, eventId)
      .replace(applyEventUpdates(currentEvent, req.body || {}));
    return res.status(200).json(updateResult.resource);
  } catch (error) {
    return next(error);
  }
});

module.exports = router;
module.exports._private = {
  escapeCosmosString,
  normalizeFixtureId,
  serializeEvent,
  serializeDashboardEvent,
  normalizeCreatorFilter,
  normalizeFixtureState,
  normalizeStatus,
  normalizeOddData,
  normalizeSearchPayload,
  buildSearchQuery,
  groupEventsByFixture,
  normalizeEventIds,
  normalizeEventHistoryEntry,
  applyEventUpdates,
};
