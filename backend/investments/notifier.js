// notifier.js — Envío de alertas por correo (SMTP Gmail) usando nodemailer.
// Usa una "contraseña de aplicación" de Gmail (cuenta con verificación en 2 pasos).
// Las credenciales y el correo destino se guardan en la configuración (mailConfig).

import nodemailer from 'nodemailer';
import { getConfig } from './store.js';

let transporter = null;

function mailConfig() {
  const cfg = getConfig();
  return cfg.mailConfig || {};
}

export function isMailConfigured() {
  const mc = mailConfig();
  return !!(mc.smtpUser && mc.smtpPass && mc.fromEmail);
}

function buildTransporter() {
  const mc = mailConfig();
  if (!isMailConfigured()) return null;
  if (transporter && transporter._configUser === mc.smtpUser) return transporter;
  transporter = nodemailer.createTransport({
    host: mc.smtpHost || 'smtp.gmail.com',
    port: Number(mc.smtpPort || 465),
    secure: mc.smtpPort == null || Number(mc.smtpPort) === 465,
    auth: { user: mc.smtpUser, pass: mc.smtpPass },
  });
  transporter._configUser = mc.smtpUser;
  return transporter;
}

// Envía un correo de alerta. to por defecto = correo destino configurado.
export async function sendAlert({ subject, html, text, to = null }) {
  const mc = mailConfig();
  const t = buildTransporter();
  if (!t) throw new Error('Correo no configurado (mailConfig en la configuración)');
  const dest = to || mc.destEmail;
  if (!dest) throw new Error('No hay correo destino configurado (mailConfig.destEmail)');
  await t.sendMail({
    from: mc.fromEmail,
    to: dest,
    subject,
    text: text || html?.replace(/<[^>]+>/g, ' '),
    html,
  });
  return { ok: true, to: dest };
}

// Alerta de retiro: se llama cuando hay ganancias realizadas que conviene retirar.
export function buildWithdrawalEmail({ stats }) {
  const lines = [
    `Capital total: $${stats.capitalTotal.toFixed(2)}`,
    `Ganancia total: $${stats.profit.toFixed(2)} (${stats.profitPct.toFixed(2)}%)`,
    `Ganancias realizadas (retirables): $${stats.realizedProfit.toFixed(2)}`,
    `Pendiente no realizado: $${stats.unrealized.toFixed(2)}`,
  ];
  return {
    subject: '🟢 Miku Invest: momento de retirar ganancias',
    html: `<h2>Miku Invest — Alerta de retiro</h2>
<p>El sistema detectó ganancias realizadas suficientes para retirar.</p>
<ul>${lines.map((l) => `<li>${l}</li>`).join('')}</ul>
<p><strong>Acción:</strong> retira desde la plataforma del broker (Binance o Alpaca). El sistema no ejecuta retiros.</p>
<p style="color:#888;font-size:12px">Enviado automáticamente por Miku Invest · este correo no es asesoría financiera.</p>`,
    text: `Miku Invest — Alerta de retiro\n\n${lines.join('\n')}\n\nAcción: retira desde la plataforma del broker.`,
  };
}

// Alerta de error crítico del sistema (p. ej. broker caído).
export function buildErrorEmail({ message }) {
  return {
    subject: '⚠️ Miku Invest: error del sistema',
    html: `<h2>Miku Invest — Error</h2><p>${message}</p>`,
    text: `Miku Invest — Error\n\n${message}`,
  };
}

// Resumen del período de simulación (se envía al cumplirse simReviewDays).
export function buildSimReviewEmail({ stats, state, cfg }) {
  const buys = state.trades.filter((t) => t.action === 'buy').length;
  const sells = state.trades.filter((t) => t.action === 'sell').length;
  const holds = state.cycles.filter((c) => c.finalDecision?.action === 'hold').length;
  const decisions = state.cycles.filter((c) => c.finalDecision?.action && c.finalDecision.action !== 'hold').length;
  const avgConf = state.cycles.length
    ? Math.round(state.cycles.reduce((s, c) => s + (c.analyst?.confidence || 0), 0) / state.cycles.length)
    : 0;
  const lines = [
    `Período: ${simReviewDaysLabel(cfg.simReviewDays)} · Capital inicial: $${(cfg.initialCash || 0).toFixed(2)}`,
    `Capital total final: $${stats.capitalTotal.toFixed(2)}`,
    `Ganancia total: $${stats.profit.toFixed(2)} (${stats.profitPct.toFixed(2)}%)`,
    `Ganancia realizada: $${stats.realizedProfit.toFixed(2)} · No realizada: $${stats.unrealized.toFixed(2)}`,
    `Operaciones: ${buys} compras · ${sells} ventas · ${decisions} decisiones activas (${holds} holds)`,
    `Ciclos analizados: ${state.cycles.length} · confianza media del analista: ${avgConf}%`,
  ];
  const lastTrades = state.trades.slice(-5).map((t) => `${t.symbol} ${t.action === 'buy' ? 'COMPRA' : 'VENTA'} ${t.qty} @ $${Number(t.price).toFixed(2)}`).join(' · ');
  return {
    subject: `📊 Miku Invest: revisión de simulación lista (${stats.profitPct >= 0 ? '+' : ''}${stats.profitPct.toFixed(2)}%)`,
    html: `<h2>Miku Invest — Revisión del período de simulación</h2>
<p>Se cumplieron los <strong>${simReviewDaysLabel(cfg.simReviewDays)}</strong> de simulación. Resumen:</p>
<ul>${lines.map((l) => `<li>${l}</li>`).join('')}</ul>
${lastTrades ? `<p><strong>Últimas operaciones:</strong> ${lastTrades}</p>` : '<p>No hubo operaciones ejecutadas en el período.</p>'}
<p><strong>Siguiente paso sugerido:</strong> revisa este resumen en la web de Miku, valida que las decisiones hayan sido lógicas y decide si pasas a modo real (la web tiene el botón). En modo real el sistema ejecuta órdenes con fondos reales: pruébalo con una cifra pequeña.</p>
<p style="color:#888;font-size:12px">Enviado automáticamente por Miku Invest · este correo no es asesoría financiera.</p>`,
    text: `Miku Invest — Revisión del período de simulación\n\n${lines.join('\n')}\n\n${lastTrades ? `Últimas operaciones: ${lastTrades}\n\n` : ''}Revisa el resumen en la web de Miku y decide si pasas a modo real.`,
  };
}

function simReviewDaysLabel(days) {
  return days === 1 ? '1 día' : `${days || 14} días`;
}
