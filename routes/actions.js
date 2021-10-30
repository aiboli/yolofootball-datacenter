var express = require('express');
const axios = require("axios").default;
var router = express.Router();

/* GET home page. */
router.get('/getGames', async function (req, res, next) {
    //console.log(req);
    var currentDate = new Date();
    var currentDateString = `${currentDate.getFullYear()}-${currentDate.getMonth() + 1}-${currentDate.getDate()}`;
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
    var dates = await container.items.query(`SELECT * from c WHERE c.date = '${currentDate.getFullYear()}-${currentDate.getMonth() + 1}-${currentDate.getDate()}'`).fetchAll();
    var gamesData = dates.resources[0];
    global.testgame = gamesData;
    res.send(gamesData);
});

module.exports = router;
