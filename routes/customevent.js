var express = require('express');
var helper = require('../common/helper');
var router = express.Router();

const CosmosClient = require("@azure/cosmos").CosmosClient;

router.get('/all', async function (req, res, next) {
    const config = {
        endpoint: "https://yolofootball-database.documents.azure.com:443/",
        key: "hOicNBuPcYclHNG3UHZA9zGKhXp9zrTeoxbagVWBWRql4nXsEbOykJkyxfKMA2cEOGuwvMAMIES8Ssg81bppFA==",
        databaseId: "yolofootball",
        containerId: "orders"
    };
    const client = new CosmosClient({ endpoint: config.endpoint, key: config.key });
    const database = client.database(config.databaseId);
    const container = database.container(config.containerId);
    var dates = await container.items.query(`SELECT * from c`).fetchAll();
    var orderData = dates.resources[0];
    global.testOrder = orderData;
    return res.status(200).send(orderData);
});

/**
 * GET Single custom event by id
 */
router.get('/', async function (req, res, next) {
    const eventId = req.query.id;
    const config = {
        endpoint: "https://yolofootball-database.documents.azure.com:443/",
        key: "hOicNBuPcYclHNG3UHZA9zGKhXp9zrTeoxbagVWBWRql4nXsEbOykJkyxfKMA2cEOGuwvMAMIES8Ssg81bppFA==",
        databaseId: "yolofootball",
        containerId: "customevents"
    };
    const client = new CosmosClient({ endpoint: config.endpoint, key: config.key });
    const database = client.database(config.databaseId);
    const container = database.container(config.containerId);
    let query = {
        query: `SELECT * from c event WHERE event.id = "${eventId}"`
    };
    var getEvent = await container.items.query(query).fetchAll();
    if (getEvent.resources && getEvent.resources.length > 0) {

        return res.status(200).send(orderData);
    }
    var orderData = dates.resources[0];
    global.testOrder = orderData;
    return res.status(200).send(orderData);
});

// get customevents
router.post('/customevents', async function (req, res, next) {
    const config = {
        endpoint: "https://yolofootball-database.documents.azure.com:443/",
        key: "hOicNBuPcYclHNG3UHZA9zGKhXp9zrTeoxbagVWBWRql4nXsEbOykJkyxfKMA2cEOGuwvMAMIES8Ssg81bppFA==",
        databaseId: "yolofootball",
        containerId: "orders"
    };
    const client = new CosmosClient({ endpoint: config.endpoint, key: config.key });
    const database = client.database(config.databaseId);
    const container = database.container(config.containerId);
    let postData = req.body;
    let query = {
        query: `SELECT * 
        FROM c
        WHERE c.id IN ("${postData.ids.join('","')}")`
    };

    if (req.body.state) {
        query.query = query.query + ` AND c.state = "${req.body.state}"`
    }

    if (req.body.created_by) {
        query.query = query.query + ` AND c.created_by = "${req.body.created_by}"`
    }
    console.log(query.query);
    var dates = await container.items.query(query).fetchAll();
    var orderData = dates.resources;
    return res.status(200).send(orderData);
});

// create custom event
router.post('/', async function (req, res, next) {
    // need this header: Content-Type: application/json; charset=utf-8
    const config = {
        endpoint: "https://yolofootball-database.documents.azure.com:443/",
        key: "hOicNBuPcYclHNG3UHZA9zGKhXp9zrTeoxbagVWBWRql4nXsEbOykJkyxfKMA2cEOGuwvMAMIES8Ssg81bppFA==",
        databaseId: "yolofootball",
        containerId: "customevents"
    };
    const client = new CosmosClient({ endpoint: config.endpoint, key: config.key });
    const database = client.database(config.databaseId);
    const container = database.container(config.containerId);
    let postData = req.body;
    let eventToCreate = {
        "create_date": new Date().getTime(), // order placed date
        "fixture_id": postData.fixture_id, // the fixture id that this event is created for
        "odd_data": postData.odd_data, // custome event odd data
        "status": 'active', // status of this event, 1. active - when first time created, 2. locked - when game is ongoing, 3. canceled - event is canceld 4. completed - game is over and win has been paid
        "event_history": [], // event history
        "pool_fund": postData.poll_fund, // total fund that user prepared for this pool
        "matched_pool_fund": postData.matched_poll_fund, // extra matched fund provided by others
        "invested_pool_fund": 0, // total inversted pool fund for now
        "associated_order_ids": [], // the order number that player created
        "actual_return": 0, // the user actual mount get
        "created_by": postData.user_name ? postData.user_name : 'ano'
    }
    var eventCreateResult = await container.items.create(eventToCreate);
    var eventData = eventCreateResult.resource;
    // update users information
    if (!postData.user_name) {
        return res.status(200).send(eventData);
    }
    const userContainer = database.container("users");
    const query = {
        query: `select * from c user where user.user_name = "${postData.user_name}"`
    };
    var readUsers = await userContainer.items.query(query).fetchAll();
    if (readUsers.resources && readUsers.resources.length > 0) {
        let currentUser = readUsers.resources[0];
        currentUser.created_bid_ids.push(eventData.id);
        currentUser.account_balance = currentUser.account_balance - eventData.poll_fund;
        await userContainer.item(currentUser.id, currentUser.id).replace(currentUser);
        return res.status(200).send(eventData);
    }
    return res.status(400).send(eventData);
});

