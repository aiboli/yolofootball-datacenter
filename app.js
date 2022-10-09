var createError = require('http-errors');
var express = require('express');
var path = require('path');
var cookieParser = require('cookie-parser');
var logger = require('morgan');
var sassMiddleware = require('node-sass-middleware');
var bodyParser = require('body-parser');
// const CosmosClient = require("@azure/cosmos").CosmosClient;
var JobsManager = require('./jobs/cron-jobs');

var indexRouter = require('./routes/index');
var usersRouter = require('./routes/user');
var actionsRouter = require('./routes/actions');
var orderRouter = require('./routes/order');

global.testgame = { test: 'test' };
global.testfixtures = { test: 'fixtures' };
global.todayDate = getDateString();

var app = express();

// view engine setup
app.set('views', path.join(__dirname, 'views'));
app.set('view engine', 'ejs');

app.use(logger('dev'));
app.use(express.json());
app.use(express.urlencoded({ extended: false }));
app.use(bodyParser.json());
app.use(bodyParser.urlencoded({
  extended: true
}));
app.use(cookieParser());
app.use(sassMiddleware({
  src: path.join(__dirname, 'public'),
  dest: path.join(__dirname, 'public'),
  indentedSyntax: true, // true = .sass and false = .scss
  sourceMap: true
}));
app.use(express.static(path.join(__dirname, 'public')));

app.use('/', indexRouter);
app.use('/user', usersRouter);
app.use('/actions', actionsRouter);
app.use('/order', orderRouter);

// const config = {
//   endpoint: "https://yolofootball-database.documents.azure.com:443/",
//   key: "hOicNBuPcYclHNG3UHZA9zGKhXp9zrTeoxbagVWBWRql4nXsEbOykJkyxfKMA2cEOGuwvMAMIES8Ssg81bppFA==",
//   databaseId: "yolofootball",
//   containerId: "games"
// };
// console.log('connect to cosmosdb')
// const client = new CosmosClient({ endpoint: config.endpoint, key: config.key });
// const database = client.database(config.databaseId);
// const container = database.container(config.containerId);
// console.log(container.items.query("SELECT * FROM c"));
// jobs manager
JobsManager.start();

// catch 404 and forward to error handler
app.use(function (req, res, next) {
  next(createError(404));
});

// error handler
app.use(function (err, req, res, next) {
  // set locals, only providing error in development
  res.locals.message = err.message;
  res.locals.error = req.app.get('env') === 'development' ? err : {};

  // render the error page
  res.status(err.status || 500);
  res.render('error');
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
module.exports = app;
