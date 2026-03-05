const express = require('express');
const router = express.Router();
const { v4: uuidv4 } = require('uuid');
const { supabaseAdmin } = require('../utils/supabaseClient');
const authMiddleware = require('../middleware/authMiddleware');
const { checkDocumentLimit } = require('../middleware/planMiddleware');

// GET /api/documents - List user documents
router.get('/', authMiddleware, async (req, res) => {
  try {
    const { page = 1, limit = 20, search, type } = req.query;
    const offset = (page - 1) * limit;

    let query = supabaseAdmin
      .from('documents')
      .select('*', { count: 'exact' })
      .eq('user_id', req.user.id)
      .order('updated_at', { ascending: false })
      .range(offset, offset + limit - 1);

    if (search) {
      query = query.ilike('title', `%${search}%`);
    }
    if (type) {
      query = query.eq('type', type);
    }

    const { data, error, count } = await query;
    if (error) throw error;

    // Count this month's docs
    const startOfMonth = new Date();
    startOfMonth.setDate(1);
    startOfMonth.setHours(0, 0, 0, 0);

    const { count: monthlyCount } = await supabaseAdmin
      .from('documents')
      .select('*', { count: 'exact', head: true })
      .eq('user_id', req.user.id)
      .gte('created_at', startOfMonth.toISOString());

    res.json({
      documents: data,
      total: count,
      page: parseInt(page),
      limit: parseInt(limit),
      monthlyCount: monthlyCount || 0,
      monthlyLimit: req.userPlan === 'pro' ? null : 5
    });
  } catch (err) {
    console.error('List documents error:', err);
    res.status(500).json({ error: 'Failed to fetch documents' });
  }
});

// GET /api/documents/:id - Get single document
router.get('/:id', authMiddleware, async (req, res) => {
  try {
    const { data, error } = await supabaseAdmin
      .from('documents')
      .select('*')
      .eq('id', req.params.id)
      .eq('user_id', req.user.id)
      .single();

    if (error || !data) {
      return res.status(404).json({ error: 'Document not found' });
    }

    res.json(data);
  } catch (err) {
    res.status(500).json({ error: 'Failed to fetch document' });
  }
});

// POST /api/documents - Create new document
router.post('/', authMiddleware, checkDocumentLimit, async (req, res) => {
  try {
    const { title, type = 'document', content, canvasData } = req.body;

    const doc = {
      id: uuidv4(),
      user_id: req.user.id,
      title: title || 'Untitled Document',
      type,
      content: content || '',
      canvas_data: canvasData || null,
      thumbnail: null,
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString()
    };

    const { data, error } = await supabaseAdmin
      .from('documents')
      .insert(doc)
      .select()
      .single();

    if (error) throw error;

    res.status(201).json(data);
  } catch (err) {
    console.error('Create document error:', err);
    res.status(500).json({ error: 'Failed to create document' });
  }
});

// PUT /api/documents/:id - Update document
router.put('/:id', authMiddleware, async (req, res) => {
  try {
    const { title, content, canvasData, thumbnail } = req.body;

    const updateData = {
      updated_at: new Date().toISOString()
    };

    if (title !== undefined) updateData.title = title;
    if (content !== undefined) updateData.content = content;
    if (canvasData !== undefined) updateData.canvas_data = canvasData;
    if (thumbnail !== undefined) updateData.thumbnail = thumbnail;

    const { data, error } = await supabaseAdmin
      .from('documents')
      .update(updateData)
      .eq('id', req.params.id)
      .eq('user_id', req.user.id)
      .select()
      .single();

    if (error || !data) {
      return res.status(404).json({ error: 'Document not found or update failed' });
    }

    res.json(data);
  } catch (err) {
    console.error('Update document error:', err);
    res.status(500).json({ error: 'Failed to update document' });
  }
});

// DELETE /api/documents/:id - Delete document
router.delete('/:id', authMiddleware, async (req, res) => {
  try {
    const { error } = await supabaseAdmin
      .from('documents')
      .delete()
      .eq('id', req.params.id)
      .eq('user_id', req.user.id);

    if (error) throw error;

    res.json({ message: 'Document deleted successfully' });
  } catch (err) {
    res.status(500).json({ error: 'Failed to delete document' });
  }
});

// PATCH /api/documents/:id/rename
router.patch('/:id/rename', authMiddleware, async (req, res) => {
  try {
    const { title } = req.body;
    if (!title) return res.status(400).json({ error: 'Title required' });

    const { data, error } = await supabaseAdmin
      .from('documents')
      .update({ title, updated_at: new Date().toISOString() })
      .eq('id', req.params.id)
      .eq('user_id', req.user.id)
      .select()
      .single();

    if (error) throw error;
    res.json(data);
  } catch (err) {
    res.status(500).json({ error: 'Failed to rename document' });
  }
});

// POST /api/documents/:id/duplicate
router.post('/:id/duplicate', authMiddleware, checkDocumentLimit, async (req, res) => {
  try {
    const { data: original, error: fetchError } = await supabaseAdmin
      .from('documents')
      .select('*')
      .eq('id', req.params.id)
      .eq('user_id', req.user.id)
      .single();

    if (fetchError || !original) {
      return res.status(404).json({ error: 'Document not found' });
    }

    const copy = {
      ...original,
      id: uuidv4(),
      title: `${original.title} (Copy)`,
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString()
    };

    const { data, error } = await supabaseAdmin
      .from('documents')
      .insert(copy)
      .select()
      .single();

    if (error) throw error;
    res.status(201).json(data);
  } catch (err) {
    res.status(500).json({ error: 'Failed to duplicate document' });
  }
});

module.exports = router;
