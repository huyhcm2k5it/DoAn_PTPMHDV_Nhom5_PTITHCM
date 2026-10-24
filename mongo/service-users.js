
const ownerDatabases = { patient: 'patient_db', appointment: 'appointment_db', pharmacy: 'pharmacy_db' };

async function provisionOwnerUser(connection, owner, password) {
  const database = ownerDatabases[owner];
  await connection.useDb(database, { useCache: true }).db.command({
    createUser: `${owner}-service`, pwd: password,
    roles: [{ role: 'readWrite', db: database }],
  });
}

module.exports = { ownerDatabases, provisionOwnerUser };
