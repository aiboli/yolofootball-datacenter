const { CosmosClient } = require("@azure/cosmos");

const COSMOS_CONFIG = {
  endpoint: "https://yolofootball-database.documents.azure.com:443/",
  key: "hOicNBuPcYclHNG3UHZA9zGKhXp9zrTeoxbagVWBWRql4nXsEbOykJkyxfKMA2cEOGuwvMAMIES8Ssg81bppFA==",
  databaseId: "yolofootball",
};

const createDatabase = () => {
  const client = new CosmosClient({
    endpoint: COSMOS_CONFIG.endpoint,
    key: COSMOS_CONFIG.key,
  });

  return client.database(COSMOS_CONFIG.databaseId);
};

const ensureContainer = async (containerId, partitionKeyPath = "/id") => {
  const database = createDatabase();
  await database.containers.createIfNotExists({
    id: containerId,
    partitionKey: {
      paths: [partitionKeyPath],
    },
  });

  return database.container(containerId);
};

module.exports = {
  COSMOS_CONFIG,
  createDatabase,
  ensureContainer,
};
