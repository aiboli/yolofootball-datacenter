const KICKOFF_LOOKAHEAD_MINUTES = 60;
const DEFAULT_LIST_LIMIT = 20;
const MAX_LIST_LIMIT = 50;
const KICKOFF_EXPIRY_HOURS = 24;
const ACTIVITY_EXPIRY_DAYS = 14;
const FINAL_FIXTURE_STATUSES = new Set(["FT", "AET", "PEN", "CANC", "ABD", "AWD", "WO"]);
const NOT_STARTED_FIXTURE_STATUS = "NS";
const ACTIVE_EVENT_STATUS = "active";
const LOCKED_EVENT_STATUS = "locked";
const CANCELED_EVENT_STATUS = "canceled";
const READ_STATUS = "read";
const UNREAD_STATUS = "unread";

const clampLimit = (value, fallbackValue = DEFAULT_LIST_LIMIT) => {
  const parsedValue = Number.parseInt(value, 10);
  if (!Number.isInteger(parsedValue) || parsedValue <= 0) {
    return fallbackValue;
  }

  return Math.min(parsedValue, MAX_LIST_LIMIT);
};

const toDate = (value) => {
  const parsedDate = value instanceof Date ? value : new Date(value);
  return Number.isNaN(parsedDate.getTime()) ? null : parsedDate;
};

const toIsoString = (value, fallbackValue = null) => {
  const parsedDate = toDate(value);
  return parsedDate ? parsedDate.toISOString() : fallbackValue;
};

const addDuration = (value, { minutes = 0, hours = 0, days = 0 } = {}) => {
  const baseDate = toDate(value);
  if (!baseDate) {
    return null;
  }

  const durationMs =
    minutes * 60 * 1000 + hours * 60 * 60 * 1000 + days * 24 * 60 * 60 * 1000;
  return new Date(baseDate.getTime() + durationMs).toISOString();
};

const getFixtureId = (fixture) => Number.parseInt(fixture?.fixture?.id, 10);

const getFixtureStatus = (fixture) => fixture?.fixture?.status?.short || null;

const getFixtureKickoff = (fixture) => toIsoString(fixture?.fixture?.date);

const getFixtureLeagueName = (fixture) => fixture?.league?.name || null;

const getFixtureTeams = (fixture) => ({
  home: fixture?.teams?.home?.name || null,
  away: fixture?.teams?.away?.name || null,
});

const getFixtureTitle = (fixture) => {
  const teams = getFixtureTeams(fixture);
  if (teams.home && teams.away) {
    return `${teams.home} vs ${teams.away}`;
  }

  return `Fixture ${getFixtureId(fixture) || ""}`.trim();
};

const isFixtureFinished = (fixture) => FINAL_FIXTURE_STATUSES.has(getFixtureStatus(fixture));

const resolveMatchWinnerResult = (fixture) => {
  const homeGoals = Number(
    fixture?.goals?.home ??
      fixture?.score?.fulltime?.home ??
      fixture?.score?.full_time?.home
  );
  const awayGoals = Number(
    fixture?.goals?.away ??
      fixture?.score?.fulltime?.away ??
      fixture?.score?.full_time?.away
  );

  if (!Number.isFinite(homeGoals) || !Number.isFinite(awayGoals)) {
    return null;
  }

  if (homeGoals > awayGoals) {
    return 0;
  }
  if (homeGoals === awayGoals) {
    return 1;
  }
  return 2;
};

const getPredictionResultLabel = (result) => {
  if (result === 0) {
    return "Home";
  }
  if (result === 1) {
    return "Draw";
  }
  if (result === 2) {
    return "Away";
  }
  return "Unknown";
};

const createNotificationId = (dedupeKey) =>
  `notification-${Buffer.from(String(dedupeKey)).toString("base64url")}`;

const buildNotificationRecord = ({
  userName,
  type,
  title,
  body,
  ctaPath,
  entityType,
  entityId,
  dedupeKey,
  createdAt,
  expiresAt,
  priority = "normal",
  metadata = {},
}) => ({
  id: createNotificationId(dedupeKey),
  user_name: userName,
  type,
  status: UNREAD_STATUS,
  title,
  body,
  cta_path: ctaPath,
  entity_type: entityType,
  entity_id: String(entityId),
  dedupe_key: dedupeKey,
  created_at: createdAt,
  read_at: null,
  expires_at: expiresAt,
  priority,
  metadata,
});

