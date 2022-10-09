var express = require('express');
var router = express.Router();

/* GET home page. */
router.get('/', function (req, res, next) {
  res.render('index', { title: 'Yolofootball datacenter', game: JSON.stringify(global.testgame), fixtures: JSON.stringify(global.testfixtures), orders: JSON.stringify(global.testOrder), date: getDateString() });
});

function getDateString() {
  var currentDate = new Date();
  var year = currentDate.getUTCFullYear();
  var month = String(currentDate.getUTCMonth() + 1);
  if (month.length < 2) {
      month = "0" + month;
  }
  var date = String(currentDate.getUTCDate());
  if (date.length < 2) {
      date = "0" + date;
  }
  return `${year}-${month}-${date}`;
}

module.exports = router;