# Miku Invest — imagen del backend (node) con el frontend embebido.
# El frontend se compila dentro de la imagen; el backend lo sirve como estático.

# ---- Stage 1: compilar el frontend ----
FROM node:22-alpine AS frontend
WORKDIR /app
COPY frontend/package.json frontend/package-lock.json* ./
RUN npm ci || npm install
COPY frontend/ ./
RUN npm run build

# ---- Stage 2: backend con el dist del frontend ----
FROM node:22-alpine
WORKDIR /app
ENV NODE_ENV=production
COPY backend/package.json backend/package-lock.json* ./
RUN npm ci --omit=dev || npm install
COPY backend/ ./
COPY --from=frontend /app/dist ./frontend/dist

# Persistencia (config.json / state.json) montada como volumen en /app/data.
# No se monta sobre /app/investments para no ocultar el código de la imagen.
VOLUME /app/data
ENV MIKU_DATA_DIR=/app/data

EXPOSE 4000
HEALTHCHECK --interval=30s --timeout=5s --start-period=20s \
  CMD node -e "fetch('http://127.0.0.1:4000/api/health').then(r=>{process.exit(r.ok?0:1)}).catch(()=>process.exit(1))"

CMD ["node", "server.js"]
