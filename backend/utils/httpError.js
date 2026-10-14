// An error with an HTTP status, for the error handler
module.exports = (status, message) => Object.assign(new Error(message), { statusCode: status });
