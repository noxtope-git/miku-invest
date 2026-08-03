// store.js — Estado persistente de la cartera de inversión.
// Guarda cartera, cash, posiciones, historial de trades y ciclos en JSON.

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const DIR = path.dirname(fileURLToPath(import.meta.url));
const STATE_FILE = path.join(DIR, 'state.json');
const CONFIG_FILE = path.join(DIR, 'config.json');

export const DEFAULT_CONFIG = {
  mode: 'simulation', // 'simulation' | 'live'
  initialCash: 10000,
  maxPositionPct: 10, // % del capital total por posición
  stopLossPct: 5, // stop-loss por posición
  takeProfitPct: 10,
  perTradeFeePct: 0.1, // comisión simulada por operación
  minCycleIntervalMinutes: 30, // protección contra ciclos demasiado seguidos
  autoCycle: false,
  autoCycleCron: '0 18 * * 1-5', // ejemplo: 18:00 lun-vie
  liveKeys: { apiKey: '', apiSecret: '', alpacaKey: '', alpacaSecret: '', alpacaLive: false }, // API keys Binance + Alpaca (modo real)
  liveMaxNotionalPct: 0.5, // % de la caja real como máximo por orden
  assets: [
    { symbol: 'AAPL', market: 'stocks', label: 'Apple' },
    { symbol: 'MSFT', market: 'stocks', label: 'Microsoft' },
    { symbol: 'BTCUSDT', market: 'crypto', label: 'Bitcoin' },
    { symbol: 'ETHUSDT', market: 'crypto', label: 'Ethereum' },
  ],
};

function defaultState() {
  return {
    mode: 'simulation',
    createdAt: Date.now(),
    capital: DEFAULT_CONFIG.initialCash,
    cash: DEFAULT_CONFIG.initialCash,
    positions: {}, // symbol -> { qty, avgPrice, openedAt }
    trades: [], // historial de operaciones ejecutadas
    cycles: [], // historial de ciclos (analista/estratega/auditor)
    lastCycleAt: 0,
    lastCycleError: null,
  };
}

let cache = null;

export function getConfig() {
  if (fs.existsSync(CONFIG_FILE)) {
    try {
      return { ...DEFAULT_CONFIG, ...JSON.parse(fs.readFileSync(CONFIG_FILE, 'utf8')) };
    } catch {}
  }
  return { ...DEFAULT_CONFIG };
}

export function saveConfig(patch) {
  const cfg = { ...getConfig(), ...patch };
  fs.writeFileSync(CONFIG_FILE, JSON.stringify(cfg, null, 2), 'utf8');
  return cfg;
}

export function getState() {
  if (cache) return cache;
  if (fs.existsSync(STATE_FILE)) {
    try {
      cache = { ...defaultState(), ...JSON.parse(fs.readFileSync(STATE_FILE, 'utf8')) };
      return cache;
    } catch {}
  }
  cache = defaultState();
  return cache;
}

export function saveState() {
  if (cache) fs.writeFileSync(STATE_FILE, JSON.stringify(cache, null, 2), 'utf8');
}

export function resetState() {
  cache = defaultState();
  saveState();
  return cache;
}
