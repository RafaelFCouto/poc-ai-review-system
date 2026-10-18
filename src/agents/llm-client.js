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
  let parsed;
  try {
    const json = text.trim().replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/, '');
    parsed = JSON.parse(json);
  } catch (cause) {
    throw new Error(`[${agentName}] invalid JSON response`, { cause });
  }
  if (!Array.isArray(parsed)) throw new Error(`[${agentName}] response must be a JSON array`);
  return parsed;
}

module.exports = { chat, parseJson, MODEL };
