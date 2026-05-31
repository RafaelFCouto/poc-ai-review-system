const { MongoClient } = require('mongodb');

const client = new MongoClient(process.env.MONGODB_URI);
const db     = client.db('poc_review');

async function saveAuditLog(log) {
  await client.connect();
  await db.collection('audit_logs').insertOne({
    ...log,
    timestamp: new Date(),
  });
}

async function ping() {
  await client.connect();
  await client.db('admin').command({ ping: 1 });
}

module.exports = { saveAuditLog, ping };
