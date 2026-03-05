const express = require('express');
const router = express.Router();
const { supabaseAdmin } = require('../utils/supabaseClient');
const authMiddleware = require('../middleware/authMiddleware');
require('dotenv').config();

const stripe = require('stripe')(process.env.STRIPE_SECRET_KEY);

// POST /api/payments/create-checkout - Create Stripe Checkout Session
router.post('/create-checkout', authMiddleware, async (req, res) => {
  try {
    const userId = req.user.id;
    const userEmail = req.user.email;

    // Check if already pro
    const { data: profile } = await supabaseAdmin
      .from('profiles')
      .select('plan, stripe_customer_id')
      .eq('id', userId)
      .single();

    if (profile?.plan === 'pro') {
      return res.status(400).json({ error: 'User already has Pro plan' });
    }

    // Create or retrieve Stripe customer
    let customerId = profile?.stripe_customer_id;
    if (!customerId) {
      const customer = await stripe.customers.create({
        email: userEmail,
        metadata: { supabase_user_id: userId }
      });
      customerId = customer.id;

      await supabaseAdmin
        .from('profiles')
        .update({ stripe_customer_id: customerId })
        .eq('id', userId);
    }

    // Create checkout session
    const session = await stripe.checkout.sessions.create({
      customer: customerId,
      payment_method_types: ['card'],
      line_items: [{
        price: process.env.STRIPE_PRO_PRICE_ID,
        quantity: 1
      }],
      mode: 'subscription',
      success_url: `${process.env.FRONTEND_URL}/dashboard?upgraded=true&session_id={CHECKOUT_SESSION_ID}`,
      cancel_url: `${process.env.FRONTEND_URL}/pricing?cancelled=true`,
      metadata: { user_id: userId },
      subscription_data: {
        metadata: { user_id: userId }
      },
      allow_promotion_codes: true,
      billing_address_collection: 'auto',
      locale: 'pt-BR'
    });

    res.json({ url: session.url, sessionId: session.id });
  } catch (err) {
    console.error('Checkout error:', err);
    res.status(500).json({ error: 'Failed to create checkout session' });
  }
});

// POST /api/payments/create-portal - Manage subscription portal
router.post('/create-portal', authMiddleware, async (req, res) => {
  try {
    const { data: profile } = await supabaseAdmin
      .from('profiles')
      .select('stripe_customer_id')
      .eq('id', req.user.id)
      .single();

    if (!profile?.stripe_customer_id) {
      return res.status(400).json({ error: 'No subscription found' });
    }

    const session = await stripe.billingPortal.sessions.create({
      customer: profile.stripe_customer_id,
      return_url: `${process.env.FRONTEND_URL}/dashboard`
    });

    res.json({ url: session.url });
  } catch (err) {
    console.error('Portal error:', err);
    res.status(500).json({ error: 'Failed to create billing portal' });
  }
});

// POST /api/payments/webhook - Stripe Webhook Handler
router.post('/webhook', express.raw({ type: 'application/json' }), async (req, res) => {
  const sig = req.headers['stripe-signature'];
  let event;

  try {
    event = stripe.webhooks.constructEvent(
      req.body,
      sig,
      process.env.STRIPE_WEBHOOK_SECRET
    );
  } catch (err) {
    console.error('Webhook signature verification failed:', err.message);
    return res.status(400).json({ error: `Webhook Error: ${err.message}` });
  }

  try {
    switch (event.type) {
      case 'checkout.session.completed': {
        const session = event.data.object;
        const userId = session.metadata?.user_id;
        if (userId) {
          await supabaseAdmin
            .from('profiles')
            .update({
              plan: 'pro',
              stripe_subscription_id: session.subscription,
              plan_expires_at: null
            })
            .eq('id', userId);
          console.log(`✅ User ${userId} upgraded to Pro`);
        }
        break;
      }

      case 'customer.subscription.updated': {
        const subscription = event.data.object;
        const customerId = subscription.customer;
        const { data: profile } = await supabaseAdmin
          .from('profiles')
          .select('id')
          .eq('stripe_customer_id', customerId)
          .single();

        if (profile) {
          const isActive = ['active', 'trialing'].includes(subscription.status);
          await supabaseAdmin
            .from('profiles')
            .update({
              plan: isActive ? 'pro' : 'free',
              plan_expires_at: isActive ? null : new Date(subscription.current_period_end * 1000).toISOString()
            })
            .eq('id', profile.id);
        }
        break;
      }

      case 'customer.subscription.deleted': {
        const subscription = event.data.object;
        const customerId = subscription.customer;
        const { data: profile } = await supabaseAdmin
          .from('profiles')
          .select('id')
          .eq('stripe_customer_id', customerId)
          .single();

        if (profile) {
          await supabaseAdmin
            .from('profiles')
            .update({ plan: 'free', plan_expires_at: null })
            .eq('id', profile.id);
          console.log(`⬇️ User ${profile.id} downgraded to Free`);
        }
        break;
      }

      case 'invoice.payment_failed': {
        const invoice = event.data.object;
        console.log(`⚠️ Payment failed for customer ${invoice.customer}`);
        break;
      }
    }

    res.json({ received: true });
  } catch (err) {
    console.error('Webhook processing error:', err);
    res.status(500).json({ error: 'Webhook processing failed' });
  }
});

// GET /api/payments/status - Get subscription status
router.get('/status', authMiddleware, async (req, res) => {
  try {
    const { data: profile } = await supabaseAdmin
      .from('profiles')
      .select('plan, plan_expires_at, stripe_customer_id, stripe_subscription_id')
      .eq('id', req.user.id)
      .single();

    const planExpired = profile?.plan_expires_at && new Date(profile.plan_expires_at) < new Date();
    const effectivePlan = (profile?.plan === 'pro' && !planExpired) ? 'pro' : 'free';

    res.json({
      plan: effectivePlan,
      planExpiresAt: profile?.plan_expires_at,
      hasSubscription: !!profile?.stripe_subscription_id
    });
  } catch (err) {
    res.status(500).json({ error: 'Failed to get subscription status' });
  }
});

module.exports = router;
