process.on('uncaughtException', (err) => {
  console.error('UNCAUGHT EX:', err.message, err.stack);
});
process.on('unhandledRejection', (reason) => {
  console.error('UNHANDLED REJ:', reason);
});
const app = require('../server');
module.exports = app;
