// alpaca.js — Ejecución real de acciones en Alpaca (paper o live) usando API keys.
// Soporta órdenes MARKET con notional (fraccional) para acciones EE.UU.
//
// Seguridad: keys desde variables de entorno (APCA_API_KEY_ID, APCA_API_SECRET_KEY)
// o desde config.liveKeys.alpaca*. Usa primero el entorno paper para pruebas.

import { getConfig } from './store.js';

const PAPER_BASE = 'https://paper-api.alpaca.markets';
const LIVE_BASE = 'https://api.alpaca.markets';

function getKeys() {
  const cfg = getConfig();
  const key = process.env.APCA_API_KEY_ID || cfg.liveKeys?.alpacaKey || '';
  const secret = process.env.APCA_API_SECRET_KEY || cfg.liveKeys?.alpacaSecret || '';
  return { key, secret };
}

export function hasAlpacaKeys() {
  const { key, secret } = getKeys();
  return !!(key && secret);
}

function baseUrl(cfg) {
  return cfg.liveKeys?.alpacaLive ? LIVE_BASE : PAPER_BASE;
}

function headers() {
  const { key, secret } = getKeys();
  return {
    'APCA-API-KEY-ID': key,
    'APCA-API-SECRET-KEY': secret,
    'Content-Type': 'application/json',
  };
}

function parseBody(text) {
  if (!text) return {};
  try {
    return JSON.parse(text);
  } catch {
    return { raw: text };
  }
}

async function request(method, path, body = null, timeoutMs = 20000) {
  const { key, secret } = getKeys();
  if (!key || !secret) throw new Error('API keys de Alpaca no configuradas');
  const cfg = getConfig();
  const url = `${baseUrl(cfg)}${path}`;
  const r = await fetch(url, {
    method,
    headers: headers(),
    body: body ? JSON.stringify(body) : undefined,
    signal: AbortSignal.timeout(timeoutMs),
  });
  const text = await r.text();
  const data = parseBody(text);
  if (!r.ok) {
    const msg = data?.message || data?.raw || `HTTP ${r.status}`;
    throw new Error(`Alpaca ${path}: ${msg}`);
  }
  return data;
}

export async function testConnection() {
  const account = await request('GET', '/v2/account');
  const positions = await request('GET', '/v2/positions');
  return {
    ok: true,
    account: {
      accountNumber: account.account_number,
      equity: Number(account.equity),
      cash: Number(account.cash),
      buyingPower: Number(account.buying_power),
      status: account.status,
    },
    positions: (positions || []).map((p) => ({ symbol: p.symbol, qty: Number(p.qty), marketValue: Number(p.market_value) })),
  };
}

// Consulta la caja (cash) disponible en la cuenta.
export async function getCash() {
  const account = await request('GET', '/v2/account');
  return Number(account.cash || 0);
}

// Saldo (cantidad) de una posición concreta (símbolo, ej. AAPL).
export async function getPositionQty(symbol) {
  try {
    const pos = await request('GET', `/v2/positions/${encodeURIComponent(symbol)}`);
    return Number(pos.qty || 0);
  } catch {
    return 0;
  }
}

// Orden de mercado. quantity: notional en USD (fraccional) o cantidad de acciones.
export async function placeMarketOrder({ symbol, side, quantity, notional }) {
  if (!['buy', 'sell'].includes(side)) throw new Error(`Side inválido: ${side}`);
  const order = {
    symbol,
    side,
    type: 'market',
    time_in_force: 'day',
  };
  if (notional != null) order.notional = Math.round(Number(notional) * 100) / 100;
  else order.qty = String(Number(quantity));
  if (order.notional != null && order.notional < 1) {
    throw new Error(`Notional mínimo de Alpaca es 1 USD (pedido: ${order.notional})`);
  }
  const data = await request('POST', '/v2/orders', order);
  const filledQty = Number(data.filled_qty || data.qty || 0);
  return {
    orderId: data.id,
    symbol: data.symbol,
    side: data.side,
    qty: filledQty,
    executedQty: filledQty,
    avgFillPrice: Number(data.filled_avg_price || 0),
    status: data.status,
    submittedAt: data.submitted_at,
    raw: data,
  };
}
