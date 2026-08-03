// llm.js — Cliente común para invocar modelos de IA.
// Soporta dos proveedores (se eligen con MIKU_LLM_PROVIDER):
//   - 'ollama' (predeterminado): modelos locales vía Ollama.
//   - 'google': API gratuita de Google AI Studio (Gemini) vía REST.
// Incluye reintentos con backoff.

const PROVIDER = process.env.MIKU_LLM_PROVIDER || 'ollama';
const OLLAMA_URL = process.env.OLLAMA_URL || 'http://127.0.0.1:11434';

const GEMINI_KEY = process.env.GOOGLE_API_KEY || '';
const GEMINI_API = process.env.GEMINI_API_URL || 'https://generativelanguage.googleapis.com/v1beta';

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

async function askOllama({
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
        console.warn(`[llm/ollama] reintento ${attempt}/${retries} ${model}: ${e.message}`);
        await sleep(wait);
      }
    }
  }
  throw lastErr;
}

// Llama al modelo a través de la API gratuita de Google AI Studio (Gemini).
async function askGoogle({
  model,
  system,
  user,
  temperature = 0.3,
  maxTokens = 2048,
  timeoutMs = 120000,
  retries = 3,
}) {
  if (!GEMINI_KEY) throw new Error('GOOGLE_API_KEY no está configurada (MIKU_LLM_PROVIDER=google)');
  const url = `${GEMINI_API}/models/${model}:generateContent?key=${encodeURIComponent(GEMINI_KEY)}`;
  const body = {
    systemInstruction: { parts: [{ text: system }] },
    contents: [{ role: 'user', parts: [{ text: user }] }],
    generationConfig: { temperature, maxOutputTokens: maxTokens },
  };
  let lastErr = null;
  for (let attempt = 1; attempt <= retries; attempt++) {
    try {
      const r = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
        signal: AbortSignal.timeout(timeoutMs),
      });
      if (!r.ok) {
        const t = await r.text();
        if (r.status === 429) throw new Error(`Gemini ${model}: límite de peticiones (429) ${t}`);
        throw new Error(`Gemini ${model}: HTTP ${r.status} ${t}`);
      }
      const data = await r.json();
      const text = data?.candidates?.[0]?.content?.parts?.map((p) => p.text || '').join('') || '';
      if (!text && data?.promptFeedback?.blockReason) {
        throw new Error(`Gemini ${model}: bloqueado (${data.promptFeedback.blockReason})`);
      }
      return text;
    } catch (e) {
      lastErr = e;
      if (attempt < retries) {
        // Ante 429 conviene esperar un poco más (límites de tasa del free tier).
        const wait = (e.message.includes('429') ? 15000 : 2000) * attempt;
        console.warn(`[llm/google] reintento ${attempt}/${retries} ${model}: ${e.message}`);
        await sleep(wait);
      }
    }
  }
  throw lastErr;
}

// Despacha según el proveedor configurado.
export async function askLLM(opts) {
  if (PROVIDER === 'google') return askGoogle(opts);
  return askOllama(opts);
}

// Compatibilidad con importaciones antiguas.
export { askOllama };