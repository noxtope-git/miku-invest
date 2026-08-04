// auth.js — Autenticación de administrador para proteger los datos y la consola.
// Usa un hash (scrypt) de la contraseña en config.json, sesiones por token
// (en memoria/cookie) y bloqueo temporal ante muchos intentos fallidos.
// Requiere traducción del usuario: la contraseña se establece mediante la
// variable de entorno MIKU_ADMIN_PASSWORD o por la ruta /api/auth/password.

import crypto from 'node:crypto';
import { getConfig, saveConfig } from './store.js';

const SESSION_TTL = 30 * 24 * 3600 * 1000; // 30 días
const MAX_ATTEMPTS = 5;
const LOCK_MS = 60 * 1000; // 60 s de bloqueo

function hashPassword(password, salt) {
  return crypto.scryptSync(String(password), salt, 64).toString('hex');
}

// Registra oega la contraseña desde la variable de entorno (una sola vez).
export function bootstrapAdmin() {
  const cfg = getConfig();
  const envPass = process.env.MIKU_ADMIN_PASSWORD;
  if (envPass && !cfg.authPasswordHash) {
    const salt = crypto.randomBytes(16).toString('hex');
    saveConfig({
      authEnabled: true,
      authSalt: salt,
      authPasswordHash: hashPassword(envPass, salt),
      authSessions: {},
      authLock: { count: 0, until: 0 },
    });
    return true; // activado con la contraseña del entorno
  }
  return false;
}

export function isAuthEnabled() {
  return !!getConfig().authEnabled && !!getConfig().authPasswordHash;
}

// Cata el token de la cookie o del header Authorization.
export function getToken(req) {
  const header = req.headers.authorization || '';
  if (header.startsWith('Bearer ')) return header.slice(7).trim();
  const raw = req.headers.cookie || '';
  const m = raw.match(/(?:^|;\s*)miku_session=([^;]+)/);
  return m ? decodeURIComponent(m[1]) : null;
}

export function isAuthenticated(req) {
  const token = getToken(req);
  if (!token) return false;
  const cfg = getConfig();
  const at = cfg.authSessions?.[token];
  if (!at) return false;
  if (Date.now() - at > SESSION_TTL) {
    const sessions = { ...cfg.authSessions };
    delete sessions[token];
    saveConfig({ authSessions: sessions });
    return false;
  }
  return true;
}

export function checkLoginLock() {
  const cfg = getConfig();
  const lock = cfg.authLock || {};
  if (lock.until && Date.now() < lock.until) {
    return { locked: true, seconds: Math.ceil((lock.until - Date.now()) / 1000) };
  }
  return { locked: false };
}

export function login(password) {
  const cfg = getConfig();
  const lock = checkLoginLock();
  if (lock.locked) return { ok: false, error: `Demasiados intentos. Intenta en ${lock.seconds}s.` };

  if (!cfg.authPasswordHash || !cfg.authSalt) return { ok: false, error: 'Autenticación no configurada.' };

  const expected = Buffer.from(cfg.authPasswordHash, 'hex');
  const received = Buffer.from(hashPassword(password, cfg.authSalt), 'hex');
  if (received.length !== expected.length || !crypto.timingSafeEqual(received, expected)) {
    const count = (cfg.authLock?.count || 0) + 1;
    const until = count >= MAX_ATTEMPTS ? Date.now() + LOCK_MS : 0;
    const reset = count >= MAX_ATTEMPTS ? 0 : count;
    saveConfig({ authLock: { count: reset, until } });
    return { ok: false, error: 'Contraseña incorrecta.' };
  }

  const token = crypto.randomBytes(32).toString('hex');
  const sessions = { ...(cfg.authSessions || {}), [token]: Date.now() };
  // poda de sesiones caducadas
  for (const [k, at] of Object.entries(sessions)) {
    if (Date.now() - at > SESSION_TTL) delete sessions[k];
  }
  saveConfig({ authSessions: sessions, authLock: { count: 0, until: 0 } });
  return { ok: true, token };
}

export function logout(req) {
  const token = getToken(req);
  if (!token) return false;
  const cfg = getConfig();
  if (cfg.authSessions?.[token]) {
    delete cfg.authSessions[token];
    saveConfig({ authSessions: cfg.authSessions });
    return true;
  }
  return false;
}

export function changePassword(current, next) {
  if (!isAuth()) return { ok: false, error: 'Autenticación no activa.' };
  const cfg = getConfig();
  const expected = Buffer.from(cfg.authPasswordHash, 'hex');
  const received = Buffer.from(hashPassword(current, cfg.authSalt), 'hex');
  if (received.length !== expected.length || !crypto.timingSafeEqual(received, expected)) {
    return { ok: false, error: 'Contraseña actual incorrecta.' };
  }
  const salt = crypto.randomBytes(16).toString('hex');
  saveConfig({ authSalt: salt, authPasswordHash: hashPassword(next, salt), authSessions: {} });
  return { ok: true };
}