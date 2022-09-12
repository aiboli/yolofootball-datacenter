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
    res.send(orderData);
});
module.exports = router;
