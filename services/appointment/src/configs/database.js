const mongoose = require('mongoose');
const { ensureAppointmentStorage } = require('../dbs/indexes.js');
const DATABASE = 'appointment_db';
async function connectDatabase(uri) {
  if (!uri) throw new Error('MONGODB_URI is required');
  const parsed = new URL(uri);
  if (decodeURIComponent(parsed.pathname.replace(/^\//, '')) !== DATABASE) throw new Error('MONGODB_URI must select ' + DATABASE);
  const connection = await mongoose.createConnection(uri, { serverSelectionTimeoutMS: 5000, autoCreate: false, autoIndex: false }).asPromise();
  try { await ensureAppointmentStorage(connection); return connection; } catch (error) { await connection.close(); throw error; }
}
module.exports = { DATABASE, connectDatabase };