const nodeCron = require("node-cron");
const axios = require("axios").default;
const helper = require('../common/helper');
const CosmosClient = require("@azure/cosmos").CosmosClient;
// const nodeMailer = require('nodemailer');
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
const leaguesContainer = database.container('leagues');

const runTimeMonitor = nodeCron.schedule("*/3 * * * *", async function jobYouNeedToExecute() {
    // global.monitor = {
    //     lastCheck: new Date(),
    //     isTodayFixtureFetched: false,
    //     isTodayGameFetched: false,
    //     isTodayFixtureFetching: false,
    //     isTodayGameFetching: false
    //   };
    console.log('run time Monitor is running');
    global.monitor.lastCheck = new Date();
    console.log('check if game update');
    var dates = await container.items.query(`SELECT * from c WHERE c.date = '${helper.getDateString()}'`).fetchAll();
    if (dates.resources.length === 0) {
        global.monitor.isTodayGameFetched = false;
    } else {
        global.monitor.isTodayGameFetched = true;
    }
    console.log('check if game update');
    var fixturesDates = await fixturesContainer.items.query(`SELECT * from c WHERE c.date = '${helper.getDateString()}'`).fetchAll()
    if (fixturesDates.resources.length === 0) {
        global.monitor.isTodayFixtureFetched = false;
    } else {
        global.monitor.isTodayFixtureFetched = true;
    }
});

