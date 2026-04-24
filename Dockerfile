# Dockerfile — basado en Debian slim con Chromium via apt (más confiable que nixpacks)
FROM node:20-bookworm-slim

# Dependencias del sistema que necesita Chromium headless
RUN apt-get update && apt-get install -y \
    chromium \
    fonts-freefont-ttf \
    ca-certificates \
    dumb-init \
    && rm -rf /var/lib/apt/lists/*

# Que Puppeteer NO descargue su propio Chromium y use el del sistema
ENV PUPPETEER_SKIP_DOWNLOAD=true
ENV PUPPETEER_EXECUTABLE_PATH=/usr/bin/chromium

WORKDIR /app

# Instalar dependencias primero (mejor cache)
COPY package*.json ./
RUN npm install --omit=dev

# Copiar el resto
COPY . .

# Usar dumb-init para manejar señales correctamente con Puppeteer
ENTRYPOINT ["dumb-init", "--"]
CMD ["npm", "start"]
