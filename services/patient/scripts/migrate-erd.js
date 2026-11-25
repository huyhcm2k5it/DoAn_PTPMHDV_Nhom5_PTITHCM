const { runErdMigration } = require('../../../mongo/erd-cli');
runErdMigration(require('mongoose'), 'patient').catch((error) => {
  console.error(error.message);
  process.exitCode = 1;
});
