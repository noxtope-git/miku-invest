// agents.js — Los tres agentes de IA del sistema de inversión.
// Analista (26b) → Estratega (12b) → Auditor (e4b).
// Cada agente devuelve JSON estructurado; los datos ya vienen calculados
// de forma determinista (indicadores técnicos) para que el LLM los interprete,
// no para que los invente.

import { askLLM } from './llm.js';
import { extractJson } from './marketdata.js';

const isGoogle = (process.env.MIKU_LLM_PROVIDER || 'ollama') === 'google';

// Modelos por defecto según el proveedor activo.
// Ollama: Gemma local. Google: Gemini Flash (gratis vía Google AI Studio).
// Modelos gratuitos de Google AI Studio disponibles para este proyecto
// (verificado por prueba real: 2.0-flash tiene cuota 0 y 2.5-flash da 404).
// 'gemini-flash-lite-latest' devuelve JSON limpio; gemma-4-31b-it de refuerzo.
const GOOGLE_DEFAULTS = {
  analyst: 'gemini-flash-lite-latest',
  strategist: 'gemini-flash-lite-latest',
  auditor: 'gemini-flash-lite-latest',
};
const GOOGLE_FALLBACK = {
  analyst: ['gemini-flash-lite-latest', 'gemma-4-31b-it'],
  strategist: ['gemini-flash-lite-latest', 'gemma-4-31b-it'],
  auditor: ['gemini-flash-lite-latest', 'gemma-4-31b-it'],
};
const OLLAMA_DEFAULTS = {
  analyst: 'gemma4:26b',
  strategist: 'gemma4:12b',
  auditor: 'gemma4:e4b',
};

// Fallback: si el modelo principal no está disponible, usa otro (evita
// bloquear todo el ciclo).
const OLLAMA_FALLBACK = {
  analyst: ['gemma4:12b', 'gemma4:e4b'],
  strategist: ['gemma4:e4b'],
  auditor: ['gemma4:e4b'],
};

const DEFAULTS = isGoogle ? GOOGLE_DEFAULTS : OLLAMA_DEFAULTS;

export const MODELS = {
  analyst: process.env.MIKU_ANALYST_MODEL || DEFAULTS.analyst,
  strategist: process.env.MIKU_STRATEGIST_MODEL || DEFAULTS.strategist,
  auditor: process.env.MIKU_AUDITOR_MODEL || DEFAULTS.auditor,
};

export const FALLBACK_MODELS = isGoogle ? GOOGLE_FALLBACK : OLLAMA_FALLBACK;

function pickModels(role, loadedModels = []) {
  const primary = MODELS[role];
  if (!loadedModels.length) return [primary, ...(FALLBACK_MODELS[role] || [])];
  const candidates = [primary, ...(FALLBACK_MODELS[role] || [])];
  const unique = [...new Set(candidates)];
  const available = unique.filter((m) => loadedModels.some((lm) => lm.startsWith(m)));
  return available.length ? available : unique;
}

// Pide a un agente su JSON, probando modelos de respaldo si el principal falla.
async function askAgent(role, { system, user, temperature }, validate) {
  let lastErr = null;
  const attempts = pickModels(role);
  for (const model of attempts) {
    try {
      const text = await askLLM({ model, system, user, temperature });
      const json = extractJson(text);
      if (!json) throw new Error('no devolvió JSON válido');
      const normalized = validate ? validate(json) : json;
      if (!normalized) throw new Error('JSON fuera del esquema esperado');
      return { raw: text, model, ...normalized };
    } catch (e) {
      lastErr = e;
      console.warn(`[agents] ${role} con ${model}: ${e.message}`);
    }
  }
  throw lastErr || new Error(`${role} falló tras probar todos los modelos`);
}

