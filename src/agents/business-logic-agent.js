const fs   = require('fs');
const path = require('path');
const { chat, parseJson } = require('./llm-client');

const promptBase = fs.readFileSync(path.join(__dirname, 'prompts', 'business-logic.md'), 'utf8');

async function analyze(diff, businessRules, standards = '') {
  let system = promptBase.replace('{{BUSINESS_RULES}}', businessRules);
  if (standards) system += `\n\n## Project coding standards\n\n${standards}`;
  const { text, tokens } = await chat(system, `## Code diff to analyze\n\n${diff}`);
  console.log(`[business-logic-agent] tokens — prompt: ${tokens.prompt}, output: ${tokens.output}, total: ${tokens.total}`);
  const comments = parseJson(text, 'business-logic-agent').map(c => ({ ...c, agent: 'business_logic' }));
  return { comments, tokens };
}

module.exports = { analyze };
