// live.js — Emisor de eventos en tiempo real (SSE) para ver la actividad de la IA en vivo.

const listeners = [];

export function subscribeLive(fn) {
  listeners.push(fn);
  return () => {
    const i = listeners.indexOf(fn);
    if (i >= 0) listeners.splice(i, 1);
  };
}

export function emitLive(event, data) {
  for (const fn of listeners) {
    try {
      fn(event, data);
    } catch {
      // un listener que falla no debe romper a los demás
    }
  }
}