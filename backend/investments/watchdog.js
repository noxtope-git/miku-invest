// watchdog.js — Vigila los servicios externos (Ollama) y los reinicia si caen.
// Objetivo: que el sistema funcione de forma independiente (sin intervención manual).

import { spawn } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { listModels } from './llm.js';

const OLLAMA_URL = process.env.OLLAMA_URL || 'http://127.0.0.1:11434';

// Posibles rutas del ejecutable de Ollama.
function ollamaCandidates() {
  const home = os.homedir();
  return [
    process.env.OLLAMA_BIN,
    path.join(home, 'AppData', 'Local', 'Ollama', 'ollama.exe'),
    'C:\\Program Files\\Ollama\\ollama.exe',
  ].filter(Boolean);
}

let checkInterval = null;
let ollamaUp = false;
let lastCheck = 0;

async function pingOllama() {
  try {
    const r = await fetch(`${OLLAMA_URL}/api/tags`, { signal: AbortSignal.timeout(5000) });
    return r.ok;
  } catch {
    return false;
  }
}

function launchOllama() {
  const bin = ollamaCandidates().find((p) => p && fs.existsSync(p));
  if (!bin) return false;
  console.log(`[watchdog] iniciando Ollama: ${bin}`);
  try {
    const child = spawn(bin, ['serve'], { detached: true, stdio: 'ignore' });
    child.unref();
    return true;
  } catch (e) {
    console.error(`[watchdog] no se pudo iniciar Ollama: ${e.message}`);
    return false;
  }
}

export function getWatchdogStatus() {
  return { ollamaUp, lastCheck, models: null };
}

// Intenta dejar Ollama arriba (esperando hasta timeoutMs).
export async function ensureOllama(timeoutMs = 60000) {
  if (await pingOllama()) {
    ollamaUp = true;
    return { ok: true };
  }
  const launched = launchOllama();
  const waited = 0;
  const step = 2000;
  while (waited < timeoutMs) {
    await new Promise((r) => setTimeout(r, step));
    if (await pingOllama()) {
      ollamaUp = true;
      console.log('[watchdog] Ollama respondiendo de nuevo');
      return { ok: true, launched };
    }
  }
  ollamaUp = false;
  return { ok: false, launched, error: 'Ollama no respondió tras el intento de reinicio' };
}

// Comprueba cada N ms y reinicia Ollama si hace falta.
export function startWatchdog(intervalMs = 60000) {
  if (checkInterval) return;
  checkInterval = setInterval(async () => {
    lastCheck = Date.now();
    const up = await pingOllama();
    ollamaUp = up;
    if (!up) {
      console.warn('[watchdog] Ollama no responde; intentando reiniciar…');
      await ensureOllama(30000);
    }
  }, intervalMs);
  ensureOllama(45000).then((res) => {
    if (!res.ok) console.warn(`[watchdog] ${res.error}`);
  });
}
