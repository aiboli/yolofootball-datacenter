# yolofootball-datacenter

Express.js service for storing football fixtures, odds, orders, users, and custom betting events in Azure Cosmos DB.

## yolofootball-service API

### Service behavior

- Base app: Express 4
- Default start command: `npm start`
- Mounted routes: `/`, `/user`, `/actions`, `/order`, `/customevent`, `/fixtures`
- Request bodies: JSON and `application/x-www-form-urlencoded` are both accepted
- Authentication: none
- Error format: unmatched routes and server errors render the EJS error page instead of returning a JSON error envelope

### Date handling

- Routes that default to "today" use `common/helper.js`, which formats the date in the `America/Los_Angeles` timezone as `YYYY-MM-DD`

## Endpoints

### `GET /`

Returns the server-rendered debug page from `views/index.ejs`. This is an HTML page, not a JSON API response.

The page is populated from these globals:

- `global.testgame`
- `global.testfixtures`
- `global.testOrder`
- `global.monitor`

### `POST /user`

Creates a user document in the `users` container.

Request body:

- `user_name`: required string
- `email`: required string; stored as `user_email`
- `amount`: initial `account_balance`
- `password`: stored directly as `password`

Success response:

- Status `200`
- Full created Cosmos document

Example request:

```json
{
  "user_name": "alice",
  "email": "alice@example.com",
  "amount": 1000,
  "password": "demo-password"
}
```

### `GET /user`

Fetches the first user whose `user_name` matches the `user_name` query parameter.

Query parameters:

- `user_name`: required string

Success response:

- Status `200`
- Matching user document when found
- No explicit `404` path exists in the handler

Example:

`GET /user?user_name=alice`

### `GET /actions/getGames`

Fetches one daily `games` document from Cosmos DB and stores it in `global.testgame`.

Query parameters:

- `date`: optional `YYYY-MM-DD`; defaults to the current Los Angeles date

Success response:

- Status `200`
- A document shaped like:

```json
{
  "date": "2026-03-26",
  "games": []
}
```

### `GET /actions/getFixtures`

Fetches one daily `fixtures` document from Cosmos DB and stores it in `global.testfixtures`.

Query parameters:

- `date`: optional `YYYY-MM-DD`; defaults to the current Los Angeles date

Success response:

- Status `200`
- A document shaped like:

```json
{
  "date": "2026-03-26",
  "fixtures": []
}
```

### `GET /actions/prepareData`

Builds a fixture map for league `39` by combining:

- `leagues` container data
- `odds` container data
- only fixtures whose upstream status is `NS`
- only fixtures that also have an odds entry

Success response:

- Status `200`
- Object keyed by fixture id
- Each value is the stored fixture object plus an added `odds` property copied from `currentOdds.bookmakers[0]`

Example response shape:

```json
{
  "915340": {
    "fixture": { "id": 915340 },
    "league": { "id": 39 },
    "teams": {
      "home": { "name": "Manchester United" },
      "away": { "name": "Liverpool" }
    },
    "odds": {
      "id": 8,
      "name": "Bet365"
    }
  }
}
```

### `POST /actions/bulkUpdateOrder`

Re-evaluates pending orders against all stored daily fixture documents and updates the `orders` container. Winning orders also credit the matching user's wallet in the `users` container.

Request body:

- `ids`: required array of order document ids
- `user_name`: accepted by callers but not used by the handler

Order update rules:

- Any losing selection marks the order as `completed`, `is_win = false`, `actual_return = 0`
- If every selection is finished and won, the order becomes `completed`, `is_win = true`, `actual_return = win_return`
- Otherwise the order remains ongoing and stays `pending`
- `fixture_state`, `fixture_states`, `fixtures_ids`, `selection_count`, and `selections` are normalized during the update

Success response:

- Status `200`
- Empty body

Example request:

```json
{
  "ids": ["order-101", "order-102"]
}
```

### `GET /order/all`

Intended to return all orders, but the current implementation queries all documents and then returns only `resources[0]`.

Current response behavior:

- Status `200`
- The first order document in the query result

### `POST /order/orders`

Queries orders by any combination of ids, state, and creator.

Request body:

- `ids`: optional array of order ids
- `state`: optional string such as `pending`, `canceled`, or `completed`
- `created_by`: optional username

Success response:

- Status `200`
- Array of matching order documents

Example request:

```json
{
  "ids": ["order-101", "order-102"],
  "state": "pending",
  "created_by": "alice"
}
```

### `POST /order`

Creates a new order in the `orders` container.

Single-order request body:

- `fixture_id`
- `bet_result`
- `odd_rate`
- `odd_mount`
- `win_return`
- `fixture_state`: optional, defaults to `notstarted`
- `fixtures_ids`: optional
- `fixture_states`: optional
- `order_type`: optional, defaults to `single`
- `selection_count`: optional, defaults to `1`
- `user_name`: optional; when present the service also appends the new order id to the user's `order_ids` and subtracts the stake from the user's balance

