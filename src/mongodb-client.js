const { MongoClient } = require('mongodb');

const client = new MongoClient(process.env.MONGODB_URI);
const db     = client.db('poc_review');
let connected = false;

async function ensureConnected() {
  if (!connected) {
    await client.connect();
    connected = true;
  }
}

async function saveAuditLog(log) {
  await ensureConnected();
  await db.collection('audit_logs').insertOne({
    ...log,
    timestamp: new Date(),
  });
}

async function ping() {
  await ensureConnected();
  await client.db('admin').command({ ping: 1 });
}

module.exports = { saveAuditLog, ping };
