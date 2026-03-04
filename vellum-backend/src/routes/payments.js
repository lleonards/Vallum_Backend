const express = require('express');
const router = express.Router();
const Stripe = require('stripe');
const { supabaseAdmin } = require('../db/supabase');
const authMiddleware = require('../middleware/auth');

const stripe = new Stripe(process.env.STRIPE_SECRET_KEY);

// ─── POST /api/payments/create-checkout ─────────────────────────────────────
// Cria sessão de checkout do Stripe para o plano Pro
router.post('/create-checkout', authMiddleware, async (req, res) => {
  try {
    const { data: profile } = await supabaseAdmin
      .from('profiles')
      .select('stripe_customer_id, email, plan')
      .eq('id', req.user.id)
      .single();

    if (profile?.plan === 'pro') {
      return res.status(400).json({ error: 'Você já possui o plano Pro!' });
    }

    // Criar ou reutilizar customer no Stripe
    let customerId = profile?.stripe_customer_id;
    if (!customerId) {
      const customer = await stripe.customers.create({
        email: req.user.email,
        metadata: { supabase_uid: req.user.id },
      });
      customerId = customer.id;
      await supabaseAdmin
        .from('profiles')
        .update({ stripe_customer_id: customerId })
        .eq('id', req.user.id);
    }

    const session = await stripe.checkout.sessions.create({
      customer: customerId,
      payment_method_types: ['card'],
      line_items: [
        {
          price: process.env.STRIPE_PRICE_ID, // ID do preço no Stripe
          quantity: 1,
        },
      ],
      mode: 'subscription',
      success_url: `${process.env.FRONTEND_URL}/dashboard?payment=success`,
      cancel_url: `${process.env.FRONTEND_URL}/pricing?payment=cancelled`,
      metadata: { supabase_uid: req.user.id },
      locale: 'pt-BR',
    });

    res.json({ url: session.url, sessionId: session.id });
  } catch (err) {
    console.error('Create checkout error:', err);
    res.status(500).json({ error: err.message });
  }
});

// ─── GET /api/payments/status ────────────────────────────────────────────────
// Retorna status do plano do usuário
router.get('/status', authMiddleware, async (req, res) => {
  try {
    const { data: profile, error } = await supabaseAdmin
      .from('profiles')
      .select('plan, documents_created_this_month, month_reset_date, stripe_subscription_id')
      .eq('id', req.user.id)
      .single();

    if (error) throw error;
    res.json({ profile });
  } catch (err) {
    console.error('Get status error:', err);
    res.status(500).json({ error: err.message });
  }
});

// ─── POST /api/payments/create-portal ────────────────────────────────────────
// Cria sessão do portal do cliente Stripe (cancelar/gerenciar assinatura)
router.post('/create-portal', authMiddleware, async (req, res) => {
  try {
    const { data: profile } = await supabaseAdmin
      .from('profiles')
      .select('stripe_customer_id')
      .eq('id', req.user.id)
      .single();

    if (!profile?.stripe_customer_id) {
      return res.status(400).json({ error: 'Nenhuma assinatura encontrada' });
    }

    const portalSession = await stripe.billingPortal.sessions.create({
      customer: profile.stripe_customer_id,
      return_url: `${process.env.FRONTEND_URL}/dashboard`,
    });

    res.json({ url: portalSession.url });
  } catch (err) {
    console.error('Create portal error:', err);
    res.status(500).json({ error: err.message });
  }
});

// ─── POST /api/payments/webhook ──────────────────────────────────────────────
// Webhook do Stripe para atualizar status da assinatura
router.post('/webhook', async (req, res) => {
  const sig = req.headers['stripe-signature'];
  let event;

  try {
    event = stripe.webhooks.constructEvent(
      req.body,
      sig,
      process.env.STRIPE_WEBHOOK_SECRET
    );
  } catch (err) {
    console.error('Webhook signature error:', err.message);
    return res.status(400).json({ error: `Webhook Error: ${err.message}` });
  }

  try {
    switch (event.type) {
      case 'checkout.session.completed': {
        const session = event.data.object;
        const uid = session.metadata?.supabase_uid;
        if (uid) {
          await supabaseAdmin
            .from('profiles')
            .update({
              plan: 'pro',
              stripe_subscription_id: session.subscription,
            })
            .eq('id', uid);
          console.log(`✅ Usuário ${uid} ativado como Pro`);
        }
        break;
      }

      case 'customer.subscription.deleted':
      case 'customer.subscription.paused': {
        const subscription = event.data.object;
        // Encontrar usuário pelo stripe_subscription_id
        const { data } = await supabaseAdmin
          .from('profiles')
          .select('id')
          .eq('stripe_subscription_id', subscription.id)
          .single();

        if (data) {
          await supabaseAdmin
            .from('profiles')
            .update({ plan: 'free', stripe_subscription_id: null })
            .eq('id', data.id);
          console.log(`⚠️ Assinatura cancelada para usuário ${data.id}`);
        }
        break;
      }

      case 'invoice.payment_failed': {
        console.log('❌ Falha no pagamento:', event.data.object.id);
        break;
      }
    }

    res.json({ received: true });
  } catch (err) {
    console.error('Webhook handler error:', err);
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
