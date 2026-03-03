import express from 'express'
import cors from 'cors'
import helmet from 'helmet'
import morgan from 'morgan'
import compression from 'compression'
import rateLimit from 'express-rate-limit'
import dotenv from 'dotenv'
import path from 'path'

dotenv.config()

import { pdfRoutes } from './routes/pdf.routes'
import { conversionRoutes } from './routes/conversion.routes'
import { stripeRoutes } from './routes/stripe.routes'
import { authMiddleware } from './middleware/auth.middleware'
import { errorHandler } from './middleware/error.middleware'
import { logger } from './utils/logger'

const app = express()
const PORT = process.env.PORT || 5000

// ── Security middlewares ──────────────────────────────────────────────────────
app.use(helmet({
  crossOriginResourcePolicy: { policy: 'cross-origin' },
}))

app.use(cors({
  origin: [
    process.env.FRONTEND_URL || 'http://localhost:3000',
    /\.vercel\.app$/,
    /\.render\.com$/,
    /\.netlify\.app$/,
  ],
  credentials: true,
  methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization'],
}))

// Stripe webhook needs raw body
app.use('/api/stripe/webhook', express.raw({ type: 'application/json' }))

// Regular body parsers
app.use(express.json({ limit: '10mb' }))
app.use(express.urlencoded({ extended: true, limit: '10mb' }))
app.use(compression())

// Logging
app.use(morgan('combined', {
  stream: { write: (msg) => logger.http(msg.trim()) }
}))

// Rate limiting
const limiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 100,
  message: { error: 'Muitas requisições. Tente novamente em 15 minutos.' },
})
app.use('/api/', limiter)

// Conversion has stricter limit
const conversionLimiter = rateLimit({
  windowMs: 60 * 60 * 1000, // 1 hour
  max: 20,
  message: { error: 'Limite de conversões atingido. Tente novamente em 1 hora.' },
})
app.use('/api/convert', conversionLimiter)

// ── Routes ────────────────────────────────────────────────────────────────────
app.get('/health', (_req, res) => {
  res.json({ status: 'ok', timestamp: new Date().toISOString(), service: 'vellum-backend' })
})

// Stripe webhook (before auth middleware - needs raw body)
app.use('/api/stripe', stripeRoutes)

// Protected routes
app.use('/api/pdf', authMiddleware, pdfRoutes)
app.use('/api/convert', authMiddleware, conversionRoutes)

// ── Error handler ─────────────────────────────────────────────────────────────
app.use(errorHandler)

// 404 handler
app.use((_req, res) => {
  res.status(404).json({ error: 'Rota não encontrada' })
})

// ── Start server ──────────────────────────────────────────────────────────────
app.listen(PORT, () => {
  logger.info(`🚀 Vellum Backend rodando na porta ${PORT}`)
  logger.info(`📄 Ambiente: ${process.env.NODE_ENV || 'development'}`)
})

export default app
