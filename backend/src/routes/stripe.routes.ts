import { Router, Request, Response } from 'express'
import Stripe from 'stripe'
import { supabaseAdmin } from '../utils/supabase'
import { authMiddleware, AuthRequest } from '../middleware/auth.middleware'
import { logger } from '../utils/logger'

const stripe = new Stripe(process.env.STRIPE_SECRET_KEY || '', {
  apiVersion: '2023-10-16' as any,
})

export const stripeRoutes = Router()

// ── Create checkout session ───────────────────────────────────────────────────
stripeRoutes.post('/create-checkout', authMiddleware, async (req: AuthRequest, res: Response) => {
  try {
    const { priceId } = req.body
    if (!priceId) {
      res.status(400).json({ error: 'priceId é obrigatório' })
      return
    }

    const session = await stripe.checkout.sessions.create({
      mode: 'subscription',
      payment_method_types: ['card'],
      line_items: [{ price: priceId, quantity: 1 }],
      success_url: `${process.env.FRONTEND_URL}/settings?success=true`,
      cancel_url: `${process.env.FRONTEND_URL}/pricing?canceled=true`,
      customer_email: req.user?.email,
      metadata: {
        userId: req.user?.id || '',
      },
      locale: 'pt-BR',
    })

    res.json({ sessionId: session.id, url: session.url })
  } catch (err: any) {
    logger.error('Stripe checkout error:', err)
    res.status(500).json({ error: err.message })
  }
})

// ── Customer portal ───────────────────────────────────────────────────────────
stripeRoutes.post('/portal', authMiddleware, async (req: AuthRequest, res: Response) => {
  try {
    // Get customer ID from Supabase profile
    const { data: profile } = await supabaseAdmin
      .from('profiles')
      .select('stripe_customer_id')
      .eq('id', req.user?.id)
      .single()

    if (!profile?.stripe_customer_id) {
      res.status(400).json({ error: 'Cliente Stripe não encontrado' })
      return
    }

    const session = await stripe.billingPortal.sessions.create({
      customer: profile.stripe_customer_id,
      return_url: `${process.env.FRONTEND_URL}/settings`,
    })

    res.json({ url: session.url })
  } catch (err: any) {
    logger.error('Stripe portal error:', err)
    res.status(500).json({ error: err.message })
  }
})

// ── Webhook handler ───────────────────────────────────────────────────────────
stripeRoutes.post('/webhook', async (req: Request, res: Response) => {
  const sig = req.headers['stripe-signature']
  const webhookSecret = process.env.STRIPE_WEBHOOK_SECRET!

  if (!sig) {
    res.status(400).json({ error: 'Missing stripe signature' })
    return
  }

  let event: Stripe.Event
  try {
    event = stripe.webhooks.constructEvent(req.body, sig, webhookSecret)
  } catch (err: any) {
    logger.error('Webhook signature verification failed:', err.message)
    res.status(400).json({ error: `Webhook error: ${err.message}` })
    return
  }

  try {
    switch (event.type) {
      case 'checkout.session.completed': {
        const session = event.data.object as Stripe.Checkout.Session
        const userId = session.metadata?.userId
        const customerId = session.customer as string

        if (userId && customerId) {
          await supabaseAdmin
            .from('profiles')
            .upsert({
              id: userId,
              stripe_customer_id: customerId,
              plan: 'pro',
              subscription_status: 'active',
              updated_at: new Date().toISOString(),
            })
          logger.info(`User ${userId} subscribed successfully`)
        }
        break
      }

      case 'customer.subscription.updated': {
        const subscription = event.data.object as Stripe.Subscription
        const customerId = subscription.customer as string

        const { data: profile } = await supabaseAdmin
          .from('profiles')
          .select('id')
          .eq('stripe_customer_id', customerId)
          .single()

        if (profile) {
          const status = subscription.status
          const plan = status === 'active' ? 'pro' : 'free'
          
          await supabaseAdmin
            .from('profiles')
            .update({
              plan,
              subscription_status: status,
              updated_at: new Date().toISOString(),
            })
            .eq('id', profile.id)

          logger.info(`Subscription updated for customer ${customerId}: ${status}`)
        }
        break
      }

      case 'customer.subscription.deleted': {
        const subscription = event.data.object as Stripe.Subscription
        const customerId = subscription.customer as string

        const { data: profile } = await supabaseAdmin
          .from('profiles')
          .select('id')
          .eq('stripe_customer_id', customerId)
          .single()

        if (profile) {
          await supabaseAdmin
            .from('profiles')
            .update({
              plan: 'free',
              subscription_status: 'canceled',
              updated_at: new Date().toISOString(),
            })
            .eq('id', profile.id)

          logger.info(`Subscription canceled for customer ${customerId}`)
        }
        break
      }

      case 'invoice.payment_failed': {
        const invoice = event.data.object as Stripe.Invoice
        logger.warn(`Payment failed for customer ${invoice.customer}`)
        break
      }

      default:
        logger.debug(`Unhandled webhook event: ${event.type}`)
    }

    res.json({ received: true })
  } catch (err: any) {
    logger.error('Webhook processing error:', err)
    res.status(500).json({ error: 'Webhook processing failed' })
  }
})
