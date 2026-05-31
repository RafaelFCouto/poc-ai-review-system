const fs   = require('fs');
const path = require('path');
const { GoogleGenerativeAI } = require('@google/generative-ai');

const genAI  = new GoogleGenerativeAI(process.env.GEMINI_API_KEY);
const model  = genAI.getGenerativeModel({ model: process.env.GEMINI_MODEL || 'gemini-2.5-flash' });
const prompt = fs.readFileSync(path.join(__dirname, 'prompts', 'bug-detection.md'), 'utf8');

async function analyze(diff, standards = '') {
  const fullPrompt = standards
    ? `${prompt}\n\n## Project coding standards\n\n${standards}`
    : prompt;

  const result = await model.generateContent([
    { text: fullPrompt },
    { text: `## Code diff to analyze\n\n${diff}` },
  ]);

  const usage = result.response.usageMetadata;
  const tokens = {
    prompt: usage?.promptTokenCount      ?? 0,
    output: usage?.candidatesTokenCount  ?? 0,
    total:  usage?.totalTokenCount       ?? 0,
  };
  console.log(`[bug-agent] tokens — prompt: ${tokens.prompt}, output: ${tokens.output}, total: ${tokens.total}`);

  const text = result.response.text().trim();

  try {
    const json     = text.replace(/^```json\n?/, '').replace(/\n?```$/, '');
    const comments = JSON.parse(json).map(c => ({ ...c, agent: 'bug' }));
    return { comments, tokens };
  } catch {
    console.error('[bug-agent] failed to parse response:', text.slice(0, 200));
    return { comments: [], tokens };
  }
}

module.exports = { analyze };
