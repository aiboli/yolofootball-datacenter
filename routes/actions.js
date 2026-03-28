var express = require("express");
var router = express.Router();
const helper = require("../common/helper");
const CosmosClient = require("@azure/cosmos").CosmosClient;
const { filterSupportedLeagueEntries } = require("../common/supportedLeagues");

const createDatabaseClient = (containerId) => {
  const config = {
    endpoint: "https://yolofootball-database.documents.azure.com:443/",
    key: "hOicNBuPcYclHNG3UHZA9zGKhXp9zrTeoxbagVWBWRql4nXsEbOykJkyxfKMA2cEOGuwvMAMIES8Ssg81bppFA==",
    databaseId: "yolofootball",
    containerId,
  };
  const client = new CosmosClient({
    endpoint: config.endpoint,
    key: config.key,
  });
  const database = client.database(config.databaseId);

  return {
    database,
    container: database.container(containerId),
  };
};

const normalizeFixtureId = (fixtureId) => {
  if (typeof fixtureId === "string" && fixtureId.includes("@")) {
    return parseInt(fixtureId.split("@")[1], 10);
  }

  return parseInt(fixtureId, 10);
};

const normalizeFixtureState = (fixture) => {
  const shortState = fixture?.fixture?.status?.short;
  if (shortState === "FT") {
    return "finished";
  }
  if (shortState === "NS") {
    return "notstarted";
  }
  if (shortState === "CANC") {
    return "canceled";
  }

  return "ongoing";
};

const getOrderSelections = (order) => {
  if (Array.isArray(order.selections) && order.selections.length > 0) {
    return order.selections.map((selection) => ({
      ...selection,
      fixture_id: normalizeFixtureId(selection.fixture_id),
      bet_result: parseInt(selection.bet_result, 10),
    }));
  }

  return [
    {
      fixture_id: normalizeFixtureId(order.fixture_id),
      bet_result: parseInt(order.bet_result, 10),
      fixture_state: order.fixture_state,
    },
  ];
};

const checkSelectionResult = (selection, fixture) => {
  if (!fixture || fixture.fixture.status.short !== "FT") {
    return "ongoing";
  }

  let homeGoals = fixture.goals.home;
  let awayGoals = fixture.goals.away;
  let result = homeGoals > awayGoals ? 0 : homeGoals == awayGoals ? 1 : 2;
  let isWin = result == selection.bet_result;

  return isWin ? "win" : "lost";
};

const evaluateOrder = (order, fixtureMap) => {
  const selections = getOrderSelections(order);
  const fixtureStates = [];
  let hasOngoingSelection = false;

  for (let i = 0; i < selections.length; i++) {
    const selection = selections[i];
    const fixture = fixtureMap[selection.fixture_id];
    const selectionResult = checkSelectionResult(selection, fixture);
    const fixtureState = fixture ? normalizeFixtureState(fixture) : "ongoing";

    fixtureStates.push(fixtureState);
    selection.fixture_state = fixtureState;

    if (selectionResult === "lost") {
      return {
        state: "lost",
        selections,
        fixtureStates,
      };
    }

    if (selectionResult === "ongoing") {
      hasOngoingSelection = true;
    }
  }

  if (hasOngoingSelection) {
    return {
      state: "ongoing",
      selections,
      fixtureStates,
    };
  }

  return {
    state: "win",
    selections,
    fixtureStates,
  };
};

const creditWinningUser = async (userContainer, userName, winReturn) => {
  const userQuery = {
    query: `SELECT * FROM c WHERE c.user_name = "${userName}"`,
  };
  const getUserResult = await userContainer.items.query(userQuery).fetchAll();
  if (getUserResult.resources && getUserResult.resources.length > 0) {
    let currentUser = getUserResult.resources[0];
    currentUser.account_balance = currentUser.account_balance + winReturn;
    await userContainer.item(currentUser.id, currentUser.id).replace(currentUser);
  }
};

