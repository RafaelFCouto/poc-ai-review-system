const { createServer } = require('../../src/mcp-server');
const { StdioServerTransport } = require('@modelcontextprotocol/sdk/server/stdio.js');

const provider = {
  async getBusinessContext(_project, keys) {
    if (keys.includes('TCC-999')) throw new Error('Fixture: task unavailable');
    return { businessRules: 'TCC-9: RN-06\nBloquear salas em manutenção.',
      rules: [{ key: 'TCC-9', summary: 'RN-06', description: 'Bloquear salas em manutenção.',
        source: 'https://example.invalid/browse/TCC-9', updated: null }],
      issue_keys: ['TCC-9'], retrieved_at: new Date().toISOString(), rules_source: 'pr_description' };
  },
};
createServer(provider).connect(new StdioServerTransport()).catch(error => {
  console.error(error.message);
  process.exitCode = 1;
});
