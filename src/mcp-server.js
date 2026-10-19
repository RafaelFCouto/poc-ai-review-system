const { Server } = require('@modelcontextprotocol/sdk/server/index.js');
const { StdioServerTransport } = require('@modelcontextprotocol/sdk/server/stdio.js');
const { ListToolsRequestSchema, CallToolRequestSchema } = require('@modelcontextprotocol/sdk/types.js');
const jiraClient = require('./jira-client');
const { normalizeIssueKeys } = require('./jira-reference');

const SERVER_INFO = { name: 'jira-business-rules', version: '1.0.0' };
const TOOL_NAME = 'get_business_rules';

function createServer(provider = jiraClient) {
  const server = new Server(SERVER_INFO, { capabilities: { tools: {} } });
  server.setRequestHandler(ListToolsRequestSchema, async () => ({ tools: [{
    name: TOOL_NAME,
    description: 'Retrieve business requirements from Jira by explicit issue keys or project label.',
    inputSchema: {
      type: 'object',
      properties: {
        projectKey: { type: 'string' },
        issueKeys: { type: 'array', items: { type: 'string' }, maxItems: 20 },
      },
      required: ['projectKey'],
      additionalProperties: false,
    },
    annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: true },
  }] }));
  server.setRequestHandler(CallToolRequestSchema, async request => {
    try {
      if (request.params.name !== TOOL_NAME) throw new Error('Unknown MCP tool');
      const args = request.params.arguments;
      if (!args || typeof args.projectKey !== 'string' ||
          Object.keys(args).some(key => !['projectKey', 'issueKeys'].includes(key))) {
        throw new Error('Invalid get_business_rules arguments');
      }
      const keys = normalizeIssueKeys(args.issueKeys === undefined ? [] : args.issueKeys);
      const context = await provider.getBusinessContext(args.projectKey, keys);
      return { content: [{ type: 'text', text: JSON.stringify(context) }] };
    } catch (error) {
      return { isError: true, content: [{ type: 'text', text: error.message }] };
    }
  });
  return server;
}

async function main() {
  // stdout belongs exclusively to the MCP JSON-RPC transport.
  const server = createServer();
  await server.connect(new StdioServerTransport());
}

if (require.main === module) {
  main().catch(error => {
    console.error('[jira-mcp-server]', error.message);
    process.exitCode = 1;
  });
}

module.exports = { createServer, SERVER_INFO, TOOL_NAME };
