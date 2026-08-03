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
      const mc = c?.mailConfig || {};
      setMailForm((f) => ({
        ...f,
        smtpUser: mc.smtpUser || f.smtpUser,
        smtpPass: mc.smtpPass ? (f.smtpPass === '' ? '' : f.smtpPass) : f.smtpPass,
        destEmail: mc.destEmail || f.destEmail,
        minWithdrawalProfit: c?.minWithdrawalProfit ?? f.minWithdrawalProfit,
        cooldown: c?.withdrawalAlertCooldownH ?? f.cooldown,
      }));
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

  return (
    <div className="invest-panel">
      {error && <p className="err">{error}</p>}

      <div className="invest-header">
        <div>
          <h2>Miku Invest</h2>
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
