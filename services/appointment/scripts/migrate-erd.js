const { runErdMigration } = require('../../../mongo/erd-cli');
runErdMigration(require('mongoose'), 'appointment').catch((error) => {
  console.error(error.message);
  process.exitCode = 1;
});
