const nodeCron = require("node-cron");
const helper = require("../common/helper");
const CosmosClient = require("@azure/cosmos").CosmosClient;
const {
  getPacificDateString,
  requestWithApiUsage,
} = require("../common/apiUsage");
const { createNotificationRepository } = require("../common/notificationRepository");
const {
  SUPPORTED_LEAGUES,
  matchesSupportedLeague,
} = require("../common/supportedLeagues");
const { runNotificationSweep } = require("./notificationSweep");
const { runOrderSettlementSweep } = require("./orderSettlementSweep");
const Mailjet = require("node-mailjet");
const mailjet = Mailjet.apiConnect(
  "540e8d4b1864d6a55dec4d9e57d47c94",
  "1ffb56f79c4502204176e16b21e7e782"
);
// const nodeMailer = require('nodemailer');
const config = {
  endpoint: "https://yolofootball-database.documents.azure.com:443/",
  key: "hOicNBuPcYclHNG3UHZA9zGKhXp9zrTeoxbagVWBWRql4nXsEbOykJkyxfKMA2cEOGuwvMAMIES8Ssg81bppFA==",
  databaseId: "yolofootball",
  containerId: "games",
};
console.log("connect to cosmosdb");
const client = new CosmosClient({ endpoint: config.endpoint, key: config.key });
const database = client.database(config.databaseId);
const container = database.container(config.containerId);
const fixturesContainer = database.container("fixtures");
const leaguesContainer = database.container("leagues");
const oddsContainer = database.container("odds");
const notificationRepository = createNotificationRepository();
const API_FOOTBALL_BASE_URL = "https://api-football-v1.p.rapidapi.com/v3";
const API_FOOTBALL_HOST = "api-football-v1.p.rapidapi.com";
const API_FOOTBALL_KEY = "28fc80e178mshdff1cc6efb6539cp119f94jsn1a2811635bf8";
const ODDS_BOOKMAKER_ID = "8";
const API_FOOTBALL_PROVIDER = "api-football";
const API_FOOTBALL_TIMEZONE = "America/Los_Angeles";
const ODDS_LOOKAHEAD_DAYS = 14;
const API_REQUEST_DELAY_MS = 1200;
const SUPPORTED_LEAGUE_CACHE_TTL_MS = 24 * 60 * 60 * 1000;
const ODDS_ELIGIBLE_FIXTURE_STATUSES = new Set(["NS"]);
const supportedLeagueCache = {
  fetchedAt: 0,
  currentLeagues: [],
  resolvedLeagues: [],
};

const runTimeMonitor = nodeCron.schedule(
  "*/3 * * * *",
  async function jobYouNeedToExecute() {
    // global.monitor = {
    //     lastCheck: new Date(),
    //     isTodayFixtureFetched: false,
    //     isTodayGameFetched: false,
    //     isTodayFixtureFetching: false,
    //     isTodayGameFetching: false
    //   };
    console.log("run time Monitor is running");
    global.monitor.lastCheck = new Date();
    console.log("check if game update");
    var dates = await container.items
      .query(`SELECT * from c WHERE c.date = '${helper.getDateString()}'`)
      .fetchAll();
    if (dates.resources.length === 0) {
      global.monitor.isTodayGameFetched = false;
    } else {
      global.monitor.isTodayGameFetched = true;
    }
    console.log("check if game update");
    var fixturesDates = await fixturesContainer.items
      .query(`SELECT * from c WHERE c.date = '${helper.getDateString()}'`)
      .fetchAll();
    if (fixturesDates.resources.length === 0) {
      global.monitor.isTodayFixtureFetched = false;
    } else {
      global.monitor.isTodayFixtureFetched = true;
    }
  }
);

