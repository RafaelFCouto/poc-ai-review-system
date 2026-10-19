const crypto       = require('crypto');
const orchestrator = require('./orchestrator');

const WEBHOOK_SECRET = process.env.GITHUB_WEBHOOK_SECRET;

function verifySignature(rawBody, signature) {
  if (typeof signature !== 'string' || !/^sha256=[a-f0-9]{64}$/i.test(signature) ||
      !Buffer.isBuffer(rawBody) || !WEBHOOK_SECRET) return false;
  const expected = crypto
    .createHmac('sha256', WEBHOOK_SECRET)
    .update(rawBody)
    .digest();
  return crypto.timingSafeEqual(expected, Buffer.from(signature.slice(7), 'hex'));
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
    prDescription: pull_request.body || '',
  }).catch(err => console.error('[orchestrator] error:', err.message));
};

module.exports = { handle };
