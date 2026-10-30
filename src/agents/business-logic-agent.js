const fs   = require('fs');
const path = require('path');
const { chat, parseJson } = require('./llm-client');

const promptBase = fs.readFileSync(path.join(__dirname, 'prompts', 'business-logic.md'), 'utf8');

async function analyze(diff, businessRules) {
  if (typeof businessRules !== 'string' || !businessRules.trim()) {
    throw new Error('Business-rule review requires non-empty business rules');
  }
  const system = promptBase.replace('{{BUSINESS_RULES}}', () => businessRules);
  const { text, tokens } = await chat(system, `## Code diff to analyze\n\n${diff}`);
  console.log(`[business-logic-agent] tokens — prompt: ${tokens.prompt}, output: ${tokens.output}, total: ${tokens.total}`);
  const comments = parseJson(text, 'business-logic-agent').map(c => {
    if (!c || typeof c !== 'object' || Array.isArray(c) ||
        typeof c.file !== 'string' || !c.file.trim() ||
        !Number.isSafeInteger(c.line) || c.line < 1 ||
        typeof c.rule_id !== 'string' || !c.rule_id.trim() ||
        typeof c.jira_issue_key !== 'string' || !c.jira_issue_key.trim() ||
        typeof c.body !== 'string' || !c.body.trim() ||
        (c.suggested_code !== undefined && c.suggested_code !== null && typeof c.suggested_code !== 'string') ||
        !['high', 'medium', 'low'].includes(c.severity)) {
      throw new Error('Invalid business-rule finding: expected file, line, rule_id, jira_issue_key, body and severity');
    }
    return { file: c.file, line: c.line, rule_id: c.rule_id, jira_issue_key: c.jira_issue_key, body: c.body,
      suggested_code: c.suggested_code?.trim() || null, severity: c.severity, agent: 'business_logic' };
  });
  return { comments, tokens };
}

module.exports = { analyze };