const ANALYST_SYSTEM = `Eres un analista financiero senior, conservador y riguroso.
Recibes datos técnicos reales calculados de un activo financiero (precio, variaciones, medias móviles, RSI, MACD, soporte y resistencia) junto con los últimos precios diarios.
Debes interpretar esos datos y emitir un informe breve de análisis.

Responde ÚNICAMENTE con JSON válido con este formato exacto:
{
  "sentiment": "alcista" | "bajista" | "neutral",
  "confidence": 0-100 (número entero),
  "summary": "Resumen del análisis en español, máximo 4 frases, con números concretos del activo.",
  "keyLevels": {
    "support": "nivel de soporte aproximado redondeado",
    "resistance": "nivel de resistencia aproximado redondeado"
  },
  "risks": ["riesgo 1", "riesgo 2"],
  "opportunities": ["oportunidad 1", "oportunidad 2"]
}

Reglas:
- No inventes datos: usa solo los números que te dan.
- El RSI > 70 es sobrecomprado (riesgo de caída), RSI < 30 es sobrevendido.
- MACD positivo y creciente apoya tendencia alcista; negativo apoya bajista.
- Precio sobre SMA20 y SMA50 suele ser alcista, debajo bajista.
- Sé prudente: si hay señales mezcladas, usa "neutral".
- No recomiendes apalancamiento ni operaciones de alto riesgo.`;

function formatIndicators(assetData) {
  const ind = assetData.indicators || {};
  const lines = [
    `Precio actual: ${ind.price} ${assetData.currency}`,
    `Variación 1 día: ${ind.change1d?.toFixed(2)}%`,
    `Variación 5 días: ${ind.change5d?.toFixed(2)}%`,
    `Variación 1 mes: ${ind.change1m?.toFixed(2)}%`,
    `SMA20: ${ind.sma20?.toFixed(2)}`,
    `SMA50: ${ind.sma50?.toFixed(2)}`,
    `RSI14: ${ind.rsi14?.toFixed(1)}`,
    `MACD: ${ind.macd?.toFixed(3)} (señal: ${ind.macdSignal?.toFixed(3)})`,
    `Soporte 20d: ${ind.support20?.toFixed(2)}`,
    `Resistencia 20d: ${ind.resistance20?.toFixed(2)}`,
  ];
  if (Array.isArray(ind.lastTrades) && ind.lastTrades.length) {
    lines.push('ÚLTIMOS 10 CIERRES DIARIOS:');
    for (const t of ind.lastTrades.slice(-10)) {
      lines.push(`  ${new Date(t.t).toISOString().slice(0, 10)}: ${t.c}`);
    }
  }
  return lines.join('\n');
}

function normalizeAnalyst(json) {
  const j = json && typeof json === 'object' ? json : null;
  if (!j) return null;
  const sentiment = ['alcista', 'bajista', 'neutral'].includes(j.sentiment) ? j.sentiment : 'neutral';
  const confidence = Number.isFinite(Number(j.confidence)) ? Math.max(0, Math.min(100, Number(j.confidence))) : 50;
  return {
    sentiment,
    confidence,
    summary: String(j.summary || '').slice(0, 1000),
    keyLevels: {
      support: j.keyLevels?.support ?? null,
      resistance: j.keyLevels?.resistance ?? null,
    },
    risks: Array.isArray(j.risks) ? j.risks.map(String).slice(0, 5) : [],
    opportunities: Array.isArray(j.opportunities) ? j.opportunities.map(String).slice(0, 5) : [],
  };
}

async function analyst(assetData) {
  const user = `DATOS TÉCNICOS DE ${assetData.symbol} (${assetData.market.toUpperCase()}):
${formatIndicators(assetData)}

EmitE tu informe JSON de análisis.`;
  return askAgent('analyst', { system: ANALYST_SYSTEM, user, temperature: 0.3 }, normalizeAnalyst);
}

const STRATEGIST_SYSTEM = `Eres un gestor de cartera disciplinado. Recibes el informe del analista, el saldo disponible en caja, las posiciones abiertas y las reglas de riesgo.
Debes decidir la acción para el activo consultado.

Reglas de riesgo OBLIGATORIAS:
- Nunca arriesgues más del máximo permitido por posición (dado en la configuración).
- Toda posición nueva necesita señales claramente alcistas del analista y capital suficiente en caja.
- Si ya tienes posición abierta y el analista dice "bajista", debes considerar vender (stop).
- Si el analista dice "neutral" y no tienes posición, la decisión debe ser "mantener" (no operar).
- Proporción de inversión sugerida: usa un porcentaje razonable de la caja (p. ej. 20-40% en una posición nueva), sin superar el máximo por posición sobre el capital total.

Responde ÚNICAMENTE con JSON válido:
{
  "action": "buy" | "sell" | "hold",
  "reasoning": "Explicación breve en español de por qué tomas esta decisión, usando los datos del analista.",
  "quantity": número de unidades (0 si action es hold; si buy, cantidad según reglas; si sell y tienes posición, toda la posición a menos que indiques lo contrario),
  "limitPrice": "precio límite redondeado o null",
  "riskCheck": { "ok": true/false, "notes": "notas" }
}`;