Accumulator request body:

- `selections`: array of selections
- `combined_odd` or `odd_rate`
- `stake` or `odd_mount`
- `win_return`
- `order_type`: optional; defaults to `accumulator` when `selections.length > 1`
- `user_name`: optional

Selection fields:

- `fixture_id`
- `bet_result`
- `odd_rate`
- `fixture_state`: optional
- `market`: optional, defaults to `match_winner`
- `selection`: optional free-form label

Success response:

- Status `200`
- Created order document

Important current behavior:

- If `user_name` is omitted, the order is created and returned without any user lookup
- If `user_name` is present but no matching user exists, the order is still created and then returned with status `400`

Single-order example:

```json
{
  "fixture_id": "2026-03-26@915340",
  "bet_result": 0,
  "odd_rate": 2.1,
  "odd_mount": 100,
  "win_return": 210,
  "fixture_state": "notstarted",
  "user_name": "alice"
}
```

Accumulator example:

```json
{
  "selections": [
    {
      "fixture_id": 915340,
      "bet_result": 0,
      "odd_rate": 1.75,
      "market": "match_winner"
    },
    {
      "fixture_id": 915342,
      "bet_result": 1,
      "odd_rate": 2.24,
      "market": "match_winner"
    }
  ],
  "combined_odd": 3.92,
  "stake": 100,
  "win_return": 392,
  "user_name": "alice"
}
```

### `PUT /order/:orderId`

Updates an existing order document.

Path parameters:

- `orderId`: required Cosmos document id

Request body:

- `state`: required for any update
- `returned_mount`: required when `state = "completed"` and may be `0`
- `win_result`: required boolean when `state = "completed"`

Behavior by state:

- `canceled`: only `state` is updated
- `completed`: `state`, `is_win`, and `actual_return` are updated

Success response:

- Status `200`
- Updated order document

Important current behavior:

- The handler does not refund or credit user balances
- Missing ids or missing required completion fields return `400`

Example request:

```json
{
  "state": "completed",
  "returned_mount": 210,
  "win_result": true
}
```

### `GET /customevent/all`

Legacy endpoint with incorrect wiring.

Current implementation behavior:

- Queries the `orders` container instead of `customevents`
- Returns only `resources[0]`
- Response is an order document, not a custom event list

### `GET /customevent`

Intended to fetch a single custom event by `id`.

Query parameters:

- `id`: custom event document id

Current implementation behavior:

- The handler queries the `customevents` container
- When a match exists, it responds with an undefined local variable rather than the event document
- When no match exists, the fallback path references an undefined `dates` variable

This route should be treated as broken in the current service.

### `POST /customevent/customevents`

Legacy endpoint with incorrect wiring.

Request body:

- `ids`: required array
- `state`: optional
- `created_by`: optional

Current implementation behavior:

- Queries the `orders` container instead of `customevents`
- Returns matching order documents

### `POST /customevent`

Creates a custom event in the `customevents` container.

Request body:

- `fixture_id`
- `odd_data`
- `poll_fund`: source field used to populate stored `pool_fund`
- `matched_poll_fund`: source field used to populate stored `matched_pool_fund`
- `user_name`: optional, defaults stored `created_by` to `ano` when omitted

Success response:

- Status `200`
- Created custom event document

Stored fields:

- `create_date`
- `fixture_id`
- `odd_data`
- `status`, initially `active`
- `event_history`, initially empty
- `pool_fund`
- `matched_pool_fund`
- `invested_pool_fund`, initially `0`
- `associated_order_ids`, initially empty
- `actual_return`, initially `0`
- `created_by`

Important current behavior:

- If `user_name` is provided and a user exists, the route appends the new event id to `created_bid_ids`
- The balance deduction path uses `eventData.poll_fund`, but the created document stores `pool_fund`, so the wallet update is currently inconsistent
- If `user_name` is provided and no user exists, the event is still created and then returned with status `400`

Example request:

```json
{
  "fixture_id": 915340,
  "odd_data": {
    "market": "correct_score",
    "options": [
      { "label": "1-0", "odd": 7.5 },
      { "label": "2-0", "odd": 9.0 }
    ]
  },
  "poll_fund": 500,
  "matched_poll_fund": 250,
  "user_name": "alice"
}
```

### `PUT /customevent/:eventid`

Updates a custom event by action type.

Path parameters:

- `eventid`: required Cosmos document id

Request body:

- `action`: required string

Supported actions:

- `updateFund`: requires `updated_fund`
- `updateStatus`: requires `status`
- `updateOddData`: requires `odd_data`
- `placeBet`: requires `odd_mount`, `order_id`, and `bet_result`
- `cancelBet`: requires `odd_mount`, `order_id`, and `bet_result`

