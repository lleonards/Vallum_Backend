import { Request, Response, NextFunction } from 'express'
import { logger } from '../utils/logger'

export function errorHandler(
  err: any,
  _req: Request,
  res: Response,
  _next: NextFunction
): void {
  logger.error('Unhandled error:', err)

  if (err.type === 'entity.too.large') {
    res.status(413).json({ error: 'Arquivo muito grande. Limite: 50MB' })
    return
  }

  if (err.name === 'MulterError') {
    if (err.code === 'LIMIT_FILE_SIZE') {
      res.status(413).json({ error: 'Arquivo muito grande. Limite: 50MB' })
    } else {
      res.status(400).json({ error: `Erro no upload: ${err.message}` })
    }
    return
  }

  const statusCode = err.statusCode || err.status || 500
  const message = err.message || 'Erro interno do servidor'

  res.status(statusCode).json({
    error: message,
    ...(process.env.NODE_ENV === 'development' && { stack: err.stack }),
  })
}
