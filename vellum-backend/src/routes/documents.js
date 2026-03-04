const express = require('express');
const router = express.Router();
const { supabaseAdmin } = require('../db/supabase');
const authMiddleware = require('../middleware/auth');

// Todos os endpoints requerem autenticação
router.use(authMiddleware);

// ─── GET /api/documents ─────────────────────────────────────────────────────
// Lista todos os documentos do usuário
router.get('/', async (req, res) => {
  try {
    const { data, error } = await supabaseAdmin
      .from('documents')
      .select('id, title, thumbnail_url, created_at, updated_at')
      .eq('user_id', req.user.id)
      .order('updated_at', { ascending: false });

    if (error) throw error;
    res.json({ documents: data || [] });
  } catch (err) {
    console.error('GET /documents error:', err);
    res.status(500).json({ error: err.message });
  }
});

// ─── GET /api/documents/:id ─────────────────────────────────────────────────
// Busca um documento específico
router.get('/:id', async (req, res) => {
  try {
    const { data, error } = await supabaseAdmin
      .from('documents')
      .select('*')
      .eq('id', req.params.id)
      .eq('user_id', req.user.id)
      .single();

    if (error) throw error;
    if (!data) return res.status(404).json({ error: 'Documento não encontrado' });

    res.json({ document: data });
  } catch (err) {
    console.error('GET /documents/:id error:', err);
    res.status(500).json({ error: err.message });
  }
});

// ─── POST /api/documents ────────────────────────────────────────────────────
// Cria um novo documento (verifica limite do plano gratuito)
router.post('/', async (req, res) => {
  try {
    const { title = 'Documento sem título', content = { pages: [] } } = req.body;

    // Verificar plano e limite
    const { data: profile, error: profileError } = await supabaseAdmin
      .from('profiles')
      .select('plan, documents_created_this_month, month_reset_date')
      .eq('id', req.user.id)
      .single();

    if (profileError) throw profileError;

    const now = new Date();
    const resetDate = new Date(profile.month_reset_date);
    const currentMonth = new Date(now.getFullYear(), now.getMonth(), 1);

    // Reset mensal
    let docsThisMonth = profile.documents_created_this_month;
    if (resetDate < currentMonth) {
      await supabaseAdmin
        .from('profiles')
        .update({ documents_created_this_month: 0, month_reset_date: currentMonth.toISOString() })
        .eq('id', req.user.id);
      docsThisMonth = 0;
    }

    // Limite plano gratuito
    if (profile.plan === 'free' && docsThisMonth >= 5) {
      return res.status(403).json({
        error: 'Limite de documentos atingido',
        message: 'Você atingiu o limite de 5 documentos/mês do plano gratuito. Faça upgrade para o plano Pro.',
        upgrade: true,
      });
    }

    // Criar documento
    const { data, error } = await supabaseAdmin
      .from('documents')
      .insert({
        user_id: req.user.id,
        title,
        content,
      })
      .select()
      .single();

    if (error) throw error;

    // Incrementar contador
    await supabaseAdmin
      .from('profiles')
      .update({ documents_created_this_month: docsThisMonth + 1 })
      .eq('id', req.user.id);

    res.status(201).json({ document: data });
  } catch (err) {
    console.error('POST /documents error:', err);
    res.status(500).json({ error: err.message });
  }
});

// ─── PUT /api/documents/:id ─────────────────────────────────────────────────
// Atualiza um documento
router.put('/:id', async (req, res) => {
  try {
    const { title, content, thumbnail_url } = req.body;

    const updateData = { updated_at: new Date().toISOString() };
    if (title !== undefined) updateData.title = title;
    if (content !== undefined) updateData.content = content;
    if (thumbnail_url !== undefined) updateData.thumbnail_url = thumbnail_url;

    const { data, error } = await supabaseAdmin
      .from('documents')
      .update(updateData)
      .eq('id', req.params.id)
      .eq('user_id', req.user.id)
      .select()
      .single();

    if (error) throw error;
    if (!data) return res.status(404).json({ error: 'Documento não encontrado' });

    res.json({ document: data });
  } catch (err) {
    console.error('PUT /documents/:id error:', err);
    res.status(500).json({ error: err.message });
  }
});

// ─── DELETE /api/documents/:id ──────────────────────────────────────────────
// Remove um documento
router.delete('/:id', async (req, res) => {
  try {
    const { error } = await supabaseAdmin
      .from('documents')
      .delete()
      .eq('id', req.params.id)
      .eq('user_id', req.user.id);

    if (error) throw error;
    res.json({ message: 'Documento removido com sucesso' });
  } catch (err) {
    console.error('DELETE /documents/:id error:', err);
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