Success response:

- Status `200`
- Updated custom event document

Side effects by action:

- `updateFund`: replaces `pool_fund` and appends an event history entry
- `updateStatus`: replaces `status` and appends an event history entry
- `updateOddData`: replaces `odd_data` and appends an event history entry
- `placeBet`: increments `invested_pool_fund`, appends `order_id`, and appends an event history entry
- `cancelBet`: decrements `invested_pool_fund`, removes `order_id`, and appends an event history entry

Unknown `action` values return `400`.

### `GET /fixtures`

Returns the season-wide fixtures array for league `39` from the `leagues` container.

Success response:

- Status `200`
- Array of fixture records

Example response shape:

```json
[
  {
    "fixture": {
      "id": 915340,
      "status": { "short": "NS" }
    },
    "league": {
      "id": 39,
      "season": 2025
    }
  }
]
```

## Storage Overview

All persistent data is stored in the Azure Cosmos DB database `yolofootball`.

The app currently writes to these containers:

1. `users`
2. `orders`
3. `customevents`
4. `games`
5. `fixtures`
6. `leagues`
7. `odds`

Cosmos DB also adds its own metadata fields such as `id`, `_rid`, `_self`, `_etag`, `_attachments`, and `_ts`. Those fields are omitted from most examples below unless they are useful to show.

## Stored Data Structures

### `users`

User profile and wallet state.

Key fields:

- `user_name`: display/login name
- `user_email`: email address
- `user_wallet_id`: wallet identifier
- `created_date`: account creation date
- `order_ids`: list of order document ids created by the user
- `created_bid_ids`: list of custom event ids created by the user
- `account_balance`: current balance
- `password`: stored password value
- `is_valid_user`: verification flag
- `customized_field.prefered_culture`: user locale preference

Example:

```json
{
  "id": "7f5b5f5d-ae7c-4db8-8f16-1cb0b2d1f71a",
  "user_name": "alice",
  "user_email": "alice@example.com",
  "user_wallet_id": "001",
  "created_date": "2026-03-26T20:14:03.000Z",
  "order_ids": ["order-101", "order-102"],
  "created_bid_ids": ["event-301"],
  "account_balance": 8500,
  "password": "plain-text-in-current-code",
  "is_valid_user": false,
  "customized_field": {
    "prefered_culture": "en-us"
  }
}
```

### `orders`

Bet orders. Supports both single bets and accumulator bets.

Key fields:

- `orderdate`: Unix timestamp in milliseconds
- `fixture_id`: primary fixture id
- `fixtures_ids`: all fixture ids in the order
- `bet_result`: selected result for the primary fixture
- `odd_rate`: single odd or combined odd
- `odd_mount`: stake amount
- `win_return`: expected payout if the order wins
- `is_win`: whether the final order result is a win
- `state`: `pending`, `canceled`, or `completed`
- `fixture_state`: state of the primary fixture
- `fixture_states`: state per selection
- `actual_return`: actual paid amount
- `created_by`: username, default `ano`
- `order_type`: `single` or `accumulator`
- `selection_count`: number of selections
- `selections[]`: per-selection detail

Selection fields:

- `fixture_id`
- `bet_result`: `0` home win, `1` draw, `2` away win
- `odd_rate`
- `fixture_state`
- `market`: defaults to `match_winner`
- `selection`: optional free-form label from client payload

Example:

```json
{
  "id": "order-101",
  "orderdate": 1774566300000,
  "fixture_id": 915340,
  "fixtures_ids": [915340, 915342],
  "bet_result": 0,
  "odd_rate": 3.92,
  "odd_mount": 100,
  "win_return": 392,
  "is_win": false,
  "state": "pending",
  "fixture_state": "notstarted",
  "fixture_states": ["notstarted", "notstarted"],
  "actual_return": 0,
  "created_by": "alice",
  "order_type": "accumulator",
  "selection_count": 2,
  "selections": [
    {
      "fixture_id": 915340,
      "bet_result": 0,
      "odd_rate": 1.75,
      "fixture_state": "notstarted",
      "market": "match_winner"
    },
    {
      "fixture_id": 915342,
      "bet_result": 1,
      "odd_rate": 2.24,
      "fixture_state": "notstarted",
      "market": "match_winner"
    }
  ]
}
```

### `customevents`

Custom betting pools created by users for a specific fixture.

Key fields:

- `create_date`: Unix timestamp in milliseconds
- `fixture_id`: related fixture id
- `odd_data`: custom odds definition supplied by the client
- `status`: `active`, `locked`, `canceled`, or `completed`
- `event_history[]`: audit trail for updates and bets
- `pool_fund`: pool owner funding
- `matched_pool_fund`: matched funding from others
- `invested_pool_fund`: amount already bet into the pool
- `associated_order_ids`: linked order ids
- `actual_return`: actual payout
- `created_by`: username, default `ano`

