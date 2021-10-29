var express = require('express');
const axios = require("axios").default;
var router = express.Router();

/* GET home page. */
router.get('/getGames', function (req, res, next) {
    //console.log(req);
    var currentDate = new Date();
    var currentDateString = `${currentDate.getFullYear()}-${currentDate.getMonth() + 1}-${currentDate.getDate()}`;
    var options = {
        method: 'GET',
        url: 'https://api-football-v1.p.rapidapi.com/v3/odds',
        params: { date: currentDateString, timezone: 'America/Los_Angeles' },
        headers: {
            'x-rapidapi-host': 'api-football-v1.p.rapidapi.com',
            'x-rapidapi-key': '28fc80e178mshdff1cc6efb6539cp119f94jsn1a2811635bf8'
        }
    };
    axios.request(options).then(function (response) {
        global.testgame = response.data;
        res.send(response.data);
    }).catch(function (error) {
        console.error(error);
    });
});

module.exports = router;
