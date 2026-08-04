// learn.js — Bucle de auto-aprendizaje (reflexión) de Miku.
// Tras cada ciclo evalúa su historial REAL (operaciones cerradas vs decisión
// del analista, P&L realizado, aciertos por sentimiento), y con esos datos
// pide al LLM que escriba "lecciones" concretas. Esas lecciones se guardan en
// experience.json y se inyectan en los prompts de los agentes en los ciclos
// siguientes, de modo que el razonamiento queda condicionado por su propia
// experiencia. No re-entrena el modelo: condiciona la toma de decisiones.

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { askLLM } from './llm.js';
import { extractJson } from './marketdata.js';
import { getConfig, getState } from './store.js';
import { emitLive } from './live.js';

const DATA_DIR = process.env.MIKU_DATA_DIR || path.dirname(fileURLToPath(import.meta.url));
const EXPERIENCE_FILE = path.join(DATA_DIR, 'experience.json');

const defaultLearnModel = (process.env.MIKU_LLM_PROVIDER || 'ollama') === 'google'
  ? 'gemini-flash-lite-latest'
  : 'gemma4:e4b';
const LEARN_MODEL = process.env.MIKU_LEARN_MODEL || defaultLearnModel;

function defaultExperience() {
  return {
    createdAt: Date.now(),
    lastEvalAt: 0,
    stats: null, // últimas métricas evaluadas
    lessons: [], // lecciones activas que se inyectan en los prompts
    history: [], // historial de autoevaluaciones (máximo 60)
  };
}

function loadExperience() {
  if (fs.existsSync(EXPERIENCE_FILE)) {
    try {
      return { ...defaultExperience(), ...JSON.parse(fs.readFileSync(EXPERIENCE_FILE, 'utf8')) };
    } catch {}
  }
  return defaultExperience();
}

function saveExperience(exp) {
  fs.writeFileSync(EXPERIENCE_FILE, JSON.stringify(exp, null, 2), 'utf8');
}

// Métricas reales a partir del historial de operaciones y ciclos.
export function computePerformanceStats() {
  const state = getState();
  const trades = state.trades || [];
  const cycles = state.cycles || [];

  // Último precio conocido por activo (para valorar posiciones abiertas).
  const lastPrice = {};
  for (const c of cycles) lastPrice[c.symbol] = c.price;

  const bySentiment = {};
  const details = [];
  let realized = 0;
  let wins = 0;
  let losses = 0;

  for (const t of trades) {
    const pnl = (t.price - t.avgCost) * t.qty || 0;
    if (t.action === 'sell') {
      realized += pnl;
      if (pnl > 0) wins++;
      else if (pnl < 0) losses++;
      const cyc = cycles.filter((c) => c.symbol === t.symbol && c.at <= t.at).pop();
      const sent = cyc?.analyst?.sentiment || 'desconocido';
      const bucket = bySentiment[sent] || { trades: 0, pnl: 0, wins: 0 };
      bucket.trades += 1;
      bucket.pnl += pnl;
      if (pnl > 0) bucket.wins += 1;
      bySentiment[sent] = bucket;
      details.push({
        at: t.at,
        symbol: t.symbol,
        action: t.action,
        qty: t.qty,
        price: t.price,
        avgCost: t.avgCost,
        pnl: Math.round(pnl * 100) / 100,
        sentiment: sent,
      });
    }
  }

  const pnls = details.map((d) => d.pnl);
  const avgTrade = pnls.length ? pnls.reduce((a, b) => a + b, 0) / pnls.length : 0;
  const best = pnls.length ? Math.max(...pnls) : 0;
  const worst = pnls.length ? Math.min(...pnls) : 0;
  const closedCount = wins + losses;

  const open = Object.entries(state.positions || {}).map(([symbol, pos]) => {
    const cur = lastPrice[symbol] ?? pos.lastPrice ?? pos.avgPrice;
    return {
      symbol,
      qty: pos.qty,
      avgPrice: pos.avgPrice,
      last: cur,
      unrealized: Math.round((cur - pos.avgPrice) * pos.qty * 100) / 100,
    };
  });

  return {
    evaluatedAt: Date.now(),
    cyclesTotal: cycles.length,
    tradesEvaluated: details.length,
    openPositions: open.length,
    realizedPnl: Math.round(realized * 100) / 100,
    winRate: closedCount ? Math.round((wins / closedCount) * 1000) / 10 : null,
    wins,
    losses,
    avgTrade: Math.round(avgTrade * 100) / 100,
    bestTrade: Math.round(best * 100) / 100,
    worstTrade: Math.round(worst * 100) / 100,
    bySentiment,
    open,
  };
}

