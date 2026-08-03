// orchestrator.js — Ejecuta el ciclo de inversión para cada activo configurado.
// Pipeline: obtener datos → Analista → Estratega → Auditor → ejecutar (simulación o live).

import { getSeries, computeIndicators } from './marketdata.js';
import { agents, MODELS } from './agents.js';
import { getConfig, getState, saveState, resetState } from './store.js';
import * as broker from './broker.js';
import * as alpaca from './alpaca.js';

let running = false;

function round2(x) {
  return Math.round(x * 100) / 100;
}

export function portfolioSnapshot() {
  const cfg = getConfig();
  const state = getState();
  return computePortfolio(cfg, state);
}

function computePortfolio(cfg, state) {
  const holdingsValue = Object.values(state.positions).reduce((s, p) => s + p.qty * p.lastPrice, 0);
  const capitalTotal = round2(state.cash + holdingsValue);
  const unrealized = Object.values(state.positions).reduce((s, p) => s + (p.lastPrice - p.avgPrice) * p.qty, 0);
  return { state, cfg, capitalTotal, holdingsValue: round2(holdingsValue), unrealized: round2(unrealized) };
}

// Actualiza lastPrice de cada posición con el precio más reciente disponible.
function markPositions(cfg, state, priceMap) {
  for (const sym of Object.keys(state.positions)) {
    const price = priceMap[sym];
    if (price != null) state.positions[sym].lastPrice = price;
  }
  saveState();
}

