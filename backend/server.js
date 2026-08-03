import express from 'express';
import cors from 'cors';
import path from 'node:path';
import fs from 'node:fs';

import {
  runCycle,
  cycleStatus,
  portfolioSnapshot,
  resetPortfolio,
  startAutoCycle,
  MODELS,
  maybeSendWithdrawalAlert,
} from './investments/orchestrator.js';
import { getConfig, saveConfig } from './investments/store.js';
import * as broker from './investments/broker.js';
import { sendAlert, buildErrorEmail, isMailConfigured } from './investments/notifier.js';
import { startWatchdog, getWatchdogStatus } from './investments/watchdog.js';

const app = express();
const PORT = process.env.PORT || 4000;

const OLLAMA_URL = process.env.OLLAMA_URL || 'http://127.0.0.1:11434';
const OPENCODE_URL = process.env.OPENCODE_URL || 'http://127.0.0.1:37999';
const OPENCODE_PASS = process.env.OPENCODE_PASS || '5d81c5f2-2880-461c-90a2-6034bb158ee3';
const OPENCODE_USER = process.env.OPENCODE_USER || 'opencode';

app.use(cors());
app.use(express.json({ limit: '50mb' }));

const FRONTEND_DIST = path.join(import.meta.dirname, '..', 'frontend', 'dist');
if (fs.existsSync(FRONTEND_DIST)) {
  app.use(express.static(FRONTEND_DIST));
}

function opencodeHeaders() {
  const b64 = Buffer.from(`${OPENCODE_USER}:${OPENCODE_PASS}`).toString('base64');
  return { Authorization: `Basic ${b64}`, 'Content-Type': 'application/json' };
}

app.get('/api/health', async (req, res) => {
  const status = { ollama: 'down', opencode: 'down', watchdog: getWatchdogStatus() };
  try {
    const r = await fetch(`${OLLAMA_URL}/api/version`, { signal: AbortSignal.timeout(3000) });
    status.ollama = r.ok ? 'up' : 'down';
  } catch { status.ollama = 'down'; }
  try {
    const r = await fetch(`${OPENCODE_URL}/global/health`, { headers: opencodeHeaders(), signal: AbortSignal.timeout(3000) });
    status.opencode = r.ok ? 'up' : 'down';
  } catch { status.opencode = 'down'; }
  res.json(status);
});

app.get('/api/models', async (req, res) => {
  const models = [];
  try {
    const r = await fetch(`${OLLAMA_URL}/api/tags`, { signal: AbortSignal.timeout(5000) });
    const data = await r.json();
    for (const m of data.models || []) {
      models.push({ id: m.name, name: m.name, engine: 'ollama', size: m.size, detail: m.details });
    }
  } catch (e) { models.push({ id: '__ollama_error__', name: 'Ollama no disponible', engine: 'ollama', error: e.message }); }
  res.json({ models });
});

app.get('/api/opencode/sessions', async (req, res) => {
  try {
    const r = await fetch(`${OPENCODE_URL}/session`, { headers: opencodeHeaders(), signal: AbortSignal.timeout(5000) });
    const data = await r.json();
    res.json(data || []);
  } catch (e) {
    res.status(502).json({ error: `No se pudo conectar con opencode: ${e.message}` });
  }
});

app.get('/api/opencode/models', async (req, res) => {
  try {
    const r = await fetch(`${OPENCODE_URL}/api/model`, { headers: opencodeHeaders(), signal: AbortSignal.timeout(10000) });
    const data = await r.json();
    const models = (data?.data || [])
      .filter((m) => m.providerID === 'opencode' || m.providerID === 'openrouter')
      .map((m) => ({
        id: m.id,
        providerID: m.providerID,
        label: m.id,
        variants: (m.variants || []).map((v) => v.id),
        capabilities: m.capabilities,
      }));
    res.json({ models });
  } catch (e) {
    res.status(502).json({ error: e.message });
  }
});

app.post('/api/opencode/model', async (req, res) => {
  const { sessionID, modelID, providerID, variant } = req.body || {};
  if (!sessionID || !modelID) return res.status(400).json({ error: 'sessionID y modelID son requeridos' });
  try {
    const body = {
      model: { id: modelID, providerID: providerID || 'opencode' },
    };
    if (variant) body.model.variant = variant;
    const r = await fetch(`${OPENCODE_URL}/api/session/${sessionID}/model`, {
      method: 'POST',
      headers: opencodeHeaders(),
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(10000),
    });
    if (!r.ok) {
      const t = await r.text();
      return res.status(r.status).json({ error: t });
    }
    res.json({ ok: true, modelID, providerID: providerID || 'opencode', variant });
  } catch (e) {
    res.status(502).json({ error: e.message });
  }
});

app.post('/api/opencode/session', async (req, res) => {
  const { title, parentID } = req.body || {};
  try {
    const r = await fetch(`${OPENCODE_URL}/session`, {
      method: 'POST',
      headers: opencodeHeaders(),
      body: JSON.stringify({ title, parentID }),
      signal: AbortSignal.timeout(5000),
    });
    res.json(await r.json());
  } catch (e) {
    res.status(502).json({ error: e.message });
  }
});