// change to every 2 hours running the cron job, but now only for fixtures
// change to call at 1:59am
// pst time is 7 hours behind
const allGamesRequest = nodeCron.schedule("30 1,12 * * *", async function jobYouNeedToExecute() {
    console.log("all game request executed");
    // check if we already got today's game
    var dates = await container.items.query(`SELECT * from c WHERE c.date = '${helper.getDateString()}'`).fetchAll();
    console.log(dates);
    if (dates.resources.length === 0) {
        global.monitor.isTodayGameFetching = true;
        var currentDateString = helper.getDateString();
        var options = {
            method: 'GET',
            url: 'https://api-football-v1.p.rapidapi.com/v3/odds',
            params: { date: currentDateString, timezone: 'America/Los_Angeles' },
            headers: {
                'x-rapidapi-host': 'api-football-v1.p.rapidapi.com',
                'x-rapidapi-key': '28fc80e178mshdff1cc6efb6539cp119f94jsn1a2811635bf8'
            }
        };
        var response;
        try {
            response = await axios.request(options);
        } catch (e) {
            console.log(e);
            global.monitor.isTodayGameFetching = false;
        }
        global.testgame = response.data;
        let gamedate = response.data.parameters.date;
        let totalPage = response.data.paging.total;
        let objectDef = {
            date: gamedate,
            games: response.data.response
        };
        let restPreparedData = await prepareAllGamesData(1, totalPage);
        let finalData = buildAllGamesData(objectDef, restPreparedData);
        global.testgame = finalData;
        console.log(finalData);
        console.log('final data about to store');
        console.log('saving new data');
        var res = await container.items.create(finalData);
        console.log('save success!');
        global.monitor.isTodayGameFetching = false;
        console.log(res);
    }
    var fixturesDates = await fixturesContainer.items.query(`SELECT * from c WHERE c.date = '${helper.getDateString()}'`).fetchAll();
    console.log('check if data in fixturesContainer db');
    if (fixturesDates.resources.length === 0) {
        //------------------- getting the fixtures by date ----------
        console.log('starting get the fixtures');
        global.monitor.isTodayFixtureFetching = true;
        var fixturesOptions = {
            method: 'GET',
            url: 'https://api-football-v1.p.rapidapi.com/v3/fixtures',
            params: { date: helper.getDateString(), timezone: 'America/Los_Angeles' },
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
        global.monitor.isTodayFixtureFetching = false;
    } else if (fixturesDates.resources.length === 1) {
        console.log('updating the fixture data');
        global.monitor.isTodayFixtureFetching = true;
        var fixturesOptions = {
            method: 'GET',
            url: 'https://api-football-v1.p.rapidapi.com/v3/fixtures',
            params: { date: helper.getDateString(), timezone: 'America/Los_Angeles' },
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
        console.log('updating new fixturesContainer data');
        var fixturesRes = await fixturesContainer.items({ date: fixturesResponse.data.parameters.date }).replace(fixturesObject);
        console.log('updating fixturesContainer success!');
        console.log(fixturesRes);
        global.monitor.isTodayFixtureFetching = false;
    };

    // let transporter = nodeMailer.createTransport({
    //     host: 'smtp.ethereal.email',
    //     port: 587,
    //     secure: false, // true for 465, false for other ports
    //     auth: {
    //         user: 'kathryn.abshire@ethereal.email', // generated ethereal user
    //         pass: 'ZWwwWSU7UsJKKZThQS' // generated ethereal password
    //     }
    // });

    // var mailOptions = {
    //     from: 'kathryn.abshire@ethereal.email',
    //     to: 'yolofootballdatacenter@gmail.com',
    //     subject: 'the cron job finish running',
    //     text: 'he cron job finish running'
    // };

    // transporter.sendMail(mailOptions, function (error, info) {
    //     if (error) {
    //         console.log(errsor);
    //     } else {
    //         console.log('Email sent: ' + info.response);
    //     }
    // });
}, {
    scheduled: false,
    timezone: 'America/Los_Angeles'
});

const allDataRequest = nodeCron.schedule("1 1,10,19 * * *", async function jobYouNeedToExecute() {

    let league_ids = [];
    let league_ids_eu = [39,140,61,136,78]; // 5 major leagus
    let league_ids_asian = [98,292,169]; // J, K, C
    let league_ids_special = [1]; // world cup
    league_ids = league_ids.concat(league_ids_eu);
    league_ids = league_ids.concat(league_ids_special);
    league_ids = league_ids.concat(league_ids_asian);
    console.log(league_ids);
    prepareAllFixureData(league_ids, '2022', leaguesContainer);
}, {
    scheduled: true,
    timezone: 'America/Los_Angeles'
});

function start() {
    // init();
    // allGamesRequest.start();
    // runTimeMonitor.start();
    allDataRequest.start();
}

function getFixtureDataRequest(id, season) {
    var option = {
        method: 'GET',
        url: 'https://api-football-v1.p.rapidapi.com/v3/fixtures',
        params: {league: id, season: season},
        headers: {
            'x-rapidapi-host': 'api-football-v1.p.rapidapi.com',
            'x-rapidapi-key': '28fc80e178mshdff1cc6efb6539cp119f94jsn1a2811635bf8'
        }
    };
    return option;
}

async function prepareAllFixureData(leagues, season, databaseContainer) {
    const delay = (ms = 1200) => new Promise((r) => setTimeout(r, ms));
    const getInSeries = async (promises) => {
        let results = [];
        let count = 1;
        for (let promise of promises) {
            console.log('executing the request for leagues', count++);
            await delay();
            try {
                const request_result = await axios.request(promise);
                const leagueResult = {
                    league: request_result.data.parameters.league,
                    fixtures: request_result.data.response
                };
                const leagueDataInDB = await databaseContainer.items.query(`SELECT * from c WHERE c.league = '${leagueResult.league}'`).fetchAll();
                if (leagueDataInDB.resources.length == 0) {
                    const createdLeagueResponse = databaseContainer.items.create(leagueResult);
                    console.log('createdLeagueResponse succeed');
                } else if (leagueDataInDB.resources.length == 1) {
                    let currentData = leagueDataInDB.resources[0];
                    if (!leagueResult.fixtures && leagueResult.fixtures.length > 0) {
                        currentData.fixtures = leagueResult.fixtures;
                        const replaceLeagueResponse = databaseContainer.item(currentData.id, currentData.league).replace(currentData);
                        console.log('replaceLeagueResponse succeed');
                    }
                }
                console.log('executing success for:', count);
            } catch (e) {
                console.log('executing error:', count);
                console.log(e);
            }
        }
        return results;
    };
    const promises = leagues.map((league_id) => {
        console.log(league_id);
        return getFixtureDataRequest(league_id, season);
    });
    try {
        const results = await getInSeries(promises);
        return results;
    } catch (e) {
        console.log(e);
        global.monitor.isTodayGameFetching = false;
    }
    return null;
}

async function prepareAllGamesData(startPage, endPage) {
    const delay = (ms = 1200) => new Promise((r) => setTimeout(r, ms));
    const getInSeries = async (promises) => {
        let results = [];
        let count = 1;
        for (let promise of promises) {
            console.log('executing the request for pages', count++);
            await delay();
            try {
                const request_result = await axios.request(promise);
                results.push(request_result);
                console.log('executing success for:', count);
            } catch (e) {
                console.log('executing error:', count);
                console.log(e);
            }
        }
        return results;
    };
    const getInParallel = async (promises) => Promise.all(promises);
    const pageArray = [];
    for (let i = startPage + 1; i <= endPage; i++) {
        pageArray.push(i);
    }
    const promises = pageArray.map((page) => {
        console.log(page);
        const thisOption = {
            method: 'GET',
            url: 'https://api-football-v1.p.rapidapi.com/v3/odds',
            params: { date: helper.getDateString(), timezone: 'America/Los_Angeles', page: page },
            headers: {
                'x-rapidapi-host': 'api-football-v1.p.rapidapi.com',
                'x-rapidapi-key': '28fc80e178mshdff1cc6efb6539cp119f94jsn1a2811635bf8'
            }
        }
        return thisOption;
    });
    try {
        const results = await getInSeries(promises);
        return results;
    } catch (e) {
        console.log(e);
        global.monitor.isTodayGameFetching = false;
    }
    return null;
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

async function init() {
    console.log('initial check')
    console.log('check if game update');
    var dates = await container.items.query(`SELECT * from c WHERE c.date = '${helper.getDateString()}'`).fetchAll();
    if (dates.resources.length === 0) {
        global.monitor.isTodayGameFetched = false;
    } else {
        global.testgame = dates.resources[0];
        global.monitor.isTodayGameFetched = true;
    }
    console.log('check if game update');
    var fixturesDates = await fixturesContainer.items.query(`SELECT * from c WHERE c.date = '${helper.getDateString()}'`).fetchAll()
    if (fixturesDates.resources.length === 0) {
        global.monitor.isTodayFixtureFetched = false;
    } else {
        global.testfixtures = fixturesDates.resources[0];
        global.monitor.isTodayFixtureFetched = true;
    }
}

exports.start = start;

