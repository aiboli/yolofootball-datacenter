const nodeCron = require("node-cron");
const axios = require("axios").default;
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
console.log(container.items.query("SELECT * FROM c"));

const allGamesRequest = nodeCron.schedule("0 */6 * * *", async function jobYouNeedToExecute() {
    console.log("all game request executed");
    var currentDate = new Date();
    console.log(currentDate.getUTCFullYear(), currentDate.getUTCMonth() + 1, currentDate.getUTCDate());
    var currentDateString = `${currentDate.getFullYear()}-${currentDate.getMonth() + 1}-${currentDate.getDate()}`;
    var options = {
        method: 'GET',
        url: 'https://api-football-v1.p.rapidapi.com/v3/odds',
        params: { date: currentDateString, timezone: 'America/Los_Angeles' },
        headers: {
            'x-rapidapi-host': 'api-football-v1.p.rapidapi.com',
            'x-rapidapi-key': '28fc80e178mshdff1cc6efb6539cp119f94jsn1a2811635bf8'
        }
    };
    console.log(global.testgame);
    var response = await axios.request(options);
    global.testgame = response.data;
    let gamedate = response.data.parameters.date;
    let objectDef = {
        date: gamedate,
        games: response.data.response
    };
    global.testgame = objectDef;
    console.log(objectDef);
    // check if we already got today's game
    var dates = await container.items.query(`SELECT * from c WHERE c.date = '${currentDate.getFullYear()}-${currentDate.getMonth() + 1}-${currentDate.getDate()}'`).fetchAll();
    console.log(dates);
    if (dates.resources.length === 0) {
        console.log('saving new data');
        var res = await container.items.create(objectDef);
        console.log(res);
    }
});

function start() {
    allGamesRequest.start();
}

exports.start = start;