History entry fields:

- `time`
- `info`
- `data`: optional payload for some updates

Example:

```json
{
  "id": "event-301",
  "create_date": 1774566400000,
  "fixture_id": 915340,
  "odd_data": {
    "market": "correct_score",
    "options": [
      { "label": "1-0", "odd": 7.5 },
      { "label": "2-0", "odd": 9.0 }
    ]
  },
  "status": "active",
  "event_history": [
    {
      "time": "2026-03-26T20:16:40.000Z",
      "info": "update fund to 500"
    }
  ],
  "pool_fund": 500,
  "matched_pool_fund": 250,
  "invested_pool_fund": 100,
  "associated_order_ids": ["order-101"],
  "actual_return": 0,
  "created_by": "alice"
}
```

### `games`

Daily odds snapshot for a single date. This is fetched from API-Football `/v3/odds`, then filtered so only bookmaker id `6` is kept.

Key fields:

- `date`: `YYYY-MM-DD`
- `games[]`: odds records returned by API-Football for that date

Stored game entries are mostly raw upstream objects. Common nested fields used by the app include:

- `fixture.id`
- `fixture.date`
- `league.id`, `league.name`, `league.country`
- `teams.home`, `teams.away`
- `bookmakers[]`

Example:

```json
{
  "date": "2026-03-26",
  "games": [
    {
      "fixture": {
        "id": 915340,
        "date": "2026-03-26T19:00:00+00:00",
        "status": { "short": "NS" }
      },
      "league": {
        "id": 39,
        "name": "Premier League",
        "country": "England"
      },
      "teams": {
        "home": { "id": 33, "name": "Manchester United" },
        "away": { "id": 40, "name": "Liverpool" }
      },
      "bookmakers": [
        {
          "id": 6,
          "name": "Bwin",
          "bets": [
            {
              "id": 1,
              "name": "Match Winner",
              "values": [
                { "value": "Home", "odd": "2.10" },
                { "value": "Draw", "odd": "3.40" },
                { "value": "Away", "odd": "3.20" }
              ]
            }
          ]
        }
      ]
    }
  ]
}
```

### `fixtures`

Daily fixture snapshot for a single date. This is fetched from API-Football `/v3/fixtures`.

Key fields:

- `date`: `YYYY-MM-DD`
- `fixtures[]`: raw fixture records for that date

Example:

```json
{
  "date": "2026-03-26",
  "fixtures": [
    {
      "fixture": {
        "id": 915340,
        "date": "2026-03-26T19:00:00+00:00",
        "status": { "short": "NS", "long": "Not Started" }
      },
      "league": {
        "id": 39,
        "name": "Premier League",
        "season": 2025
      },
      "teams": {
        "home": { "id": 33, "name": "Manchester United" },
        "away": { "id": 40, "name": "Liverpool" }
      },
      "goals": {
        "home": null,
        "away": null
      }
    }
  ]
}
```

### `leagues`

Season-wide fixture snapshot per league. This is fetched from API-Football `/v3/fixtures?league=...&season=...`.

Key fields:

- `league`: league id as stored from the upstream request parameters
- `fixtures[]`: all returned fixtures for that league and season

Example:

```json
{
  "league": "39",
  "fixtures": [
    {
      "fixture": {
        "id": 915340,
        "status": { "short": "NS" }
      },
      "league": {
        "id": 39,
        "season": 2025
      },
      "teams": {
        "home": { "name": "Manchester United" },
        "away": { "name": "Liverpool" }
      }
    }
  ]
}
```

### `odds`

Season-wide odds snapshot per league. This is fetched from API-Football `/v3/odds?league=...&season=...&bookmaker=8`, including pagination.

Key fields:

- `league`: league id as stored from the upstream request parameters
- `season`: season from the upstream request parameters
- `odds[]`: raw odds records for that league and season

Example:

```json
{
  "league": "39",
  "season": "2025",
  "odds": [
    {
      "fixture": {
        "id": 915340
      },
      "league": {
        "id": 39,
        "season": 2025
      },
      "bookmakers": [
        {
          "id": 8,
          "name": "Bet365",
          "bets": [
            {
              "name": "Match Winner",
              "values": [
                { "value": "Home", "odd": "2.05" },
                { "value": "Draw", "odd": "3.35" },
                { "value": "Away", "odd": "3.50" }
              ]
            }
          ]
        }
      ]
    }
  ]
}
```

## Notes

- `orders`, `users`, and `customevents` are app-owned documents
- `games`, `fixtures`, `leagues`, and `odds` are mostly raw API-Football payloads wrapped in a small top-level document
- `orders` and `customevents` update user balances and reference ids in the `users` container
- Several route handlers return or update these documents directly, so keeping the stored shape stable matters for the frontend and cron jobs
