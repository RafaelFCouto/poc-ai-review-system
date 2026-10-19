const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const reference = require('../src/jira-reference');

function context() {
  return { businessRules: 'TCC-9: RN-06\nBloquear manutenção.',
    rules: [{ key: 'TCC-9', summary: 'RN-06', description: 'Bloquear manutenção.', source: 'https://example.invalid/browse/TCC-9', updated: null }],
    issue_keys: ['TCC-9'], retrieved_at: '2026-10-18T12:00:00Z', rules_source: 'pr_description' };
}

function clientUnderTest({ toolError = false, tools = [{ name: 'get_business_rules' }], resultText, connectError } = {}) {
  const events = [];
  let spawned;
  class Transport { constructor(options) { spawned = options; } }
  class Client {
    async connect(transport) {
      events.push('connect');
      if (connectError) throw connectError;
      transport.setProtocolVersion('test-protocol');
    }
    async listTools() { events.push('list'); return { tools }; }
    async callTool(args) {
      events.push(args);
      return { isError: toolError, content: [{ type: 'text', text: resultText === undefined ? JSON.stringify(context()) : resultText }] };
    }
    getServerVersion() { return { name: 'jira-business-rules', version: '1.0.0' }; }
    getServerCapabilities() { return { tools: {} }; }
    async close() { events.push('close'); }
  }
  const module = { exports: {} };
  vm.runInNewContext(fs.readFileSync(path.join(__dirname, '../src/mcp-client.js'), 'utf8'), {
    module, exports: module.exports, __dirname: path.join(__dirname, '../src'),
    process: { execPath: process.execPath, env: { JIRA_API_TOKEN: 'offline', GROQ_API_KEY: 'must-not-be-forwarded' } },
    require(name) {
      if (name === 'path') return path;
      if (name === './jira-reference') return reference;
      if (name === '@modelcontextprotocol/sdk/client/index.js') return { Client };
      if (name === '@modelcontextprotocol/sdk/client/stdio.js') return { StdioClientTransport: Transport };
      throw new Error('Unexpected dependency (direct Jira calls are forbidden here): ' + name);
    },
  });
  return { client: module.exports, events, getSpawned: () => spawned };
}

test('client uses MCP discovery and tool call, preserving context and negotiation metadata', async () => {
  const state = clientUnderTest();
  const received = await state.client.getBusinessContext('TCC', ['TCC-9']);
  assert.equal(state.events[0], 'connect');
  assert.equal(state.events[1], 'list');
  assert.equal(state.events[2].name, 'get_business_rules');
  assert.equal(state.events[2].arguments.issueKeys[0], 'TCC-9');
  assert.equal(state.events[3], 'close');
  assert.equal(received.mcp.protocol_version, 'test-protocol');
  assert.equal(received.mcp.server.name, 'jira-business-rules');
  assert.equal(received.rules[0].source, 'https://example.invalid/browse/TCC-9');
  assert.equal(state.getSpawned().command, process.execPath);
  assert.equal(state.getSpawned().env.GROQ_API_KEY, undefined);
  assert.equal(state.getSpawned().env.JIRA_API_TOKEN, 'offline');
});

test('MCP tool errors do not become empty context and still close the client', async () => {
  const state = clientUnderTest({ toolError: true, resultText: 'Jira request failed (HTTP 401)' });
  await assert.rejects(() => state.client.getBusinessContext('TCC', ['TCC-9']), /MCP tool failed/);
  assert.equal(state.events.at(-1), 'close');
});

test('missing tool or malformed MCP result fails before model execution', async () => {
  for (const options of [{ tools: [] }, { resultText: '{}' }, { resultText: 'not json' }]) {
    const state = clientUnderTest(options);
    await assert.rejects(() => state.client.getBusinessContext('TCC', ['TCC-9']), /does not expose|Invalid Jira MCP/);
    assert.equal(state.events.at(-1), 'close');
  }
});

test('MCP initialization failure still closes the client', async () => {
  const state = clientUnderTest({ connectError: new Error('initialize failed') });
  await assert.rejects(() => state.client.getBusinessContext('TCC', ['TCC-9']), /initialize failed/);
  assert.equal(state.events.at(-1), 'close');
});

test('MCP server advertises the tool and delegates to the Jira provider', async () => {
  const handlers = new Map();
  const listSchema = {};
  const callSchema = {};
  let requested;
  class Server { setRequestHandler(schema, handler) { handlers.set(schema, handler); } }
  const module = { exports: {} };
  vm.runInNewContext(fs.readFileSync(path.join(__dirname, '../src/mcp-server.js'), 'utf8'), {
    module, exports: module.exports,
    require(name) {
      if (name === '@modelcontextprotocol/sdk/server/index.js') return { Server };
      if (name === '@modelcontextprotocol/sdk/server/stdio.js') return { StdioServerTransport: class {} };
      if (name === '@modelcontextprotocol/sdk/types.js') return { ListToolsRequestSchema: listSchema, CallToolRequestSchema: callSchema };
      if (name === './jira-client') return {};
      if (name === './jira-reference') return reference;
      throw new Error('Unexpected dependency: ' + name);
    },
  });
  module.exports.createServer({ async getBusinessContext(project, keys) { requested = { project, keys }; return context(); } });
  assert.equal((await handlers.get(listSchema)()).tools[0].name, 'get_business_rules');
  const response = await handlers.get(callSchema)({ params: { name: 'get_business_rules', arguments: { projectKey: 'TCC', issueKeys: ['tcc-9'] } } });
  assert.equal(requested.project, 'TCC');
  assert.equal(requested.keys[0], 'TCC-9');
  assert.equal(JSON.parse(response.content[0].text).rules[0].key, 'TCC-9');
  const invalid = await handlers.get(callSchema)({ params: { name: 'other', arguments: {} } });
  assert.equal(invalid.isError, true);
});
