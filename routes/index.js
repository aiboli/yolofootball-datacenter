var express = require('express');
var router = express.Router();

/* GET home page. */
router.get('/', function (req, res, next) {
  res.render('index', { title: 'Yolofootball datacenter', game: JSON.stringify(global.testgame) });
});

module.exports = router;
