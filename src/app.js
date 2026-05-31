const express        = require('express');
const webhookHandler = require('./webhook-handler');
const mongoClient    = require('./mongodb-client');

const app  = express();
const PORT = process.env.PORT || 4000;

app.use(express.json({ verify: (req, _res, buf) => { req.rawBody = buf; } }));

app.get('/health', (_req, res) => res.json({ status: 'ok' }));

app.get('/health-db', async (_req, res) => {
  try {
    await mongoClient.ping();
    res.json({ status: 'ok', db: 'connected' });
  } catch (err) {
    res.status(503).json({ status: 'error', db: err.message });
  }
});

app.post('/webhook', (req, res) => webhookHandler.handle(req, res));

app.listen(PORT, () => {
  console.log(`AI Review System running on port ${PORT}`);
});

module.exports = app;
