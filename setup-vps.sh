#!/usr/bin/env bash
# setup-vps.sh — Instala Docker y levanta Miku Invest en un VPS Ubuntu (ARM 64).
# Pensado para Oracle Cloud Free Tier (Ampere A1, 24 GB RAM, Ubuntu 22.04+).
# Ejecutar como usuario con sudo:  bash setup-vps.sh
set -e

echo "== Miku Invest · instalación en el VPS =="

# 1. Requisitos
if ! command -v curl >/dev/null 2>&1; then
  sudo apt-get update && sudo apt-get install -y curl
fi

# 2. Docker Engine (si no está instalado)
if ! command -v docker >/dev/null 2>&1; then
  echo "Instalando Docker…"
  curl -fsSL https://get.docker.com | sudo sh
fi

# 3. Compose plugin
sudo docker compose version >/dev/null 2>&1 || {
  echo "Instalando docker compose…"
  sudo apt-get install -y docker-compose-plugin || true
}

# 4. Clonar o copiar el proyecto
if [ ! -d "miku-invest/docker-compose.yml" ]; then
  echo "Descargando el código de Miku Invest…"
  git clone https://github.com/noxtope-git/miku-invest.git miku-invest 2>/dev/null || echo "git clone falló; copia la carpeta del proyecto a ~/miku-invest"
fi
cd miku-invest

# 5. Levantar el stack (la primera vez descarga modelos, tarda varios minutos)
echo "Levantando contenedores (primer arranque: descarga modelos ~10 GB, ten paciencia)…"
sudo docker compose up -d --build

echo ""
echo "== Listo =="
echo "Web:        http://$(curl -s -4 ifconfig.me):4000"
echo "Estado:     sudo docker compose ps"
echo "Logs:       sudo docker compose logs -f miku"
echo ""
echo "Recuerda: configura en la web el correo de retiro y las API keys de los brokers."
