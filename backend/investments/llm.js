// llm.js — Cliente común para invocar modelos locales vía Ollama.
// Incluye reintentos con backoff y detección de modelos no cargados.

const OLLAMA_URL = process.env.OLLAMA_URL || 'http://127.0.0.1:11434';

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// Comprueba si el modelo está disponible localmente (lo carga bajo demanda si hace falta).
export async function ensureModel(model, timeoutMs = 120000) {
  const r = await fetch(`${OLLAMA_URL}/api/generate`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ model, prompt: '', stream: false, keep_alive: '30m' }),
    signal: AbortSignal.timeout(timeoutMs),
  });
  if (!r.ok) {
    const t = await r.text();
    throw new Error(`Ollama no pudo cargar ${model}: HTTP ${r.status} ${t}`);
  }
  return true;
}

// Lista los modelos disponibles en Ollama.
export async function listModels() {
  const r = await fetch(`${OLLAMA_URL}/api/tags`, { signal: AbortSignal.timeout(15000) });
  if (!r.ok) throw new Error(`Ollama /api/tags: HTTP ${r.status}`);
  const data = await r.json();
  return (data.models || []).map((m) => m.name);
}

export async function askOllama({
  model,
  system,
  user,
  temperature = 0.3,
  maxTokens = 2048,
  timeoutMs = 600000,
  retries = 3,
}) {
  const body = {
    model,
    messages: [
      { role: 'system', content: system },
      { role: 'user', content: user },
    ],
    stream: false,
    options: { temperature, num_predict: maxTokens },
  };
  let lastErr = null;
  for (let attempt = 1; attempt <= retries; attempt++) {
    try {
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
    } catch (e) {
      lastErr = e;
      if (attempt < retries) {
        const wait = 2000 * attempt + Math.floor(Math.random() * 1000);
        console.warn(`[llm] reintento ${attempt}/${retries} ${model}: ${e.message}`);
        await sleep(wait);
      }
    }
  }
  throw lastErr;
}
