const {
  ACTIVE_EVENT_STATUS,
  collectNewNotifications,
  mergeFixturesFromLeagueDocuments,
  resolveAutoLockFixtureState,
} = require("../common/notifications");

const runNotificationSweep = async ({ repository, now = new Date() }) => {
  const [users, leagueDocuments, orders, customEvents, existingNotifications] = await Promise.all([
    repository.getUsers(),
    repository.getLeagueDocuments(),
    repository.getOrders(),
    repository.getCustomEvents(),
    repository.listAllNotifications(),
  ]);

  const fixtureMap = mergeFixturesFromLeagueDocuments(leagueDocuments);
  const updatedCustomEvents = [];

  for (const event of Array.isArray(customEvents) ? customEvents : []) {
    const fixture = fixtureMap[Number.parseInt(event?.fixture_id, 10)];
    const fixtureState = resolveAutoLockFixtureState(fixture);
    if (event?.status === ACTIVE_EVENT_STATUS && fixtureState) {
      const lockedEvent = await repository.lockCustomEvent(event.id, fixtureState);
      updatedCustomEvents.push(lockedEvent || event);
    } else {
      updatedCustomEvents.push(event);
    }
  }

  const notifications = collectNewNotifications({
    users,
    fixtureMap,
    orders,
    customEvents: updatedCustomEvents,
    existingNotifications,
    now,
  });

  if (notifications.length === 0) {
    return [];
  }

  return repository.upsertNotifications(notifications);
};

module.exports = {
  runNotificationSweep,
};
