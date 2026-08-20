// store.js — Estado persistente de la cartera de inversión.
// Guarda cartera, cash, posiciones, historial de trades y ciclos en JSON.

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

// Directorio de persistencia (config.json / state.json). Por defecto vive junto
// al código (uso local), pero en Docker se separa a /app/data vía MIKU_DATA_DIR
// para que el código nuevo de la imagen no quede enmascarado por el volumen.
const DATA_DIR = process.env.MIKU_DATA_DIR
  || path.dirname(fileURLToPath(import.meta.url));
const STATE_FILE = path.join(DATA_DIR, 'state.json');
const CONFIG_FILE = path.join(DATA_DIR, 'config.json');

export const DEFAULT_CONFIG = {
  mode: 'simulation', // 'simulation' | 'live'
  initialCash: 10000,
  maxPositionPct: 10, // % del capital total por posición
  stopLossPct: 5, // stop-loss por posición
  takeProfitPct: 15,
  takeProfitPartialPct: 50, // % de la posición vendida al tocar take-profit (el resto sigue)
  trailingStopPct: 5, // trailing: vende si cae este % desde el máximo (tras la salida parcial)
  perTradeFeePct: 0.1, // comisión simulada por operación
  maxEntryRsi: 70, // bloquear compras si RSI14 supera este nivel (sobrecompra)
  minEntryConfidence: 65, // confianza mínima del analista para abrir posición
  minCycleIntervalMinutes: 30, // protección contra ciclos demasiado seguidos
  autoCycle: false,
  autoPaused: false,
  autoCycleCron: '0 18 * * 1-5', // ejemplo: 18:00 lun-vie
  liveKeys: { apiKey: '', apiSecret: '', alpacaKey: '', alpacaSecret: '', alpacaLive: false }, // API keys Binance + Alpaca (modo real)
  liveMaxNotionalPct: 0.5, // % de la caja real como máximo por orden
  mailConfig: {
    smtpHost: 'smtp.gmail.com',
    smtpPort: 465,
    smtpUser: '', // miku.finanzas@gmail.com
    smtpPass: '', // contraseña de aplicación de Gmail
    fromEmail: 'Miku Finanzas <miku.finanzas@gmail.com>',
    destEmail: '', // correo donde recibe las alertas
  },
  mailNotifyWithdrawal: true, // enviar alerta cuando haya ganancias retirables
  minWithdrawalProfit: 10, // ganancia mínima realizada (USD) para alertar
  withdrawalAlertCooldownH: 24, // horas entre alertas de retiro
  simReviewEnabled: false, // avisar por correo al terminar el período de simulación
  simReviewDays: 14, // duración del período de simulación (días)
  simReviewStartedAt: 0, // marca de tiempo cuando se activó el período
  simReviewSentAt: 0, // última vez que se envió el aviso de revisión
  autoLearnEnabled: true, // la IA aprende de su propio historial (reflexión)
  autoLearnIntervalMinutes: 1440, // cada cuánto se autoevalúa para extraer lecciones (24 h)
  authEnabled: false, // requiere login para entrar (protege datos y consola)
  authSalt: '', // sal del hash de la contraseña del admin
  authPasswordHash: '', // hash (scrypt) de la contraseña del admin
  authSessions: {}, // token -> timestamp (sesiones activas)
  authLock: { count: 0, until: 0 }, // bloqueo temporal por muchos intentos fallidos
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
    withdrawalAlertSentAt: 0, // última vez que se avisó de retiro (evita spam)
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
