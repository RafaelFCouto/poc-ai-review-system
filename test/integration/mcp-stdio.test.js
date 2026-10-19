const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const fs = require('node:fs');
const vm = require('node:vm');
const { createMcpClient } = require('../../src/mcp-client');

// Real SDK and child-process stdio; only the Jira provider is a deterministic fixture.
const client = createMcpClient({ serverPath: path.join(__dirname, '../fixtures/jira-mcp-server.cjs'), serverEnv: {} });

test('real MCP initialization, discovery and tool call over stdio', { timeout: 15000 }, async t => {
  const context = await client.getBusinessContext('TCC', ['TCC-9']);
  assert.equal(context.mcp.transport, 'stdio');
  assert.match(context.mcp.protocol_version, /^\d{4}-\d{2}-\d{2}$/);
  assert.equal(context.mcp.server.name, 'jira-business-rules');
  assert.equal(context.mcp.tool, 'get_business_rules');
  assert.ok(context.mcp.capabilities.tools);
  assert.equal(context.rules[0].key, 'TCC-9');
  assert.match(context.businessRules, /Bloquear salas em manutenção/);
  t.diagnostic(JSON.stringify({ transport: context.mcp.transport,
    protocol_version: context.mcp.protocol_version, server: context.mcp.server, tool: context.mcp.tool }));
});

test('orchestrator retrieves context over real MCP and audits the context used by its agent', { timeout: 15000 }, async () => {
  const root = path.join(__dirname, '../../src');
  const finding = { file: 'src/service.js', line: 1, rule_id: 'RN-06',
    body: 'RN-06: a regra exige bloquear a sala em manutenção.', severity: 'high' };
  let prompt;
  let audit;
  let published;
  const llm = { MODEL: 'offline-integration-model', parseJson: JSON.parse,
    async chat(system) { prompt = system; return { text: JSON.stringify([finding]), tokens: { prompt: 10, output: 5, total: 15 } }; } };
  function load(file, mocks) {
    const module = { exports: {} };
    vm.runInNewContext(fs.readFileSync(path.join(root, file), 'utf8'), {
      module, exports: module.exports, __dirname: path.dirname(path.join(root, file)),
      console: { log() {} }, process: { env: { JIRA_PROJECT_KEY: 'TCC' } },
      require(name) {
        if (Object.hasOwn(mocks, name)) return mocks[name];
        throw new Error('Unexpected integration dependency: ' + name);
      },
    });
    return module.exports;
  }
  const agent = load('agents/business-logic-agent.js', { fs, path, './llm-client': llm });
  const orchestrator = load('orchestrator.js', {
    './github-client': {
      async getDiff() { return [{ filename: finding.file, patch: '+changed code' }]; },
      async postReviewComment(...args) { published = args[4]; },
    },
    './mcp-client': client,
    './mongodb-client': { async saveAuditLog(log) { audit = log; } },
    './jira-reference': require('../../src/jira-reference'),
    './business-rules.json': require('../../src/business-rules.json'),
    './agents/business-logic-agent': agent,
    './agents/llm-client': llm,
    './agents/aggregator': require('../../src/agents/aggregator'),
  });
  await orchestrator.run({ owner: 'offline', repo: 'api', prNumber: 1, headSha: 'fixture-sha', prDescription: 'Jira: TCC-9' });
  assert.ok(prompt.includes(audit.business_context.businessRules));
  assert.equal(audit.business_context.rules[0].key, 'TCC-9');
  assert.equal(audit.business_context.mcp.transport, 'stdio');
  assert.match(audit.business_context.mcp.protocol_version, /^\d{4}-\d{2}-\d{2}$/);
  assert.equal(audit.jira_issue_keys[0], 'TCC-9');
  assert.equal(published[0].rule_id, 'RN-06');
  assert.equal(published[0].jira_issue_key, 'TCC-9');
  assert.equal(published[0].rule_summary, audit.business_context.rules[0].title);
  assert.equal(published[0].rule_source, audit.business_context.rules[0].source);
  assert.equal(audit.agents[0], 'business_logic');
});

test('real MCP tool error is rejected by the client', { timeout: 15000 }, async () => {
  await assert.rejects(() => client.getBusinessContext('TCC', ['TCC-999']), /Fixture: task unavailable/);
});
