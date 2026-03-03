import { Router, Request, Response } from 'express'
import Stripe from 'stripe'
import { supabaseAdmin } from '../utils/supabase'
import { authMiddleware, AuthRequest } from '../middleware/auth.middleware'
import { logger } from '../utils/logger'

export const stripeRoutes = Router()

// ─────────────────────────────────────────────────────────────
// STRIPE CONFIG
// ─────────────────────────────────────────────────────────────
if (!process.env.STRIPE_SECRET_KEY) {
  throw new Error('STRIPE_SECRET_KEY não configurada')
}

const stripe = new Stripe(process.env.STRIPE_SECRET_KEY, {
  apiVersion: '2023-10-16',
})

// ─────────────────────────────────────────────────────────────
// CREATE CHECKOUT SESSION
// ─────────────────────────────────────────────────────────────
stripeRoutes.post(
  '/create-checkout',
  authMiddleware,
  async (req: AuthRequest, res: Response) => {
    try {
      const { priceId } = req.body

      if (!priceId) {
        return res.status(400).json({ error: 'priceId é obrigatório' })
      }

      if (!process.env.FRONTEND_URL) {
        return res.status(500).json({ error: 'FRONTEND_URL não configurada' })
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

      res.json({
        sessionId: session.id,
        url: session.url,
      })
    } catch (err: any) {
      logger.error('Stripe checkout error:', err)
      res.status(500).json({ error: err.message || 'Erro ao criar checkout' })
    }
  }
)

// ─────────────────────────────────────────────────────────────
// CUSTOMER PORTAL
// ─────────────────────────────────────────────────────────────
stripeRoutes.post(
  '/portal',
  authMiddleware,
  async (req: AuthRequest, res: Response) => {
    try {
      if (!process.env.FRONTEND_URL) {
        return res.status(500).json({ error: 'FRONTEND_URL não configurada' })
      }

      const { data: profile, error } = await supabaseAdmin
        .from('profiles')
        .select('stripe_customer_id')
        .eq('id', req.user?.id)
        .single()

      if (error || !profile?.stripe_customer_id) {
        return res.status(400).json({ error: 'Cliente Stripe não encontrado' })
      }

      const session = await stripe.billingPortal.sessions.create({
        customer: profile.stripe_customer_id,
        return_url: `${process.env.FRONTEND_URL}/settings`,
      })

      res.json({ url: session.url })
    } catch (err: any) {
      logger.error('Stripe portal error:', err)
      res.status(500).json({ error: err.message || 'Erro no portal Stripe' })
    }
  }
)

// ─────────────────────────────────────────────────────────────
// WEBHOOK
// IMPORTANTE: precisa usar express.raw() na rota principal
// ─────────────────────────────────────────────────────────────
stripeRoutes.post(
  '/webhook',
  async (req: Request, res: Response) => {
    const sig = req.headers['stripe-signature']
    const webhookSecret = process.env.STRIPE_WEBHOOK_SECRET

    if (!sig || !webhookSecret) {
      return res.status(400).json({ error: 'Webhook mal configurado' })
    }

    let event: Stripe.Event

    try {
      event = stripe.webhooks.constructEvent(
        req.body,
        sig,
        webhookSecret
      )
    } catch (err: any) {
      logger.error('Webhook signature verification failed:', err.message)
      return res.status(400).json({ error: `Webhook error: ${err.message}` })
    }

    try {
      switch (event.type) {

        case 'checkout.session.completed': {
          const session = event.data.object as Stripe.Checkout.Session
          const userId = session.metadata?.userId
          const customerId = session.customer as string

          if (userId && customerId) {
            await supabaseAdmin.from('profiles').upsert({
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

            logger.info(`Subscription updated: ${status}`)
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

            logger.info(`Subscription canceled`)
          }
          break
        }

        case 'invoice.payment_failed': {
          const invoice = event.data.object as Stripe.Invoice
          logger.warn(`Pagamento falhou para cliente ${invoice.customer}`)
          break
        }

        default:
          logger.debug(`Evento não tratado: ${event.type}`)
      }

      res.json({ received: true })
    } catch (err: any) {
      logger.error('Webhook processing error:', err)
      res.status(500).json({ error: 'Webhook processing failed' })
    }
  }
)