const isNotificationExpired = (notification, now = new Date()) => {
  const expiryDate = toDate(notification?.expires_at);
  if (!expiryDate) {
    return false;
  }

  const nowDate = toDate(now) || new Date();
  return expiryDate.getTime() <= nowDate.getTime();
};

const filterNotifications = (notifications, { status, now = new Date(), limit } = {}) =>
  (Array.isArray(notifications) ? notifications : [])
    .filter((notification) => !!notification?.user_name)
    .filter((notification) => !isNotificationExpired(notification, now))
    .filter((notification) => {
      if (!status) {
        return true;
      }

      return notification.status === status;
    })
    .sort(
      (left, right) =>
        new Date(right?.created_at || 0).getTime() - new Date(left?.created_at || 0).getTime()
    )
    .slice(0, clampLimit(limit, Array.isArray(notifications) ? notifications.length : DEFAULT_LIST_LIMIT));

const matchesFixtureFollow = (user, fixture) => {
  const favoriteTeams = Array.isArray(user?.favorite_teams) ? user.favorite_teams : [];
  const favoriteLeagues = Array.isArray(user?.favorite_leagues) ? user.favorite_leagues : [];
  const teams = getFixtureTeams(fixture);
  const leagueName = getFixtureLeagueName(fixture);

  return {
    isMatch:
      favoriteTeams.includes(teams.home) ||
      favoriteTeams.includes(teams.away) ||
      favoriteLeagues.includes(leagueName),
    teams,
    leagueName,
  };
};

const buildFixtureKickoffNotification = (user, fixture, now = new Date()) => {
  const fixtureId = getFixtureId(fixture);
  const kickoff = toDate(getFixtureKickoff(fixture));
  const currentTime = toDate(now) || new Date();
  if (!fixtureId || !kickoff || getFixtureStatus(fixture) !== NOT_STARTED_FIXTURE_STATUS) {
    return null;
  }

  const minutesUntilKickoff = (kickoff.getTime() - currentTime.getTime()) / (60 * 1000);
  if (minutesUntilKickoff < 0 || minutesUntilKickoff > KICKOFF_LOOKAHEAD_MINUTES) {
    return null;
  }

  const followMatch = matchesFixtureFollow(user, fixture);
  if (!followMatch.isMatch || !user?.user_name) {
    return null;
  }

  const createdAt = currentTime.toISOString();
  const dedupeKey = `fixture_kickoff:${user.user_name}:${fixtureId}`;
  return buildNotificationRecord({
    userName: user.user_name,
    type: "fixture_kickoff",
    title: `${getFixtureTitle(fixture)} kicks off soon`,
    body: `Kickoff is less than ${KICKOFF_LOOKAHEAD_MINUTES} minutes away for a match tied to your follows.`,
    ctaPath: `/?fixture=${fixtureId}`,
    entityType: "fixture",
    entityId: fixtureId,
    dedupeKey,
    createdAt,
    expiresAt: addDuration(kickoff, { hours: KICKOFF_EXPIRY_HOURS }),
    priority: "high",
    metadata: {
      fixture_id: fixtureId,
      kickoff: kickoff.toISOString(),
      league_name: followMatch.leagueName,
      home_team: followMatch.teams.home,
      away_team: followMatch.teams.away,
    },
  });
};

const buildPredictionResultNotification = (user, prediction, fixture, now = new Date()) => {
  const fixtureId = Number.parseInt(prediction?.fixture_id, 10);
  if (!user?.user_name || !fixtureId || !fixture || !isFixtureFinished(fixture)) {
    return null;
  }

  const actualResult = resolveMatchWinnerResult(fixture);
  if (!Number.isInteger(actualResult)) {
    return null;
  }

  const predictedResult = Number.parseInt(prediction?.predicted_result, 10);
  if (!Number.isInteger(predictedResult)) {
    return null;
  }

  const isCorrect = predictedResult === actualResult;
  const createdAt = toIsoString(now, new Date().toISOString());
  const dedupeKey = `prediction_result:${user.user_name}:${fixtureId}:${actualResult}`;

  return buildNotificationRecord({
    userName: user.user_name,
    type: "prediction_result",
    title: isCorrect
      ? `You nailed ${getFixtureTitle(fixture)}`
      : `Prediction settled for ${getFixtureTitle(fixture)}`,
    body: isCorrect
      ? `Your ${getPredictionResultLabel(predictedResult)} call was correct.`
      : `You picked ${getPredictionResultLabel(
          predictedResult
        )}, but the final result was ${getPredictionResultLabel(actualResult)}.`,
    ctaPath: "/user",
    entityType: "prediction",
    entityId: fixtureId,
    dedupeKey,
    createdAt,
    expiresAt: addDuration(createdAt, { days: ACTIVITY_EXPIRY_DAYS }),
    priority: isCorrect ? "high" : "normal",
    metadata: {
      fixture_id: fixtureId,
      predicted_result: predictedResult,
      actual_result: actualResult,
      result: isCorrect ? "won" : "lost",
    },
  });
};