// change to every 2 hours running the cron job, but now only for fixtures
// change to call at 1:59am
// pst time is 7 hours behind
const allGamesRequest = nodeCron.schedule(
  "30 1,12 * * *",
  async function jobYouNeedToExecute() {
    console.log("all game request executed");
    // check if we already got today's game
    var dates = await container.items
      .query(`SELECT * from c WHERE c.date = '${helper.getDateString()}'`)
      .fetchAll();
    console.log(dates);
    if (dates.resources.length === 0) {
      global.monitor.isTodayGameFetching = true;
      var currentDateString = helper.getDateString();
      var options = {
        method: "GET",
        url: "https://api-football-v1.p.rapidapi.com/v3/odds",
        params: { date: currentDateString, timezone: "America/Los_Angeles" },
        headers: {
          "x-rapidapi-host": "api-football-v1.p.rapidapi.com",
          "x-rapidapi-key":
            "28fc80e178mshdff1cc6efb6539cp119f94jsn1a2811635bf8",
        },
      };
      var response;
      try {
        response = await requestApiFootball(options, "allGamesRequest");
      } catch (e) {
        console.log(e);
        global.monitor.isTodayGameFetching = false;
      }
      global.testgame = response.data;
      let gamedate = response.data.parameters.date;
      let totalPage = response.data.paging.total;
      let objectDef = {
        date: gamedate,
        games: response.data.response,
      };
      let restPreparedData = await prepareAllGamesData(1, totalPage);
      let finalData = buildAllGamesData(objectDef, restPreparedData);
      global.testgame = finalData;
      console.log(finalData);
      console.log("final data about to store");
      console.log("saving new data");
      var res = await container.items.create(finalData);
      console.log("save success!");
      global.monitor.isTodayGameFetching = false;
      console.log(res);
    }
    var fixturesDates = await fixturesContainer.items
      .query(`SELECT * from c WHERE c.date = '${helper.getDateString()}'`)
      .fetchAll();
    console.log("check if data in fixturesContainer db");
    if (fixturesDates.resources.length === 0) {
      //------------------- getting the fixtures by date ----------
      console.log("starting get the fixtures");
      global.monitor.isTodayFixtureFetching = true;
      var fixturesOptions = {
        method: "GET",
        url: "https://api-football-v1.p.rapidapi.com/v3/fixtures",
        params: {
          date: helper.getDateString(),
          timezone: "America/Los_Angeles",
        },
        headers: {
          "x-rapidapi-host": "api-football-v1.p.rapidapi.com",
          "x-rapidapi-key":
            "28fc80e178mshdff1cc6efb6539cp119f94jsn1a2811635bf8",
        },
      };
      var fixturesResponse = await requestApiFootball(
        fixturesOptions,
        "allGamesRequest"
      );
      var fixturesObject = {
        date: fixturesResponse.data.parameters.date,
        fixtures: fixturesResponse.data.response,
      };
      global.testfixtures = fixturesObject;
      console.log("store data in database");
      console.log("saving new fixturesContainer data");
      var fixturesRes = await fixturesContainer.items.create(fixturesObject);
      console.log("save fixturesContainer success!");
      console.log(fixturesRes);
      global.monitor.isTodayFixtureFetching = false;
    } else if (fixturesDates.resources.length === 1) {
      console.log("updating the fixture data");
      global.monitor.isTodayFixtureFetching = true;
      var fixturesOptions = {
        method: "GET",
        url: "https://api-football-v1.p.rapidapi.com/v3/fixtures",
        params: {
          date: helper.getDateString(),
          timezone: "America/Los_Angeles",
        },
        headers: {
          "x-rapidapi-host": "api-football-v1.p.rapidapi.com",
          "x-rapidapi-key":
            "28fc80e178mshdff1cc6efb6539cp119f94jsn1a2811635bf8",
        },
      };
      var fixturesResponse = await requestApiFootball(
        fixturesOptions,
        "allGamesRequest"
      );
      var fixturesObject = {
        date: fixturesResponse.data.parameters.date,
        fixtures: fixturesResponse.data.response,
      };
      global.testfixtures = fixturesObject;
      console.log("store data in database");
      console.log("updating new fixturesContainer data");
      var fixturesRes = await fixturesContainer
        .items({ date: fixturesResponse.data.parameters.date })
        .replace(fixturesObject);
      console.log("updating fixturesContainer success!");
      console.log(fixturesRes);
      global.monitor.isTodayFixtureFetching = false;
    }

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
  },
  {
    scheduled: false,
    timezone: "America/Los_Angeles",
  }
);

