const ids = {
  medicine: '00000000-0000-4000-8000-000000000301',
  inventory: '00000000-0000-4000-8000-000000000801',
};
async function seed({ connection, dryRun = true } = {}) {
  const record = {
    id: ids.inventory,
    medicineId: ids.medicine,
    onHand: 30,
    reserved: 0,
    version: 1,
  };
  if (!dryRun) {
    if (!connection) throw new Error('Owner database connection required.');
    await connection
      .collection('inventory')
      .updateOne(
        { medicineId: ids.medicine },
        { $setOnInsert: record },
        { upsert: true },
      );
  }
  // No fabricated FINAL/PAID/Identity projections: actual owners must publish them.
  return {
    inventory: record,
    requires: [
      'Catalog medicine/price stream',
      'Identity access',
      'Patient access',
      'Clinical FINAL',
    ],
  };
}
if (require.main === module) {
  (async () => {
    const dryRun = process.argv.includes('--dry-run');
    const connection = dryRun
      ? undefined
      : await require('../src/configs/database').connectDatabase(
          process.env.MONGODB_URI,
        );
    try {
      console.log(JSON.stringify(await seed({ connection, dryRun })));
    } finally {
      await connection?.close();
    }
  })().catch((error) => {
    console.error(error.code || error.name);
    process.exitCode = 1;
  });
}
module.exports = { seed, ids };
