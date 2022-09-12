# yolofootball-datacenter
yolofootball-datacenter expressjs app

## Order Information
### Order fields
```javascript
{
    "id": "replace_with_new_document_id", // order id
    "orderdate": 1524379940, // order placed date
    "fixture_id": 915340, // the fixture id that related to this order
    "fixtures_ids": [913540, 913542] // if multiple fixtures added to this order
    "bet_result": 0, // bet result: 0 is host win, 1 is draw, 2 is away win
    "odd_rate": 1.70, // rate
    "odd_mount": 10000, // the total money that user bet
    "win_return": 17000, // returns the money if wins
    "is_win": false, // is user win this order
    "state": "pending", // order status: pending, canceled, completed
    "fixture_state": "notstarted", // fixture's state: notstarted, canceled, finished
    "fixture_states": ["finished", "notstarted"]
    "actual_return": 0, // the user actual mount get
    "_rid": "Rg0YAIOxP4kBAAAAAAAAAA==",
    "_self": "dbs/Rg0YAA==/colls/Rg0YAIOxP4k=/docs/Rg0YAIOxP4kBAAAAAAAAAA==/",
    "_etag": "\"45058a9a-0000-0700-0000-631ed13f0000\"",
    "_attachments": "attachments/",
    "_ts": 1662964031
}
```
