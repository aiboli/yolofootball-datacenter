var express = require('express');
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
  console.log(postData);
  let userToCreate = {
    "user_name": postData.user_name,
    "user_email": postData.email,
    "user_wallet_id": "001",
    "created_date": new Date(),
    "order_ids": [
    ],
    "created_bid_ids": [
    ],
    "account_balance": 10000,
    "password": "pwd",
    "is_valid_user": true,
    "customized_field": {
      "prefered_culture": "en-us"
    }
  };
  var userCreateResult = await container.items.create(userToCreate);
  var userData = userCreateResult.resource;
  console.log(userData);
  return res.status(200).json(userData);
});

module.exports = router;