app.post('/api/opencode/message', async (req, res) => {
  const { sessionID, text, model, agent, modelID, providerID, variant } = req.body || {};
  if (!sessionID || !text) return res.status(400).json({ error: 'sessionID y text son requeridos' });
  try {
    const body = {
      parts: [{ type: 'text', text }],
      noReply: false,
    };
    if (model) body.model = model;
    if (agent) body.agent = agent;
    if (modelID || variant || providerID) {
      body.model = { id: modelID || 'deepseek-v4-flash-free', providerID: providerID || 'opencode' };
      if (variant) body.model.variant = variant;
    }
    const r = await fetch(`${OPENCODE_URL}/session/${sessionID}/message`, {
      method: 'POST',
      headers: opencodeHeaders(),
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(600000),
    });
    if (!r.ok) {
      const t = await r.text();
      return res.status(r.status).json({ error: t });
    }
    const data = await r.json();
    const textParts = (data.parts || []).filter((p) => p.type === 'text' && p.text).map((p) => p.text);
    const reasoningParts = (data.parts || []).filter((p) => p.type === 'reasoning' && p.text).map((p) => p.text);
    res.json({ text: textParts.join('\n'), reasoning: reasoningParts.join('\n'), sessionID, info: data.info });
  } catch (e) {
    res.status(502).json({ error: e.message });
  }
});

app.get('/api/opencode/messages', async (req, res) => {
  const { sessionID, limit } = req.query;
  if (!sessionID) return res.status(400).json({ error: 'sessionID es requerido' });
  try {
    const url = `${OPENCODE_URL}/session/${sessionID}/message${limit ? `?limit=${limit}` : ''}`;
    const r = await fetch(url, { headers: opencodeHeaders(), signal: AbortSignal.timeout(5000) });
    const data = await r.json();
    const messages = (data || []).map((m) => ({
      role: m.info?.role || 'unknown',
      time: m.info?.time?.created,
      text: (m.parts || []).filter((p) => p.type === 'text' && p.text).map((p) => p.text).join('\n'),
    }));
    res.json(messages);
  } catch (e) {
    res.status(502).json({ error: e.message });
  }
});

app.post('/api/chat', async (req, res) => {
  const { engine, model, messages, sessionID, opencodeModel, agent, modelID, providerID, variant } = req.body || {};
  if (engine === 'opencode') {
    const text = messages?.[messages.length - 1]?.content || '';
    try {
      const body = { sessionID, text, model: opencodeModel, agent, modelID, providerID, variant };
      const r = await fetch(`http://127.0.0.1:${PORT}/api/opencode/message`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });
      const data = await r.json();
      if (!r.ok) return res.status(r.status).json(data);
      res.json({ role: 'assistant', content: data.text, engine: 'opencode' });
    } catch (e) {
      res.status(502).json({ error: e.message });
    }
  } else {
    try {
      const body = {
        model: model || 'gemma4:12b',
        messages,
        stream: false,
      };
      const r = await fetch(`${OLLAMA_URL}/api/chat`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
        signal: AbortSignal.timeout(600000),
      });
      const data = await r.json();
      res.json({ role: 'assistant', content: data.message?.content || '', engine: 'ollama' });
    } catch (e) {
      res.status(502).json({ error: e.message });
    }
  }
});

app.post('/api/invest/cycle', async (req, res) => {
  const { assets } = req.body || {};
  try {
    const results = await runCycle({ assets });
    res.json({ results });
  } catch (e) {
    res.status(502).json({ error: e.message });
  }
});

app.get('/api/invest/status', async (req, res) => {
  try {
    const status = await cycleStatus();
    const portfolio = portfolioSnapshot();
    res.json({ ...status, portfolio });
  } catch (e) {
    res.status(502).json({ error: e.message });
  }
});

app.get('/api/invest/config', (req, res) => {
  const cfg = getConfig();
  const lk = cfg.liveKeys || {};
  const mc = cfg.mailConfig || {};
  const masked = {
    ...cfg,
    liveKeys: {
      apiKey: lk.apiKey ? '****' : '',
      apiSecret: lk.apiSecret ? '****' : '',
      alpacaKey: lk.alpacaKey ? '****' : '',
      alpacaSecret: lk.alpacaSecret ? '****' : '',
      alpacaLive: !!lk.alpacaLive,
    },
    mailConfig: {
      smtpHost: mc.smtpHost,
      smtpPort: mc.smtpPort,
      smtpUser: mc.smtpUser,
      smtpPass: mc.smtpPass ? '****' : '',
      fromEmail: mc.fromEmail,
      destEmail: mc.destEmail,
    },
    mailConfigured: isMailConfigured(),
  };
  res.json(masked);
});

