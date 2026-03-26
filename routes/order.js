var express = require("express");
var helper = require("../common/helper");
var router = express.Router();

const CosmosClient = require("@azure/cosmos").CosmosClient;

const getOrdersContainer = () => {
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

  return {
    database,
    container: database.container(config.containerId),
  };
};

const normalizeSelection = (selection, fallbackFixtureState) => ({
  fixture_id: selection.fixture_id,
  bet_result: parseInt(selection.bet_result, 10),
  odd_rate: parseFloat(selection.odd_rate),
  fixture_state: selection.fixture_state || fallbackFixtureState || "notstarted",
  market: selection.market || "match_winner",
  selection: selection.selection,
});

const normalizeOrderPayload = (postData) => {
  if (Array.isArray(postData.selections) && postData.selections.length > 0) {
    const selections = postData.selections.map((selection) =>
      normalizeSelection(selection, postData.fixture_state)
    );

    return {
      fixture_id: selections[0].fixture_id,
      bet_result: selections[0].bet_result,
      fixture_state: selections[0].fixture_state,
      selections,
      fixtures_ids: selections.map((selection) => selection.fixture_id),
      fixture_states: selections.map((selection) => selection.fixture_state),
      odd_rate: parseFloat(postData.odd_rate ?? postData.combined_odd),
      odd_mount: parseFloat(postData.odd_mount ?? postData.stake),
      win_return: parseFloat(postData.win_return),
      order_type:
        postData.order_type || (selections.length > 1 ? "accumulator" : "single"),
      selection_count: selections.length,
      user_name: postData.user_name,
    };
  }

  return {
    fixture_id: postData.fixture_id,
    bet_result: parseInt(postData.bet_result, 10),
    fixture_state: postData.fixture_state || "notstarted",
    selections: [
      normalizeSelection(
        {
          fixture_id: postData.fixture_id,
          bet_result: postData.bet_result,
          odd_rate: postData.odd_rate,
          fixture_state: postData.fixture_state,
        },
        postData.fixture_state
      ),
    ],
    fixtures_ids: postData.fixtures_ids || [],
    fixture_states: postData.fixture_states || [],
    odd_rate: parseFloat(postData.odd_rate),
    odd_mount: parseFloat(postData.odd_mount),
    win_return: parseFloat(postData.win_return),
    order_type: postData.order_type || "single",
    selection_count: postData.selection_count || 1,
    user_name: postData.user_name,
  };
};

router.get("/all", async function (req, res, next) {
  const { container } = getOrdersContainer();
  var dates = await container.items.query(`SELECT * from c`).fetchAll();
  var orderData = dates.resources[0];
  global.testOrder = orderData;
  return res.status(200).send(orderData);
});

router.post("/orders", async function (req, res, next) {
  const { container } = getOrdersContainer();
  let postData = req.body || {};
  let filters = ["1 = 1"];

  if (postData.ids && postData.ids.length > 0) {
    filters.push(`c.id IN ("${postData.ids.join('","')}")`);
  }

  if (postData.state) {
    filters.push(`c.state = "${postData.state}"`);
  }

  if (postData.created_by) {
    filters.push(`c.created_by = "${postData.created_by}"`);
  }

  let query = {
    query: `SELECT * FROM c WHERE ${filters.join(" AND ")}`,
  };

  var dates = await container.items.query(query).fetchAll();
  var orderData = dates.resources;
  return res.status(200).send(orderData);
});

router.post("/", async function (req, res, next) {
  const { database, container } = getOrdersContainer();
  let postData = req.body || {};
  let normalizedOrder = normalizeOrderPayload(postData);

  let orderToCreate = {
    orderdate: new Date().getTime(),
    fixture_id: normalizedOrder.fixture_id,
    fixtures_ids: normalizedOrder.fixtures_ids,
    bet_result: normalizedOrder.bet_result,
    odd_rate: normalizedOrder.odd_rate,
    odd_mount: normalizedOrder.odd_mount,
    win_return: normalizedOrder.win_return,
    is_win: false,
    state: "pending",
    fixture_state: normalizedOrder.fixture_state,
    fixture_states:
      normalizedOrder.fixture_states.length > 0
        ? normalizedOrder.fixture_states
        : normalizedOrder.selections.map((selection) => selection.fixture_state),
    actual_return: 0,
    created_by: normalizedOrder.user_name ? normalizedOrder.user_name : "ano",
    order_type: normalizedOrder.order_type,
    selection_count: normalizedOrder.selection_count,
    selections: normalizedOrder.selections,
  };

  var orderCreateResult = await container.items.create(orderToCreate);
  var orderData = orderCreateResult.resource;

  if (!normalizedOrder.user_name) {
    return res.status(200).send(orderData);
  }

  const userContainer = database.container("users");
  const query = {
    query: `select * from c user where user.user_name = "${normalizedOrder.user_name}"`,
  };
  var readUsers = await userContainer.items.query(query).fetchAll();
  if (readUsers.resources && readUsers.resources.length > 0) {
    let currentUser = readUsers.resources[0];
    currentUser.order_ids.push(orderData.id);
    currentUser.account_balance =
      currentUser.account_balance - orderData.odd_mount;
    await userContainer.item(currentUser.id, currentUser.id).replace(currentUser);
    return res.status(200).send(orderData);
  }
  return res.status(400).send(orderData);
});

router.put("/:orderId", async function (req, res, next) {
  const { container } = getOrdersContainer();
  const orderId = req.params && req.params.orderId;
  const postData = req.body;

  if (!orderId) {
    return res.status(400);
  }

  const orderResponse = await container.item(orderId, orderId).read();
  let currentOrder = orderResponse.resource;
  if (!currentOrder) {
    return res.status(400);
  }

  if (postData && postData.state) {
    if (postData.state == "canceled") {
      currentOrder.state = postData.state;
    } else if (postData.state == "completed") {
      if (postData.returned_mount !== 0 && !postData.returned_mount) {
        return res.status(400);
      }
      if (postData.win_result === undefined) {
        return res.status(400);
      }
      currentOrder.state = postData.state;
      currentOrder.is_win = postData.win_result;
      currentOrder.actual_return = postData.returned_mount;
    }
  }

  var orderCreateResult = await container.item(orderId, orderId).replace(currentOrder);
  var orderData = orderCreateResult.resource;
  return res.status(200).send(orderData);
});

module.exports = router;
