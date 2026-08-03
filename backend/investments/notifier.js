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
