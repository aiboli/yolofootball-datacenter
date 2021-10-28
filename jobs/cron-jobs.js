const nodeCron = require("node-cron");
const axios = require("axios").default;

const allGamesRequest = nodeCron.schedule("* * */4 * * *", function jobYouNeedToExecute() {
    console.log("all game request executed");
    var currentDate = new Date();
    console.log(currentDate.getUTCFullYear(), currentDate.getUTCMonth() + 1, currentDate.getUTCDate());
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
    console.log(global.testgame);
    axios.request(options).then(function (response) {
        global.testgame = response.data;
    }).catch(function (error) {
        console.error(error);
    });
});

function start() {
    allGamesRequest.start();
}

exports.start = start;

