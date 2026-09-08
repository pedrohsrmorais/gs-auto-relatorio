const express = require('express');
const path = require('path');
const cors = require('cors');
const helmet = require('helmet');
const morgan = require('morgan');
require('dotenv').config();

const { testConnection } = require('./config/database');
const apiRoutes = require('./routes/api.routes');

const app = express();
const PORT = process.env.PORT || 3028;
const DIST_DIR = path.join(__dirname, '../../frontend/dist');

// ── Segurança e utilitários ───────────────────────────────────────────────────
app.use(helmet());
app.use(cors({
  origin: process.env.CORS_ORIGIN || '*',
  methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE'],
  allowedHeaders: ['Content-Type', 'Authorization'],
}));
app.use(morgan('dev'));

// ── Body parsing ──────────────────────────────────────────────────────────────
app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true }));

// ── Health check (fora de /api, não passa por auth nem pelo fallback) ────────
app.get('/health', (_req, res) => res.json({ status: 'ok' }));

// ── Estático (frontend buildado) ──────────────────────────────────────────────
app.use(express.static(DIST_DIR));

// ── Rotas da API ──────────────────────────────────────────────────────────────
app.use('/api', apiRoutes);

// ── 404 em JSON para /api/* não encontrado ────────────────────────────────────
// Precisa vir DEPOIS de app.use('/api', apiRoutes) e ANTES do fallback do SPA,
// senão uma rota de API inexistente cairia no catch-all e devolveria o
// index.html com 200 em vez de um 404 — silenciosamente "funcionando" errado.
app.use('/api', (_req, res) => {
  res.status(404).json({ success: false, message: 'Rota não encontrada.' });
});

// ── Fallback SPA (deve vir depois das rotas de API) ───────────────────────────
// Sem path string: no Express 5 (path-to-regexp novo), app.get('*', ...) ou
// app.get('/*', ...) lança "TypeError: Missing parameter name" na inicialização
// — wildcard sem nome não é mais aceito. Usar app.use(handler) sem path evita
// o parser de rotas por completo e funciona em qualquer versão do Express.
app.use((req, res) => {
  if (req.method !== 'GET') return res.status(404).json({ success: false, message: 'Rota não encontrada.' });
  res.sendFile(path.join(DIST_DIR, 'index.html'));
});

// ── Tratamento de erros global ────────────────────────────────────────────────
// Captura erros assíncronos: use asyncHandler nos controllers, ou chame next(err)
app.use((err, _req, res, _next) => {
  const statusCode = err.statusCode || err.status || 500;
  console.error(`[${new Date().toISOString()}] ${err.stack || err.message}`);
  res.status(statusCode).json({
    success: false,
    message: err.message || 'Internal Server Error',
    ...(err.details && { details: err.details }),
    ...(process.env.NODE_ENV === 'development' && { stack: err.stack }),
  });
});

// ── Boot ──────────────────────────────────────────────────────────────────────
async function start() {
  await testConnection(); // Falha rápido se o banco não responder
  app.listen(PORT, () => {
    console.log(`Servidor rodando em http://localhost:${PORT}`);
    console.log(`Ambiente: ${process.env.NODE_ENV || 'development'}`);
  });
}

start().catch((err) => {
  console.error(err.message);
  process.exit(1);
});

module.exports = app;