app.post('/api/invest/config', (req, res) => {
  const patch = req.body || {};
  const cfg = saveConfig(patch);
  const mc = cfg.mailConfig || {};
  res.json({
    ok: true,
    ...cfg,
    mailConfig: {
      smtpHost: mc.smtpHost,
      smtpPort: mc.smtpPort,
      smtpUser: mc.smtpUser,
      smtpPass: mc.smtpPass ? '****' : '',
      fromEmail: mc.fromEmail,
      destEmail: mc.destEmail,
    },
    mailConfigured: isMailConfigured(),
  });
});

// Guarda la configuración de correo para las alertas de retiro.
app.post('/api/invest/mail/config', (req, res) => {
  const { smtpHost, smtpPort, smtpUser, smtpPass, fromEmail, destEmail, mailNotifyWithdrawal, minWithdrawalProfit, withdrawalAlertCooldownH } = req.body || {};
  const patch = { mailConfig: { ...(getConfig().mailConfig || {}) } };
  if (smtpHost != null) patch.mailConfig.smtpHost = smtpHost.trim();
  if (smtpPort != null) patch.mailConfig.smtpPort = Number(smtpPort);
  if (smtpUser != null) patch.mailConfig.smtpUser = smtpUser.trim();
  if (smtpPass != null && smtpPass !== '****') patch.mailConfig.smtpPass = smtpPass.trim();
  if (fromEmail != null) patch.mailConfig.fromEmail = fromEmail.trim();
  if (destEmail != null) patch.mailConfig.destEmail = destEmail.trim();
  if (mailNotifyWithdrawal != null) patch.mailNotifyWithdrawal = !!mailNotifyWithdrawal;
  if (minWithdrawalProfit != null) patch.minWithdrawalProfit = Number(minWithdrawalProfit);
  if (withdrawalAlertCooldownH != null) patch.withdrawalAlertCooldownH = Number(withdrawalAlertCooldownH);
  const cfg = saveConfig(patch);
  res.json({ ok: true, mailConfigured: isMailConfigured(), mailConfig: cfg.mailConfig, mailNotifyWithdrawal: cfg.mailNotifyWithdrawal });
});

// Envía un correo de prueba para validar la configuración.
app.post('/api/invest/mail/test', async (req, res) => {
  try {
    const result = await sendAlert({
      subject: '✅ Miku Invest: correo de prueba',
      html: '<h2>Miku Invest</h2><p>Si recibes este correo, las alertas de retiro funcionarán automáticamente.</p>',
      text: 'Miku Invest — correo de prueba. Las alertas de retiro funcionarán automáticamente.',
    });
    res.json({ ok: true, ...result });
  } catch (e) {
    res.status(502).json({ error: e.message });
  }
});

// Alerta de retiro: dispara una revisión manual del estado (para probar sin esperar al ciclo).
app.post('/api/invest/mail/withdrawal-alert', async (req, res) => {
  try {
    const result = await maybeSendWithdrawalAlert();
    res.json({ ok: true, result });
  } catch (e) {
    res.status(502).json({ error: e.message });
  }
});

app.post('/api/invest/reset', (req, res) => {
  const state = resetPortfolio();
  res.json({ ok: true, state });
});

app.get('/api/invest/broker/status', (req, res) => {
  res.json({
    binance: broker.hasLiveKeys('crypto'),
    alpaca: broker.hasLiveKeys('stocks'),
    mode: getConfig().mode,
  });
});

app.post('/api/invest/broker/keys', (req, res) => {
  const { apiKey, apiSecret, alpacaKey, alpacaSecret, alpacaLive } = req.body || {};
  const patch = { liveKeys: { ...(getConfig().liveKeys || {}) } };
  if (apiKey != null) patch.liveKeys.apiKey = apiKey.trim();
  if (apiSecret != null) patch.liveKeys.apiSecret = apiSecret.trim();
  if (alpacaKey != null) patch.liveKeys.alpacaKey = alpacaKey.trim();
  if (alpacaSecret != null) patch.liveKeys.alpacaSecret = alpacaSecret.trim();
  if (alpacaLive != null) patch.liveKeys.alpacaLive = !!alpacaLive;
  const cfg = saveConfig(patch);
  res.json({
    ok: true,
    binance: broker.hasLiveKeys('crypto'),
    alpaca: broker.hasLiveKeys('stocks'),
  });
});

app.post('/api/invest/broker/test', async (req, res) => {
  const { market } = req.body || {};
  try {
    const result = await broker.testConnection(market || null);
    res.json(result);
  } catch (e) {
    res.status(502).json({ error: e.message });
  }
});

app.get('*', (req, res, next) => {
  if (req.path.startsWith('/api')) return next();
  const idx = path.join(FRONTEND_DIST, 'index.html');
  if (fs.existsSync(idx)) return res.sendFile(idx);
  next();
});

app.listen(PORT, () => {
  console.log(`Miku backend escuchando en http://localhost:${PORT}`);
  startAutoCycle();
  startWatchdog(60000);
});
