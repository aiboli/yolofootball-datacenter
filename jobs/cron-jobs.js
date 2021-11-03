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
const fixturesContainer = database.container('fixtures');

const allGamesRequest = nodeCron.schedule("1 */6 * * *", async function jobYouNeedToExecute() {
    console.log("all game request executed");
    console.log(getDateString());
    // check if we already got today's game
    var dates = await container.items.query(`SELECT * from c WHERE c.date = '${getDateString()}'`).fetchAll();
    console.log('data in db');
    console.log(dates);
    if (dates.resources.length === 0) {
        var currentDateString = getDateString();
        var options = {
            method: 'GET',
            url: 'https://api-football-v1.p.rapidapi.com/v3/odds',
            params: { date: currentDateString, timezone: 'America/Los_Angeles' },
            headers: {
                'x-rapidapi-host': 'api-football-v1.p.rapidapi.com',
                'x-rapidapi-key': '28fc80e178mshdff1cc6efb6539cp119f94jsn1a2811635bf8'
            }
        };
        var response = await axios.request(options);
        global.testgame = response.data;
        let gamedate = response.data.parameters.date;
        let totalPage = response.data.paging.total;
        let objectDef = {
            date: gamedate,
            fixtures: response.data.response
        };
        let restPreparedData = await prepareAllGamesData(1, totalPage);
        let finalData = buildAllGamesData(objectDef, restPreparedData);
        global.testgame = finalData;
        console.log(finalData);
        console.log('final data about to store');
        console.log('saving new data');
        var res = await container.items.create(finalData);
        console.log('save success!');
        console.log(res);
    }
    var fixturesDates = await fixturesContainer.items.query(`SELECT * from c WHERE c.date = '${getDateString()}'`).fetchAll();
    console.log('check if data in fixturesContainer db');
    if (fixturesDates.resources.length === 0) {
        //------------------- getting the fixtures by date ----------
        console.log('starting get the fixtures');
        var fixturesOptions = {
            method: 'GET',
            url: 'https://api-football-v1.p.rapidapi.com/v3/fixtures',
            params: { date: getDateString(), timezone: 'America/Los_Angeles' },
            headers: {
                'x-rapidapi-host': 'api-football-v1.p.rapidapi.com',
                'x-rapidapi-key': '28fc80e178mshdff1cc6efb6539cp119f94jsn1a2811635bf8'
            }
        };
        var fixturesResponse = await axios.request(fixturesOptions);
        var fixturesObject = {
            date: fixturesResponse.data.parameters.date,
            fixtures: fixturesResponse.data.response
        };
        global.testfixtures = fixturesObject;
        console.log('store data in database');
        console.log('saving new fixturesContainer data');
        var fixturesRes = await fixturesContainer.items.create(fixturesObject);
        console.log('save fixturesContainer success!');
        console.log(fixturesRes);
    }
});

function start() {
    allGamesRequest.start();
}

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

async function prepareAllGamesData(startPage, endPage) {
    const delay = (ms = 1000) => new Promise((r) => setTimeout(r, ms));
    const getInSeries = async (promises) => {
        let results = [];
        for (let promise of promises) {
            results.push(await delay().then(() => promise));
        }
        return results;
    };
    const getInParallel = async (promises) => Promise.all(promises);
    const pageArray = [];
    for (let i = startPage + 1; i <= endPage; i++) {
        pageArray.push(i);
    }
    const promises = pageArray.map((page) => {
        const thisOption = {
            method: 'GET',
            url: 'https://api-football-v1.p.rapidapi.com/v3/odds',
            params: { date: getDateString(), timezone: 'America/Los_Angeles', page: page },
            headers: {
                'x-rapidapi-host': 'api-football-v1.p.rapidapi.com',
                'x-rapidapi-key': '28fc80e178mshdff1cc6efb6539cp119f94jsn1a2811635bf8'
            }
        }
        return axios.request(thisOption);
    });
    const results = await getInSeries(promises);
    return results;
}

function buildAllGamesData(originalCall, resultsArray) {
    // filter works
    originalCall.games = filterGames(originalCall.games);
    for (let i = 0; i < resultsArray.length; i++) {
        originalCall.games = originalCall.games.concat(filterGames(resultsArray[i].data.response));
    }
    return originalCall;
}

function filterGames(games) {
    var filteredGames = games.filter((game) => {
        var gameOddsProviders = game.bookmakers;
        game.bookmakers = gameOddsProviders.filter((provider) => {
            return filterSpecificOddsProvider(6, provider);
        });
        return game.bookmakers.length === 1;
    });
    return filteredGames;
}

function filterSpecificOddsProvider(id, data) {
    return data.id === id;
}

exports.start = start;