const resolveOrderNotificationOutcome = (order) => {
  const state = typeof order?.state === "string" ? order.state.toLowerCase() : "";
  if (["won", "lost", "void", "canceled"].includes(state)) {
    return state;
  }
  if (state !== "completed") {
    return null;
  }
  if (order?.is_win === true) {
    return "won";
  }

  const actualReturn = Number(order?.actual_return || 0);
  if (actualReturn > 0) {
    return "void";
  }
  if (actualReturn === 0) {
    return "lost";
  }
  return "completed";
};

const buildOrderSettledNotification = (order, fixture, now = new Date()) => {
  const userName = typeof order?.created_by === "string" ? order.created_by : "";
  const orderId = typeof order?.id === "string" ? order.id : "";
  const outcome = resolveOrderNotificationOutcome(order);
  if (!userName || !orderId || !outcome || userName === "ano") {
    return null;
  }

  const fixtureId = Number.parseInt(order?.fixture_id, 10);
  const fixtureTitle = fixture ? getFixtureTitle(fixture) : "your order";
  const createdAt = toIsoString(now, new Date().toISOString());
  const dedupeKey = `order_settled:${userName}:${orderId}:${outcome}`;
  const outcomeTitleMap = {
    won: "won",
    lost: "lost",
    void: "was settled",
    canceled: "was canceled",
    completed: "was completed",
  };

  return buildNotificationRecord({
    userName,
    type: "order_settled",
    title: `Order ${outcomeTitleMap[outcome] || "updated"} on ${fixtureTitle}`,
    body:
      outcome === "won"
        ? "A settled order finished as a win."
        : outcome === "lost"
          ? "A settled order finished as a loss."
          : outcome === "canceled"
            ? "One of your orders was canceled."
            : "One of your orders has a new settlement status.",
    ctaPath: "/user",
    entityType: "order",
    entityId: orderId,
    dedupeKey,
    createdAt,
    expiresAt: addDuration(createdAt, { days: ACTIVITY_EXPIRY_DAYS }),
    priority: outcome === "won" ? "high" : "normal",
    metadata: {
      order_id: orderId,
      fixture_id: fixtureId || null,
      outcome,
    },
  });
};

const getCustomEventNotificationStatus = (event, fixture) => {
  if (event?.status === CANCELED_EVENT_STATUS) {
    return CANCELED_EVENT_STATUS;
  }
  if (event?.status === LOCKED_EVENT_STATUS) {
    return LOCKED_EVENT_STATUS;
  }
  if (event?.status === ACTIVE_EVENT_STATUS && getFixtureStatus(fixture) !== NOT_STARTED_FIXTURE_STATUS) {
    return LOCKED_EVENT_STATUS;
  }

  return null;
};

const buildCustomEventStatusNotification = (event, fixture, now = new Date()) => {
  const userName = typeof event?.created_by === "string" ? event.created_by : "";
  const eventId = typeof event?.id === "string" ? event.id : "";
  const notificationStatus = getCustomEventNotificationStatus(event, fixture);
  if (!userName || !eventId || !notificationStatus || userName === "ano") {
    return null;
  }

  const fixtureId = Number.parseInt(event?.fixture_id, 10);
  const fixtureTitle = fixture ? getFixtureTitle(fixture) : `fixture ${fixtureId}`;
  const fixtureStatus = getFixtureStatus(fixture);
  const isFixtureUnavailable =
    event?.fixture_state === "canceled" ||
    ["PST", "CANC", "ABD", "AWD", "WO"].includes(fixtureStatus);
  const createdAt = toIsoString(now, new Date().toISOString());
  const dedupeKey = `custom_event_status:${userName}:${eventId}:${notificationStatus}`;

  return buildNotificationRecord({
    userName,
    type: "custom_event_status",
    title:
      notificationStatus === CANCELED_EVENT_STATUS
        ? `Custom odds canceled for ${fixtureTitle}`
        : `Custom odds locked for ${fixtureTitle}`,
    body:
      notificationStatus === CANCELED_EVENT_STATUS
        ? "Your custom odds post is no longer active."
        : isFixtureUnavailable
          ? "This fixture is no longer in a bettable pre-kickoff state, so this custom odds post was locked."
          : "Kickoff has passed, so this custom odds post is now locked.",
    ctaPath: fixtureId ? `/?fixture=${fixtureId}` : "/",
    entityType: "custom_event",
    entityId: eventId,
    dedupeKey,
    createdAt,
    expiresAt: addDuration(createdAt, { days: ACTIVITY_EXPIRY_DAYS }),
    priority: "normal",
    metadata: {
      event_id: eventId,
      fixture_id: fixtureId || null,
      status: notificationStatus,
    },
  });
};

