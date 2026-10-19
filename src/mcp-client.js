const path = require('path');
const { Client } = require('@modelcontextprotocol/sdk/client/index.js');
const { StdioClientTransport } = require('@modelcontextprotocol/sdk/client/stdio.js');
const { normalizeIssueKeys } = require('./jira-reference');

const TOOL_NAME = 'get_business_rules';
const REQUEST_TIMEOUT_MS = 30_000;
const SERVER_PATH = path.join(__dirname, 'mcp-server.js');

function createMcpClient({ serverPath = SERVER_PATH, serverEnv = process.env } = {}) {
  async function getBusinessContext(projectKey, issueKeys = []) {
    const keys = normalizeIssueKeys(issueKeys);
    const client = new Client({ name: 'business-rule-review', version: '1.0.0' }, { capabilities: {} });
    // Forward Jira credentials only to our child server, never through tool arguments.
    const env = Object.fromEntries(['JIRA_BASE_URL', 'JIRA_EMAIL', 'JIRA_API_TOKEN']
      .filter(key => typeof serverEnv[key] === 'string').map(key => [key, serverEnv[key]]));
    const transport = new StdioClientTransport({
      command: process.execPath, args: [serverPath], env, stderr: 'inherit',
    });
    let protocolVersion;
    // Public transport hook called by SDK 1.29 after the initialize response.
    transport.setProtocolVersion = version => { protocolVersion = version; };
    try {
      await client.connect(transport, { timeout: REQUEST_TIMEOUT_MS });
      const listed = await client.listTools(undefined, { timeout: REQUEST_TIMEOUT_MS });
      if (!listed.tools.some(tool => tool.name === TOOL_NAME)) {
        throw new Error('Jira MCP server does not expose ' + TOOL_NAME);
      }
      const result = await client.callTool({ name: TOOL_NAME,
        arguments: { projectKey, issueKeys: keys } }, undefined, { timeout: REQUEST_TIMEOUT_MS });
      const text = result.content?.filter(item => item.type === 'text').map(item => item.text).join('\n');
      if (result.isError) throw new Error('Jira MCP tool failed: ' + (text || 'unknown error'));
      let context;
      try { context = JSON.parse(text); }
      catch { throw new Error('Invalid Jira MCP tool response: expected JSON context'); }
      if (!context || typeof context.businessRules !== 'string' || !Array.isArray(context.rules) ||
          !Array.isArray(context.issue_keys) || typeof context.retrieved_at !== 'string') {
        throw new Error('Invalid Jira MCP business context');
      }
      if (!protocolVersion) throw new Error('MCP protocol negotiation was not recorded');
      return { ...context, mcp: {
        transport: 'stdio', protocol_version: protocolVersion,
        server: client.getServerVersion(), capabilities: client.getServerCapabilities(), tool: TOOL_NAME,
      } };
    } finally {
      await client.close();
    }
  }
  return { getBusinessContext };
}

module.exports = { ...createMcpClient(), createMcpClient };
