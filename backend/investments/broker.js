// broker.js — Ejecución real multi-broker.
// - cripto  → Binance Spot (API keys firmadas HMAC-SHA256)
// - acciones → Alpaca (paper o live, órdenes market fraccionales)
// Enruta automáticamente según asset.market.

import crypto from 'node:crypto';
import { getConfig } from './store.js';
import * as alpaca from './alpaca.js';

const BINANCE_BASE = 'https://api.binance.com';

function getKeys() {
  const cfg = getConfig();
  const key = process.env.BINANCE_API_KEY || cfg.liveKeys?.apiKey || '';
  const secret = process.env.BINANCE_API_SECRET || cfg.liveKeys?.apiSecret || '';
  return { key, secret };
}

export function hasLiveKeys(market = null) {
  if (market === 'crypto') {
    const { key, secret } = getKeys();
    return !!(key && secret);
  }
  if (market === 'stocks') {
    return alpaca.hasAlpacaKeys();
  }
  const { key, secret } = getKeys();
  return !!(key && secret) || alpaca.hasAlpacaKeys();
}

// ---------------------------------------------------------------------------
// Binance (cripto)
// ---------------------------------------------------------------------------

async function binanceSigned(method, path, params = {}) {
  const { key, secret } = getKeys();
  if (!key || !secret) throw new Error('API keys de Binance no configuradas');
  const query = new URLSearchParams({ ...params, timestamp: String(Date.now()) }).toString();
  const signature = crypto.createHmac('sha256', secret).update(query).digest('hex');
  const url = `${BINANCE_BASE}${path}?${query}&signature=${signature}`;
  const r = await fetch(url, {
    method,
    headers: { 'X-MBX-APIKEY': key },
    signal: AbortSignal.timeout(20000),
  });
  const data = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(`Binance ${path}: ${data?.msg || `HTTP ${r.status}`} (código ${data?.code || '?'})`);
  return data;
}

async function binancePublic(path, params = {}) {
  const url = `${BINANCE_BASE}${path}?${new URLSearchParams(params).toString()}`;
  const r = await fetch(url, { signal: AbortSignal.timeout(20000) });
  const data = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(`Binance ${path}: ${data?.msg || `HTTP ${r.status}`}`);
  return data;
}

function roundDownStep(value, stepSize) {
  const decimals = Math.max(0, String(stepSize).split('.')[1]?.length || 0);
  const factor = 10 ** decimals;
  return Math.floor(value * factor) / factor;
}

async function getFilters(symbol) {
  const info = await binancePublic('/api/v3/exchangeInfo', { symbol });
  const s = info.symbols?.[0];
  if (!s) throw new Error(`Binance: símbolo ${symbol} no encontrado`);
  const f = {};
  for (const filter of s.filters) {
    if (filter.filterType === 'LOT_SIZE') f.lotSize = filter;
    if (filter.filterType === 'MARKET_LOT_SIZE') f.marketLotSize = filter;
    if (filter.filterType === 'NOTIONAL') f.notional = filter;
  }
  return f;
}

export async function testBinanceConnection() {
  const data = await binanceSigned('GET', '/api/v3/account', {});
  const balances = (data.balances || [])
    .filter((b) => Number(b.free) > 0 || Number(b.locked) > 0)
    .map((b) => ({ asset: b.asset, free: Number(b.free), locked: Number(b.locked) }));
  return { ok: true, broker: 'binance', permissions: data.permissions || [], balances };
}

export async function getBinanceBalance(asset) {
  const data = await binanceSigned('GET', '/api/v3/account', {});
  const b = (data.balances || []).find((x) => x.asset === asset);
  return { asset, free: Number(b?.free || 0), locked: Number(b?.locked || 0) };
}

export async function getBinanceTicker(symbol) {
  const r = await binancePublic('/api/v3/ticker/price', { symbol });
  return Number(r.price);
}

export async function placeBinanceOrder({ symbol, side, quantity }) {
  if (!['BUY', 'SELL'].includes(side)) throw new Error(`Side inválido: ${side}`);
  const filters = await getFilters(symbol);
  const step = filters.lotSize?.stepSize || filters.marketLotSize?.stepSize || '0.00000001';
  const minNotional = Number(filters.notional?.minNotional || 5);
  const price = await getBinanceTicker(symbol);
  const adjusted = roundDownStep(quantity, step);
  if (adjusted <= 0) throw new Error(`Cantidad ${quantity} por debajo del mínimo tras ajustar a ${step}`);
  if (adjusted * price < minNotional) {
    throw new Error(`Valor de la orden (${(adjusted * price).toFixed(2)} USDT) menor que el mínimo ${minNotional} USDT`);
  }
  const data = await binanceSigned('POST', '/api/v3/order', {
    symbol,
    side,
    type: 'MARKET',
    quantity: String(adjusted),
  });
  return {
    orderId: data.orderId,
    symbol: data.symbol,
    side,
    executedQty: Number(data.executedQty),
    price: data.executedQty ? Number(data.cummulativeQuoteQty) / Number(data.executedQty) : price,
    status: data.status,
    at: data.transactTime,
    broker: 'binance',
    raw: data,
  };
}

// ---------------------------------------------------------------------------
// Alpaca (acciones)
// ---------------------------------------------------------------------------

export async function testAlpacaConnection() {
  return alpaca.testConnection();
}

export async function placeAlpacaOrder({ symbol, side, notional }) {
  return alpaca.placeMarketOrder({ symbol, side, notional });
}

// ---------------------------------------------------------------------------
// Fachada: enrutado por mercado
// ---------------------------------------------------------------------------

export function brokerFor(market) {
  if (market === 'crypto') return 'binance';
  if (market === 'stocks') return 'alpaca';
  return null;
}

export async function testConnection(market = null) {
  if (!market) {
    const results = {};
    const cfg = getConfig();
    if (hasLiveKeys('crypto')) {
      try { results.binance = await testBinanceConnection(); } catch (e) { results.binance = { ok: false, error: e.message }; }
    }
    if (hasLiveKeys('stocks')) {
      try { results.alpaca = await testAlpacaConnection(); } catch (e) { results.alpaca = { ok: false, error: e.message }; }
    }
    return results;
  }
  if (market === 'crypto') return testBinanceConnection();
  if (market === 'stocks') return testAlpacaConnection();
  throw new Error(`Mercado desconocido: ${market}`);
}

export async function placeMarketOrder({ market, symbol, side, quantity, notional }) {
  if (market === 'crypto') return placeBinanceOrder({ symbol, side, quantity });
  if (market === 'stocks') return placeAlpacaOrder({ symbol, side, notional });
  throw new Error(`Mercado sin broker conectado: ${market}`);
}
