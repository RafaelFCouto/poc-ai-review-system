const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const crypto = require('node:crypto');
const { EventEmitter } = require('node:events');
const reference = require('../src/jira-reference');

test('explicit Jira field accepts multiple keys and normalizes case and duplicates', () => {
  assert.deepEqual(reference.extractIssueKeys('Descrição com TCC-3 no texto.\nJira: tcc-9, TCC-5, TCC-9\n'), ['TCC-9', 'TCC-5']);
});

test('unmarked mentions and missing descriptions retain project context', () => {
  for (const body of [null, undefined, '', 'Relacionada a TCC-9', 'NotJira: TCC-9']) {
    assert.deepEqual(reference.extractIssueKeys(body), []);
  }
});

test('empty or malformed explicit fields fail rather than widening the search', () => {
  for (const body of ['Jira:', 'Jira: texto', 'Jira: TCC-9,', 'Jira: TCC-9 OR project=TCC', 'Jira: TCC-0', 'Jira: TCC-9\nJira: nope']) {
    assert.throws(() => reference.extractIssueKeys(body), /Invalid Jira reference/);
  }
});

test('explicit task selection has a bounded size', () => {
  assert.throws(() => reference.extractIssueKeys('Jira: ' + Array.from({length: 21}, (_, index) => 'TCC-' + (index + 1)).join(', ')), /at most 20/);
});

const issue = (key, description = 'Texto da regra.') => ({ key, fields: { summary: 'Regra de ' + key, description } });
function jiraClient({ status = 200, data = { issues: [issue('TCC-9')] }, raw } = {}) {
  const calls = [];
  const https = {
    request(url, options, onResponse) {
      const call = { url, options, body: '' };
      calls.push(call);
      const request = new EventEmitter();
      request.write = chunk => { call.body += chunk; };
      request.end = () => {
        queueMicrotask(() => {
          const response = new EventEmitter();
          response.statusCode = status;
          onResponse(response);
          response.emit('data', raw === undefined ? JSON.stringify(data) : raw);
          response.emit('end');
        });
      };
      return request;
    },
  };
  const module = { exports: {} };
  vm.runInNewContext(fs.readFileSync(path.join(__dirname, '../src/jira-client.js'), 'utf8'), {
    module, exports: module.exports, Buffer, URL,
    process: { env: { JIRA_BASE_URL: 'https://example.invalid', JIRA_EMAIL: 'offline', JIRA_API_TOKEN: 'offline' } },
    require(name) {
      if (name === 'https') return https;
      if (name === './jira-reference') return reference;
      throw new Error('Unexpected dependency: ' + name);
    },
  });
  return { client: module.exports, calls };
}

test('explicit tasks are queried by key without a project or label restriction', async () => {
  const context = jiraClient();
  const rules = await context.client.getBusinessRules('SALA', ['tcc-9', 'TCC-9']);
  const body = JSON.parse(context.calls[0].body);
  assert.equal(body.jql, 'key in ("TCC-9") ORDER BY key ASC');
  assert.equal(body.maxResults, 1);
  assert.equal(new URL(context.calls[0].url).pathname, '/rest/api/3/search/jql');
  assert.match(rules, /^TCC-9:/);
});

test('only explicitly requested tasks enter model context', async () => {
  const context = jiraClient({ data: { issues: [issue('TCC-3'), issue('TCC-9')] } });
  const rules = await context.client.getBusinessRules('TCC', ['TCC-9']);
  assert.match(rules, /TCC-9/);
  assert.doesNotMatch(rules, /TCC-3/);
});

test('absence of explicit keys retains the project-label query', async () => {
  const context = jiraClient();
  await context.client.getBusinessRules('tcc');
  const body = JSON.parse(context.calls[0].body);
  assert.equal(body.jql, 'project = TCC AND labels = business-rule ORDER BY key ASC');
  assert.equal(body.maxResults, 20);
});

test('missing or inaccessible selected task fails without falling back to all rules', async () => {
  const context = jiraClient();
  await assert.rejects(() => context.client.getBusinessRules('TCC', ['TCC-9', 'TCC-8']), /not found or not accessible: TCC-8/);
  assert.equal(context.calls.length, 1);
});

test('empty project search remains distinct from a missing explicit task', async () => {
  const context = jiraClient({ data: { issues: [] } });
  assert.equal(await context.client.getBusinessRules('TCC'), '');
});

