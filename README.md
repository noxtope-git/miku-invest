# Miku AI — Asistente local

Asistente de IA local que combina **Gemma 4** (Google), **OpenCode**, chat por texto y un **sistema de inversión multi-agente**.

## Arquitectura

```
┌─────────────────────────────────────────────────────┐
│  Frontend React (http://localhost:4000)             │
│  - Chat con selector de motor                       │
│  - Modelo y razonamiento de OpenCode                │
│  - Sesiones OpenCode con permisos                   │
│  - Pestaña Inversiones (dashboard multi-agente)     │
└──────────────────────┬──────────────────────────────┘
                       │ /api
┌──────────────────────▼──────────────────────────────┐
│  Backend Express (puerto 4000)                       │
│  - /api/chat    → Ollama o OpenCode                  │
│  - /api/opencode/sessions  → lista de sesiones      │
│  - /api/opencode/message   → envía a OpenCode       │
│  - /api/invest/* → orquestador de inversión         │
└───────┬──────────────────────────┬──────────────────┘
        │                          │
┌───────▼─────────┐      ┌─────────▼──────────────────┐
│  Ollama :11434  │      │  OpenCode serve :37999      │
│  gemma4:e4b     │      │  (sesiones, herramientas,   │
│  gemma4:12b     │      │   permisos)                 │
│  gemma4:26b     │      └────────────────────────────┘
└─────────────────┘
```

## Sistema de inversión (Miku Invest)

Pipeline de 3 agentes que se ejecuta por ciclo, con datos reales de mercado:

```
Datos reales (Yahoo Finance + Binance API)
   │
   ▼
1. ANALISTA (gemma4:26b)  → interpreta indicadores técnicos (RSI, medias, MACD)
   │                         y emite informe con sentimiento y confianza
   ▼
2. ESTRATEGA (gemma4:12b) → decide COMPRAR/VENDER/MANTENER según el informe
   │                         y las reglas de riesgo de la cartera
   ▼
3. AUDITOR (gemma4:e4b)   → valida que la decisión respete el riesgo y aprueba
   │
   ▼
   Ejecución (modo simulación con comisiones / broker real futuro)
```

- **Modo simulación** (por defecto): dinero ficticio, comisiones simuladas, sin riesgo.
- **Modo real**: ejecuta órdenes MARKET en dos brokers según el mercado del activo:
  - **Cripto** → **Binance Spot** (BTCUSDT, ETHUSDT…) con API keys firmadas.
  - **Acciones EE.UU.** → **Alpaca** (paper o live, órdenes fraccionales por importe).
- Los indicadores técnicos se calculan de forma determinista en el backend; los LLM los interpretan, no los inventan.
- El estado (cartera, posiciones, operaciones, ciclos) persiste en `backend/investments/state.json`.
- Configuración en `backend/investments/config.json`: capital inicial, % máximo por posición, stop-loss, comisión, activos, API keys de los brokers y ciclo automático. Este archivo NO se sube a Git (contiene claves).

### Broker real

El sistema puede ejecutar operaciones reales en cripto (Binance) y acciones (Alpaca). La arquitectura multi-agente está inspirada en proyectos open source similares, en especial **TradingAgents** (github.com/TauricResearch/TradingAgents, paper arXiv:2412.20138), que replica una firma de trading con roles especializados y debate alcista/bajista.

Para activarlo:

1. **Binance (cripto):** crea una API key con permisos **solo de trading** (nunca con retiros) y, a ser posible, **restringida a tu IP**.
2. **Alpaca (acciones):** crea una cuenta (gratis), genera una API key y usa el entorno **paper trading** (sin dinero real). Desmarca "Alpaca live" solo cuando quieras operar con fondos reales.
3. En la pestaña 📈 Inversiones → "Configurar API keys" introduce las claves (se guardan en `config.json`, nunca se vuelven a mostrar), o usa variables de entorno:
   - Binance: `BINANCE_API_KEY`, `BINANCE_API_SECRET`
   - Alpaca: `APCA_API_KEY_ID`, `APCA_API_SECRET_KEY`
4. Pulsa "Probar ambos" para verificar permisos y saldos de cada broker.
5. Cambia a modo real (🔴) con el botón del panel.

**Advertencias:**
- Cada activo se enruta automáticamente a su broker según su mercado.
- Se usa el porcentaje `liveMaxNotionalPct` del saldo real por orden (por defecto 50%) como límite de tamaño.
- Los LLM locales no predicen el mercado de forma fiable. Valida primero la estrategia en simulación durante semanas/meses antes de operar con capital real.

### Componentes

| Componente | Ruta | Función |
|---|---|---|
| Frontend | `frontend/` | React + Vite, tema Miku |
| Backend | `backend/server.js` | API Express que une todo |
| Datos de mercado | `backend/investments/marketdata.js` | Yahoo Finance + Binance, indicadores técnicos |
| Agentes | `backend/investments/agents.js` | Analista (26b), Estratega (12b), Auditor (e4b) |
| Orquestador | `backend/investments/orchestrator.js` | Pipeline de ciclo, ejecución y temporizador |
| Broker | `backend/investments/broker.js` | Fachada multi-broker: Binance (cripto) + Alpaca (acciones) |
| Broker Alpaca | `backend/investments/alpaca.js` | Cliente Alpaca (paper/live) para acciones EE.UU. |
| Estado | `backend/investments/store.js` | Persistencia de cartera y configuración |

## Cómo usar

1. **Instalar** (una sola vez): doble clic en `install.bat`
2. **Iniciar todo**: doble clic en `start-miku.bat`
3. Abre `http://localhost:4000`

### En la interfaz web
- Elige el motor: **Gemma 4 E4B**, **Gemma 4 12B**, **Gemma 4 26B** o **OpenCode**
- Con OpenCode puedes elegir modelo, razonamiento y continuar sesiones anteriores o crear nuevas
- Pestaña **📈 Inversiones**: ejecuta ciclos del sistema multi-agente, revisa posiciones, operaciones e informes de los 3 agentes

## Configuración

Variables de entorno del backend (opcionales):

| Variable | Defecto |
|---|---|
| `PORT` | `4000` |
| `OLLAMA_URL` | `http://127.0.0.1:11434` |
| `OPENCODE_URL` | `http://127.0.0.1:37999` |
| `OPENCODE_PASS` | la contraseña de tu servidor opencode |

## Puertos

| Puerto | Servicio |
|---|---|
| 11434 | Ollama |
| 37999 | OpenCode serve |
| 4000 | Miku (backend + frontend) |
| 5173 | Vite (solo desarrollo) |
