var express = require('express');
var router = express.Router();
const CosmosClient = require("@azure/cosmos").CosmosClient;

/* GET home page. */
router.get('/getGames', async function (req, res, next) {
    //console.log(req);
    const config = {
        endpoint: "https://yolofootball-database.documents.azure.com:443/",
        key: "hOicNBuPcYclHNG3UHZA9zGKhXp9zrTeoxbagVWBWRql4nXsEbOykJkyxfKMA2cEOGuwvMAMIES8Ssg81bppFA==",
        databaseId: "yolofootball",
        containerId: "games"
    };
    console.log('connect to cosmosdb')
    const client = new CosmosClient({ endpoint: config.endpoint, key: config.key });
    const database = client.database(config.databaseId);
    const container = database.container(config.containerId);
    let dates;
    if (req.query.date) {
        dates = await container.items.query(`SELECT * from c WHERE c.date = '${req.query.date}'`).fetchAll();
    } else {
        dates = await container.items.query(`SELECT * from c WHERE c.date = '${getDateString()}'`).fetchAll();
    }
    var gamesData = dates.resources[0];
    global.testgame = gamesData;
    res.send(gamesData);
});

router.get('/getFixtures', async function (req, res, next) {
    //console.log(req);
    const config = {
        endpoint: "https://yolofootball-database.documents.azure.com:443/",
        key: "hOicNBuPcYclHNG3UHZA9zGKhXp9zrTeoxbagVWBWRql4nXsEbOykJkyxfKMA2cEOGuwvMAMIES8Ssg81bppFA==",
        databaseId: "yolofootball",
        containerId: "fixtures"
    };
    console.log('connect to cosmosdb')
    const client = new CosmosClient({ endpoint: config.endpoint, key: config.key });
    const database = client.database(config.databaseId);
    const container = database.container(config.containerId);
    let dates;
    if (req.query.date) {
        dates = await container.items.query(`SELECT * from c WHERE c.date = '${req.query.date}'`).fetchAll();
    } else {
        dates = await container.items.query(`SELECT * from c WHERE c.date = '${getDateString()}'`).fetchAll();
    }
    var gamesData = dates.resources[0];
    console.log(dates);
    global.testfixtures = gamesData;
    res.send(gamesData);
});

