const { supabaseAdmin } = require('../utils/supabaseClient');

// Check if user can create more documents (free plan: max 5/month)
const checkDocumentLimit = async (req, res, next) => {
  try {
    const userId = req.user.id;

    // Get user profile with plan
    const { data: profile, error: profileError } = await supabaseAdmin
      .from('profiles')
      .select('plan, plan_expires_at')
      .eq('id', userId)
      .single();

    if (profileError) {
      return res.status(500).json({ error: 'Could not verify user plan' });
    }

    const plan = profile?.plan || 'free';
    const planExpired = profile?.plan_expires_at && new Date(profile.plan_expires_at) < new Date();

    const effectivePlan = (plan === 'pro' && !planExpired) ? 'pro' : 'free';

    req.userPlan = effectivePlan;

    if (effectivePlan === 'pro') {
      return next(); // Pro users have unlimited access
    }

    // Check monthly document count for free users
    const startOfMonth = new Date();
    startOfMonth.setDate(1);
    startOfMonth.setHours(0, 0, 0, 0);

    const { count, error: countError } = await supabaseAdmin
      .from('documents')
      .select('*', { count: 'exact', head: true })
      .eq('user_id', userId)
      .gte('created_at', startOfMonth.toISOString());

    if (countError) {
      return res.status(500).json({ error: 'Could not check document limit' });
    }

    if (count >= 5) {
      return res.status(403).json({
        error: 'Monthly document limit reached',
        message: 'Free plan allows up to 5 documents per month. Upgrade to Pro for unlimited access.',
        currentCount: count,
        limit: 5,
        upgradeTo: 'pro',
        upgradePrice: 'R$ 4,90/mês'
      });
    }

    req.docsThisMonth = count;
    next();
  } catch (err) {
    console.error('Plan middleware error:', err);
    res.status(500).json({ error: 'Failed to check plan limits' });
  }
};

module.exports = { checkDocumentLimit };
