var express = require("express");
var router = express.Router();
const CosmosClient = require("@azure/cosmos").CosmosClient;
const {
  sanitizeStringArray,
  createDefaultOnboardingState,
  mergeOnboardingState,
  upsertPredictionHistory,
} = require("../common/userProfile");

const createUsersContainer = () => {
  const config = {
    endpoint: "https://yolofootball-database.documents.azure.com:443/",
    key: "hOicNBuPcYclHNG3UHZA9zGKhXp9zrTeoxbagVWBWRql4nXsEbOykJkyxfKMA2cEOGuwvMAMIES8Ssg81bppFA==",
    databaseId: "yolofootball",
    containerId: "users",
  };
  const client = new CosmosClient({ endpoint: config.endpoint, key: config.key });
  const database = client.database(config.databaseId);
  return database.container(config.containerId);
};

const escapeCosmosString = (value) => String(value).replace(/"/g, '\\"');

const findUserByName = async (container, userName) => {
  const query = {
    query: `SELECT * from c user WHERE user.user_name = "${escapeCosmosString(userName)}"`,
  };
  const result = await container.items.query(query).fetchAll();
  return result.resources?.[0] || null;
};

const buildUsersListQuery = (query = {}) => {
  const filters = [];

  if (query?.has_predictions === "true") {
    filters.push("ARRAY_LENGTH(c.prediction_history) > 0");
  }

  return `SELECT * FROM c${filters.length > 0 ? ` WHERE ${filters.join(" AND ")}` : ""}`;
};

/* create user */
router.post("/", async function (req, res, next) {
  const container = createUsersContainer();
  let postData = req.body || {};
  let userToCreate = {
    user_name: postData.user_name,
    user_email: postData.email,
    user_wallet_id: "001",
    created_date: new Date(),
    order_ids: [],
    created_bid_ids: [],
    account_balance: postData.amount,
    password: postData.password,
    is_valid_user: false,
    customized_field: {
      prefered_culture: "en-us",
    },
    privacy_consent: postData.privacy_consent || null,
    favorite_teams: sanitizeStringArray(postData.favorite_teams),
    favorite_leagues: sanitizeStringArray(postData.favorite_leagues),
    onboarding_state: mergeOnboardingState(
      createDefaultOnboardingState(),
      postData.onboarding_state
    ),
    prediction_history: Array.isArray(postData.prediction_history)
      ? postData.prediction_history
      : [],
  };
  var userCreateResult = await container.items.create(userToCreate);
  var userData = userCreateResult.resource;
  return res.status(200).json(userData);
});

/* get user profile */
router.get("/", async function (req, res, next) {
  const container = createUsersContainer();
  const userName = req.query?.user_name;
  if (!userName) {
    return res.status(400).json({ error: "user_name is required" });
  }

  const userData = await findUserByName(container, userName);
  if (!userData) {
    return res.status(404).json({ error: "user not found" });
  }

  return res.status(200).json(userData);
});

router.get("/all", async function (req, res, next) {
  const container = createUsersContainer();
  const result = await container.items.query(buildUsersListQuery(req.query || {})).fetchAll();
  return res.status(200).json(result.resources || []);
});

/* update selected user profile fields */
router.put("/:userName", async function (req, res, next) {
  const container = createUsersContainer();
  const userName = req.params?.userName;
  if (!userName) {
    return res.status(400).json({ error: "user_name is required" });
  }

  const currentUser = await findUserByName(container, userName);
  if (!currentUser) {
    return res.status(404).json({ error: "user not found" });
  }

  if (req.body?.favorite_teams !== undefined) {
    currentUser.favorite_teams = sanitizeStringArray(req.body.favorite_teams);
  }
  if (req.body?.favorite_leagues !== undefined) {
    currentUser.favorite_leagues = sanitizeStringArray(req.body.favorite_leagues);
  }
  if (req.body?.onboarding_state !== undefined) {
    currentUser.onboarding_state = mergeOnboardingState(
      currentUser.onboarding_state,
      req.body.onboarding_state
    );
  }
  if (req.body?.upsert_prediction !== undefined) {
    currentUser.prediction_history = upsertPredictionHistory(
      currentUser.prediction_history,
      req.body.upsert_prediction
    );
  }

  const replaceResult = await container.item(currentUser.id, currentUser.id).replace(currentUser);
  return res.status(200).json(replaceResult.resource);
});

module.exports = router;
module.exports._private = {
  buildUsersListQuery,
  escapeCosmosString,
};