function normalizeStrategist(json) {
  const j = json && typeof json === 'object' ? json : null;
  if (!j) return null;
  const action = ['buy', 'sell', 'hold'].includes(j.action) ? j.action : 'hold';
  const quantity = Number.isFinite(Number(j.quantity)) ? Number(j.quantity) : 0;
  return {
    action,
    reasoning: String(j.reasoning || '').slice(0, 1000),
    quantity: action === 'hold' ? 0 : Math.max(0, quantity),
    limitPrice: j.limitPrice ?? null,
    riskCheck: j.riskCheck && typeof j.riskCheck === 'object' ? j.riskCheck : { ok: true, notes: '' },
  };
}

async function strategist({ assetData, analystReport, portfolio }) {
  const cfg = portfolio.cfg;
  const position = portfolio.state.positions[assetData.symbol];
  const posText = position
    ? `Tienes posición abierta: ${position.qty} unidades a precio medio ${position.avgPrice} (abierta ${new Date(position.openedAt).toISOString()})`
    : 'No tienes posición abierta en este activo.';

  const user = `INFORME DEL ANALISTA para ${assetData.symbol}:
${JSON.stringify(analystReport, null, 2)}

ESTADO DE LA CARTERA:
- Caja disponible: ${portfolio.state.cash.toFixed(2)} ${assetData.currency}
- Capital total (caja + posiciones valoradas): ${portfolio.capitalTotal.toFixed(2)} ${assetData.currency}
- Precio actual del activo: ${assetData.indicators.price}
- ${posText}

REGLAS:
- Máximo % del capital por posición: ${cfg.maxPositionPct}%
- Stop-loss por posición: ${cfg.stopLossPct}%
- Take-profit por posición: ${cfg.takeProfitPct}%

Decide la acción y responde SOLO el JSON.`;
  return askAgent('strategist', { system: STRATEGIST_SYSTEM, user, temperature: 0.2 }, normalizeStrategist);
}

const AUDITOR_SYSTEM = `Eres un auditor de cartera. Recibes la decisión del estratega, los datos del activo y el estado de la cartera.
Tu trabajo: validar que la operación respete las reglas de riesgo y actualizar el registro. Si algo no cuadra, lo señalas claramente.
No inventes cifras: usa solo las que te pasan.

Responde ÚNICAMENTE con JSON válido:
{
  "approval": true/false,
  "reasoning": "En español, máximo 3 frases.",
  "adjustedAction": "buy" | "sell" | "hold",
  "adjustedQuantity": número (0 si no hay operación),
  "warnings": ["advertencia 1", "advertencia 2"]
}`;

function normalizeAuditor(json) {
  const j = json && typeof json === 'object' ? json : null;
  if (!j) return null;
  const approval = j.approval === true;
  const adjustedAction = ['buy', 'sell', 'hold'].includes(j.adjustedAction) ? j.adjustedAction : null;
  return {
    approval,
    reasoning: String(j.reasoning || '').slice(0, 1000),
    adjustedAction,
    adjustedQuantity: Number.isFinite(Number(j.adjustedQuantity)) ? Number(j.adjustedQuantity) : 0,
    warnings: Array.isArray(j.warnings) ? j.warnings.map(String).slice(0, 5) : [],
  };
}

async function auditor({ assetData, strategistDecision, portfolio }) {
  const user = `DECISIÓN DEL ESTRATEGA para ${assetData.symbol}:
${JSON.stringify(strategistDecision, null, 2)}

DATOS DEL ACTIVO:
- Precio actual: ${assetData.indicators.price} ${assetData.currency}

ESTADO DE LA CARTERA:
- Caja: ${portfolio.state.cash.toFixed(2)}
- Capital total: ${portfolio.capitalTotal.toFixed(2)}
- Posiciones: ${JSON.stringify(portfolio.state.positions)}

Reglas vigentes:
- Máx % posición: ${portfolio.cfg.maxPositionPct}%
- Stop-loss: ${portfolio.cfg.stopLossPct}%

Valida la decisión y responde SOLO el JSON.`;
  return askAgent('auditor', { system: AUDITOR_SYSTEM, user, temperature: 0.1 }, normalizeAuditor);
}

export const agents = { analyst, strategist, auditor };
