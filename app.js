var createError = require('http-errors');
var express = require('express');
var path = require('path');
var cookieParser = require('cookie-parser');
var logger = require('morgan');
var sassMiddleware = require('node-sass-middleware');
// const CosmosClient = require("@azure/cosmos").CosmosClient;
var JobsManager = require('./jobs/cron-jobs');

var indexRouter = require('./routes/index');
var usersRouter = require('./routes/users');
var actionsRouter = require('./routes/actions');

global.testgame = { test: 'test' };
global.testfixtures = { test: 'fixtures' };

var app = express();

// view engine setup
app.set('views', path.join(__dirname, 'views'));
app.set('view engine', 'ejs');

app.use(logger('dev'));
app.use(express.json());
app.use(express.urlencoded({ extended: false }));
app.use(cookieParser());
app.use(sassMiddleware({
  src: path.join(__dirname, 'public'),
  dest: path.join(__dirname, 'public'),
  indentedSyntax: true, // true = .sass and false = .scss
  sourceMap: true
}));
app.use(express.static(path.join(__dirname, 'public')));

app.use('/', indexRouter);
app.use('/users', usersRouter);
app.use('/actions', actionsRouter);

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

module.exports = app;
