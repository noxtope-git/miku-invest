import { useState, useEffect, useCallback } from 'react';

const fmtMoney = (n) => (n == null ? '—' : Number(n).toLocaleString('es-ES', { minimumFractionDigits: 2, maximumFractionDigits: 2 }));
const fmtDate = (ts) => (ts ? new Date(ts).toLocaleString('es-ES') : '—');
const fmtPct = (n) => (n == null ? '—' : `${Number(n).toFixed(2)}%`);

const ACTION_LABEL = { buy: 'COMPRAR', sell: 'VENDER', hold: 'MANTENER' };
const ACTION_COLOR = { buy: 'var(--miku-green)', sell: 'var(--miku-pink)', hold: 'var(--miku-text-dim)' };

export default function InvestPanel() {
  const [status, setStatus] = useState(null);
  const [config, setConfig] = useState(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [selectedCycle, setSelectedCycle] = useState(null);
  const [broker, setBroker] = useState(null);
  const [apiKey, setApiKey] = useState('');
  const [apiSecret, setApiSecret] = useState('');
  const [alpacaKey, setAlpacaKey] = useState('');
  const [alpacaSecret, setAlpacaSecret] = useState('');
  const [alpacaLive, setAlpacaLive] = useState(false);
  const [brokerTesting, setBrokerTesting] = useState(false);
  const [brokerTestResult, setBrokerTestResult] = useState(null);
  const [showKeys, setShowKeys] = useState(false);
  const [mailForm, setMailForm] = useState({ smtpUser: '', smtpPass: '', destEmail: '', minWithdrawalProfit: 10, cooldown: 24 });
  const [showMail, setShowMail] = useState(false);
  const [mailSaving, setMailSaving] = useState(false);
  const [mailTesting, setMailTesting] = useState(false);
  const [mailMsg, setMailMsg] = useState(null);
  const [simReview, setSimReview] = useState({ enabled: false, days: 14, startedAt: 0, sentAt: 0 });
  const [simSaving, setSimSaving] = useState(false);
  const [simMsg, setSimMsg] = useState(null);
  const [liveFeed, setLiveFeed] = useState([]);
  const [liveConnected, setLiveConnected] = useState(false);
  const [learn, setLearn] = useState(null);
  const [learning, setLearning] = useState(false);

  const appendFeed = useCallback((kind, title, body, meta) => {
    setLiveFeed((f) => [{ id: `${Date.now()}-${Math.random().toString(36).slice(2, 6)}`, kind, title, body, meta, ts: Date.now() }, ...f].slice(0, 15));
  }, []);

  useEffect(() => {
    if (!window.EventSource) return undefined;
    const es = new EventSource('/api/invest/events');
    es.onopen = () => setLiveConnected(true);
    es.onerror = () => setLiveConnected(false);
    const onEvent = (evtName, kind, titleFn, bodyFn) => es.addEventListener(evtName, (e) => {
      const d = JSON.parse(e.data);
      appendFeed(kind, titleFn(d), bodyFn(d), d);
    });
    onEvent('stage', 'stage', (d) => `${d.symbol} · ${(d.stage || '').toUpperCase()}`,
      (d) => (d.data?.summary || d.data?.reasoning || JSON.stringify(d.data || {}).slice(0, 120)));
    onEvent('decision', 'decision', (d) => `${d.symbol} · DECISIÓN ${ACTION_LABEL[d.decision?.action] || d.decision?.action}`,
      () => (d.decision?.reasoning || ''));
    onEvent('trade', 'trade', (d) => `${d.symbol} · OPERACIÓN ejecutada`,
      (d) => `${ACTION_LABEL[d.trade?.action]} ${d.trade?.qty} @ ${fmtMoney(d.trade?.price)} · comisión ${fmtMoney(d.trade?.fee)}`);
    onEvent('skipped', 'skipped', (d) => `${d.symbol} · Sin orden`,
      () => (d.reason || ''));
    onEvent('cycle-done', 'done', (d) => `${d.symbol} · CICLO COMPLETADO`, () => 'Evaluación del activo finalizada.');
    onEvent('cycle-error', 'error', (d) => `${d.symbol} · ERROR`, () => (d.error || ''));
    es.addEventListener('learn', (e) => { const d = JSON.parse(e.data); appendFeed('learn', '🧠 IA APRENDIÓ', `${d.stats?.tradesEvaluated ?? '—'} ops evaluadas · acierto ${d.stats?.winRate != null ? `${d.stats.winRate}%` : '—'}`, (d.summary || `Nuevas lecciones: ${(d.lessons || []).length}`)); });
    es.addEventListener('system', (e) => { const d = JSON.parse(e.data); appendFeed('sys', 'SISTEMA', d.message || ''); });
    return () => { es.close(); setLiveConnected(false); };
  }, [appendFeed]);

  const refresh = useCallback(async () => {
    try {
      const [s, c, b] = await Promise.all([
        fetch('/api/invest/status').then((r) => r.json()),
        fetch('/api/invest/config').then((r) => r.json()),
        fetch('/api/invest/broker/status').then((r) => r.json()),
      ]);
      setStatus(s);
      setConfig(c);
      setBroker(b);
      fetch('/api/invest/learn').then((r) => r.json()).then((d) => setLearn(d.ok ? d : null)).catch(() => {});
      const mc = c?.mailConfig || {};
      setMailForm((f) => ({
        ...f,
        smtpUser: mc.smtpUser || f.smtpUser,
        smtpPass: mc.smtpPass ? (f.smtpPass === '' ? '' : f.smtpPass) : f.smtpPass,
        destEmail: mc.destEmail || f.destEmail,
        minWithdrawalProfit: c?.minWithdrawalProfit ?? f.minWithdrawalProfit,
        cooldown: c?.withdrawalAlertCooldownH ?? f.cooldown,
      }));
      setSimReview((s) => ({ enabled: !!c?.simReviewEnabled, days: c?.simReviewDays ?? s.days, startedAt: c?.simReviewStartedAt || 0, sentAt: c?.simReviewSentAt || 0 }));
      if (c?.assets?.length && !selectedCycle) setSelectedCycle(null);
    } catch (e) {
      setError(e.message);
    }
  }, [selectedCycle]);

  useEffect(() => {
    refresh();
    const iv = setInterval(refresh, 30000);
    return () => clearInterval(iv);
  }, [refresh]);

  const runCycle = async () => {
    setLoading(true);
    setError('');
    try {
      const r = await fetch('/api/invest/cycle', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({}) });
      const d = await r.json();
      if (d.error) throw new Error(d.error);
      await refresh();
    } catch (e) {
      setError(e.message);
    } finally {
      setLoading(false);
    }
  };

  const reset = async () => {
    if (!confirm('¿Reiniciar la cartera de simulación? Se borran posiciones, operaciones y ciclos.')) return;
    setLoading(true);
    try {
      await fetch('/api/invest/reset', { method: 'POST' });
      await refresh();
    } catch (e) {
      setError(e.message);
    } finally {
      setLoading(false);
    }
  };

  const toggleMode = async () => {
    if (config.mode === 'simulation' && !confirm('⚠️ Pasar a modo REAL ejecutará operaciones reales cuando haya API keys configuradas. ¿Continuar?')) return;
    setLoading(true);
    try {
      const next = config.mode === 'simulation' ? 'live' : 'simulation';
      await fetch('/api/invest/config', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ mode: next }) });
      await refresh();
    } catch (e) {
      setError(e.message);
    } finally {
      setLoading(false);
    }
  };

  const toggleAuto = async () => {
    setLoading(true);
    try {
      await fetch('/api/invest/config', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ autoCycle: !config.autoCycle }) });
      await refresh();
    } catch (e) {
      setError(e.message);
    } finally {
      setLoading(false);
    }
  };

  const controlTrain = async (action) => {
    setError('');
    try {
      const r = await fetch('/api/invest/control', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ action }) });
      const d = await r.json();
      if (d.error) throw new Error(d.error);
      await refresh();
    } catch (e) {
      setError(e.message);
    }
  };

  const forceLearn = async () => {
    setLearning(true);
    setError('');
    try {
      const r = await fetch('/api/invest/learn', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({}) });
      const d = await r.json();
      if (d.error) throw new Error(d.error);
      setLearn({ ...(learn || {}), ...d.exp });
      await refresh();
    } catch (e) {
      setError(e.message);
    } finally {
      setLearning(false);
    }
  };

  const saveKeys = async () => {
    setError('');
    try {
      const r = await fetch('/api/invest/broker/keys', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          apiKey: apiKey.trim() || undefined,
          apiSecret: apiSecret.trim() || undefined,
          alpacaKey: alpacaKey.trim() || undefined,
          alpacaSecret: alpacaSecret.trim() || undefined,
          alpacaLive,
        }),
      });
      const d = await r.json();
      if (d.error) throw new Error(d.error);
      setApiKey('');
      setApiSecret('');
      setAlpacaKey('');
      setAlpacaSecret('');
      await refresh();
    } catch (e) {
      setError(e.message);
    }
  };

  const saveMail = async () => {
    setMailSaving(true);
    setMailMsg(null);
    try {
      const r = await fetch('/api/invest/mail/config', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          smtpUser: mailForm.smtpUser.trim(),
          smtpPass: mailForm.smtpPass.trim() || undefined,
          destEmail: mailForm.destEmail.trim(),
          minWithdrawalProfit: Number(mailForm.minWithdrawalProfit),
          withdrawalAlertCooldownH: Number(mailForm.cooldown),
        }),
      });
      const d = await r.json();
      if (d.error) throw new Error(d.error);
      setMailMsg({ ok: true, text: 'Configuración de correo guardada.' });
      setMailForm((f) => ({ ...f, smtpPass: '' }));
      await refresh();
    } catch (e) {
      setMailMsg({ ok: false, text: e.message });
    } finally {
      setMailSaving(false);
    }
  };

  const testMail = async () => {
    setMailTesting(true);
    setMailMsg(null);
    try {
      const r = await fetch('/api/invest/mail/test', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({}) });
      const d = await r.json();
      if (d.error) throw new Error(d.error);
      setMailMsg({ ok: true, text: `Correo de prueba enviado a ${d.to}. Revisa tu bandeja de entrada.` });
    } catch (e) {
      setMailMsg({ ok: false, text: `Fallo al enviar: ${e.message}` });
    } finally {
      setMailTesting(false);
    }
  };

  const saveSimReview = async () => {
    setSimSaving(true);
    setSimMsg(null);
    try {
      const enabling = !simReview.enabled;
      const patch = { simReviewEnabled: enabling, simReviewDays: Math.max(1, Number(simReview.days) || 14) };
      if (enabling) {
        const start = simReview.startedAt || simReview.sentAt || Date.now();
        patch.simReviewStartedAt = start;
        patch.simReviewSentAt = 0;
      } else {
        patch.simReviewStartedAt = 0;
        patch.simReviewSentAt = 0;
      }
      const r = await fetch('/api/invest/config', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(patch) });
      const d = await r.json();
      if (d.error) throw new Error(d.error);
      setSimMsg({ ok: true, text: enabling ? 'Aviso activado: te escribiré por correo al final del período de simulación.' : 'Aviso desactivado.' });
      await refresh();
    } catch (e) {
      setSimMsg({ ok: false, text: e.message });
    } finally {
      setSimSaving(false);
    }
  };

  const testBroker = async (market = null) => {    setBrokerTesting(true);
    setBrokerTestResult(null);
    try {
      const r = await fetch('/api/invest/broker/test', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ market }),
      });
      const d = await r.json();
      if (d.error) throw new Error(d.error);
      if (d.ok) {
        setBrokerTestResult({ ok: true, broker: d.broker || market, account: d.account, permissions: d.permissions, balances: d.balances });
      } else {
        setBrokerTestResult({ ok: false, error: d.error });
      }
    } catch (e) {
      setBrokerTestResult({ ok: false, error: e.message });
    } finally {
      setBrokerTesting(false);
    }
  };

  if (!status) {
    return <div className="invest-panel"><p className="dim">Cargando estado de inversión…</p>{error && <p className="err">{error}</p>}</div>;
  }

  const p = status.portfolio || {};
  const st = p.state || {};
  const cfg = config || {};
  const cycles = st.cycles || [];
  const trades = st.trades || [];
  const positions = Object.entries(st.positions || {});
  const returnPct = cfg.initialCash ? ((p.capitalTotal - cfg.initialCash) / cfg.initialCash) * 100 : 0;
  const isTraining = !!status.running || !!config.autoCycle;
  const isPaused = !config.autoCycle && !status.running;
  const totalCycles = st.cycles?.length || 0;
  const totalTrades = st.trades?.length || 0;
  const lastAtText = st.lastCycleAt ? new Date(st.lastCycleAt).toLocaleTimeString('es-ES') : '—';

  return (
    <div className="invest-panel">
      {error && <p className="err">{error}</p>}

      <div className="invest-header">
        <div>
          <h2 className="invest-title"><img src="/miku-original.png" className="miku-mini" alt="Miku" /> Miku Invest <span className="spark">✦</span></h2>
          <p className="dim">
            Modo: <strong className={st.mode === 'live' ? 'live' : ''}>{st.mode === 'live' ? '🔴 REAL' : '🟢 SIMULACIÓN'}</strong> · {cfg.assets?.length || 0} activos
          </p>
        </div>
        <div className="invest-actions">
          <button className={`small-btn ${config.autoCycle ? '' : ''}`} onClick={toggleAuto} title="Ejecutar el ciclo automáticamente cada cierto tiempo">
            {config.autoCycle ? '🔄 Auto: ON' : '⏱ Auto: OFF'}
          </button>
          <button className="small-btn" onClick={toggleMode} title="Cambiar entre simulación y broker real">
            {config.mode === 'live' ? '🔴 Modo real' : '🟢 Simulación'}
          </button>
          <button className="small-btn" onClick={runCycle} disabled={loading || status.running}>
            {loading || status.running ? 'Analizando…' : '▶ Ejecutar ciclo'}
          </button>
          <button className="small-btn danger" onClick={reset}>Reiniciar</button>
        </div>
      </div>

      <section className="invest-section console">
        <div className="broker-head">
          <h3 style={{ margin: 0 }}><img src="/miku-original.png" className="miku-mini" alt="Miku" /> Consola de entrenamiento <span className="spark">✦</span></h3>
          <span className={`status-dot ${isTraining ? 'dot-up' : 'dot-down'}`} />
          <span className="dim" style={{ fontSize: 12 }}>{isTraining ? 'IA en entrenamiento…' : isPaused ? 'en pausa' : 'detenida'}</span>
        </div>

        <div className="console-grid">
          <div className="console-metric"><span className="cm-value">{totalCycles}</span><span className="cm-label">ciclos</span></div>
          <div className="console-metric"><span className="cm-value">{totalTrades}</span><span className="cm-label">operaciones</span></div>
          <div className="console-metric"><span className="cm-value">{config.assets?.length || 0}</span><span className="cm-label">activos</span></div>
          <div className="console-metric"><span className="cm-value">{lastAtText}</span><span className="cm-label">última corrida</span></div>
        </div>

        <div className="console-controls">
          {!config.autoCycle ? (
            <button className="small-btn y2k play" onClick={() => controlTrain('resume')}>▶ Reanudar</button>
          ) : (
            <button className="small-btn y2k pause" onClick={() => controlTrain('pause')}>⏸ Pausar</button>
          )}
          <button className="small-btn y2k stop" onClick={() => controlTrain('stop')}>⏹ Detener</button>
          <span className="console-hint">
            Pausar detiene los ciclos automáticos · Detener interrumpe el ciclo en curso y pausa · Reanudar vuelve a operar.
          </span>
        </div>

        {isTraining && (
          <p className="console-running" style={{ marginTop: 10 }}>⚡ La IA está analizando mercados en vivo… mira el registro abajo.</p>
        )}
      </section>

      <section className="invest-section live-feed">
        <div className="broker-head">
          <h3 style={{ margin: 0 }}>Actividad de la IA en vivo ⚡</h3>
          <span className={`status-dot ${liveConnected ? 'dot-up' : 'dot-down'}`} />
          <span className="dim" style={{ fontSize: 12 }}>{liveConnected ? 'conectado en tiempo real' : 'sin conexión (reintentando…)'}</span>
          {liveFeed.length > 0 && (
            <button className="small-btn" style={{ marginLeft: 'auto' }} onClick={() => setLiveFeed([])}>Limpiar</button>
          )}
        </div>
        {liveFeed.length === 0 ? (
          <p className="dim" style={{ margin: 0 }}>Aún no hay actividad. Ejecuta un ciclo o espera al auto-cycle para ver el pipeline en vivo.</p>
        ) : (
          <div className="live-list">
            {liveFeed.map((it) => {
              const color = it.kind === 'error' ? 'var(--miku-pink)' : it.kind === 'trade' ? 'var(--miku-green)' : (it.kind === 'decision' || it.kind === 'sys') ? 'var(--miku-accent)' : 'var(--miku-text-dim)';
              const icon = it.kind === 'stage' ? '▸' : it.kind === 'decision' ? '🎯' : it.kind === 'trade' ? '✅' : it.kind === 'skipped' ? '⏭' : it.kind === 'error' ? '❌' : it.kind === 'sys' ? '⚙' : '🏁';
              return (
                <div key={it.id} className="live-item">
                  <span className="live-icon" style={{ color }}>{icon}</span>
                  <div className="live-body" style={{ borderLeftColor: color }}>
                    <span className="live-title" style={{ color }}>{it.title}</span>
                    <span className="live-time">{new Date(it.ts).toLocaleTimeString('es-ES')}</span>
                    <p className="live-text">{it.body}</p>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </section>

      <section className="invest-section">
        <div className="broker-head">
          <h3 style={{ margin: 0 }}>🧠 IA · Aprendizaje por reflexión</h3>
          <span className={`status-dot ${learn?.enabled ? 'dot-up' : 'dot-down'}`} />
          <span className="dim" style={{ fontSize: 12 }}>{learn?.enabled ? 'aprendiendo de su historial real' : 'aprendizaje desactivado'}</span>
          <button className="small-btn" onClick={forceLearn} disabled={learning}>
            {learning ? 'Evaluando…' : 'Evaluar ahora'}
          </button>
        </div>
        <div className="console-grid" style={{ marginTop: 10 }}>
          <div className="console-metric"><span className="cm-value">{learn?.stats?.tradesEvaluated ?? '—'}</span><span className="cm-label">ops evaluadas</span></div>
          <div className="console-metric"><span className="cm-value">{learn?.stats?.winRate != null ? `${learn.stats.winRate}%` : '—'}</span><span className="cm-label">acierto real</span></div>
          <div className="console-metric"><span className="cm-value">{fmtMoney(learn?.stats?.realizedPnl)}</span><span className="cm-label">P&L realizado</span></div>
          <div className="console-metric"><span className="cm-value">{learn?.lessons?.length ?? 0}</span><span className="cm-label">lecciones activas</span></div>
        </div>
        {learn?.lessons?.length > 0 && (
          <div className="learn-lessons">
            <p className="dim" style={{ marginBottom: 6, fontWeight: 700, fontSize: 13 }}>Lecciones que la IA se auto-impone en cada ciclo:</p>
            <ul className="learn-list">
              {learn.lessons.map((l, i) => (
                <li key={i}>
                  <span className={`learn-area ${l.area}`}>{l.area}</span>
                  <span className="learn-text">{l.text}</span>
                </li>
              ))}
            </ul>
          </div>
        )}
        {learn?.history?.length > 0 && (
          <div className="learn-history">
            <p className="dim" style={{ marginBottom: 6, fontSize: 12 }}>Autoevaluaciones recientes:</p>
            {learn.history.slice(0, 4).map((h, i) => (
              <p key={i} className="dim" style={{ fontSize: 12, margin: '2px 0' }}>
                {fmtDate(h.at)} · {h.tradesEvaluated} ops · acierto {h.winRate != null ? `${h.winRate}%` : '—'} · P&L {fmtMoney(h.realizedPnl)} · {h.lessons} lecciones
                {h.summary ? ` — ${h.summary}` : ''}
              </p>
            ))}
          </div>
        )}
        <p className="dim" style={{ marginTop: 8, fontSize: 12 }}>
          Cada ciclo, la IA revisa el resultado real de sus operaciones (aciertos, errores, rendimiento por sentimiento), se autoevalúa y extrae <strong>lecciones</strong> que inyecta en sus propios prompts (Analista · Estratega · Auditor) del siguiente ciclo. Así su razonamiento se condiciona a su experiencia y mejora con la práctica. La autoevaluación corre automáticamente cada {learn?.intervalMinutes ? Math.round(learn.intervalMinutes / 60) : 24} h (configurable) y puedes forzarla con el botón.
        </p>
      </section>

      <section className="invest-section">
        <div className="broker-head">
          <h3 style={{ margin: 0 }}>Brokers en modo real</h3>
          {showKeys ? (
            <div className="broker-keys">
              <div className="broker-keygroup">
                <span className="broker-keygroup-label">Binance (cripto)</span>
                <input type="text" placeholder="Binance API Key" value={apiKey} onChange={(e) => setApiKey(e.target.value)} />
                <input type="password" placeholder="Binance API Secret" value={apiSecret} onChange={(e) => setApiSecret(e.target.value)} />
              </div>
              <div className="broker-keygroup">
                <span className="broker-keygroup-label">Alpaca (acciones)</span>
                <input type="text" placeholder="Alpaca API Key ID" value={alpacaKey} onChange={(e) => setAlpacaKey(e.target.value)} />
                <input type="password" placeholder="Alpaca API Secret" value={alpacaSecret} onChange={(e) => setAlpacaSecret(e.target.value)} />
                <label className="setting-label" style={{ whiteSpace: 'nowrap' }}>
                  <input type="checkbox" checked={alpacaLive} onChange={(e) => setAlpacaLive(e.target.checked)} style={{ marginRight: 5 }} />
                  Alpaca live
                </label>
              </div>
              <button className="small-btn" onClick={saveKeys}>Guardar</button>
              <button className="small-btn" onClick={() => setShowKeys(false)}>Cancelar</button>
            </div>
          ) : (
            <button className="small-btn" onClick={() => setShowKeys(true)}>Configurar API keys</button>
          )}
          <button className="small-btn" onClick={() => testBroker(null)} disabled={brokerTesting}>
            {brokerTesting ? 'Probando…' : 'Probar ambos'}
          </button>
        </div>
        <div className="broker-status-row">
          <span className="broker-chip">
            <span className={`status-dot ${broker?.binance ? 'dot-up' : 'dot-down'}`} />
            Binance (cripto) {broker?.binance ? 'configurado' : 'sin keys'}
            {broker?.binance && <button className="small-btn mini" onClick={() => testBroker('crypto')} disabled={brokerTesting}>probar</button>}
          </span>
          <span className="broker-chip">
            <span className={`status-dot ${broker?.alpaca ? 'dot-up' : 'dot-down'}`} />
            Alpaca (acciones) {broker?.alpaca ? 'configurado' : 'sin keys'}
            {broker?.alpaca && <button className="small-btn mini" onClick={() => testBroker('stocks')} disabled={brokerTesting}>probar</button>}
          </span>
        </div>
        {brokerTestResult && (
          <div className={`broker-result ${brokerTestResult.ok ? 'ok' : 'fail'}`}>
            {brokerTestResult.ok ? (
              <>
                <p><strong>✅ Conexión OK ({brokerTestResult.broker || brokerTestResult.account ? 'broker' : 'binance'}).</strong></p>
                {brokerTestResult.account ? (
                  <p className="dim">
                    Cuenta: equity {fmtMoney(brokerTestResult.account.equity)} · cash {fmtMoney(brokerTestResult.account.cash)} · estado {brokerTestResult.account.status}
                    {brokerTestResult.positions?.length > 0 ? ` · posiciones: ${brokerTestResult.positions.map((p) => `${p.symbol} ${p.qty}`).join(', ')}` : ''}
                  </p>
                ) : (
                  <>
                    <p className="dim">Permisos: {brokerTestResult.permissions?.join(', ') || 'ninguno listado'}</p>
                    {brokerTestResult.balances?.length > 0 ? (
                      <p className="dim">Saldos: {brokerTestResult.balances.map((b) => `${b.asset} ${b.free}`).join(' · ')}</p>
                    ) : (
                      <p className="dim">Sin saldos libres en la cuenta.</p>
                    )}
                  </>
                )}
              </>
            ) : (
              <p><strong>❌ {brokerTestResult.error}</strong></p>
            )}
          </div>
        )}
        <p className="dim" style={{ marginTop: 8, fontSize: 12 }}>
          Binance: cripto Spot (BTCUSDT, ETHUSDT…), key con permisos <strong>solo trading</strong> (sin retiros). Alpaca: acciones EE.UU., empieza en <strong>paper trading</strong> (gratis, sin dinero real); desmarca "Alpaca live" para operar con fondos reales. Ninguna key se muestra de nuevo tras guardarse.
        </p>
      </section>

      <section className="invest-section">
        <div className="broker-head">
          <h3 style={{ margin: 0 }}>Notificaciones de retiro por correo 📧</h3>
          <span className={`status-dot ${cfg.mailConfigured ? 'dot-up' : 'dot-down'}`} />
          {cfg.mailConfigured ? (
            <span className="dim" style={{ fontSize: 12 }}>activo · alerta a {cfg.mailConfig?.destEmail}</span>
          ) : (
            <span className="dim" style={{ fontSize: 12 }}>no configurado</span>
          )}
          <button className="small-btn" onClick={() => setShowMail(!showMail)}>
            {showMail ? 'Cerrar' : 'Configurar correo'}
          </button>
          <button className="small-btn" onClick={testMail} disabled={mailTesting || !cfg.mailConfigured}>
            {mailTesting ? 'Enviando…' : 'Enviar prueba'}
          </button>
        </div>
        {showMail && (
          <div className="broker-keys">
            <div className="broker-keygroup">
              <span className="broker-keygroup-label">Correo remitente (el bot)</span>
              <input type="text" placeholder="miku.finanzas@gmail.com" value={mailForm.smtpUser} onChange={(e) => setMailForm({ ...mailForm, smtpUser: e.target.value })} />
              <input type="password" placeholder="Contraseña de aplicación (16 letras)" value={mailForm.smtpPass} onChange={(e) => setMailForm({ ...mailForm, smtpPass: e.target.value })} />
            </div>
            <div className="broker-keygroup">
              <span className="broker-keygroup-label">Correo destino (donde recibes las alertas)</span>
              <input type="text" placeholder="tu-correo@gmail.com" value={mailForm.destEmail} onChange={(e) => setMailForm({ ...mailForm, destEmail: e.target.value })} />
            </div>
            <div className="broker-keygroup" style={{ flexDirection: 'row', alignItems: 'center', gap: 12 }}>
              <label className="setting-label" style={{ whiteSpace: 'nowrap' }}>
                Alertar cuando la ganancia realizada ≥
                <input type="number" min="1" value={mailForm.minWithdrawalProfit} onChange={(e) => setMailForm({ ...mailForm, minWithdrawalProfit: e.target.value })} style={{ width: 70, margin: '0 6px' }} />
                USD
              </label>
              <label className="setting-label" style={{ whiteSpace: 'nowrap' }}>
                cada
                <input type="number" min="1" value={mailForm.cooldown} onChange={(e) => setMailForm({ ...mailForm, cooldown: e.target.value })} style={{ width: 60, margin: '0 6px' }} />
                horas
              </label>
            </div>
            <div>
              <button className="small-btn" onClick={saveMail} disabled={mailSaving}>{mailSaving ? 'Guardando…' : 'Guardar'}</button>
            </div>
          </div>
        )}
        {mailMsg && <div className={`broker-result ${mailMsg.ok ? 'ok' : 'fail'}`}><p>{mailMsg.ok ? '✅ ' : '❌ '}{mailMsg.text}</p></div>}
        <p className="dim" style={{ marginTop: 12, fontSize: 12 }}><strong>Revisión del período de simulación</strong></p>
        <div className="broker-keys" style={{ marginTop: 6 }}>
          <div className="broker-keygroup" style={{ flexDirection: 'row', alignItems: 'center', gap: 12, flexWrap: 'wrap' }}>
            <label className="setting-label" style={{ whiteSpace: 'nowrap', display: 'flex', alignItems: 'center', gap: 6 }}>
              <input type="checkbox" checked={simReview.enabled} onChange={(e) => setSimReview({ ...simReview, enabled: e.target.checked })} />
              Avisarme por correo al terminar
            </label>
            <label className="setting-label" style={{ whiteSpace: 'nowrap', display: 'flex', alignItems: 'center', gap: 6 }}>
              <input type="number" min="1" value={simReview.days} onChange={(e) => setSimReview({ ...simReview, days: e.target.value })} style={{ width: 60 }} />
              día(s)
            </label>
            <button className="small-btn" onClick={saveSimReview} disabled={simSaving}>{simSaving ? 'Guardando…' : simReview.enabled ? 'Activar aviso' : 'Activar aviso'}</button>
          </div>
          <p className="dim" style={{ fontSize: 12, marginTop: 6 }}>
            {simReview.enabled && simReview.startedAt
              ? `⏳ Corriendo desde ${new Date(simReview.startedAt).toLocaleDateString('es-ES')}. Te avisaré alrededor del ${new Date(simReview.startedAt + simReview.days * 86400000).toLocaleString('es-ES')} con un resumen de la simulación.${simReview.sentAt ? ` · Último envío: ${new Date(simReview.sentAt).toLocaleString('es-ES')}` : ''}`
              : 'Deja este aviso activo para recibir el resumen al final del período de simulación y decidir cuándo pasar al modo real.'}
          </p>
          {simMsg && <div className={`broker-result ${simMsg.ok ? 'ok' : 'fail'}`}><p>{simMsg.ok ? '✅ ' : '❌ '}{simMsg.text}</p></div>}
        </div>
        <p className="dim" style={{ marginTop: 8, fontSize: 12 }}>
          El sistema revisa tras cada ciclo si hay <strong>ganancias realizadas</strong> (ventas con beneficio) iguales o superiores al mínimo configurado y te avisa por correo cuándo retirar desde el broker. <strong>El sistema no puede retirar fondos</strong>: solo te lo recuerda.
        </p>
        <p className="dim" style={{ fontSize: 12 }}>
          Cómo crear la contraseña de aplicación: en Gmail activa la <strong>verificación en 2 pasos</strong> (Seguridad), luego ve a <strong>Seguridad → Contraseñas de aplicaciones</strong> y genera una para "Correo". Pega esos 16 caracteres aquí.
        </p>
      </section>

      <div className="invest-cards">
        <div className="invest-card">
          <div className="card-label">Capital total</div>
          <div className="card-value">{fmtMoney(p.capitalTotal)}</div>
        </div>
        <div className="invest-card">
          <div className="card-label">Caja disponible</div>
          <div className="card-value">{fmtMoney(st.cash)}</div>
        </div>
        <div className="invest-card">
          <div className="card-label">Valor posiciones</div>
          <div className="card-value">{fmtMoney(p.holdingsValue)}</div>
        </div>
        <div className="invest-card">
          <div className="card-label">Ganancia/Pérdida</div>
          <div className={`card-value ${returnPct >= 0 ? 'pos' : 'neg'}`}>{fmtPct(returnPct)}</div>
        </div>
      </div>

      <div className="invest-grid">
        <section className="invest-section">
          <h3>Posiciones abiertas</h3>
          {positions.length === 0 ? (
            <p className="dim">Sin posiciones abiertas.</p>
          ) : (
            <table className="invest-table">
              <thead><tr><th>Activo</th><th>Cant.</th><th>P. medio</th><th>P. actual</th><th>Valor</th></tr></thead>
              <tbody>
                {positions.map(([sym, pos]) => (
                  <tr key={sym}>
                    <td><strong>{sym}</strong></td>
                    <td>{pos.qty}</td>
                    <td>{fmtMoney(pos.avgPrice)}</td>
                    <td>{fmtMoney(pos.lastPrice)}</td>
                    <td>{fmtMoney(pos.qty * pos.lastPrice)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </section>

        <section className="invest-section">
          <h3>Últimas operaciones ({trades.length})</h3>
          {trades.length === 0 ? (
            <p className="dim">Aún no hay operaciones ejecutadas.</p>
          ) : (
            <table className="invest-table">
              <thead><tr><th>Fecha</th><th>Activo</th><th>Acción</th><th>Cant.</th><th>Precio</th></tr></thead>
              <tbody>
                {trades.slice(-8).reverse().map((t) => (
                  <tr key={t.id}>
                    <td>{fmtDate(t.at)}</td>
                    <td>{t.symbol}</td>
                    <td style={{ color: ACTION_COLOR[t.action] }}><strong>{ACTION_LABEL[t.action]}</strong></td>
                    <td>{t.qty}</td>
                    <td>{fmtMoney(t.price)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </section>
      </div>

      <section className="invest-section">
        <h3>Últimos ciclos de análisis ({cycles.length})</h3>
        {cycles.length === 0 ? (
          <p className="dim">Ejecuta un ciclo para ver el pipeline Analista → Estratega → Auditor.</p>
        ) : (
          <div className="cycle-list">
            {cycles.slice(-6).reverse().map((c, i) => {
              const sel = selectedCycle && selectedCycle.at === c.at && selectedCycle.symbol === c.symbol;
              return (
                <div key={`${c.at}-${c.symbol}`} className="cycle-item">
                  <button className="cycle-head" onClick={() => setSelectedCycle(sel ? null : c)}>
                    <span className="cycle-symbol">{c.symbol}</span>
                    <span className={`cycle-action`} style={{ color: ACTION_COLOR[c.finalDecision?.action] }}>
                      {ACTION_LABEL[c.finalDecision?.action] || c.finalDecision?.action}
                    </span>
                    <span className="cycle-price">{fmtMoney(c.price)}</span>
                    <span className="cycle-conf">conf {c.analyst?.confidence ?? '—'}%</span>
                    <span className="cycle-date">{fmtDate(c.at)}</span>
                    <span className="cycle-chev">{sel ? '▾' : '▸'}</span>
                  </button>
                  {sel && (
                    <div className="cycle-detail">
                      <div className="agent-block">
                        <h4>1 · Analista <span className="agent-model">gemma4:26b</span></h4>
                        <p>{c.analyst?.summary}</p>
                        <p className="dim">Sentimiento: <strong>{c.analyst?.sentiment}</strong> · Confianza: {c.analyst?.confidence}% · RSI14: {c.analyst && c.analyst.raw ? '…' : '—'}</p>
                        {c.analyst?.risks?.length > 0 && <p className="dim">Riesgos: {c.analyst.risks.join(' · ')}</p>}
                      </div>
                      <div className="agent-block">
                        <h4>2 · Estratega <span className="agent-model">gemma4:12b</span></h4>
                        <p>{c.strategist?.reasoning}</p>
                        <p className="dim">Acción: <strong>{ACTION_LABEL[c.strategist?.action]}</strong> · Cantidad: {c.strategist?.quantity ?? 0}</p>
                      </div>
                      <div className="agent-block">
                        <h4>3 · Auditor <span className="agent-model">gemma4:e4b</span></h4>
                        <p>{c.auditor?.reasoning}</p>
                        <p className="dim">Aprobado: <strong>{c.auditor?.approval ? 'SÍ' : 'NO'}</strong>{c.auditor?.warnings?.length > 0 ? ` · Avisos: ${c.auditor.warnings.join(' · ')}` : ''}</p>
                      </div>
                      {c.trade && (
                        <div className="agent-block trade">
                          <h4>✅ Operación ejecutada (simulación)</h4>
                          <p className="dim">{ACTION_LABEL[c.trade.action]} {c.trade.qty} @ {fmtMoney(c.trade.price)} · comisión {fmtMoney(c.trade.fee)}</p>
                        </div>
                      )}
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        )}
      </section>
    </div>
  );
}
