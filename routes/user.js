var express = require('express');
const { route } = require('./order');
var router = express.Router();
const CosmosClient = require("@azure/cosmos").CosmosClient;

/* GET users listing. */
router.post('/', async function (req, res, next) {
  const config = {
    endpoint: "https://yolofootball-database.documents.azure.com:443/",
    key: "hOicNBuPcYclHNG3UHZA9zGKhXp9zrTeoxbagVWBWRql4nXsEbOykJkyxfKMA2cEOGuwvMAMIES8Ssg81bppFA==",
    databaseId: "yolofootball",
    containerId: "users"
  };
  const client = new CosmosClient({ endpoint: config.endpoint, key: config.key });
  const database = client.database(config.databaseId);
  const container = database.container(config.containerId);
  let postData = req.body;
  let userToCreate = {
    "user_name": postData.user_name,
    "user_email": postData.email,
    "user_wallet_id": "001",
    "created_date": new Date(),
    "order_ids": [
    ],
    "created_bid_ids": [
    ],
    "account_balance": postData.amount,
    "password": postData.password,
    "is_valid_user": false,
    "customized_field": {
      "prefered_culture": "en-us"
    }
  };
  var userCreateResult = await container.items.create(userToCreate);
  var userData = userCreateResult.resource;
  return res.status(200).json(userData);
});

// get user profile
router.get('/', async function (req, res, next) {
  const config = {
    endpoint: "https://yolofootball-database.documents.azure.com:443/",
    key: "hOicNBuPcYclHNG3UHZA9zGKhXp9zrTeoxbagVWBWRql4nXsEbOykJkyxfKMA2cEOGuwvMAMIES8Ssg81bppFA==",
    databaseId: "yolofootball",
    containerId: "users"
  };
  const client = new CosmosClient({ endpoint: config.endpoint, key: config.key });
  const database = client.database(config.databaseId);
  const container = database.container(config.containerId);
  let queryData = req.query;
  console.log(queryData);
  let query = {
    query: `SELECT * from c user WHERE user.user_name = "${queryData.user_name}"`
  }
  var userFetchResult = await container.items.query(query).fetchAll();
  var userData = userFetchResult.resources[0];
  return res.status(200).json(userData);
})

module.exports = router;
