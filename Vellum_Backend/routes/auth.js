const express = require('express');
const router = express.Router();
const { supabaseAdmin } = require('../utils/supabaseClient');

// POST /api/auth/register
router.post('/register', async (req, res) => {
  try {
    const { email, password, name } = req.body;

    if (!email || !password || !name) {
      return res.status(400).json({ error: 'Email, senha e nome são obrigatórios' });
    }

    if (password.length < 6) {
      return res.status(400).json({ error: 'A senha deve ter pelo menos 6 caracteres' });
    }

    // Criar usuário no Supabase Auth
    const { data, error } = await supabaseAdmin.auth.admin.createUser({
      email,
      password,
      email_confirm: true,
      user_metadata: { name }
    });

    if (error) {
      console.error('Supabase auth error:', error);

      if (
        error.message.includes('already registered') ||
        error.message.includes('already been registered') ||
        error.message.includes('duplicate')
      ) {
        return res.status(409).json({ error: 'Este e-mail já está em uso' });
      }

      return res.status(400).json({ error: error.message });
    }

    const userId = data.user.id;
    const now = new Date().toISOString();

    // Usar upsert para evitar conflito caso exista trigger no Supabase
    // que já inseriu o usuário na tabela automaticamente
    const { error: dbError } = await supabaseAdmin
      .from('users')
      .upsert(
        {
          id: userId,
          email: email,
          name: name,
          plan: 'free',
          subscription_status: 'inactive',
          docs_this_month: 0,
          usage_month: now,
          created_at: now,
          updated_at: now
        },
        { onConflict: 'id' }
      );

    if (dbError) {
      console.error('Database error ao inserir usuário:', dbError);
      // Tenta reverter a criação do usuário no Auth para não deixar órfão
      await supabaseAdmin.auth.admin.deleteUser(userId).catch(e =>
        console.error('Erro ao reverter criação do usuário Auth:', e)
      );
      return res.status(500).json({ error: 'Erro ao salvar usuário no banco de dados' });
    }

    return res.status(201).json({
      message: 'Usuário criado com sucesso',
      user: {
        id: userId,
        email: email,
        name: name
      }
    });

  } catch (err) {
    console.error('Register error inesperado:', err);
    return res.status(500).json({ error: 'Falha no registro. Tente novamente.' });
  }
});


// POST /api/auth/login
router.post('/login', async (req, res) => {
  try {
    const { email, password } = req.body;

    if (!email || !password) {
      return res.status(400).json({ error: 'E-mail e senha são obrigatórios' });
    }

    const { createClient } = require('@supabase/supabase-js');

    const supabaseClient = createClient(
      process.env.SUPABASE_URL,
      process.env.SUPABASE_ANON_KEY
    );

    const { data, error } = await supabaseClient.auth.signInWithPassword({
      email,
      password
    });

    if (error) {
      console.error('Login error:', error.message);
      return res.status(401).json({ error: 'E-mail ou senha inválidos' });
    }

    // Buscar dados do usuário na tabela users
    const { data: userData, error: userError } = await supabaseAdmin
      .from('users')
      .select('*')
      .eq('id', data.user.id)
      .single();

    if (userError) {
      console.error('User fetch error:', userError);
    }

    return res.json({
      token: data.session.access_token,
      refreshToken: data.session.refresh_token,
      user: {
        id: data.user.id,
        email: data.user.email,
        name: userData?.name || data.user.user_metadata?.name || '',
        plan: userData?.plan || 'free',
        subscription_status: userData?.subscription_status || 'inactive',
        docs_this_month: userData?.docs_this_month || 0
      }
    });

  } catch (err) {
    console.error('Login error inesperado:', err);
    return res.status(500).json({ error: 'Falha no login. Tente novamente.' });
  }
});


// POST /api/auth/refresh
router.post('/refresh', async (req, res) => {
  try {
    const { refreshToken } = req.body;

    if (!refreshToken) {
      return res.status(400).json({ error: 'Refresh token é obrigatório' });
    }

    const { createClient } = require('@supabase/supabase-js');

    const supabaseClient = createClient(
      process.env.SUPABASE_URL,
      process.env.SUPABASE_ANON_KEY
    );

    const { data, error } = await supabaseClient.auth.refreshSession({
      refresh_token: refreshToken
    });

    if (error) {
      return res.status(401).json({ error: 'Refresh token inválido ou expirado' });
    }

    return res.json({
      token: data.session.access_token,
      refreshToken: data.session.refresh_token
    });

  } catch (err) {
    console.error('Refresh error:', err);
    return res.status(500).json({ error: 'Falha ao renovar token' });
  }
});


// POST /api/auth/logout
router.post('/logout', async (req, res) => {
  return res.json({ message: 'Logout realizado com sucesso' });
});


// POST /api/auth/forgot-password
router.post('/forgot-password', async (req, res) => {
  try {
    const { email } = req.body;

    if (!email) {
      return res.status(400).json({ error: 'E-mail é obrigatório' });
    }

    const { createClient } = require('@supabase/supabase-js');

    const supabaseClient = createClient(
      process.env.SUPABASE_URL,
      process.env.SUPABASE_ANON_KEY
    );

    const { error } = await supabaseClient.auth.resetPasswordForEmail(email, {
      redirectTo: `${process.env.FRONTEND_URL}/reset-password`
    });

    if (error) {
      console.error('Forgot password error:', error.message);
    }

    // Sempre retorna sucesso por segurança (não revela se o e-mail existe)
    return res.json({ message: 'Se este e-mail estiver cadastrado, você receberá as instruções em breve.' });

  } catch (err) {
    console.error('Forgot password error:', err);
    return res.status(500).json({ error: 'Falha ao enviar e-mail de recuperação' });
  }
});

module.exports = router;
