const fs     = require('fs');
const path   = require('path');
const OpenAI = require('openai').default;

const client = new OpenAI({
  apiKey:  process.env.GROQ_API_KEY,
  baseURL: 'https://api.groq.com/openai/v1',
});

const MODEL      = process.env.GROQ_MODEL || 'llama-3.3-70b-versatile';
const promptBase = fs.readFileSync(path.join(__dirname, 'prompts', 'business-logic.md'), 'utf8');

async function analyze(diff, businessRules, standards = '') {
  let systemPrompt = promptBase.replace('{{BUSINESS_RULES}}', businessRules);
  if (standards) {
    systemPrompt += `\n\n## Project coding standards\n\n${standards}`;
  }

  const response = await client.chat.completions.create({
    model:       MODEL,
    temperature: 0.1,
    messages: [
      { role: 'system', content: systemPrompt },
      { role: 'user',   content: `## Code diff to analyze\n\n${diff}` },
    ],
  });

  const tokens = {
    prompt: response.usage?.prompt_tokens     ?? 0,
    output: response.usage?.completion_tokens ?? 0,
    total:  response.usage?.total_tokens      ?? 0,
  };
  console.log(`[business-logic-agent] tokens — prompt: ${tokens.prompt}, output: ${tokens.output}, total: ${tokens.total}`);

  const text = response.choices[0].message.content.trim();

  try {
    const json     = text.replace(/^```json\n?/, '').replace(/\n?```$/, '');
    const comments = JSON.parse(json).map(c => ({ ...c, agent: 'business_logic' }));
    return { comments, tokens };
  } catch {
    console.error('[business-logic-agent] failed to parse response:', text.slice(0, 200));
    return { comments: [], tokens };
  }
}

module.exports = { analyze };