// update custom event
router.put('/:eventid', async function (req, res, next) {
    const CosmosClient = require("@azure/cosmos").CosmosClient;
    const config = {
        endpoint: "https://yolofootball-database.documents.azure.com:443/",
        key: "hOicNBuPcYclHNG3UHZA9zGKhXp9zrTeoxbagVWBWRql4nXsEbOykJkyxfKMA2cEOGuwvMAMIES8Ssg81bppFA==",
        databaseId: "yolofootball",
        containerId: "customevents"
    };
    console.log('connect to cosmosdb');
    const client = new CosmosClient({ endpoint: config.endpoint, key: config.key });
    const database = client.database(config.databaseId);
    const container = database.container(config.containerId);

    const eventid = req.params && req.params.eventid;
    const postData = req.body;

    if (!eventid) {
        return res.status(400);
    }

    const eventResponse = await container.item(eventid, eventid).read();
    let currentEvent = eventResponse.resource;
    console.log(currentEvent);
    if (!currentEvent) {
        // throw Error('no order exists');
        return res.status(400);
    }
    // scenarios: 
    // event owner: add more fund, cancel event, change odd data
    // player: place bet, cancel bet
    // system: update event status, pay players and owner
    switch (postData.action) {
        case 'updateFund':
            currentEvent.pool_fund = postData.updated_fund;
            currentEvent.event_history.push({
                time: new Date(),
                info: `update fund to ${postData.updated_fund}`
            });
            var currentEventResult = await container.item(eventid, eventid).replace(currentEvent);
            var eventData = currentEventResult.resource;
            return res.status(200).send(eventData);
        case 'updateStatus':
            currentEvent.status = postData.status;
            currentEvent.event_history.push({
                time: new Date(),
                info: `update status to ${postData.status}`
            });
            var currentEventResult = await container.item(eventid, eventid).replace(currentEvent);
            var eventData = currentEventResult.resource;
            return res.status(200).send(eventData);
        case 'updateOddData':
            currentEvent.odd_data = postData.odd_data;
            currentEvent.event_history.push({
                time: new Date(),
                info: `update odd_data`,
                data: postData.odd_data
            });
            var currentEventResult = await container.item(eventid, eventid).replace(currentEvent);
            var eventData = currentEventResult.resource;
            return res.status(200).send(eventData);
        case 'placeBet':
            currentEvent.invested_pool_fund = currentEvent.invested_pool_fund + postData.odd_mount;
            currentEvent.associated_order_ids.push(postData.order_id);
            currentEvent.event_history.push({
                time: new Date(),
                info: `palce bet ${postData.odd_mount} for ${postData.bet_result}`
            });
            var currentEventResult = await container.item(eventid, eventid).replace(currentEvent);
            var eventData = currentEventResult.resource;
            return res.status(200).send(eventData);
        case 'cancelBet':
            currentEvent.invested_pool_fund = currentEvent.invested_pool_fund - postData.odd_mount;
            currentEvent.associated_order_ids = currentEvent.associated_order_ids.filter((id) => id != postData.order_id);
            currentEvent.event_history.push({
                time: new Date(),
                info: `remove bet ${postData.odd_mount} for ${postData.bet_result}`
            });
            var currentEventResult = await container.item(eventid, eventid).replace(currentEvent);
            var eventData = currentEventResult.resource;
            return res.status(200).send(eventData);
        default:
            return res.status(400);
    }
});

module.exports = router;