const allDataRequest = nodeCron.schedule(
  "1 1,10,15,19 * * *",
  async function jobYouNeedToExecute() {
    try {
      const supportedLeagues = await resolveSupportedLeagues();
      if (supportedLeagues.length === 0) {
        console.log("no supported leagues resolved for fixture ingestion");
        return;
      }
      await prepareAllFixureData(supportedLeagues, leaguesContainer);
    } catch (error) {
      console.log("failed to prepare all fixture data");
      console.log(error);
    }
  },
  {
    scheduled: true,
    timezone: "America/Los_Angeles",
  }
);

const allOddsRequest = nodeCron.schedule(
  "43 1,10,15,18 * * *",
  // "20 19 * * * *", test time
  async function jobYouNeedToExecute() {
    try {
      await prepareUpcomingOddsData(leaguesContainer, oddsContainer);
    } catch (error) {
      console.log("failed to prepare all odds data");
      console.log(error);
    }
  },
  {
    scheduled: true,
    timezone: "America/Los_Angeles",
  }
);

const notificationSweepRequest = nodeCron.schedule(
  "*/10 * * * *",
  async function jobYouNeedToExecute() {
    try {
      console.log("order settlement sweep executed");
      await runOrderSettlementSweep({
        notificationRepository,
        now: new Date(),
      });
      console.log("notification sweep executed");
      await runNotificationSweep({
        repository: notificationRepository,
        now: new Date(),
      });
    } catch (error) {
      console.log("notification sweep failed");
      console.log(error);
    }
  },
  {
    scheduled: true,
    timezone: "America/Los_Angeles",
  }
);

function buildApiFootballRequest(path, params = {}) {
  return {
    method: "GET",
    url: `${API_FOOTBALL_BASE_URL}${path}`,
    params,
    headers: {
      "x-rapidapi-host": API_FOOTBALL_HOST,
      "x-rapidapi-key": API_FOOTBALL_KEY,
    },
  };
}

function requestApiFootball(options, job) {
  return requestWithApiUsage(options, {
    provider: API_FOOTBALL_PROVIDER,
    job,
    source: "cron",
  });
}

async function refreshSupportedLeagueReference(forceRefresh = false) {
  const cacheAge = Date.now() - supportedLeagueCache.fetchedAt;
  if (
    !forceRefresh &&
    supportedLeagueCache.fetchedAt &&
    cacheAge < SUPPORTED_LEAGUE_CACHE_TTL_MS &&
    supportedLeagueCache.currentLeagues.length > 0
  ) {
    return supportedLeagueCache.currentLeagues;
  }

  const response = await requestApiFootball(
    buildApiFootballRequest("/leagues", { current: "true" }),
    "resolveSupportedLeagues"
  );
  const currentLeagues = Array.isArray(response?.data?.response)
    ? response.data.response
    : [];

  supportedLeagueCache.fetchedAt = Date.now();
  supportedLeagueCache.currentLeagues = currentLeagues;
  supportedLeagueCache.resolvedLeagues = [];

  return currentLeagues;
}

