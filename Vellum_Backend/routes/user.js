const express = require('express');
const router = express.Router();
const { supabaseAdmin } = require('../utils/supabaseClient');
const authMiddleware = require('../middleware/authMiddleware');

// GET /api/user/profile
router.get('/profile', authMiddleware, async (req, res) => {
  try {
    const { data, error } = await supabaseAdmin
      .from('profiles')
      .select('id, name, email, plan, plan_expires_at, created_at, avatar_url')
      .eq('id', req.user.id)
      .single();

    if (error || !data) {
      return res.status(404).json({ error: 'Profile not found' });
    }

    // Get monthly doc count
    const startOfMonth = new Date();
    startOfMonth.setDate(1);
    startOfMonth.setHours(0, 0, 0, 0);

    const { count: monthlyDocs } = await supabaseAdmin
      .from('documents')
      .select('*', { count: 'exact', head: true })
      .eq('user_id', req.user.id)
      .gte('created_at', startOfMonth.toISOString());

    const { count: totalDocs } = await supabaseAdmin
      .from('documents')
      .select('*', { count: 'exact', head: true })
      .eq('user_id', req.user.id);

    const planExpired = data.plan_expires_at && new Date(data.plan_expires_at) < new Date();
    const effectivePlan = (data.plan === 'pro' && !planExpired) ? 'pro' : 'free';

    res.json({
      ...data,
      plan: effectivePlan,
      monthlyDocs: monthlyDocs || 0,
      totalDocs: totalDocs || 0,
      monthlyLimit: effectivePlan === 'pro' ? null : 5
    });
  } catch (err) {
    res.status(500).json({ error: 'Failed to get profile' });
  }
});

// PUT /api/user/profile
router.put('/profile', authMiddleware, async (req, res) => {
  try {
    const { name, avatar_url } = req.body;
    const updateData = { updated_at: new Date().toISOString() };

    if (name) updateData.name = name;
    if (avatar_url !== undefined) updateData.avatar_url = avatar_url;

    const { data, error } = await supabaseAdmin
      .from('profiles')
      .update(updateData)
      .eq('id', req.user.id)
      .select()
      .single();

    if (error) throw error;
    res.json(data);
  } catch (err) {
    res.status(500).json({ error: 'Failed to update profile' });
  }
});

// PUT /api/user/password
router.put('/password', authMiddleware, async (req, res) => {
  try {
    const { newPassword } = req.body;
    if (!newPassword || newPassword.length < 6) {
      return res.status(400).json({ error: 'Password must be at least 6 characters' });
    }

    const { error } = await supabaseAdmin.auth.admin.updateUserById(req.user.id, {
      password: newPassword
    });

    if (error) throw error;
    res.json({ message: 'Password updated successfully' });
  } catch (err) {
    res.status(500).json({ error: 'Failed to update password' });
  }
});

// DELETE /api/user/account
router.delete('/account', authMiddleware, async (req, res) => {
  try {
    // Delete all documents
    await supabaseAdmin
      .from('documents')
      .delete()
      .eq('user_id', req.user.id);

    // Delete profile
    await supabaseAdmin
      .from('profiles')
      .delete()
      .eq('id', req.user.id);

    // Delete auth user
    await supabaseAdmin.auth.admin.deleteUser(req.user.id);

    res.json({ message: 'Account deleted successfully' });
  } catch (err) {
    res.status(500).json({ error: 'Failed to delete account' });
  }
});

module.exports = router;
