const test = require("node:test");
const assert = require("node:assert/strict");
const http = require("node:http");
const express = require("express");
const cosmos = require("@azure/cosmos");

const originalCosmosClient = cosmos.CosmosClient;

const parseQuotedValues = (queryText) =>
  [...String(queryText).matchAll(/"((?:\\"|[^"])*)"/g)].map((match) =>
    match[1].replace(/\\"/g, '"')
  );

const buildFakeCosmosClient = (events) =>
  class FakeCosmosClient {
    database() {
      return {
        container() {
          return {
            items: {
              query(queryInput) {
                const queryText =
                  typeof queryInput === "string" ? queryInput : queryInput?.query || "";
                const ids = parseQuotedValues(queryText);
                const resources =
                  ids.length > 0
                    ? events.filter((event) => ids.includes(event.id))
                    : events;

                return {
                  async fetchAll() {
                    return {
                      resources,
                    };
                  },
                };
              },
            },
          };
        },
      };
    }
  };

const createTestServer = (events) => {
  cosmos.CosmosClient = buildFakeCosmosClient(events);
  delete require.cache[require.resolve("../routes/customevent")];
  const router = require("../routes/customevent");
  const app = express();
  app.use(express.json());
  app.use("/customevent", router);
  app.use((error, req, res, next) => {
    res.status(500).json({ error: error.message });
  });

  const server = http.createServer(app);

  return new Promise((resolve) => {
    server.listen(0, () => {
      const { port } = server.address();
      resolve({
        server,
        baseUrl: `http://127.0.0.1:${port}`,
      });
    });
  });
};

test.afterEach(() => {
  cosmos.CosmosClient = originalCosmosClient;
  delete require.cache[require.resolve("../routes/customevent")];
});

test("POST /customevent/bulk returns dashboard-safe events in request order", async () => {
  const events = [
    {
      id: "event-1",
      fixture_id: "100",
      fixture_state: "notstarted",
      created_by: "albert",
      create_date: 1000,
      status: "active",
      market: "match_winner",
      odd_data: {
        market: "match_winner",
        options: [{ result: 0, label: "Home", odd: 1.8 }],
      },
      pool_fund: 25,
      matched_pool_fund: 10,
      invested_pool_fund: 5,
      actual_return: 0,
      associated_order_ids: ["order-1"],
      event_history: [{ info: "private" }],
    },
    {
      id: "event-2",
      fixture_id: "200",
      fixture_state: "finished",
      created_by: "albert",
      create_date: 2000,
      status: "completed",
      odd_data: {
        market: "match_winner",
        options: [{ result: 2, label: "Away", odd: 2.4 }],
      },
      pool_fund: 40,
      matched_pool_fund: 20,
      invested_pool_fund: 12,
      actual_return: 30,
      associated_order_ids: [],
      _etag: "sensitive",
    },
  ];
  const { server, baseUrl } = await createTestServer(events);

  try {
    const response = await fetch(`${baseUrl}/customevent/bulk`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        ids: ["event-2", "event-1"],
      }),
    });
    const body = await response.json();

    assert.equal(response.status, 200);
    assert.deepEqual(
      body.map((event) => event.id),
      ["event-2", "event-1"]
    );
    assert.equal(body[0].fixture_id, 200);
    assert.equal(body[0].market, "match_winner");
    assert.deepEqual(body[0].associated_order_ids, []);
    assert.equal("event_history" in body[0], false);
    assert.equal("_etag" in body[0], false);
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
});

test("POST /customevent/bulk rejects invalid ids", async () => {
  const { server, baseUrl } = await createTestServer([]);

  try {
    const response = await fetch(`${baseUrl}/customevent/bulk`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        ids: ["event-1", 42],
      }),
    });
    const body = await response.json();

    assert.equal(response.status, 400);
    assert.equal(body.error, "ids must contain valid event ids");
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
});
