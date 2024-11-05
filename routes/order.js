var express = require("express");
var helper = require("../common/helper");
var router = express.Router();

const CosmosClient = require("@azure/cosmos").CosmosClient;

router.get("/all", async function (req, res, next) {
  const config = {
    endpoint: "https://yolofootball-database.documents.azure.com:443/",
    key: "hOicNBuPcYclHNG3UHZA9zGKhXp9zrTeoxbagVWBWRql4nXsEbOykJkyxfKMA2cEOGuwvMAMIES8Ssg81bppFA==",
    databaseId: "yolofootball",
    containerId: "orders",
  };
  const client = new CosmosClient({
    endpoint: config.endpoint,
    key: config.key,
  });
  const database = client.database(config.databaseId);
  const container = database.container(config.containerId);
  var dates = await container.items.query(`SELECT * from c`).fetchAll();
  var orderData = dates.resources[0];
  global.testOrder = orderData;
  return res.status(200).send(orderData);
});

// get orders
router.post("/orders", async function (req, res, next) {
  const config = {
    endpoint: "https://yolofootball-database.documents.azure.com:443/",
    key: "hOicNBuPcYclHNG3UHZA9zGKhXp9zrTeoxbagVWBWRql4nXsEbOykJkyxfKMA2cEOGuwvMAMIES8Ssg81bppFA==",
    databaseId: "yolofootball",
    containerId: "orders",
  };
  const client = new CosmosClient({
    endpoint: config.endpoint,
    key: config.key,
  });
  const database = client.database(config.databaseId);
  const container = database.container(config.containerId);
  let postData = req.body;
  let query = { query: "" };
  if (postData.ids && postData.ids.length > 0) {
    query = {
      query: `SELECT * 
            FROM c
            WHERE c.id IN ("${postData.ids.join('","')}")`,
    };
  }

  if (req.body.state) {
    query.query = query.query + ` AND c.state = "${req.body.state}"`;
  }

  if (req.body.created_by) {
    query.query = query.query + ` AND c.created_by = "${req.body.created_by}"`;
  }
  console.log(query.query);
  var dates = await container.items.query(query).fetchAll();
  var orderData = dates.resources;
  return res.status(200).send(orderData);
});

// create order
router.post("/", async function (req, res, next) {
  // need this header: Content-Type: application/json; charset=utf-8
  const config = {
    endpoint: "https://yolofootball-database.documents.azure.com:443/",
    key: "hOicNBuPcYclHNG3UHZA9zGKhXp9zrTeoxbagVWBWRql4nXsEbOykJkyxfKMA2cEOGuwvMAMIES8Ssg81bppFA==",
    databaseId: "yolofootball",
    containerId: "orders",
  };
  const client = new CosmosClient({
    endpoint: config.endpoint,
    key: config.key,
  });
  const database = client.database(config.databaseId);
  const container = database.container(config.containerId);
  let postData = req.body;
  let orderToCreate = {
    orderdate: new Date().getTime(), // order placed date
    fixture_id: postData.fixture_id, // the fixture id that related to this order
    fixtures_ids: [], // if multiple fixtures added to this order
    bet_result: parseInt(postData.bet_result), // bet result: 0 is host win, 1 is draw, 2 is away win
    odd_rate: parseFloat(postData.odd_rate), // rate
    odd_mount: parseFloat(postData.odd_mount), // the total money that user bet
    win_return: parseFloat(postData.win_return), // returns the money if wins
    is_win: false, // is user win this order
    state: "pending", // order status: pending, canceled, completed
    fixture_state: postData.fixture_state, // fixture's state: notstarted, canceled, finished
    fixture_states: [],
    actual_return: 0, // the user actual mount get
    created_by: postData.user_name ? postData.user_name : "ano",
  };
  var orderCreateResult = await container.items.create(orderToCreate);
  var orderData = orderCreateResult.resource;
  // update users information
  if (!postData.user_name) {
    return res.status(200).send(orderData);
  }
  const userContainer = database.container("users");
  const query = {
    query: `select * from c user where user.user_name = "${postData.user_name}"`,
  };
  var readUsers = await userContainer.items.query(query).fetchAll();
  if (readUsers.resources && readUsers.resources.length > 0) {
    let currentUser = readUsers.resources[0];
    currentUser.order_ids.push(orderData.id);
    currentUser.account_balance =
      currentUser.account_balance - orderData.odd_mount;
    await userContainer
      .item(currentUser.id, currentUser.id)
      .replace(currentUser);
    return res.status(200).send(orderData);
  }
  return res.status(400).send(orderData);
});

// update order
router.put("/:orderId", async function (req, res, next) {
  const CosmosClient = require("@azure/cosmos").CosmosClient;
  const config = {
    endpoint: "https://yolofootball-database.documents.azure.com:443/",
    key: "hOicNBuPcYclHNG3UHZA9zGKhXp9zrTeoxbagVWBWRql4nXsEbOykJkyxfKMA2cEOGuwvMAMIES8Ssg81bppFA==",
    databaseId: "yolofootball",
    containerId: "orders",
  };
  console.log("connect to cosmosdb");
  const client = new CosmosClient({
    endpoint: config.endpoint,
    key: config.key,
  });
  const database = client.database(config.databaseId);
  const container = database.container(config.containerId);

  const orderId = req.params && req.params.orderId;
  const postData = req.body;

  if (!orderId) {
    return res.status(400);
  }

  const orderResponse = await container.item(orderId, orderId).read();
  let currentOrder = orderResponse.resource;
  if (!currentOrder) {
    // throw Error('no order exists');
    return res.status(400);
  }
  // 2 conditions: to cancel or complete order
  if (postData && postData.state) {
    if (postData.state == "canceled") {
      currentOrder.state = postData.state;
    } else if (postData.state == "completed") {
      if (postData.returned_mount !== 0 && !postData.returned_mount) {
        return res.status(400);
      }
      if (!postData.win_result) {
        return res.status(400);
      }
      currentOrder.state = postData.state;
      currentOrder.is_win = postData.win_result;
      currentOrder.actual_return = postData.returned_mount;
    }
  }
  var orderCreateResult = await container
    .item(orderId, orderId)
    .replace(currentOrder);
  var orderData = orderCreateResult.resource;
  return res.status(200).send(orderData);
});

module.exports = router;