router.post('/bulkUpdateOrder', async function (req, res, next) {
    const config = {
        endpoint: "https://yolofootball-database.documents.azure.com:443/",
        key: "hOicNBuPcYclHNG3UHZA9zGKhXp9zrTeoxbagVWBWRql4nXsEbOykJkyxfKMA2cEOGuwvMAMIES8Ssg81bppFA==",
        databaseId: "yolofootball",
        containerId: "orders"
    };
    const client = new CosmosClient({ endpoint: config.endpoint, key: config.key });
    const database = client.database(config.databaseId);
    const container = database.container(config.containerId);
    const userContainer = database.container('users');
    let postData = req.body;
    console.log(postData);
    const userName = req.body.user_name;
    const query = {
        query: `SELECT *
        FROM c
        WHERE c.id IN ("${postData.ids.join('","')}")`
    };
    console.log(query.query);
    var allOrders = await container.items.query(query).fetchAll();
    var orderData = allOrders.resources;
    var map = {}
    var fixtureToOrderMap = {};
    // check the order needs to be updated
    var orders = orderData.filter(order => order.state == 'pending');
    console.log('order:', orders);
    // check each fiture result
    for (let i = 0; i < orders.length; i++) {
        var fixtureBigId = orders[i].fixture_id;
        console.log(fixtureBigId);
        let fixtureDate = fixtureBigId.split('@')[0];
        console.log(fixtureDate);
        let fixtureId = parseInt(fixtureBigId.split('@')[1]);
        if (!map[fixtureDate]) {
            map[fixtureDate] = [];
        }
        if (!fixtureToOrderMap[fixtureId]) {
            fixtureToOrderMap[fixtureId] = [];
        }
        fixtureToOrderMap[fixtureId].push(orders[i]);
        map[fixtureDate].includes(fixtureId) ? null : map[fixtureDate].push(fixtureId);
    }
    console.log(map);
    console.log(fixtureToOrderMap);
    const dates = Object.keys(map);
    const fixtureContainer = database.container('fixtures');
    const fixtureQuery = {
        query: `
            SELECT * FROM c WHERE c.date IN ("${dates.join('","')}")
        `
    };
    const allFixtures = await fixtureContainer.items.query(fixtureQuery).fetchAll();
    console.log(allFixtures.resources.length);
    // check each fixture result
    for (let i = 0; i < allFixtures.resources.length; i++) {
        let dateToUpdate = allFixtures.resources[i].date;
        let fixtureToUpdate = map[dateToUpdate];
        let fixturesData = allFixtures.resources[i].fixtures;
        for (let j = 0; j < fixtureToUpdate.length; j++) {
            let thisFixture = fixtureToUpdate[j];
            let result = fixturesData.filter(item => item.fixture.id == thisFixture)[0];
            // check the result
            let currentOrders = fixtureToOrderMap[thisFixture];
            console.log(currentOrders);
            console.log(result);
            await Promise.all(currentOrders.map(async (order) => {
                let bet_result = checkResult(order, result);
                console.log(bet_result);
                // update order first
                if (bet_result == 'win') {
                    order.is_win = true;
                    order.state = 'completed';
                    order.fixture_state = 'finished';
                    order.actual_return = order.win_return;
                    const updateOrderResult = await container.item(order.id, order.id).replace(order);
                    console.log(updateOrderResult);
                    // update users returns
                    const userQuery = {
                        query: `
                            SELECT * FROM c WHERE c.user_name = "${userName}"
                        `
                    };
                    const getUserResult = await userContainer.items.query(userQuery).fetchAll();
                    if (getUserResult.resources && getUserResult.resources.length > 0) {
                        let currentUser = getUserResult.resources[0];
                        currentUser.account_balance = currentUser.account_balance + order.win_return;
                        const updateUserResult = await userContainer.item(currentUser.id, currentUser.id).replace(currentUser);
                        console.log(updateUserResult);
                        // return res.status(200).send(updateUserResult);
                    }
                } else if (bet_result == 'lost') {
                    order.is_win = false;
                    order.state = 'completed';
                    order.fixture_state = 'finished';
                    const updateOrderResult = await container.item(order.id, order.id).replace(order);
                    // return res.status(200).send(updateOrderResult);
                }
            }));
        }
    }
    return res.send(200);
});
/**
 * check result for order
 * @param {*} order 
 * @param {*} fixture 
 * @returns {string} win:, lost:, run:, ongoing:
 */
function checkResult(order, fixture) {
    console.log('----fixture----');
    console.log(fixture);
    // check this fixture status
    if (fixture.fixture.status.short == 'FT') {
        let homeGoals = fixture.goals.home;
        let awayGoals = fixture.goals.away;
        let result = homeGoals > awayGoals ? 0 : (homeGoals == awayGoals ? 1 : 2);
        // check if user win:
        let isWin = result == order.bet_result;
        return isWin ? 'win' : 'lost';
    }
    return 'ongoing'
}

function getDateString() {
    var currentDate = new Date();
    const nDate = currentDate.toLocaleString('en-US', {
        timeZone: 'America/Los_Angeles'
    });
    const dateArray = nDate.split(',');
    const dateFull = dateArray[0];
    const dateDetailsArray = dateFull.split('/');
    let day = dateDetailsArray[1];
    let month = dateDetailsArray[0];
    let year = dateDetailsArray[2];
    if (day.length < 2) {
        day = '0' + day;
    }
    if (month.length < 2) {
        month = '0' + month;
    }
    return `${year}-${month}-${day}`;
}

module.exports = router;
