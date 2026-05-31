const crypto       = require('crypto');
const orchestrator = require('./orchestrator');

const WEBHOOK_SECRET = process.env.GITHUB_WEBHOOK_SECRET;

function verifySignature(rawBody, signature) {
  if (!signature) return false;
  const expected = `sha256=${crypto
    .createHmac('sha256', WEBHOOK_SECRET)
    .update(rawBody)
    .digest('hex')}`;
  return crypto.timingSafeEqual(Buffer.from(expected), Buffer.from(signature));
}

const handle = (req, res) => {
  const signature = req.headers['x-hub-signature-256'];

  if (!verifySignature(req.rawBody, signature)) {
    return res.status(401).json({ error: 'Invalid signature' });
  }

  const event = req.headers['x-github-event'];
  if (event !== 'pull_request') {
    return res.status(200).json({ message: 'Event ignored' });
  }

  const { action, pull_request, repository } = req.body;
  if (!['opened', 'synchronize'].includes(action)) {
    return res.status(200).json({ message: 'Action ignored' });
  }

  res.status(200).json({ message: 'Review triggered' });

  orchestrator.run({
    owner:     repository.owner.login,
    repo:      repository.name,
    prNumber:  pull_request.number,
    headSha:   pull_request.head.sha,
  }).catch(err => console.error('[orchestrator] error:', err.message));
};

module.exports = { handle };