async function resolveSupportedLeagues(forceRefresh = false) {
  const cacheAge = Date.now() - supportedLeagueCache.fetchedAt;
  if (
    !forceRefresh &&
    supportedLeagueCache.resolvedLeagues.length > 0 &&
    cacheAge < SUPPORTED_LEAGUE_CACHE_TTL_MS
  ) {
    return supportedLeagueCache.resolvedLeagues;
  }

  const currentLeagues = await refreshSupportedLeagueReference(forceRefresh);
  const resolvedLeagues = [];

  SUPPORTED_LEAGUES.forEach((supportedLeague) => {
    const matchedLeague = currentLeagues.find((leagueEntry) =>
      matchesSupportedLeague(
        {
          country: leagueEntry?.country?.name,
          name: leagueEntry?.league?.name,
        },
        supportedLeague
      )
    );

    if (!matchedLeague) {
      console.log("supported league missing from current reference", supportedLeague);
      return;
    }

    const currentSeason = Array.isArray(matchedLeague?.seasons)
      ? matchedLeague.seasons.find((season) => season?.current === true)
      : null;
    const hasOddsCoverage = currentSeason?.coverage?.odds === true;

    if (!currentSeason || !hasOddsCoverage) {
      console.log("supported league skipped due to missing current odds coverage", {
        key: supportedLeague.key,
        leagueId: matchedLeague?.league?.id,
        season: currentSeason?.year || null,
      });
      return;
    }

    resolvedLeagues.push({
      key: supportedLeague.key,
      id: String(matchedLeague.league.id),
      name: matchedLeague.league.name,
      country: matchedLeague.country.name,
      season: String(currentSeason.year),
    });
  });

  supportedLeagueCache.resolvedLeagues = resolvedLeagues;
  return resolvedLeagues;
}

async function sendFixturesRefreshEmail(summaryText) {
  const mailjetEmail = mailjet.post("send", { version: "v3.1" }).request({
    Messages: [
      {
        From: {
          Email: "yolofootballdatacenter@gmail.com",
          Name: "Yolofootball DC",
        },
        To: [
          {
            Email: "albertlabtech@gmail.com",
            Name: "Aibo Li",
          },
        ],
        Subject: "Cron Job for Fixtures Data is completed",
        TextPart: summaryText,
        HTMLPart: `<h3>${summaryText}</h3><br /><p>Please check <a href="https://yolofootball.com/">Yolofootball.com</a>.</p>`,
      },
    ],
  });

  mailjetEmail
    .then((result) => {
      console.log(result.body);
    })
    .catch((err) => {
      console.log(err.statusCode);
    });
}

async function upsertLeagueFixturesData(databaseContainer, leagueResult) {
  const leagueDataInDB = await databaseContainer.items
    .query(`SELECT * from c WHERE c.league = '${leagueResult.league}'`)
    .fetchAll();

  if (leagueDataInDB.resources.length === 0) {
    if (leagueResult.fixtures.length === 0) {
      console.log("skip creating empty fixtures snapshot", leagueResult.league);
      return;
    }
    await databaseContainer.items.create(leagueResult);
    console.log("createdLeagueResponse succeed");
    return;
  }

  if (leagueDataInDB.resources.length === 1) {
    const currentData = leagueDataInDB.resources[0];
    if (leagueResult.fixtures.length === 0) {
      console.log("skip replacing fixtures snapshot with empty response", leagueResult.league);
      return;
    }
    currentData.fixtures = leagueResult.fixtures;
    await databaseContainer.item(currentData.id, currentData.league).replace(currentData);
    console.log("replaceLeagueResponse succeed");
  }
}

async function upsertLeagueOddsData(
  databaseContainer,
  oddsResult,
  { allowEmptyReplace = false } = {}
) {
  const oddsDataInDB = await databaseContainer.items
    .query(`SELECT * from c WHERE c.league = '${oddsResult.league}'`)
    .fetchAll();

  if (oddsDataInDB.resources.length === 0) {
    if (oddsResult.odds.length === 0) {
      console.log("skip creating empty odds snapshot", oddsResult.league);
      return;
    }
    await databaseContainer.items.create(oddsResult);
    console.log("createdOddsResponse succeed");
    return;
  }

  if (oddsDataInDB.resources.length === 1) {
    const currentData = oddsDataInDB.resources[0];
    if (oddsResult.odds.length === 0 && !allowEmptyReplace) {
      console.log("skip replacing odds snapshot with empty response", oddsResult.league);
      return;
    }
    currentData.odds = oddsResult.odds;
    currentData.season = oddsResult.season || currentData.season;
    await databaseContainer.item(currentData.id, currentData.league).replace(currentData);
    console.log("replaceOddsResponse succeed");
  }
}

