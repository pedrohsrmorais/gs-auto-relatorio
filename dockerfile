# ── Estágio 1: build do frontend ──────────────────────────────────────────────
FROM node:22-alpine AS frontend-build

WORKDIR /frontend
COPY frontend/package*.json ./
RUN npm ci

COPY frontend/ ./
RUN npm run build
# Gera /frontend/dist


# ── Estágio 2: imagem final com o backend ────────────────────────────────────
FROM node:22-alpine

WORKDIR /app

# Dependências do backend
COPY backend/package*.json ./
RUN npm ci --omit=dev

# Código do backend
COPY backend/ ./

# Copia o dist do frontend para onde o server.js espera
# server.js faz: path.join(__dirname, '../../frontend/dist')
# __dirname = /app/src → ../../frontend/dist = /frontend/dist
# Então copiamos para lá:
COPY --from=frontend-build /frontend/dist /frontend/dist

EXPOSE 3028

CMD ["node", "src/server.js"]