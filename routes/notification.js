var express = require("express");
const { createNotificationRepository } = require("../common/notificationRepository");
const { DEFAULT_LIST_LIMIT, clampLimit } = require("../common/notifications");

const createNotificationRouter = ({ repository = createNotificationRepository() } = {}) => {
  const router = express.Router();

  router.get("/", async function (req, res, next) {
    try {
      const userName = req.query?.user_name;
      if (!userName) {
        return res.status(400).json({ error: "user_name is required" });
      }

      const status = req.query?.status;
      if (status && !["read", "unread"].includes(status)) {
        return res.status(400).json({ error: "status must be read or unread" });
      }

      const notifications = await repository.listNotifications({
        userName,
        status,
        limit: clampLimit(req.query?.limit, DEFAULT_LIST_LIMIT),
      });

      return res.status(200).json({ notifications });
    } catch (error) {
      return next(error);
    }
  });

  router.get("/unread-count", async function (req, res, next) {
    try {
      const userName = req.query?.user_name;
      if (!userName) {
        return res.status(400).json({ error: "user_name is required" });
      }

      const unreadCount = await repository.getUnreadCount({ userName });
      return res.status(200).json({ unread_count: unreadCount });
    } catch (error) {
      return next(error);
    }
  });

  router.put("/:notificationId/read", async function (req, res, next) {
    try {
      const notificationId = req.params?.notificationId;
      const userName = req.body?.user_name || req.query?.user_name;
      if (!notificationId || !userName) {
        return res.status(400).json({ error: "notification id and user_name are required" });
      }

      const notification = await repository.markRead({
        notificationId,
        userName,
      });
      if (!notification) {
        return res.status(404).json({ error: "notification not found" });
      }

      return res.status(200).json(notification);
    } catch (error) {
      return next(error);
    }
  });

  router.put("/read-all/:userName", async function (req, res, next) {
    try {
      const userName = req.params?.userName;
      if (!userName) {
        return res.status(400).json({ error: "user_name is required" });
      }

      const notifications = await repository.markAllRead({ userName });
      return res.status(200).json({
        user_name: userName,
        updated_count: notifications.length,
      });
    } catch (error) {
      return next(error);
    }
  });

  return router;
};

module.exports = createNotificationRouter();
module.exports.createNotificationRouter = createNotificationRouter;
