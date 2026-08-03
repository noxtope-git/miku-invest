// llm.js — Cliente común para invocar modelos locales vía Ollama.

const OLLAMA_URL = process.env.OLLAMA_URL || 'http://127.0.0.1:11434';

export async function askOllama({ model, system, user, temperature = 0.3, maxTokens = 2048, timeoutMs = 600000 }) {
  const body = {
    model,
    messages: [
      { role: 'system', content: system },
      { role: 'user', content: user },
    ],
    stream: false,
    options: { temperature, num_predict: maxTokens },
  };
  const r = await fetch(`${OLLAMA_URL}/api/chat`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(timeoutMs),
  });
  if (!r.ok) {
    const t = await r.text();
    throw new Error(`Ollama ${model}: HTTP ${r.status} ${t}`);
  }
  const data = await r.json();
  return data.message?.content || '';
}
