const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const sourceRoot = path.join(__dirname, '..', 'src');
const quiet = { log() {}, error() {} };
const normalize = value => JSON.parse(JSON.stringify(value));
const finding = changes => ({
  file: 'src/service.js', line: 3, rule_id: 'RN-01',
  body: 'RN-01: a condição permite o comportamento proibido pela regra.',
  severity: 'high', ...changes,
});

// Replace all API clients before loading modules. Tests never start the app.
function load(file, mocks = {}, env = {}) {
  const filename = path.join(sourceRoot, file);
  const module = { exports: {} };
  vm.runInNewContext(fs.readFileSync(filename, 'utf8'), {
    module, exports: module.exports, __dirname: path.dirname(filename),
    Buffer, console: quiet, process: { env },
    require(name) {
      if (Object.hasOwn(mocks, name)) return mocks[name];
      throw new Error('Unexpected module loaded: ' + name);
    },
  }, { filename, timeout: 2000 });
  return module.exports;
}

function llmClient() {
  return load('agents/llm-client.js', { openai: { default: class {} } }, { GROQ_MODEL: 'offline-model' });
}

function review({ text = JSON.stringify([finding()]), rules = 'RN-01: regra explícita de negócio.', ruleKey = 'TCC-5', llmError } = {}) {
  const chatCalls = [];
  const posted = [];
  const audits = [];
  const jiraCalls = [];
  const llm = {
    ...llmClient(),
    async chat(system, user) {
      chatCalls.push({ system, user });
      if (llmError) throw llmError;
      return { text, tokens: { prompt: 11, output: 7, total: 18 } };
    },
  };
  const agent = load('agents/business-logic-agent.js', { fs, path, './llm-client': llm });
  const github = {
    async getDiff() { return [{ filename: 'src/service.js', patch: '@@ -1 +1 @@\n+changed code' }]; },
    async getStandards() { assert.fail('Coding standards must not be retrieved'); },
    async postReviewComment(...args) { posted.push(args); },
  };
  const orchestrator = load('orchestrator.js', {
    './github-client': github,
    './mcp-client': { async getBusinessContext(...args) {
      jiraCalls.push(args);
      return { businessRules: rules, rules: [{ key: ruleKey, summary: 'Regra de teste', description: rules, source: 'https://example.atlassian.net/browse/' + ruleKey }], issue_keys: args[1], retrieved_at: 'offline',
        mcp: { transport: 'stdio', protocol_version: 'offline-test' } };
    } },
    './jira-reference': load('jira-reference.js'),
    './business-rules.json': require('../src/business-rules.json'),
    './mongodb-client': { async saveAuditLog(log) { audits.push(log); } },
    './agents/business-logic-agent': agent,
    './agents/aggregator': load('agents/aggregator.js'),
    './agents/llm-client': llm,
  });
  return { orchestrator, agent, chatCalls, posted, audits, jiraCalls };
}
const pr = { owner: 'owner', repo: 'api', prNumber: 12, headSha: 'test-sha' };

