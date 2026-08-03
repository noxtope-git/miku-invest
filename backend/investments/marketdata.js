// marketdata.js — Obtiene datos reales de mercado (Yahoo Finance + Binance)
// y calcula indicadores técnicos básicos (medias, RSI, MACD, soporte/resistencia).

const UA = { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64)' };

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function yahooChart(symbol, range = '3mo', interval = '1d') {
  const url = `https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(symbol)}?range=${range}&interval=${interval}`;
  const r = await fetch(url, { headers: UA, signal: AbortSignal.timeout(20000) });
  if (!r.ok) throw new Error(`Yahoo ${symbol}: HTTP ${r.status}`);
  const data = await r.json();
  const res = data?.chart?.result?.[0];
  if (!res) throw new Error(`Yahoo ${symbol}: sin datos`);
  const ts = res.timestamp || [];
  const q = res.indicators?.quote?.[0] || {};
  const rows = [];
  for (let i = 0; i < ts.length; i++) {
    const o = q.open?.[i], h = q.high?.[i], l = q.low?.[i], c = q.close?.[i], v = q.volume?.[i];
    if (c == null || h == null || l == null) continue;
    rows.push({ t: ts[i] * 1000, o, h, l, c, v: v || 0 });
  }
  return { symbol, market: 'stocks', currency: res.meta?.currency || 'USD', rows, meta: res.meta };
}

async function binanceKlines(symbol, interval = '1d', limit = 90) {
  const url = `https://api.binance.com/api/v3/klines?symbol=${encodeURIComponent(symbol)}&interval=${interval}&limit=${limit}`;
  const r = await fetch(url, { signal: AbortSignal.timeout(20000) });
  if (!r.ok) throw new Error(`Binance ${symbol}: HTTP ${r.status}`);
  const k = await r.json();
  const rows = k.map((x) => ({ t: x[0], o: +x[1], h: +x[2], l: +x[3], c: +x[4], v: +x[5] }));
  return { symbol, market: 'crypto', currency: 'USDT', rows };
}

export async function getSeries(asset, market) {
  if (market === 'crypto') return binanceKlines(asset);
  return yahooChart(asset);
}

function sma(values, period) {
  const out = [];
  for (let i = 0; i < values.length; i++) {
    if (i < period - 1) { out.push(null); continue; }
    let s = 0;
    for (let j = i - period + 1; j <= i; j++) s += values[j];
    out.push(s / period);
  }
  return out;
}

function rsi(values, period = 14) {
  const out = new Array(values.length).fill(null);
  if (values.length <= period) return out;
  let gain = 0, loss = 0;
  for (let i = 1; i <= period; i++) {
    const d = values[i] - values[i - 1];
    if (d >= 0) gain += d; else loss -= d;
  }
  let avgG = gain / period, avgL = loss / period;
  out[period] = avgL === 0 ? 100 : 100 - 100 / (1 + avgG / avgL);
  for (let i = period + 1; i < values.length; i++) {
    const d = values[i] - values[i - 1];
    gain = d > 0 ? d : 0;
    loss = d < 0 ? -d : 0;
    avgG = (avgG * (period - 1) + gain) / period;
    avgL = (avgL * (period - 1) + loss) / period;
    out[i] = avgL === 0 ? 100 : 100 - 100 / (1 + avgG / avgL);
  }
  return out;
}

function macd(values, fast = 12, slow = 26, signal = 9) {
  const emaFast = ema(values, fast);
  const emaSlow = ema(values, slow);
  const line = values.map((_, i) => (emaFast[i] == null || emaSlow[i] == null ? null : emaFast[i] - emaSlow[i]));
  const valid = line.filter((x) => x != null);
  const sigAll = ema(valid, signal);
  const signalLine = line.map((x, i) => {
    if (x == null) return null;
    const idx = line.slice(0, i + 1).filter((y) => y != null).length - 1;
    return sigAll[idx] ?? null;
  });
  const hist = line.map((x, i) => (x == null || signalLine[i] == null ? null : x - signalLine[i]));
  return { line, signal: signalLine, hist };
}

function ema(values, period) {
  const out = new Array(values.length).fill(null);
  if (values.length < period) return out;
  const k = 2 / (period + 1);
  let s = 0;
  for (let i = 0; i < period; i++) s += values[i];
  let prev = s / period;
  out[period - 1] = prev;
  for (let i = period; i < values.length; i++) {
    prev = values[i] * k + prev * (1 - k);
    out[i] = prev;
  }
  return out;
}

export function computeIndicators(rows) {
  const closes = rows.map((r) => r.c);
  const highs = rows.map((r) => r.h);
  const lows = rows.map((r) => r.l);
  const volumes = rows.map((r) => r.v);
  const n = closes.length;
  const last = n - 1;

  const sma20 = sma(closes, 20);
  const sma50 = sma(closes, 50);
  const rsi14 = rsi(closes, 14);
  const macdX = macd(closes);

  const max20 = Math.max(...highs.slice(-20));
  const min20 = Math.min(...lows.slice(-20));
  const volAvg = volumes.slice(-20).reduce((a, b) => a + b, 0) / 20;

  return {
    price: closes[last],
    change1d: n > 1 ? ((closes[last] - closes[last - 1]) / closes[last - 1]) * 100 : 0,
    change5d: n > 5 ? ((closes[last] - closes[last - 6]) / closes[last - 6]) * 100 : 0,
    change1m: n > 21 ? ((closes[last] - closes[last - 22]) / closes[last - 22]) * 100 : 0,
    sma20: sma20[last],
    sma50: sma50[last],
    rsi14: rsi14[last],
    macd: macdX.line[last],
    macdSignal: macdX.signal[last],
    macdHist: macdX.hist[last],
    support20: min20,
    resistance20: max20,
    volAvg20: volAvg,
    volLast: volumes[last],
    lastTrades: rows.slice(-10).map((r) => ({
      t: r.t,
      o: r.o, h: r.h, l: r.l, c: r.c, v: r.v,
    })),
  };
}

export function extractJson(text) {
  const cleaned = text.replace(/```json/gi, '').replace(/```/g, '').trim();
  const start = cleaned.indexOf('{');
  const end = cleaned.lastIndexOf('}');
  if (start === -1 || end === -1 || end <= start) return null;
  try {
    return JSON.parse(cleaned.slice(start, end + 1));
  } catch {
    const tryStart = cleaned.indexOf('[');
    const tryEnd = cleaned.lastIndexOf(']');
    if (tryStart === -1 || tryEnd <= tryStart) return null;
    try { return JSON.parse(cleaned.slice(tryStart, tryEnd + 1)); } catch { return null; }
  }
}

export { sleep };