router.get("/getGames", async function (req, res, next) {
  const { container } = createDatabaseClient("games");
  let dates;
  if (req.query.date) {
    dates = await container.items
      .query(`SELECT * from c WHERE c.date = '${req.query.date}'`)
      .fetchAll();
  } else {
    dates = await container.items
      .query(`SELECT * from c WHERE c.date = '${helper.getDateString()}'`)
      .fetchAll();
  }
  var gamesData = dates.resources[0];
  global.testgame = gamesData;
  res.send(gamesData);
});

router.get("/getFixtures", async function (req, res, next) {
  const { container } = createDatabaseClient("fixtures");
  let dates;
  if (req.query.date) {
    dates = await container.items
      .query(`SELECT * from c WHERE c.date = '${req.query.date}'`)
      .fetchAll();
  } else {
    dates = await container.items
      .query(`SELECT * from c WHERE c.date = '${helper.getDateString()}'`)
      .fetchAll();
  }
  var gamesData = dates.resources[0];
  global.testfixtures = gamesData;
  res.send(gamesData);
});

router.get("/prepareData", async function (req, res, next) {
  const { database, container: leaguesContainer } = createDatabaseClient("leagues");
  const oddsContainer = database.container("odds");

  let leagueFixtureMap = {};
  const allLeagues = await leaguesContainer.items.query("SELECT * FROM c").fetchAll();
  allLeagues.resources.forEach((leagueDocument) => {
    filterSupportedLeagueEntries(leagueDocument.fixtures || []).forEach((currentFixture) => {
      if (currentFixture?.fixture?.status?.short === "NS") {
        leagueFixtureMap[currentFixture.fixture.id] = currentFixture;
      }
    });
  });

  const allOddsContainer = await oddsContainer.items.query("SELECT * FROM c").fetchAll();
  allOddsContainer.resources.forEach((oddsDocument) => {
    filterSupportedLeagueEntries(oddsDocument.odds || []).forEach((currentOdds) => {
      if (
        leagueFixtureMap[currentOdds?.fixture?.id] &&
        Array.isArray(currentOdds?.bookmakers) &&
        currentOdds.bookmakers[0]
      ) {
        leagueFixtureMap[currentOdds.fixture.id].odds = currentOdds.bookmakers[0];
      }
    });
  });

  for (let key of Object.keys(leagueFixtureMap)) {
    if (!leagueFixtureMap[key].odds) {
      delete leagueFixtureMap[key];
    }
  }

  return res.status(200).json(leagueFixtureMap);
});

router.post("/bulkUpdateOrder", async function (req, res, next) {
  const { database, container } = createDatabaseClient("orders");
  const userContainer = database.container("users");
  let postData = req.body;
  const query = {
    query: `SELECT * FROM c WHERE c.id IN ("${postData.ids.join('","')}")`,
  };
  var allOrders = await container.items.query(query).fetchAll();
  var orderData = allOrders.resources;
  var orders = orderData.filter((order) => order.state == "pending");

  const fixtureContainer = database.container("fixtures");
  const allFixtures = await fixtureContainer.items.query("SELECT * FROM c").fetchAll();
  const fixtureMap = {};

  allFixtures.resources.forEach((fixtureDocument) => {
    (fixtureDocument.fixtures || []).forEach((fixture) => {
      fixtureMap[fixture.fixture.id] = fixture;
    });
  });

  for (let i = 0; i < orders.length; i++) {
    let order = orders[i];
    const evaluation = evaluateOrder(order, fixtureMap);

    order.selections = evaluation.selections;
    order.selection_count = evaluation.selections.length;
    order.fixtures_ids = evaluation.selections.map((selection) => selection.fixture_id);
    order.fixture_states = evaluation.fixtureStates;
    order.fixture_state = evaluation.fixtureStates[0] || order.fixture_state;

    if (evaluation.state === "win") {
      order.is_win = true;
      order.state = "completed";
      order.actual_return = order.win_return;
      await container.item(order.id, order.id).replace(order);
      await creditWinningUser(userContainer, order.created_by, order.win_return);
    } else if (evaluation.state === "lost") {
      order.is_win = false;
      order.state = "completed";
      order.actual_return = 0;
      await container.item(order.id, order.id).replace(order);
    } else {
      await container.item(order.id, order.id).replace(order);
    }
  }

  return res.sendStatus(200);
});

module.exports = router;
