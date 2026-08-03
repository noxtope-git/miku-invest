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

### Notificaciones de retiro por correo 📧

El sistema **no puede retirar fondos** del broker, pero detecta cuándo hay **ganancias realizadas** (ventas con beneficio) y te avisa por correo para que retires manualmente.

Configuración (pestaña 📈 Inversiones → "Notificaciones de retiro"):

1. **Correo remitente (el bot):** crea `miku.finanzas@gmail.com` (o usa un correo propio).
2. En Gmail activa la **verificación en 2 pasos** (Seguridad) y genera una **contraseña de aplicación** (Seguridad → Contraseñas de aplicaciones → "Correo"). Pega esos 16 caracteres.
3. Indica tu **correo destino** (donde recibirás las alertas).
4. Define el **mínimo de ganancia** para alertar (por defecto 10 USD) y cada **cuántas horas** repetir el aviso (por defecto 24 h).
5. Pulsa "Enviar prueba" para comprobar que llega.

Tras cada ciclo, si la ganancia realizada supera el mínimo y ha pasado el cooldown, llega un correo con el resumen y la instrucción de retirar desde el broker.

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
| Notificador | `backend/investments/notifier.js` | Alertas de retiro por correo (nodemailer) |
| Watchdog | `backend/investments/watchdog.js` | Reinicia Ollama si cae y vigila servicios |
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

## Despliegue en la nube (Docker, 24/7 sin tu PC)

Para que Miku funcione **aunque tu ordenador esté apagado**, súbelo a un **VPS gratis** (Oracle Cloud Free Tier, Ampere ARM, 24 GB RAM) y corre todo con Docker:

```
docker compose up -d --build
```

Eso levanta dos contenedores:
- **miku-ollama**: Ollama con los modelos `gemma4:12b` y `gemma4:e4b` (se descargan solos la primera vez, ~9 GB).
- **miku-app**: backend + frontend. Usa modelos ligeros en la nube (variables `MIKU_*_MODEL`), ajustables en `docker-compose.yml`.

Los datos (cartera, API keys, configuración de correo) se guardan en el volumen `miku-data` y **sobreviven a reinicios**.

### En un VPS Ubuntu nuevo (guía rápida)

```bash
# 1. Instalar Docker y clonar el proyecto (o usar setup-vps.sh)
curl -fsSL https://get.docker.com | sudo sh
git clone https://github.com/noxtope-git/miku-invest.git && cd miku-invest

# 2. Levantar (la primera vez descarga modelos, tarda ~10-20 min)
sudo docker compose up -d --build

# 3. Abrir la web en http://<IP-del-VPS>:4000 y configurar correo + brokers
```

- En Oracle Cloud, abre el puerto 4000 en la **Security List** (Ingress Rules) del VCN y en el firewall del sistema (`sudo ufw allow 4000`).
- Los correos de retiro funcionan igual desde la nube.
- En la nube se usa `gemma4:12b` como analista (el 26b no cabe cómodo en 24 GB). Si quieres el 26b, elige un VPS con más RAM.
- El chat con OpenCode **no está disponible** en la nube (es local a tu PC); la pestaña de Inversiones y el chat con Gemma sí funcionan.
