var createError = require("http-errors");
var express = require("express");
var path = require("path");
var cookieParser = require("cookie-parser");
var logger = require("morgan");
var sassMiddleware = require("node-sass-middleware");
var bodyParser = require("body-parser");
var JobsManager = require("./jobs/cron-jobs");

var indexRouter = require("./routes/index");
var usersRouter = require("./routes/user");
var actionsRouter = require("./routes/actions");
var orderRouter = require("./routes/order");
var customEventRouter = require("./routes/customevent");
var fixturesRouter = require("./routes/fixtures");

global.testgame = { test: "test" };
global.testfixtures = { test: "fixtures" };
global.monitor = {
  lastCheck: new Date(),
  isTodayFixtureFetched: false,
  isTodayGameFetched: false,
  isTodayFixtureFetching: false,
  isTodayGameFetching: false,
};

var app = express();

// view engine setup
app.set("views", path.join(__dirname, "views"));
app.set("view engine", "ejs");

app.use(logger("dev"));
app.use(express.json());
app.use(express.urlencoded({ extended: false }));
app.use(bodyParser.json());
app.use(
  bodyParser.urlencoded({
    extended: true,
  })
);
app.use(cookieParser());
app.use(
  sassMiddleware({
    src: path.join(__dirname, "public"),
    dest: path.join(__dirname, "public"),
    indentedSyntax: true, // true = .sass and false = .scss
    sourceMap: true,
  })
);
app.use(express.static(path.join(__dirname, "public")));

app.use("/", indexRouter);
app.use("/user", usersRouter);
app.use("/actions", actionsRouter);
app.use("/order", orderRouter);
app.use("/customevent", customEventRouter);
app.use("/fixtures", fixturesRouter);

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
  res.locals.error = req.app.get("env") === "development" ? err : {};

  // render the error page
  res.status(err.status || 500);
  res.render("error");
});

module.exports = app;
