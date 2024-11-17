var express = require("express");
var router = express.Router();

const CosmosClient = require("@azure/cosmos").CosmosClient;

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
  const query = "SELECT * FROM c WHERE c.league = '39'";
  const allLeagues = await leaguesContainer.items.query(query).fetchAll();
  let fixtures = allLeagues.resources[0].fixtures;
  return res.status(200).send(fixtures);
});