test('review makes one LLM call and audits only the business agent and its tokens', async () => {
  const context = review();
  await context.orchestrator.run(pr);
  assert.equal(context.chatCalls.length, 1);
  assert.match(context.chatCalls[0].system, /RN-01: regra explícita de negócio/);
  assert.doesNotMatch(context.chatCalls[0].system, /## Project coding standards/);
  assert.match(context.chatCalls[0].user, /src\/service\.js/);
  assert.equal(context.posted.length, 1);
  assert.deepEqual(normalize(context.posted[0].slice(0, 4)), ['owner', 'api', 12, 'test-sha']);
  assert.equal(context.posted[0][4][0].agent, 'business_logic');
  assert.equal(context.posted[0][4][0].rule_id, 'RN-01');
  assert.equal(context.posted[0][4][0].rule_summary, require('../src/business-rules.json')[0].title);
  assert.equal(context.posted[0][4][0].rule_source, 'https://example.atlassian.net/browse/TCC-5');
  assert.equal(context.posted[0][4][0].jira_issue_key, 'TCC-5');
  assert.equal(context.audits.length, 1);
  assert.deepEqual(normalize(context.audits[0].agents), ['business_logic']);
  assert.deepEqual(normalize(context.audits[0].tokens), { prompt: 11, output: 7, total: 18 });
  assert.equal(context.audits[0].model, 'offline-model');
  assert.equal(context.audits[0].sha, 'test-sha');
  assert.equal(context.audits[0].rules_source, 'project_label');
  assert.equal(context.audits[0].jira_issue_keys.length, 0);
});

test('PR description selects explicit Jira tasks and records the references', async () => {
  const context = review();
  await context.orchestrator.run({ ...pr, prDescription: 'Resumo da alteração.\nJira: TCC-9, TCC-5\n' });
  assert.deepEqual(normalize(context.jiraCalls[0]), ['SALA', ['TCC-9', 'TCC-5']]);
  assert.deepEqual(normalize(context.audits[0].jira_issue_keys), ['TCC-9', 'TCC-5']);
  assert.equal(context.audits[0].rules_source, 'pr_description');
  assert.ok(context.audits[0].business_context.businessRules.includes('RN-01: regra explícita de negócio.'));
  assert.equal(context.audits[0].business_context.mcp.transport, 'stdio');
});

test('invalid explicit Jira reference stops before lookup, model and publication', async () => {
  const context = review();
  await assert.rejects(() => context.orchestrator.run({ ...pr, prDescription: 'Jira: incorrect' }), /Invalid Jira reference/);
  assert.equal(context.jiraCalls.length, 0);
  assert.equal(context.chatCalls.length, 0);
  assert.equal(context.posted.length, 0);
});

test('valid empty output is audited as zero findings', async () => {
  const context = review({ text: '[]' });
  await context.orchestrator.run(pr);
  assert.equal(context.chatCalls.length, 1);
  assert.equal(context.posted[0][4].length, 0);
  assert.equal(context.audits[0].comments.length, 0);
});

test('empty rule context stops review before calling the model or publishing', async () => {
  const context = review({ rules: '  ' });
  await assert.rejects(() => context.orchestrator.run(pr), /non-empty business rules/);
  assert.equal(context.chatCalls.length, 0);
  assert.equal(context.posted.length, 0);
  assert.equal(context.audits.length, 0);
});

test('provider failure does not publish or save a successful review', async () => {
  const failure = new Error('Simulated provider failure');
  const context = review({ llmError: failure });
  await assert.rejects(() => context.orchestrator.run(pr), error => error === failure);
  assert.equal(context.posted.length, 0);
  assert.equal(context.audits.length, 0);
});

test('malformed JSON fails instead of becoming an empty review', async () => {
  const context = review({ text: 'not JSON' });
  await assert.rejects(() => context.orchestrator.run(pr), /invalid JSON response/);
  assert.equal(context.posted.length, 0);
  assert.equal(context.audits.length, 0);
});

test('non-array JSON fails instead of becoming a finding collection', async () => {
  const context = review({ text: '{}' });
  await assert.rejects(() => context.orchestrator.run(pr), /JSON array/);
  assert.equal(context.posted.length, 0);
});

test('a finding outside the changed files stops publication', async () => {
  const context = review({ text: JSON.stringify([finding({ file: 'outside.js' })]) });
  await assert.rejects(() => context.orchestrator.run(pr), /outside the PR diff/);
  assert.equal(context.posted.length, 0);
  assert.equal(context.audits.length, 0);
});

test('only RNs in the retrieved context are accepted, never Jira task keys or unloaded RNs', async () => {
  for (const rule_id of ['TCC-5', 'RN-06', 'RN-99']) {
    const context = review({ text: JSON.stringify([finding({ rule_id })]) });
    await assert.rejects(() => context.orchestrator.run(pr), /outside the Jira context/);
    assert.equal(context.posted.length, 0);
    assert.equal(context.audits.length, 0);
  }
});

test('unmapped Jira task fails before the model instead of inventing an RN', async () => {
  const context = review({ ruleKey: 'TCC-999' });
  await assert.rejects(() => context.orchestrator.run(pr), /no RN mapping/);
  assert.equal(context.chatCalls.length, 0);
  assert.equal(context.posted.length, 0);
});

test('the seven API rules keep their RN identity through prompt, publication and audit', async () => {
  const mapping = [['RN-01', 'TCC-5'], ['RN-02', 'TCC-3'], ['RN-03', 'TCC-6'],
    ['RN-04', 'TCC-7'], ['RN-05', 'TCC-8'], ['RN-06', 'TCC-9'], ['RN-07', 'TCC-10']];
  for (const [rule_id, ruleKey] of mapping) {
    const context = review({ ruleKey, text: JSON.stringify([finding({ rule_id })]) });
    await context.orchestrator.run(pr);
    assert.ok(context.chatCalls[0].system.includes(rule_id + ':'));
    assert.equal(context.posted[0][4][0].rule_id, rule_id);
    assert.equal(context.audits[0].comments[0].jira_issue_key, ruleKey);
    assert.equal(context.audits[0].business_context.rules[0].id, rule_id);
  }
});

test('malformed findings fail before publication', async () => {
  for (const invalid of [null, [], finding({ rule_id: undefined }), finding({ rule_id: ' ' }),
    finding({ file: '' }), finding({ line: 0 }), finding({ line: 1.5 }),
    finding({ body: '' }), finding({ severity: 'critical' })]) {
    const context = review({ text: JSON.stringify([invalid]) });
    await assert.rejects(() => context.orchestrator.run(pr), /Invalid business-rule finding/);
    assert.equal(context.posted.length, 0);
    assert.equal(context.audits.length, 0);
  }
});

test('business rule text is inserted literally, including dollar replacement syntax', async () => {
  const rules = "RN-01: literal $& and $' content.";
  const context = review({ rules });
  await context.agent.analyze('diff', rules, 'UNRELATED_STYLE_INSTRUCTIONS');
  assert.ok(context.chatCalls[0].system.includes(rules));
  assert.ok(!context.chatCalls[0].system.includes('UNRELATED_STYLE_INSTRUCTIONS'));
});

test('parser accepts fenced JSON with CRLF and surrounding whitespace', () => {
  assert.equal(llmClient().parseJson('  ```json\r\n[]\r\n```  ', 'test').length, 0);
});

test('deduplication removes exact repeats while preserving different rules and explanations', () => {
  const consolidate = load('agents/aggregator.js').consolidate;
  const prefix = 'x'.repeat(70);
  const comments = [finding({ body: prefix + 'A' }), finding({ body: prefix + 'A' }),
    finding({ body: prefix + 'B' }), finding({ body: prefix + 'A', rule_id: 'RN-02' })];
  assert.equal(consolidate(comments).length, 3);
});

test('deduplicated findings are sorted by severity', () => {
  const unique = load('agents/aggregator.js').consolidate([
    finding({ line: 1, severity: 'low' }), finding({ line: 2, severity: 'high' }),
    finding({ line: 3, severity: 'medium' }),
  ]);
  assert.deepEqual(normalize(unique.map(comment => comment.severity)), ['high', 'medium', 'low']);
});

test('orchestrator deduplicates repeated model findings before publishing and auditing', async () => {
  const context = review({ text: JSON.stringify([finding(), finding()]) });
  await context.orchestrator.run(pr);
  assert.equal(context.posted[0][4].length, 1);
  assert.equal(context.audits[0].comments.length, 1);
});

function githubClient({ inlineFailure = false } = {}) {
  const inline = [];
  const general = [];
  class Octokit {
    constructor() {
      this.pulls = { async createReviewComment(data) {
        inline.push(data);
        if (inlineFailure) throw new Error('Simulated inline publication failure');
      } };
      this.issues = { async createComment(data) { general.push(data); } };
    }
  }
  return { client: load('github-client.js', { '@octokit/rest': { Octokit } }, { GROQ_MODEL: 'offline-model' }), inline, general };
}

test('GitHub comment identifies the business rule, single scope and model', async () => {
  const context = githubClient();
  await context.client.postReviewComment('owner', 'api', 12, 'test-sha', [finding({ agent: 'business_logic' })]);
  assert.equal(context.inline.length, 1);
  assert.match(context.inline[0].body, /Business Rules/);
  assert.match(context.inline[0].body, /Rule: `RN-01`/);
  assert.match(context.inline[0].body, /Model: `offline-model`/);
  assert.equal(context.inline[0].commit_id, 'test-sha');
  assert.equal(context.client.getStandards, undefined);
});

test('general-comment fallback retains the rule and source path', async () => {
  const context = githubClient({ inlineFailure: true });
  await context.client.postReviewComment('owner', 'api', 12, 'test-sha', [finding({ agent: 'business_logic' })]);
  assert.equal(context.general.length, 1);
  assert.match(context.general[0].body, /Rule: `RN-01`/);
  assert.match(context.general[0].body, /src\/service\.js/);
});

test('inline and fallback comments identify the RN and its associated Jira task', async () => {
  for (const inlineFailure of [false, true]) {
    const context = githubClient({ inlineFailure });
    await context.client.postReviewComment('owner', 'api', 12, 'test-sha', [finding({
      rule_id: 'RN-01', rule_summary: 'Conflito de horarios',
      jira_issue_key: 'TCC-5',
      rule_source: 'https://example.atlassian.net/browse/TCC-5',
      body: 'A condicao >= bloqueia reservas adjacentes.',
    })]);
    const comment = (inlineFailure ? context.general : context.inline)[0];
    assert.ok(comment.body.includes('**Regra de negócio violada:** RN-01 — Conflito de horarios'));
    assert.ok(comment.body.includes('**Task Jira:** [TCC-5](https://example.atlassian.net/browse/TCC-5)'));
    assert.ok(comment.body.includes('A condicao >= bloqueia reservas adjacentes.'));
  }
});
