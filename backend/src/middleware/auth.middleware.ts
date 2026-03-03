import { Request, Response, NextFunction } from 'express'
import { supabaseAdmin } from '../utils/supabase'
import { logger } from '../utils/logger'

export interface AuthRequest extends Request {
  user?: {
    id: string
    email: string
    role: string
  }
}

export async function authMiddleware(
  req: AuthRequest,
  res: Response,
  next: NextFunction
): Promise<void> {
  try {
    const authHeader = req.headers.authorization
    if (!authHeader?.startsWith('Bearer ')) {
      res.status(401).json({ error: 'Token de autorização não fornecido' })
      return
    }

    const token = authHeader.split(' ')[1]
    const { data: { user }, error } = await supabaseAdmin.auth.getUser(token)

    if (error || !user) {
      res.status(401).json({ error: 'Token inválido ou expirado' })
      return
    }

    req.user = {
      id: user.id,
      email: user.email || '',
      role: user.role || 'authenticated',
    }

    next()
  } catch (err) {
    logger.error('Auth middleware error:', err)
    res.status(500).json({ error: 'Erro interno de autenticação' })
  }
}
