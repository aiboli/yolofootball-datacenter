var express = require("express");
var router = express.Router();

const CosmosClient = require("@azure/cosmos").CosmosClient;
const { filterSupportedLeagueEntries } = require("../common/supportedLeagues");

// get all fixtures
router.get("/", async function (req, res, next) {
  const config = {
    endpoint: "https://yolofootball-database.documents.azure.com:443/",
    key: "hOicNBuPcYclHNG3UHZA9zGKhXp9zrTeoxbagVWBWRql4nXsEbOykJkyxfKMA2cEOGuwvMAMIES8Ssg81bppFA==",
    databaseId: "yolofootball",
    containerId: "leagues",
  };
  const client = new CosmosClient({
    endpoint: config.endpoint,
    key: config.key,
  });
  const database = client.database(config.databaseId);
  const leaguesContainer = database.container(config.containerId);
  const allLeagues = await leaguesContainer.items.query("SELECT * FROM c").fetchAll();
  let fixtures = [];

  allLeagues.resources.forEach((leagueDocument) => {
    fixtures = fixtures.concat(filterSupportedLeagueEntries(leagueDocument.fixtures || []));
  });

  fixtures.sort((left, right) => {
    return new Date(left?.fixture?.date || 0).getTime() - new Date(right?.fixture?.date || 0).getTime();
  });

  return res.status(200).send(fixtures);
});

module.exports = router;