function start() {
  // init();
  // allGamesRequest.start();
  // runTimeMonitor.start();
  // --------live below---------
  allDataRequest.start();
  allOddsRequest.start();
  notificationSweepRequest.start();
  // --------test below---------
  // prepareAllFixureData([{ id: "39", season: "2024" }], leaguesContainer);
  // testEmail();
}

// function testEmail() {
//   const mailjetEmail = mailjet.post("send", { version: "v3.1" }).request({
//     Messages: [
//       {
//         From: {
//           Email: "admin@yolofootball.com",
//           Name: "Yolofootball Official",
//         },
//         To: [
//           {
//             Email: "albertlabtech@gmail.com",
//             Name: "Aibo Li",
//           },
//         ],
//         Subject: "Cron Job for Fixtures Data is completed",
//         TextPart: "The fictures data have been updated!!!",
//         HTMLPart:
//           '<h3>The fictures data have been updated!!! please check at <a href="https://yolofootball.com/">Yolofootball.com</a>!</h3><br />',
//       },
//     ],
//   });

//   mailjetEmail
//     .then((result) => {
//       console.log(result.body);
//     })
//     .catch((err) => {
//       console.log(err.statusCode);
//     });
// }

function getFixtureDataRequest(id, season) {
  return buildApiFootballRequest("/fixtures", { league: id, season: season });
}

function getOddsByDateRequest(date, page = 1) {
  return buildApiFootballRequest("/odds", {
    date,
    timezone: API_FOOTBALL_TIMEZONE,
    bookmaker: ODDS_BOOKMAKER_ID,
    page,
  });
}

function delayRequest(ms = API_REQUEST_DELAY_MS) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function normalizeId(value) {
  if (value === undefined || value === null) {
    return null;
  }

  const normalizedValue = String(value).trim();
  return normalizedValue.length > 0 ? normalizedValue : null;
}

function addDaysToDateString(dateString, days) {
  const [year, month, day] = String(dateString)
    .split("-")
    .map((value) => Number.parseInt(value, 10));
  const nextDate = new Date(Date.UTC(year, month - 1, day + days));
  const nextYear = nextDate.getUTCFullYear();
  const nextMonth = String(nextDate.getUTCMonth() + 1).padStart(2, "0");
  const nextDay = String(nextDate.getUTCDate()).padStart(2, "0");

  return `${nextYear}-${nextMonth}-${nextDay}`;
}

function getFixturePacificDate(fixtureEntry) {
  const fixtureDate = fixtureEntry?.fixture?.date;
  if (!fixtureDate) {
    return null;
  }

  try {
    return getPacificDateString(fixtureDate);
  } catch (error) {
    return null;
  }
}

function collectUpcomingOddsTargets(
  leagueDocuments,
  { today = helper.getDateString(), lookaheadDays = ODDS_LOOKAHEAD_DAYS } = {}
) {
  const maxDate = addDaysToDateString(today, lookaheadDays);
  const dates = new Set();
  const targetsByLeague = {};

  (Array.isArray(leagueDocuments) ? leagueDocuments : []).forEach((leagueDocument) => {
    const leagueId = normalizeId(leagueDocument?.league);
    if (!leagueId || !Array.isArray(leagueDocument?.fixtures)) {
      return;
    }

    leagueDocument.fixtures.forEach((fixtureEntry) => {
      const fixtureId = normalizeId(fixtureEntry?.fixture?.id);
      const fixtureStatus = fixtureEntry?.fixture?.status?.short;
      const fixtureDate = getFixturePacificDate(fixtureEntry);

      if (
        !fixtureId ||
        !fixtureDate ||
        !ODDS_ELIGIBLE_FIXTURE_STATUSES.has(fixtureStatus) ||
        fixtureDate < today ||
        fixtureDate > maxDate
      ) {
        return;
      }

      if (!targetsByLeague[leagueId]) {
        targetsByLeague[leagueId] = {
          league: leagueId,
          season: normalizeId(leagueDocument?.season),
          fixtureIds: new Set(),
          dates: new Set(),
        };
      }

      targetsByLeague[leagueId].fixtureIds.add(fixtureId);
      targetsByLeague[leagueId].dates.add(fixtureDate);
      dates.add(fixtureDate);
    });
  });

  return {
    dates: Array.from(dates).sort(),
    leagues: Object.values(targetsByLeague).map((target) => ({
      league: target.league,
      season: target.season,
      fixtureIds: Array.from(target.fixtureIds),
      dates: Array.from(target.dates).sort(),
    })),
  };
}

