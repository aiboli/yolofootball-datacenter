var express = require('express');
var helper = require('../common/helper');
var router = express.Router();

/* GET home page. */
router.get('/', function (req, res, next) {
  res.render('index', { title: 'Yolofootball datacenter', game: JSON.stringify(global.testgame), fixtures: JSON.stringify(global.testfixtures), orders: JSON.stringify(global.testOrder), date: helper.getDateString(), monitor: JSON.stringify(global.monitor) });
});

module.exports = router;