# Vellum Backend — API

Backend Node.js + Express para o Vellum Editor.

## Stack
- **Node.js** + **Express**
- **Supabase** (banco de dados + autenticação)
- **Stripe** (pagamentos)
- **pdf-parse** (extração de texto de PDFs)
- **multer** (upload de arquivos)

---

## Setup Local

### 1. Instalar dependências
```bash
npm install
```

### 2. Configurar variáveis de ambiente
```bash
cp .env.example .env
# Edite o .env com suas credenciais reais
```

### 3. Configurar banco de dados Supabase
Execute o arquivo `supabase-setup.sql` no **SQL Editor** do Supabase:
1. Acesse https://app.supabase.com
2. Vá em **SQL Editor**
3. Cole e execute o conteúdo de `supabase-setup.sql`

### 4. Configurar Stripe
1. Crie uma conta em https://stripe.com
2. Crie um produto "Vellum Pro" com preço de R$29,90/mês (recorrente)
3. Copie o `price_id` para `STRIPE_PRICE_ID` no `.env`
4. Configure o webhook em https://dashboard.stripe.com/webhooks:
   - URL: `https://seu-backend.onrender.com/api/payments/webhook`
   - Eventos: `checkout.session.completed`, `customer.subscription.deleted`, `invoice.payment_failed`

### 5. Iniciar servidor
```bash
# Desenvolvimento
npm run dev

# Produção
npm start
```

---

## Deploy no Render

1. Crie uma conta em https://render.com
2. New → **Web Service**
3. Conecte seu repositório GitHub
4. Configurações:
   - **Environment**: Node
   - **Build Command**: `npm install`
   - **Start Command**: `npm start`
5. Adicione todas as variáveis do `.env` em **Environment Variables**

---

## Endpoints

| Método | Rota | Descrição |
|--------|------|-----------|
| GET | `/health` | Health check |
| GET | `/api/documents` | Listar documentos |
| POST | `/api/documents` | Criar documento |
| GET | `/api/documents/:id` | Buscar documento |
| PUT | `/api/documents/:id` | Atualizar documento |
| DELETE | `/api/documents/:id` | Remover documento |
| POST | `/api/convert/pdf` | Converter PDF |
| POST | `/api/payments/create-checkout` | Iniciar checkout Stripe |
| GET | `/api/payments/status` | Status da assinatura |
| POST | `/api/payments/create-portal` | Portal de gerenciamento |
| POST | `/api/payments/webhook` | Webhook Stripe |

---

## Autenticação

Todos os endpoints (exceto `/health` e `/api/payments/webhook`) requerem:
```
Authorization: Bearer <supabase_jwt_token>
```

O token é obtido automaticamente pelo frontend via `@supabase/supabase-js`.