function executeTrade(cfg, state, asset, price, decision) {
  const feeRate = cfg.perTradeFeePct / 100;
  let qty = 0;
  if (decision.action === 'buy') {
    qty = Number(decision.quantity) || 0;
    if (qty <= 0) return null;
    const gross = qty * price;
    const fee = gross * feeRate;
    const total = gross + fee;
    if (total > state.cash) return null;
    state.cash = round2(state.cash - total);
    const existing = state.positions[asset.symbol];
    if (existing) {
      const newQty = existing.qty + qty;
      existing.avgPrice = round2((existing.avgPrice * existing.qty + gross) / newQty);
      existing.qty = newQty;
      existing.lastPrice = price;
    } else {
      state.positions[asset.symbol] = { qty, avgPrice: price, lastPrice: price, openedAt: Date.now() };
    }
  } else if (decision.action === 'sell') {
    const existing = state.positions[asset.symbol];
    if (!existing) return null;
    qty = Math.min(Number(decision.quantity) || existing.qty, existing.qty);
    const gross = qty * price;
    const fee = gross * feeRate;
    state.cash = round2(state.cash + gross - fee);
    existing.qty = round2(existing.qty - qty);
    if (existing.qty <= 0.0000001) delete state.positions[asset.symbol];
  }
  const trade = {
    id: `${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
    at: Date.now(),
    symbol: asset.symbol,
    market: asset.market,
    action: decision.action,
    qty,
    price,
    fee: round2((qty * price) * feeRate),
    mode: state.mode,
  };
  state.trades.push(trade);
  saveState();
  return trade;
}

async function executeLive(cfg, state, asset, price, decision) {
  const brokerName = broker.brokerFor(asset.market);
  if (!brokerName) {
    return { skipped: true, reason: `No hay broker conectado para el mercado "${asset.market}".` };
  }
  if (!broker.hasLiveKeys(asset.market)) {
    return { skipped: true, reason: `No hay API keys configuradas para el broker ${brokerName} (${asset.market}).` };
  }

  if (asset.market === 'crypto') {
    const quoteAsset = 'USDT';
    const balance = await broker.getBinanceBalance(quoteAsset);
    const symbol = asset.symbol;

    if (decision.action === 'buy') {
      const maxNotional = balance.free * cfg.liveMaxNotionalPct;
      const priceNow = await broker.getBinanceTicker(symbol);
      let qty = Number(decision.quantity) || 0;
      if (qty <= 0 || qty * priceNow > maxNotional) {
        qty = maxNotional / priceNow;
      }
      if (qty * priceNow < 5) {
        return { skipped: true, reason: `Capital insuficiente: mínimo 5 USDT, disponible ${balance.free.toFixed(2)} USDT` };
      }
      const order = await broker.placeBinanceOrder({ symbol, side: 'BUY', quantity: qty });
      recordLiveTrade(state, asset, 'buy', order);
      return { order };
    }

    if (decision.action === 'sell') {
      const held = await broker.getBinanceBalance(symbol.replace(quoteAsset, ''));
      let qty = Number(decision.quantity) || held.free;
      qty = Math.min(qty, held.free);
      if (qty <= 0) return { skipped: true, reason: `No hay saldo de ${symbol} para vender` };
      const order = await broker.placeBinanceOrder({ symbol, side: 'SELL', quantity: qty });
      recordLiveTrade(state, asset, 'sell', order);
      return { order };
    }
  }

  if (asset.market === 'stocks') {
    const cash = await alpaca.getCash();
    if (decision.action === 'buy') {
      const notional = Math.min(Number(decision.notional) || 0, cash * cfg.liveMaxNotionalPct);
      const qty = Number(decision.quantity) || 0;
      const notionalByQty = qty * price;
      const finalNotional = Math.max(notional, notionalByQty > 0 ? Math.min(notionalByQty, cash * cfg.liveMaxNotionalPct) : 0);
      if (finalNotional < 1) {
        return { skipped: true, reason: `Notional menor que el mínimo de Alpaca (1 USD). Caja: ${cash.toFixed(2)} USD` };
      }
      const order = await broker.placeAlpacaOrder({ symbol: asset.symbol, side: 'buy', notional: finalNotional });
      recordLiveTrade(state, asset, 'buy', order);
      return { order };
    }

    if (decision.action === 'sell') {
      const held = await alpaca.getPositionQty(asset.symbol);
      let qty = Number(decision.quantity) || held;
      qty = Math.min(qty, held);
      if (qty <= 0) return { skipped: true, reason: `No hay posición de ${asset.symbol} para vender` };
      const order = await broker.placeAlpacaOrder({ symbol: asset.symbol, side: 'sell', notional: null });
      if (!order.orderId && order.raw?.id) {
        return { skipped: true, reason: 'No se pudo ejecutar la orden' };
      }
      return { order };
    }
  }

  return { skipped: true, reason: 'Acción no ejecutable (hold)' };
}

function recordLiveTrade(state, asset, action, order) {
  const trade = {
    id: `live-${order.orderId || `${Date.now()}-${Math.random().toString(36).slice(2, 7)}`}`,
    at: order.at || Date.now(),
    symbol: asset.symbol,
    market: asset.market,
    action,
    qty: order.executedQty,
    price: order.price,
    fee: 0,
    mode: 'live',
    brokerOrderId: order.orderId,
    status: order.status,
  };
  state.trades.push(trade);
}

async function runCycleForAsset(asset) {
  const cfg = getConfig();
  const state = getState();
  const series = await getSeries(asset.symbol, asset.market);
  const indicators = computeIndicators(series.rows);
  const assetData = { ...asset, currency: series.currency, indicators };

  const priceMap = {};
  priceMap[asset.symbol] = indicators.price;
  markPositions(cfg, state, priceMap);

  const portfolio = computePortfolio(cfg, state);
  const portfolioForAgents = {
    cfg,
    state: JSON.parse(JSON.stringify(state)),
    capitalTotal: portfolio.capitalTotal,
  };

  const analystReport = await agents.analyst(assetData);
  const strategistDecision = await agents.strategist({ assetData, analystReport, portfolio: portfolioForAgents });
  const auditorReport = await agents.auditor({ assetData, strategistDecision, portfolio: portfolioForAgents });

  const finalDecision = auditorReport.approval === false
    ? { action: auditorReport.adjustedAction || 'hold', quantity: auditorReport.adjustedQuantity || 0, reasoning: auditorReport.reasoning }
    : { action: strategistDecision.action, quantity: strategistDecision.quantity, reasoning: strategistDecision.reasoning };

  let trade = null;
  let execution = null;
  if (finalDecision.action !== 'hold') {
    if (state.mode === 'simulation') {
      trade = executeTrade(cfg, state, asset, indicators.price, finalDecision);
    } else {
      execution = await executeLive(cfg, state, asset, indicators.price, finalDecision);
      if (execution.order) trade = state.trades[state.trades.length - 1] || null;
    }
  }

  const cycle = {
    at: Date.now(),
    symbol: asset.symbol,
    market: asset.market,
    price: indicators.price,
    analyst: analystReport,
    strategist: strategistDecision,
    auditor: auditorReport,
    finalDecision,
    trade,
    execution,
  };
  state.cycles.push(cycle);
  if (state.cycles.length > 200) state.cycles = state.cycles.slice(-200);
  state.lastCycleAt = Date.now();
  saveState();
  return cycle;
}

export async function runCycle({ assets = null, quiet = false } = {}) {
  if (running) throw new Error('Ya hay un ciclo en ejecución');
  running = true;
  try {
    const cfg = getConfig();
    const list = assets || cfg.assets;
    const results = [];
    for (const asset of list) {
      try {
        const cycle = await runCycleForAsset(asset);
        results.push({ asset: asset.symbol, ok: true, cycle });
      } catch (e) {
        results.push({ asset: asset.symbol, ok: false, error: e.message });
        if (!quiet) console.error(`[invest] error ${asset.symbol}: ${e.message}`);
      }
    }
    saveState();
    return results;
  } finally {
    running = false;
  }
}

export async function cycleStatus() {
  return { running, lastCycleAt: getState().lastCycleAt };
}

export function resetPortfolio() {
  resetState();
  return getState();
}

let autoTimer = null;

export function startAutoCycle() {
  if (autoTimer) return;
  autoTimer = setInterval(async () => {
    const cfg = getConfig();
    if (!cfg.autoCycle || running) return;
    const state = getState();
    const minMs = (cfg.minCycleIntervalMinutes || 30) * 60 * 1000;
    if (state.lastCycleAt && Date.now() - state.lastCycleAt < minMs) return;
    console.log('[invest] ciclo automático iniciado');
    try {
      await runCycle({ quiet: true });
      console.log('[invest] ciclo automático completado');
    } catch (e) {
      console.error(`[invest] ciclo automático falló: ${e.message}`);
    }
  }, 60 * 1000);
}

export { MODELS };
