const fs   = require('fs');
const path = require('path');
const { chat, parseJson } = require('./llm-client');

const prompt = fs.readFileSync(path.join(__dirname, 'prompts', 'code-smell.md'), 'utf8');

async function analyze(diff, standards = '') {
  const system = standards ? `${prompt}\n\n## Project coding standards\n\n${standards}` : prompt;
  const { text, tokens } = await chat(system, `## Code diff to analyze\n\n${diff}`);
  console.log(`[smell-agent] tokens — prompt: ${tokens.prompt}, output: ${tokens.output}, total: ${tokens.total}`);
  const comments = parseJson(text, 'smell-agent').map(c => ({ ...c, agent: 'code_smell' }));
  return { comments, tokens };
}

module.exports = { analyze };
