var express = require('express');
var router = express.Router();

/* GET home page. */
router.get('/getGames', async function (req, res, next) {
    //console.log(req);
    var currentDate = new Date();
    const CosmosClient = require("@azure/cosmos").CosmosClient;
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
    var dates = await container.items.query(`SELECT * from c WHERE c.date = '${getDateString()}'`).fetchAll();
    var gamesData = dates.resources[0];
    global.testgame = gamesData;
    res.send(gamesData);
});

router.get('/getFixtures', async function (req, res, next) {
    //console.log(req);
    var currentDate = new Date();
    const CosmosClient = require("@azure/cosmos").CosmosClient;
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
    var dates = await container.items.query(`SELECT * from c WHERE c.date = '${getDateString()}'`).fetchAll();
    var gamesData = dates.resources[0];
    global.testfixtures = gamesData;
    res.send(gamesData);
});

function getDateString() {
    var currentDate = new Date();
    var year = currentDate.getUTCFullYear();
    var month = String(currentDate.getUTCMonth() + 1);
    if (month.length < 2) {
        month = "0" + month;
    }
    var date = String(currentDate.getUTCDate());
    if (date.length < 2) {
        date = "0" + date;
    }
    return `${year}-${month}-${date}`;
}

module.exports = router;