const buildCustomEventBetPlacedNotification = ({ event, order, fixture = null, now = new Date() }) => {
  const userName = typeof event?.created_by === "string" ? event.created_by : "";
  const eventId = typeof event?.id === "string" ? event.id : "";
  const orderId = typeof order?.id === "string" ? order.id : "";
  const bettorUserName = typeof order?.created_by === "string" ? order.created_by : "A bettor";
  if (!userName || !eventId || !orderId || userName === "ano") {
    return null;
  }

  const fixtureId = Number.parseInt(event?.fixture_id, 10);
  const fixtureTitle = fixture ? getFixtureTitle(fixture) : `fixture ${fixtureId}`;
  const betResult = Number.parseInt(order?.bet_result, 10);
  const stake = Number(order?.odd_mount || 0);
  const oddRate = Number(order?.odd_rate || 0);
  const createdAt = toIsoString(now, new Date().toISOString());
  const dedupeKey = `custom_event_bet_placed:${userName}:${eventId}:${orderId}`;

  return buildNotificationRecord({
    userName,
    type: "custom_event_bet_placed",
    title: `New bet on your custom odds for ${fixtureTitle}`,
    body: `${bettorUserName} backed ${getPredictionResultLabel(
      betResult
    )} with ${stake.toFixed(2)} at ${oddRate.toFixed(2)}.`,
    ctaPath: fixtureId ? `/?fixture=${fixtureId}` : "/user",
    entityType: "custom_event",
    entityId: eventId,
    dedupeKey,
    createdAt,
    expiresAt: addDuration(createdAt, { days: ACTIVITY_EXPIRY_DAYS }),
    priority: "normal",
    metadata: {
      event_id: eventId,
      order_id: orderId,
      bettor_user_name: bettorUserName,
      fixture_id: fixtureId || null,
      bet_result: Number.isInteger(betResult) ? betResult : null,
      stake,
      odd_rate: oddRate,
    },
  });
};

const buildCustomEventSettledNotification = ({ event, fixture = null, now = new Date() }) => {
  const userName = typeof event?.created_by === "string" ? event.created_by : "";
  const eventId = typeof event?.id === "string" ? event.id : "";
  if (!userName || !eventId || userName === "ano") {
    return null;
  }

  const settlementSummary =
    event?.settlement_summary && typeof event.settlement_summary === "object"
      ? event.settlement_summary
      : null;
  if (!settlementSummary || !settlementSummary.outcome) {
    return null;
  }

  const fixtureId = Number.parseInt(event?.fixture_id, 10);
  const fixtureTitle = fixture ? getFixtureTitle(fixture) : `fixture ${fixtureId}`;
  const createdAt = toIsoString(now, new Date().toISOString());
  const dedupeKey = `custom_event_settled:${userName}:${eventId}:${settlementSummary.outcome}`;
  const ownerCredit = Number(settlementSummary.owner_credit || 0);

  return buildNotificationRecord({
    userName,
    type: "custom_event_settled",
    title: `Custom odds settled for ${fixtureTitle}`,
    body:
      settlementSummary.outcome === "void"
        ? "Your custom odds market was voided and the reserved pool was released."
        : `Your custom odds market settled. Owner credit: ${ownerCredit.toFixed(2)}.`,
    ctaPath: fixtureId ? `/?fixture=${fixtureId}` : "/user",
    entityType: "custom_event",
    entityId: eventId,
    dedupeKey,
    createdAt,
    expiresAt: addDuration(createdAt, { days: ACTIVITY_EXPIRY_DAYS }),
    priority: ownerCredit > 0 ? "high" : "normal",
    metadata: {
      event_id: eventId,
      fixture_id: fixtureId || null,
      owner_credit: ownerCredit,
      outcome: settlementSummary.outcome,
      result:
        settlementSummary.result !== undefined && settlementSummary.result !== null
          ? Number(settlementSummary.result)
          : null,
    },
  });
};

