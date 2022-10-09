var express = require('express');
var router = express.Router();

/* GET home page. */
router.get('/', function (req, res, next) {
  res.render('index', { title: 'Yolofootball datacenter', game: JSON.stringify(global.testgame), fixtures: JSON.stringify(global.testfixtures), orders: JSON.stringify(global.testOrder), date: getDateString() });
});

function getDateString() {
  var currentDate = new Date();
  const nDate = currentDate.toLocaleString('en-US', {
      timeZone: 'America/Los_Angeles'
  });
  const dateArray = nDate.split(',');
  const dateFull = dateArray[0];
  const dateDetailsArray = dateFull.split('/');
  let day = dateDetailsArray[1];
  let month = dateDetailsArray[0];
  let year = dateDetailsArray[2];
  if (day.length < 2) {
      day = '0' + day;
  }
  if (month.length < 2) {
      month = '0' + month;
  }
  return `${year}-${month}-${day}`;
}

module.exports = router;