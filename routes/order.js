var express = require('express');
var router = express.Router();

router.get('/all', async function (req, res, next) {
    //console.log(req);
    const CosmosClient = require("@azure/cosmos").CosmosClient;
    const config = {
        endpoint: "https://yolofootball-database.documents.azure.com:443/",
        key: "hOicNBuPcYclHNG3UHZA9zGKhXp9zrTeoxbagVWBWRql4nXsEbOykJkyxfKMA2cEOGuwvMAMIES8Ssg81bppFA==",
        databaseId: "yolofootball",
        containerId: "orders"
    };
    console.log('connect to cosmosdb');
    const client = new CosmosClient({ endpoint: config.endpoint, key: config.key });
    const database = client.database(config.databaseId);
    const container = database.container(config.containerId);
    var dates = await container.items.query(`SELECT * from c`).fetchAll();
    var orderData = dates.resources[0];
    global.testOrder = orderData;
    res.send(orderData);
});

// create order
router.post('/', async function (req, res, next) {
    //console.log(req);
    // need this header: Content-Type: application/json; charset=utf-8
    const CosmosClient = require("@azure/cosmos").CosmosClient;
    const config = {
        endpoint: "https://yolofootball-database.documents.azure.com:443/",
        key: "hOicNBuPcYclHNG3UHZA9zGKhXp9zrTeoxbagVWBWRql4nXsEbOykJkyxfKMA2cEOGuwvMAMIES8Ssg81bppFA==",
        databaseId: "yolofootball",
        containerId: "orders"
    };
    console.log('connect to cosmosdb');
    const client = new CosmosClient({ endpoint: config.endpoint, key: config.key });
    const database = client.database(config.databaseId);
    const container = database.container(config.containerId);
    let postData = req.body;
    console.log(postData);
    let orderToCreate = {
        "orderdate": new Date().getTime(), // order placed date
        "fixture_id": postData.fixture_id, // the fixture id that related to this order
        "fixtures_ids": [], // if multiple fixtures added to this order
        "bet_result": postData.bet_result, // bet result: 0 is host win, 1 is draw, 2 is away win
        "odd_rate": postData.odd_rate, // rate
        "odd_mount": postData.odd_mount, // the total money that user bet
        "win_return": postData.win_return, // returns the money if wins
        "is_win": false, // is user win this order
        "state": "pending", // order status: pending, canceled, completed
        "fixture_state": postData.fixture_state, // fixture's state: notstarted, canceled, finished
        "fixture_states": [],
        "actual_return": 0, // the user actual mount get
    }
    var orderCreateResult = await container.items.create(orderToCreate);
    var orderData = orderCreateResult.resources;
    res.status(200).send(orderData);
});

// update order
router.put('/:orderId', async function (req, res, next) {
    const CosmosClient = require("@azure/cosmos").CosmosClient;
    const config = {
        endpoint: "https://yolofootball-database.documents.azure.com:443/",
        key: "hOicNBuPcYclHNG3UHZA9zGKhXp9zrTeoxbagVWBWRql4nXsEbOykJkyxfKMA2cEOGuwvMAMIES8Ssg81bppFA==",
        databaseId: "yolofootball",
        containerId: "orders"
    };
    console.log('connect to cosmosdb');
    const client = new CosmosClient({ endpoint: config.endpoint, key: config.key });
    const database = client.database(config.databaseId);
    const container = database.container(config.containerId);

    const orderId = req.params && req.params.orderId;
    const postData = req.body;

    if (!orderId) {
        throw Error('no orderId');
    }

    const orderResponse = await container.item(orderId, orderId).read();
    let currentOrder = orderResponse.resource;
    console.log(currentOrder);
    if (!currentOrder) {
        // throw Error('no order exists');
        return res.send(404);
    }
    // 2 conditions: to cancel or complete order
    if (postData && postData.state) {
        if (postData.state == 'canceled') {
            currentOrder.state = postData.state;
        } else if (postData.state == 'completed') {
            if (postData.returned_mount !== 0 && !postData.returned_mount) {
                throw new Error('no returned mount');
            }
            if (!postData.win_result) {
                throw new Error('no returned mount');
            }
            currentOrder.state = postData.state;
            currentOrder.is_win = postData.win_result;
            currentOrder.actual_return = postData.returned_mount;
        }
    }
    var orderCreateResult = await container.item(orderId, orderId).replace(currentOrder);
    var orderData = orderCreateResult.resource;
    return res.send(orderData);
});

module.exports = router;
