const { runErdMigration } = require('../../../mongo/erd-cli');
runErdMigration(require('mongoose'), 'pharmacy').catch((error) => {
  console.error(error.message);
  process.exitCode = 1;
});