// Pide al LLM que convierta las métricas en lecciones accionables.
async function generateLessons(stats) {
  const cfg = getConfig();
  const state = getState();
  const recent = (state.cycles || []).slice(-12).map((c) => ({
    symbol: c.symbol,
    at: new Date(c.at).toISOString().slice(5, 16),
    action: c.finalDecision?.action,
    price: c.price,
    sentiment: c.analyst?.sentiment,
    confidence: c.analyst?.confidence,
  }));

  const system = `Eres un mentor de trading que revisa las decisiones REALES que tomó un sistema de inversión automático.
Recibes métricas de rendimiento calculadas de operaciones cerradas y el historial reciente de decisiones.
Tu tarea: detectar patrones de error o de acierto y escribir lecciones concretas y accionables que guíen las próximas decisiones.

Reglas:
- Máximo 6 lecciones; prioriza las de mayor impacto real según los números.
- Cada lección debe ser específica (menciona el activo o el contexto si aplica), prescriptiva ("haz X", "evita Y") y NO genérica.
- No inventes datos: usa solo los que te dan.
- Distribuye las lecciones entre las áreas: analyst (interpretación técnica), strategist (qué y cuándo operar), auditor (control de riesgo), o all (regla general).
- Responde ÚNICAMENTE con JSON válido:
{
  "summary": "1 frase: cómo está rindiendo el sistema según los datos.",
  "lessons": [
    { "area": "analyst" | "strategist" | "auditor" | "all", "text": "lección accionable en español, máximo 2 frases" }
  ]
}`;

  const user = `MÉTRICAS REALES DEL SISTEMA:
${JSON.stringify(stats, null, 2)}

ÚLTIMAS DECISIONES TOMADAS:
${JSON.stringify(recent, null, 2)}

REGLAS VIGENTES:
- stop-loss por posición: ${cfg.stopLossPct}%
- take-profit por posición: ${cfg.takeProfitPct}%
- máximo % del capital por posición: ${cfg.maxPositionPct}%

Genera las lecciones JSON.`;

  const text = await askLLM({ model: LEARN_MODEL, system, user, temperature: 0.4 });
  const json = extractJson(text);
  if (!json || !Array.isArray(json.lessons)) throw new Error('el mentor no devolvió lecciones válidas');
  const lessons = json.lessons
    .filter((l) => l && l.text && ['analyst', 'strategist', 'auditor', 'all'].includes(l.area))
    .map((l) => ({ area: l.area, text: String(l.text).slice(0, 300) }))
    .slice(0, 6);
  return { summary: String(json.summary || '').slice(0, 400), lessons };
}

// Evalúa y aprende (con guarda de intervalo). force ignora el intervalo.
export async function maybeAutoLearn({ force = false } = {}) {
  const cfg = getConfig();
  if (!cfg.autoLearnEnabled && !force) return null;
  const exp = loadExperience();
  const intervalMs = (cfg.autoLearnIntervalMinutes || 1440) * 60 * 1000;
  if (!force && exp.lastEvalAt && Date.now() - exp.lastEvalAt < intervalMs) return null;

  const stats = computePerformanceStats();
  if (stats.tradesEvaluated === 0 && !force) return null; // aún no hay operaciones que evaluar

  let result;
  try {
    result = await generateLessons(stats);
  } catch (e) {
    console.warn(`[learn] mentor falló (${e.message}); guardando solo métricas`);
    result = { summary: null, lessons: [] };
  }

  exp.lastEvalAt = Date.now();
  exp.stats = stats;
  exp.lessons = result.lessons;
  exp.history.push({
    at: Date.now(),
    summary: result.summary,
    winRate: stats.winRate,
    realizedPnl: stats.realizedPnl,
    tradesEvaluated: stats.tradesEvaluated,
    lessons: result.lessons.length,
  });
  if (exp.history.length > 60) exp.history = exp.history.slice(-60);
  saveExperience(exp);

  emitLive('learn', {
    at: Date.now(),
    summary: result.summary,
    lessons: result.lessons,
    stats: {
      winRate: stats.winRate,
      realizedPnl: stats.realizedPnl,
      tradesEvaluated: stats.tradesEvaluated,
    },
  });
  console.log(`[learn] autoevaluación nº${exp.history.length}: ${stats.tradesEvaluated} ops, win rate ${stats.winRate ?? 'n/a'}%, ${result.lessons.length} lecciones`);
  return exp;
}

// Texto con las lecciones aplicables a un agente, para inyectar en su prompt.
export function feedbackForPrompt(role = 'all') {
  const exp = loadExperience();
  const lessons = (exp.lessons || []).filter((l) => l && l.text && (l.area === role || l.area === 'all'));
  if (!lessons.length) return '';
  const lines = lessons.map((l) => `- ${l.text}`);
  return `TU PROPIA EXPERIENCIA PREVIA (lecciones que aprendiste de tus operaciones reales; síguelas en esta decisión):\n${lines.join('\n')}`;
}

// Resumen para la API y la interfaz.
export function getExperience() {
  const exp = loadExperience();
  return {
    enabled: getConfig().autoLearnEnabled !== false,
    intervalMinutes: getConfig().autoLearnIntervalMinutes || 1440,
    lastEvalAt: exp.lastEvalAt,
    stats: exp.stats,
    lessons: exp.lessons,
    history: exp.history.slice(-10).reverse(),
  };
}
