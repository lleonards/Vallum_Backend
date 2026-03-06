const express = require('express');
const cors = require('cors');
const helmet = require('helmet');
const morgan = require('morgan');
const rateLimit = require('express-rate-limit');
const path = require('path');
require('dotenv').config();

const app = express();
const PORT = process.env.PORT || 3001;

// ─── Security Middleware ─────────────────────────────────────────────────────
app.use(helmet({ crossOriginResourcePolicy: { policy: 'cross-origin' } }));
app.use(morgan('combined'));

// ─── Rate Limiting ───────────────────────────────────────────────────────────
const limiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 200,
  message: { error: 'Too many requests, please try again later.' }
});
app.use('/api/', limiter);

// ─── CORS ────────────────────────────────────────────────────────────────────
const allowedOrigins = [
  process.env.FRONTEND_URL || 'http://localhost:3000',
  'https://vellum-app.onrender.com',
  'https://vellum-frontend.onrender.com',
  // ✅ CORREÇÃO: adicione aqui o domínio exato do seu frontend no Render
  // Ex: 'https://vallum-app.onrender.com' — confira o nome correto no painel do Render
];

const corsOptions = {
  origin: (origin, callback) => {
    // Permite requisições sem origin (ex: Postman, curl) e origins permitidas
    if (!origin || allowedOrigins.includes(origin)) {
      callback(null, true);
    } else {
      console.warn(`⚠️ CORS bloqueado para origin: ${origin}`);
      callback(new Error('Not allowed by CORS'));
    }
  },
  credentials: true,
  methods: ['GET', 'POST', 'PUT', 'DELETE', 'PATCH', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization', 'X-Requested-With']
};

// ✅ CORREÇÃO: responder explicitamente ao preflight OPTIONS em todas as rotas
app.options('*', cors(corsOptions));
app.use(cors(corsOptions));

// ─── Body Parsers ─────────────────────────────────────────────────────────────
// Raw body para Stripe webhook DEVE vir antes do json parser
app.use('/api/payments/webhook', express.raw({ type: 'application/json' }));
app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true, limit: '10mb' }));

// ─── Static Files ─────────────────────────────────────────────────────────────
app.use('/uploads', express.static(path.join(__dirname, 'uploads')));

// ─── Health Check (antes das rotas para prioridade) ───────────────────────────
app.get('/health', (req, res) => {
  res.json({
    status: 'ok',
    service: 'Vellum Backend',
    version: '1.0.0',
    timestamp: new Date().toISOString()
  });
});

// ─── Routes ──────────────────────────────────────────────────────────────────
app.use('/api/auth',       require('./routes/auth'));
app.use('/api/documents',  require('./routes/documents'));
app.use('/api/conversion', require('./routes/conversion'));
app.use('/api/payments',   require('./routes/payments'));
app.use('/api/user',       require('./routes/user'));

// ─── 404 Handler ──────────────────────────────────────────────────────────────
app.use((req, res) => {
  res.status(404).json({ error: `Rota não encontrada: ${req.method} ${req.originalUrl}` });
});

// ─── Global Error Handler ─────────────────────────────────────────────────────
app.use((err, req, res, next) => {
  console.error('Global Error:', err);

  // Erro de CORS
  if (err.message === 'Not allowed by CORS') {
    return res.status(403).json({ error: 'Origem não permitida por CORS' });
  }

  const status = err.status || 500;
  res.status(status).json({
    error: err.message || 'Erro interno do servidor',
    ...(process.env.NODE_ENV === 'development' && { stack: err.stack })
  });
});

// ─── Start Server ─────────────────────────────────────────────────────────────
app.listen(PORT, '0.0.0.0', () => {
  console.log(`\n🚀 Vellum Backend rodando na porta ${PORT}`);
  console.log(`📡 Ambiente: ${process.env.NODE_ENV}`);
  console.log(`🌐 Frontend URL: ${process.env.FRONTEND_URL}`);
  console.log(`✅ Origins permitidas: ${allowedOrigins.join(', ')}`);
});

module.exports = app;