test('HTTP failures are not mistaken for missing business rules', async () => {
  for (const status of [401, 403, 429, 500]) {
    const context = jiraClient({ status, data: { errorMessages: ['simulated failure'] } });
    await assert.rejects(() => context.client.getBusinessRules('TCC'), new RegExp('HTTP ' + status));
  }
});

test('invalid JSON and invalid Jira response shapes fail explicitly', async () => {
  await assert.rejects(() => jiraClient({ raw: 'not json' }).client.getBusinessRules('TCC'), /Jira parse error/);
  await assert.rejects(() => jiraClient({ data: {} }).client.getBusinessRules('TCC'), /expected issues array/);
  await assert.rejects(() => jiraClient({ data: { issues: [null] } }).client.getBusinessRules('TCC', ['TCC-9']), /expected key and summary/);
});

test('nested Jira descriptions preserve list items and line breaks', async () => {
  const description = { type: 'doc', content: [
    { type: 'heading', content: [{ type: 'text', text: 'RN-06' }] },
    { type: 'bulletList', content: [{ type: 'listItem', content: [{ type: 'paragraph', content: [
      { type: 'text', text: 'Bloquear salas em manutenção.' }, { type: 'hardBreak' },
      { type: 'text', text: 'Inclusive na confirmação.' },
    ] }] }] },
  ] };
  const context = jiraClient({ data: { issues: [issue('TCC-9', description)] } });
  const rules = await context.client.getBusinessRules('TCC', ['TCC-9']);
  assert.ok(rules.includes('RN-06\nBloquear salas em manutenção.\nInclusive na confirmação.'));
});

test('unvalidated query fragments never reach Jira', async () => {
  const context = jiraClient();
  await assert.rejects(() => context.client.getBusinessRules('TCC', ['TCC-9") OR key=TCC-8']), /Invalid Jira reference/);
  await assert.rejects(() => context.client.getBusinessRules('TCC OR project = OTHER'), /Invalid JIRA_PROJECT_KEY/);
  assert.equal(context.calls.length, 0);
});

function webhookUnderTest() {
  const calls = [];
  const module = { exports: {} };
  const secret = 'offline-test-secret';
  vm.runInNewContext(fs.readFileSync(path.join(__dirname, '../src/webhook-handler.js'), 'utf8'), {
    module, exports: module.exports, Buffer, console,
    process: { env: { GITHUB_WEBHOOK_SECRET: secret } },
    require(name) {
      if (name === 'crypto') return crypto;
      if (name === './orchestrator') return { async run(args) { calls.push(args); } };
      throw new Error('Unexpected dependency: ' + name);
    },
  });
  return { handler: module.exports, calls, secret };
}

test('signed webhook forwards the PR description to the orchestrator', async () => {
  const { handler, calls, secret } = webhookUnderTest();
  const body = { action: 'opened', pull_request: { number: 12, head: { sha: 'test-sha' }, body: 'Jira: TCC-9' }, repository: { name: 'api', owner: { login: 'owner' } } };
  const rawBody = Buffer.from(JSON.stringify(body));
  const signature = 'sha256=' + crypto.createHmac('sha256', secret).update(rawBody).digest('hex');
  let status;
  handler.handle({ body, rawBody, headers: { 'x-hub-signature-256': signature, 'x-github-event': 'pull_request' } }, {
    status(code) { status = code; return this; }, json() { return this; },
  });
  assert.equal(status, 200);
  assert.equal(calls.length, 1);
  assert.equal(calls[0].prDescription, 'Jira: TCC-9');
});

test('malformed webhook signatures return 401 instead of throwing', () => {
  for (const signature of [undefined, ['sha256=bad'], 'sha256=bad', 'sha256=' + 'z'.repeat(64), 'sha256=' + '0'.repeat(64)]) {
    const { handler, calls } = webhookUnderTest();
    let status;
    handler.handle({ rawBody: Buffer.from('{}'), headers: { 'x-hub-signature-256': signature } }, {
      status(code) { status = code; return this; }, json() {},
    });
    assert.equal(status, 401);
    assert.equal(calls.length, 0);
  }
});

test('authenticated non-PR events do not start a review', () => {
  const { handler, calls, secret } = webhookUnderTest();
  const rawBody = Buffer.from('{}');
  const signature = 'sha256=' + crypto.createHmac('sha256', secret).update(rawBody).digest('hex');
  let status;
  handler.handle({ body: {}, rawBody, headers: { 'x-hub-signature-256': signature, 'x-github-event': 'push' } }, {
    status(code) { status = code; return this; }, json() {},
  });
  assert.equal(status, 200);
  assert.equal(calls.length, 0);
});