async function prepareAllFixureData(leagues, databaseContainer) {
  const delay = (ms = 1200) => new Promise((r) => setTimeout(r, ms));
  const getInSeries = async (promises) => {
    let successCount = 0;
    let count = 1;
    for (let promise of promises) {
      console.log("executing the request for leagues", count++);
      await delay();
      try {
        const request_result = await requestApiFootball(promise, "allDataRequest");
        const leagueResult = {
          league: request_result.data.parameters.league,
          fixtures: request_result.data.response,
        };
        await upsertLeagueFixturesData(databaseContainer, leagueResult);
        successCount++;
        console.log("executing success for all fixture data:", count);
      } catch (e) {
        console.log("executing error fixture data:", count);
        console.log(e);
      }
    }
    if (successCount > 0) {
      sendFixturesRefreshEmail(
        `The fixtures data have been updated for ${successCount} supported leagues.`
      );
    }
    return successCount;
  };
  const promises = leagues.map((league_id) => {
    console.log(league_id.id, league_id.season);
    return getFixtureDataRequest(league_id.id, league_id.season);
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
      console.log("executing the request for pages", count++);
      await delay();
      try {
        const request_result = await requestApiFootball(promise, "allGamesRequest");
        results.push(request_result);
        console.log("executing success for all game data:", count);
      } catch (e) {
        console.log("executing error  all game data:", count);
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
      method: "GET",
      url: "https://api-football-v1.p.rapidapi.com/v3/odds",
      params: {
        date: helper.getDateString(),
        timezone: "America/Los_Angeles",
        page: page,
      },
      headers: {
        "x-rapidapi-host": "api-football-v1.p.rapidapi.com",
        "x-rapidapi-key": "28fc80e178mshdff1cc6efb6539cp119f94jsn1a2811635bf8",
      },
    };
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

async function fetchOddsForDate(date) {
  let odds = [];
  let currentPage = 1;
  let totalPage = 1;

  do {
    await delayRequest();
    const response = await requestApiFootball(
      getOddsByDateRequest(date, currentPage),
      "allOddsRequest"
    );
    if (hasApiFootballErrors(response?.data?.errors)) {
      throw new Error(
        `api-football odds error for ${date}: ${JSON.stringify(response.data.errors)}`
      );
    }
    const responseOdds = Array.isArray(response?.data?.response)
      ? response.data.response
      : [];
    odds = odds.concat(responseOdds);
    const parsedTotalPage = Number(response?.data?.paging?.total || 1);
    totalPage = Number.isFinite(parsedTotalPage)
      ? Math.max(1, parsedTotalPage)
      : 1;
    currentPage++;
  } while (currentPage <= totalPage);

  return odds;
}

function groupOddsByLeague(oddsEntries, leagueTargets) {
  const fixtureToLeague = {};
  const groupedOdds = {};

  leagueTargets.forEach((target) => {
    groupedOdds[target.league] = {
      league: target.league,
      season: target.season,
      odds: [],
    };

    target.fixtureIds.forEach((fixtureId) => {
      fixtureToLeague[fixtureId] = target.league;
    });
  });

  (Array.isArray(oddsEntries) ? oddsEntries : []).forEach((oddsEntry) => {
    const fixtureId = normalizeId(oddsEntry?.fixture?.id);
    const targetLeagueId = fixtureToLeague[fixtureId];
    if (!targetLeagueId || !groupedOdds[targetLeagueId]) {
      return;
    }

    const oddsLeagueId = normalizeId(oddsEntry?.league?.id) || targetLeagueId;
    if (oddsLeagueId !== targetLeagueId) {
      return;
    }

    groupedOdds[targetLeagueId].season =
      normalizeId(oddsEntry?.league?.season) || groupedOdds[targetLeagueId].season;
    groupedOdds[targetLeagueId].odds.push(oddsEntry);
  });

  return Object.values(groupedOdds);
}

function hasApiFootballErrors(errors) {
  if (!errors) {
    return false;
  }
  if (Array.isArray(errors)) {
    return errors.length > 0;
  }
  if (typeof errors === "object") {
    return Object.keys(errors).length > 0;
  }

  return Boolean(errors);
}

async function prepareUpcomingOddsData(leaguesContainer, databaseContainer) {
  const leagueDocumentsResult = await leaguesContainer.items
    .query("SELECT * FROM c")
    .fetchAll();
  const targets = collectUpcomingOddsTargets(leagueDocumentsResult.resources || []);

  if (targets.dates.length === 0) {
    console.log("no upcoming fixture dates resolved for odds ingestion");
    return [];
  }

  console.log("odds ingestion target dates", targets.dates);
  let allOddsEntries = [];
  const failedDates = new Set();

  for (const date of targets.dates) {
    try {
      const dateOdds = await fetchOddsForDate(date);
      allOddsEntries = allOddsEntries.concat(dateOdds);
      console.log("executing success for odds date:", date);
    } catch (error) {
      failedDates.add(date);
      console.log("executing error odds date:", date);
      console.log(error);
    }
  }

  const leagueOddsResults = groupOddsByLeague(allOddsEntries, targets.leagues);
  const targetsByLeague = targets.leagues.reduce((targetMap, target) => {
    targetMap[target.league] = target;
    return targetMap;
  }, {});

  for (const oddsResult of leagueOddsResults) {
    const target = targetsByLeague[oddsResult.league];
    const hasFailedTargetDate = (target?.dates || []).some((date) =>
      failedDates.has(date)
    );
    if (hasFailedTargetDate) {
      console.log("skip replacing odds snapshot due to failed target date", {
        league: oddsResult.league,
        failed_dates: Array.from(failedDates),
      });
      continue;
    }

    await upsertLeagueOddsData(databaseContainer, oddsResult, {
      allowEmptyReplace: true,
    });
  }

  console.log(
    `updated odds data for ${leagueOddsResults.length} leagues from ${targets.dates.length} dates`
  );
  return leagueOddsResults;
}

function buildAllGamesData(originalCall, resultsArray) {
  // filter works
  originalCall.games = filterGames(originalCall.games);
  for (let i = 0; i < resultsArray.length; i++) {
    originalCall.games = originalCall.games.concat(
      filterGames(resultsArray[i].data.response)
    );
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
  console.log("initial check");
  console.log("check if game update");
  var dates = await container.items
    .query(`SELECT * from c WHERE c.date = '${helper.getDateString()}'`)
    .fetchAll();
  if (dates.resources.length === 0) {
    global.monitor.isTodayGameFetched = false;
  } else {
    global.testgame = dates.resources[0];
    global.monitor.isTodayGameFetched = true;
  }
  console.log("check if game update");
  var fixturesDates = await fixturesContainer.items
    .query(`SELECT * from c WHERE c.date = '${helper.getDateString()}'`)
    .fetchAll();
  if (fixturesDates.resources.length === 0) {
    global.monitor.isTodayFixtureFetched = false;
  } else {
    global.testfixtures = fixturesDates.resources[0];
    global.monitor.isTodayFixtureFetched = true;
  }
}

exports.start = start;
