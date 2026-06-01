const OpenAI = require('openai').default;

const client = new OpenAI({
  apiKey:  process.env.GROQ_API_KEY,
  baseURL: 'https://api.groq.com/openai/v1',
});

const MODEL = process.env.GROQ_MODEL || 'llama-3.3-70b-versatile';

async function chat(systemPrompt, userMessage) {
  const response = await client.chat.completions.create({
    model:       MODEL,
    temperature: 0.1,
    messages: [
      { role: 'system', content: systemPrompt },
      { role: 'user',   content: userMessage  },
    ],
  });

  const tokens = {
    prompt: response.usage?.prompt_tokens     ?? 0,
    output: response.usage?.completion_tokens ?? 0,
    total:  response.usage?.total_tokens      ?? 0,
  };

  const text = response.choices[0].message.content.trim();
  return { text, tokens };
}

function parseJson(text, agentName) {
  try {
    const json = text.replace(/^```json\n?/, '').replace(/\n?```$/, '');
    return JSON.parse(json);
  } catch {
    console.error(`[${agentName}] failed to parse response:`, text.slice(0, 200));
    return [];
  }
}

module.exports = { chat, parseJson, MODEL };
