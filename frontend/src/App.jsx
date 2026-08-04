import React, { useState, useEffect, useRef, useCallback } from 'react';
import InvestPanel from './InvestPanel.jsx';

const ENGINES = [
  { id: 'gemma4:e4b', label: 'Gemma 4 E4B', desc: 'Muy rápido · Ligero (8B)' },
  { id: 'gemma4:12b', label: 'Gemma 4 12B', desc: 'Equilibrio · Rápido' },
  { id: 'gemma4:26b', label: 'Gemma 4 26B', desc: 'Máxima calidad · Más lento' },
  { id: 'opencode', label: 'OpenCode', desc: 'Agente · Sesiones y permisos' },
];

const VARIANTS = ['basic', 'medium', 'high', 'max'];

export default function App() {
  const [engine, setEngine] = useState('gemma4:e4b');
  const [messages, setMessages] = useState([]);
  const [input, setInput] = useState('');
  const [loading, setLoading] = useState(false);
  const [health, setHealth] = useState({ ollama: 'down', opencode: 'down' });
  const [sessions, setSessions] = useState([]);
  const [sessionID, setSessionID] = useState(null);
  const [ocModels, setOcModels] = useState([]);
  const [ocModel, setOcModel] = useState('deepseek-v4-flash-free');
  const [variant, setVariant] = useState('high');
  const [tab, setTab] = useState('chat');

  const chatRef = useRef(null);
  const textareaRef = useRef(null);

  const fetchHealth = useCallback(async () => {
    try {
      const r = await fetch('/api/health');
      const d = await r.json();
      setHealth(d);
    } catch {}
  }, []);

  const fetchSessions = useCallback(async () => {
    try {
      const r = await fetch('/api/opencode/sessions');
      const d = await r.json();
      if (Array.isArray(d)) setSessions(d);
    } catch {}
  }, []);

  const fetchOcModels = useCallback(async () => {
    try {
      const r = await fetch('/api/opencode/models');
      const d = await r.json();
      if (Array.isArray(d.models) && d.models.length) setOcModels(d.models);
    } catch {}
  }, []);

  useEffect(() => {
    fetchHealth();
    fetchSessions();
    fetchOcModels();
    const iv = setInterval(fetchHealth, 15000);
    return () => clearInterval(iv);
  }, [fetchHealth, fetchSessions, fetchOcModels]);

  useEffect(() => {
    try {
      const saved = JSON.parse(localStorage.getItem('miku-settings') || '{}');
      if (saved.engine) setEngine(saved.engine);
      if (saved.ocModel) setOcModel(saved.ocModel);
      if (saved.variant) setVariant(saved.variant);
    } catch {}
  }, []);

  useEffect(() => {
    try {
      localStorage.setItem('miku-settings', JSON.stringify({ engine, ocModel, variant }));
    } catch {}
  }, [engine, ocModel, variant]);

  useEffect(() => {
    chatRef.current?.scrollTo({ top: chatRef.current.scrollHeight, behavior: 'smooth' });
  }, [messages, loading]);

  const sendMessage = useCallback(async (text) => {
    if (!text.trim() || loading) return;
    const userMsg = { role: 'user', content: text.trim(), engine };
    setMessages((m) => [...m, userMsg]);
    setInput('');
    setLoading(true);

    try {
      if (engine === 'opencode') {
        let sid = sessionID;
        if (!sid) {
          const sr = await fetch('/api/opencode/session', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ title: 'Miku chat' }),
          });
          const sd = await sr.json();
          sid = sd.id;
          setSessionID(sid);
          fetchSessions();
        }
        const body = { engine, sessionID: sid, messages: [{ role: 'user', content: text.trim() }], modelID: ocModel, providerID: 'opencode', variant };
        const r = await fetch('/api/chat', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(body),
        });
        const d = await r.json();
        if (d.error) throw new Error(d.error);
        setMessages((m) => [...m, { role: 'assistant', content: d.content || '…', engine: 'opencode' }]);
      } else {
        const body = {
          engine,
          model: engine,
          messages: [...messages.filter((m) => m.role === 'user' || m.role === 'assistant'), userMsg],
        };
        const r = await fetch('/api/chat', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(body),
        });
        const d = await r.json();
        if (d.error) throw new Error(d.error);
        setMessages((m) => [...m, { role: 'assistant', content: d.content || '…', engine }]);
      }
    } catch (err) {
      setMessages((m) => [...m, { role: 'assistant', content: `⚠️ Error: ${err.message}`, engine }]);
    } finally {
      setLoading(false);
      textareaRef.current?.focus();
    }
  }, [engine, sessionID, loading, messages, fetchSessions, ocModel, variant]);

  const newSession = async () => {
    setMessages([]);
    setSessionID(null);
    setEngine('gemma4:12b');
  };
  const loadSessionMessages = async (sid) => {
    setSessionID(sid);
    setEngine('opencode');
    try {
      const r = await fetch(`/api/opencode/messages?sessionID=${sid}&limit=30`);
      const d = await r.json();
      if (Array.isArray(d)) {
        setMessages(d.filter((m) => m.text).map((m) => ({ role: m.role === 'user' ? 'user' : 'assistant', content: m.text, engine: 'opencode' })));
      }
    } catch {}
    try {
      await fetch('/api/opencode/model', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ sessionID: sid, modelID: ocModel, providerID: 'opencode', variant }),
      });
    } catch {}
  };

  const onKeyDown = (e) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      sendMessage(input);
    }
  };

  return (
    <div className="app">
      <aside className="sidebar">
        <div className="logo">
          <img src="/miku-original.png" className="miku-logo" alt="Miku" onError={(e) => { e.target.style.visibility = 'hidden'; }} />
          <div>
            <h1>MIKU <span className="spark">✦</span></h1>
            <p>Asistente local kawaii ~</p>
          </div>
        </div>

        <div className="section-title">Motor de IA</div>
        <div className="engine-select">
          {ENGINES.map((e) => (
            <button
              key={e.id}
              className={`engine-btn ${engine === e.id ? 'active' : ''}`}
              onClick={() => setEngine(e.id)}
            >
              <span className="engine-name">{e.label}</span>
              <span className="engine-desc">{e.desc}</span>
            </button>
          ))}
        </div>

        {engine === 'opencode' && (
          <>
            <div className="section-title">Modelo OpenCode</div>
            <div className="setting-row">
              <select value={ocModel} onChange={(e) => setOcModel(e.target.value)}>
                {ocModels.map((m) => (
                  <option key={m.id} value={m.id}>{m.label}</option>
                ))}
              </select>
            </div>
            <div className="section-title">Razonamiento</div>
            <div className="variant-select">
              {VARIANTS.map((v) => (
                <button
                  key={v}
                  className={`engine-btn ${variant === v ? 'active' : ''}`}
                  onClick={() => setVariant(v)}
                >
                  <span className="engine-name">{v}</span>
                </button>
              ))}
            </div>
            <div className="section-title">Sesiones OpenCode</div>
            <button className="small-btn" onClick={newSession}>+ Nueva sesión</button>
            <div className="session-list">
              {sessions.slice(0, 12).map((s) => (
                <div
                  key={s.id}
                  className={`session-item ${sessionID === s.id ? 'active' : ''}`}
                  onClick={() => loadSessionMessages(s.id)}
                >
                  <div className="session-title">{s.title || s.slug}</div>
                  <div className="session-meta">{s.directory || s.projectID}</div>
                </div>
              ))}
            </div>
          </>
        )}

        <div className="settings">
          <div className="setting-row">
            <span className="setting-label">
              <span className={`status-dot ${health.ollama === 'up' ? 'dot-up' : 'dot-down'}`} />
              Ollama {health.ollama === 'up' ? 'conectado' : 'caído'}
            </span>
          </div>
          <div className="setting-row">
            <span className="setting-label">
              <span className={`status-dot ${health.opencode === 'up' ? 'dot-up' : 'dot-down'}`} />
              OpenCode {health.opencode === 'up' ? 'conectado' : 'caído'}
            </span>
          </div>
        </div>

        <div className="sidebar-miku">
          <img src="/miku-hero.jpg" alt="Miku" className="miku-photo" />
          <span className="miku-caption">Miku cuida tus inversiones ✦</span>
        </div>
      </aside>

      <main className="main">
        <div className="topbar">
          <div className="tab-switch">
            <button className={`tab-btn ${tab === 'chat' ? 'active' : ''}`} onClick={() => setTab('chat')}>💬 Chat</button>
            <button className={`tab-btn ${tab === 'invest' ? 'active' : ''}`} onClick={() => setTab('invest')}>📈 Inversiones</button>
          </div>
          <div className="topbar-title">
            <img src="/miku-original.png" className="miku-mini" alt="Miku" />
            {tab === 'invest' ? 'Miku Invest ~' : (engine === 'opencode' ? 'OpenCode · ' + (sessionID ? sessionID.slice(0, 12) : 'nueva sesión') : engine)}
          </div>
          <div className="topbar-status">
          </div>
        </div>

        {tab === 'invest' ? (
          <InvestPanel />
        ) : (
        <>
        <div className="chat" ref={chatRef}>
          {messages.length === 0 && (
            <div className="chat-empty">
              <img src="/miku-original.png" className="miku-hero" alt="Miku" />
              <h2>¡Hola! Soy Miku ~ <span className="spark">✦</span></h2>
              <p>Elige un motor de IA y empecemos a chatear.</p>
            </div>
          )}

          {messages.map((m, i) => (
            <div key={i} className={`msg ${m.role} ${m.role === 'assistant' && m.reasoning ? 'reasoning' : ''}`}>
              <div className="msg-avatar">{m.role === 'user' ? 'Tú' : <img src="/miku-original.png" alt="Miku" />}</div>
              <div>
                <div className="msg-bubble">{m.content}</div>
                <div className="msg-meta">{m.engine}</div>
              </div>
            </div>
          ))}

          {loading && (
            <div className="msg assistant">
              <div className="msg-avatar"><img src="/miku-original.png" alt="Miku" /></div>
              <div className="msg-bubble"><span className="typing"><span /><span /><span /></span></div>
            </div>
          )}
        </div>

        <div className="input-area">
          <div className="input-box">
            <textarea
              ref={textareaRef}
              rows={1}
              placeholder={engine === 'opencode' ? 'Escribe un mensaje para OpenCode…' : 'Escribe un mensaje a Miku…'}
              value={input}
              onChange={(e) => setInput(e.target.value)}
              onKeyDown={onKeyDown}
              style={{ overflow: 'hidden' }}
              onInput={(e) => {
                e.target.style.height = 'auto';
                e.target.style.height = Math.min(e.target.scrollHeight, 140) + 'px';
              }}
            />
            <button
              className="icon-btn send"
              onClick={() => sendMessage(input)}
              disabled={loading}
              title="Enviar"
            >
              ➤
            </button>
          </div>
          <div className="hint">
            Enter para enviar · Shift+Enter para salto de línea
          </div>
        </div>
        </>
        )}
      </main>
    </div>
  );
}