const mergeFixturesFromLeagueDocuments = (leagueDocuments) => {
  const fixtureMap = {};
  (Array.isArray(leagueDocuments) ? leagueDocuments : []).forEach((leagueDocument) => {
    const fixtures = Array.isArray(leagueDocument?.fixtures) ? leagueDocument.fixtures : [];
    fixtures.forEach((fixture) => {
      const fixtureId = getFixtureId(fixture);
      if (fixtureId) {
        fixtureMap[fixtureId] = fixture;
      }
    });
  });

  return fixtureMap;
};

const resolveAutoLockFixtureState = (fixture) => {
  const status = getFixtureStatus(fixture);
  if (!status || status === NOT_STARTED_FIXTURE_STATUS) {
    return null;
  }

  if (status === "PST" || status === "CANC") {
    return "canceled";
  }
  if (FINAL_FIXTURE_STATUSES.has(status)) {
    return "finished";
  }
  return "ongoing";
};

const collectNewNotifications = ({
  users,
  fixtureMap,
  orders,
  customEvents,
  existingNotifications,
  now = new Date(),
}) => {
  const existingDedupeKeys = new Set(
    (Array.isArray(existingNotifications) ? existingNotifications : [])
      .map((notification) => notification?.dedupe_key)
      .filter((dedupeKey) => typeof dedupeKey === "string" && dedupeKey.length > 0)
  );
  const pendingDedupeKeys = new Set();
  const notifications = [];

  const pushIfNew = (notification) => {
    if (!notification) {
      return;
    }
    if (
      existingDedupeKeys.has(notification.dedupe_key) ||
      pendingDedupeKeys.has(notification.dedupe_key)
    ) {
      return;
    }

    pendingDedupeKeys.add(notification.dedupe_key);
    notifications.push(notification);
  };

  const fixtureList = Object.values(fixtureMap || {});
  (Array.isArray(users) ? users : []).forEach((user) => {
    fixtureList.forEach((fixture) => {
      pushIfNew(buildFixtureKickoffNotification(user, fixture, now));
    });

    const predictionHistory = Array.isArray(user?.prediction_history) ? user.prediction_history : [];
    predictionHistory.forEach((prediction) => {
      const fixture = fixtureMap?.[Number.parseInt(prediction?.fixture_id, 10)] || null;
      pushIfNew(buildPredictionResultNotification(user, prediction, fixture, now));
    });
  });

  (Array.isArray(orders) ? orders : []).forEach((order) => {
    const fixture = fixtureMap?.[Number.parseInt(order?.fixture_id, 10)] || null;
    pushIfNew(buildOrderSettledNotification(order, fixture, now));
  });

  (Array.isArray(customEvents) ? customEvents : []).forEach((event) => {
    const fixture = fixtureMap?.[Number.parseInt(event?.fixture_id, 10)] || null;
    pushIfNew(buildCustomEventStatusNotification(event, fixture, now));
  });

  return notifications;
};

module.exports = {
  ACTIVE_EVENT_STATUS,
  ACTIVITY_EXPIRY_DAYS,
  CANCELED_EVENT_STATUS,
  DEFAULT_LIST_LIMIT,
  FINAL_FIXTURE_STATUSES,
  KICKOFF_EXPIRY_HOURS,
  KICKOFF_LOOKAHEAD_MINUTES,
  LOCKED_EVENT_STATUS,
  MAX_LIST_LIMIT,
  NOT_STARTED_FIXTURE_STATUS,
  READ_STATUS,
  UNREAD_STATUS,
  addDuration,
  buildCustomEventBetPlacedNotification,
  buildCustomEventSettledNotification,
  buildCustomEventStatusNotification,
  buildFixtureKickoffNotification,
  buildNotificationRecord,
  buildOrderSettledNotification,
  buildPredictionResultNotification,
  clampLimit,
  collectNewNotifications,
  createNotificationId,
  filterNotifications,
  getCustomEventNotificationStatus,
  getFixtureId,
  getFixtureKickoff,
  getFixtureStatus,
  getFixtureTeams,
  getFixtureTitle,
  getPredictionResultLabel,
  isFixtureFinished,
  isNotificationExpired,
  matchesFixtureFollow,
  mergeFixturesFromLeagueDocuments,
  resolveAutoLockFixtureState,
  resolveMatchWinnerResult,
  resolveOrderNotificationOutcome,
  toIsoString,
};
