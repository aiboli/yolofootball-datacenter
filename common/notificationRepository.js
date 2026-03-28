const { createDatabase, ensureContainer } = require("./database");
const {
  DEFAULT_LIST_LIMIT,
  READ_STATUS,
  UNREAD_STATUS,
  clampLimit,
  filterNotifications,
} = require("./notifications");

const escapeCosmosString = (value) => String(value).replace(/"/g, '\\"');

const createNotificationRepository = () => {
  const database = createDatabase();
  const usersContainer = database.container("users");
  const ordersContainer = database.container("orders");
  const customEventsContainer = database.container("customevents");
  const leaguesContainer = database.container("leagues");

  let notificationContainerPromise = null;

  const getNotificationsContainer = async () => {
    if (!notificationContainerPromise) {
      notificationContainerPromise = ensureContainer("notifications", "/id");
    }

    return notificationContainerPromise;
  };

  const getNotificationsByUser = async (userName) => {
    const notificationsContainer = await getNotificationsContainer();
    const query = {
      query: `SELECT * FROM c WHERE c.user_name = "${escapeCosmosString(userName)}"`,
    };
    const result = await notificationsContainer.items.query(query).fetchAll();
    return result.resources || [];
  };

  return {
    async listNotifications({ userName, status, limit = DEFAULT_LIST_LIMIT, now = new Date() }) {
      const notifications = await getNotificationsByUser(userName);
      return filterNotifications(notifications, {
        status,
        limit: clampLimit(limit),
        now,
      });
    },

    async getUnreadCount({ userName, now = new Date() }) {
      const notifications = await getNotificationsByUser(userName);
      return filterNotifications(notifications, {
        status: UNREAD_STATUS,
        limit: notifications.length || DEFAULT_LIST_LIMIT,
        now,
      }).length;
    },

    async markRead({ notificationId, userName, now = new Date() }) {
      const notificationsContainer = await getNotificationsContainer();
      const readResult = await notificationsContainer.item(notificationId, notificationId).read();
      const notification = readResult.resource;
      if (!notification || (userName && notification.user_name !== userName)) {
        return null;
      }

      if (notification.status !== READ_STATUS) {
        notification.status = READ_STATUS;
        notification.read_at = new Date(now).toISOString();
        const updateResult = await notificationsContainer
          .item(notification.id, notification.id)
          .replace(notification);
        return updateResult.resource;
      }

      return notification;
    },

    async markAllRead({ userName, now = new Date() }) {
      const notificationsContainer = await getNotificationsContainer();
      const notifications = await getNotificationsByUser(userName);
      const unreadNotifications = notifications.filter(
        (notification) => notification?.status === UNREAD_STATUS
      );

      const updatedNotifications = [];
      for (const notification of unreadNotifications) {
        notification.status = READ_STATUS;
        notification.read_at = new Date(now).toISOString();
        const updateResult = await notificationsContainer
          .item(notification.id, notification.id)
          .replace(notification);
        updatedNotifications.push(updateResult.resource);
      }

      return updatedNotifications;
    },

    async listAllNotifications() {
      const notificationsContainer = await getNotificationsContainer();
      const result = await notificationsContainer.items.query("SELECT * FROM c").fetchAll();
      return result.resources || [];
    },

    async upsertNotifications(notifications) {
      const notificationsContainer = await getNotificationsContainer();
      const createdNotifications = [];
      for (const notification of Array.isArray(notifications) ? notifications : []) {
        const result = await notificationsContainer.items.upsert(notification);
        createdNotifications.push(result.resource);
      }

      return createdNotifications;
    },

    async getUsers() {
      const result = await usersContainer.items.query("SELECT * FROM c").fetchAll();
      return result.resources || [];
    },

    async getOrders() {
      const result = await ordersContainer.items.query("SELECT * FROM c").fetchAll();
      return result.resources || [];
    },

    async getCustomEvents() {
      const result = await customEventsContainer.items.query("SELECT * FROM c").fetchAll();
      return result.resources || [];
    },

    async getLeagueDocuments() {
      const result = await leaguesContainer.items.query("SELECT * FROM c").fetchAll();
      return result.resources || [];
    },

    async lockCustomEvent(eventId, fixtureState) {
      const readResult = await customEventsContainer.item(eventId, eventId).read();
      const event = readResult.resource;
      if (!event || event.status !== "active") {
        return event || null;
      }

      event.status = "locked";
      if (fixtureState) {
        event.fixture_state = fixtureState;
      }
      event.event_history = Array.isArray(event.event_history) ? event.event_history : [];
      event.event_history.push({
        time: new Date().toISOString(),
        info: "lock custom event after kickoff",
      });

      const updateResult = await customEventsContainer.item(event.id, event.id).replace(event);
      return updateResult.resource;
    },
  };
};

module.exports = {
  createNotificationRepository,
  escapeCosmosString,
};
