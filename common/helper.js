module.exports.getDateString = function () {
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