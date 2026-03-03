import { Request, Response, NextFunction } from 'express'
import { supabaseAdmin } from '../utils/supabase'
import { logger } from '../utils/logger'

// ✅ CORREÇÃO: Criando e exportando a interface AuthRequest
// Isso permite que 'req.user' seja reconhecido e que outros arquivos importem esse tipo
export interface AuthRequest extends Request {
  user?: {
    id: string
    email: string
    role: string
  }
}

export async function authMiddleware(
  req: AuthRequest, // ✅ CORREÇÃO: Usando a interface AuthRequest aqui
  res: Response,
  next: NextFunction
): Promise<void> {
  try {
    const authHeader = req.headers.authorization

    // Verifica se o header Authorization existe e começa com Bearer
    if (!authHeader || !authHeader.startsWith('Bearer ')) {
      res.status(401).json({ error: 'Token de autorização não fornecido' })
      return
    }

    const token = authHeader.split(' ')[1]

    // Valida o token no Supabase
    const { data, error } = await supabaseAdmin.auth.getUser(token)

    if (error || !data?.user) {
      res.status(401).json({ error: 'Token inválido ou expirado' })
      return
    }

    // ✅ Agora o TypeScript permite anexar o usuário porque usamos AuthRequest
    req.user = {
      id: data.user.id,
      email: data.user.email ?? '',
      role: (data.user as any).role ?? 'authenticated'
    }

    next()
  } catch (err) {
    logger.error('Auth middleware error:', err)
    res.status(500).json({ error: 'Erro interno de autenticação' })
  }
}
