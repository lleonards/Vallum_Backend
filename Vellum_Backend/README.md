# 📖 VELLUM - Guia Completo de Configuração e Deploy

## 🚀 Visão Geral

**Vellum** é um editor de documentos profissional estilo Canva com:
- Editor visual canvas (arrastar/soltar textos, imagens, formas)
- Editor e importação de PDF
- Conversão entre múltiplos formatos
- Zoom de até 1500%
- Tema claro e escuro
- Responsivo para mobile
- Autenticação com Supabase
- Planos Gratuito (5 docs/mês) e Pro (R$ 4,90/mês via Stripe)

---

## 📁 Estrutura do Projeto

```
vellum-backend/    → API Node.js + Express
vellum-frontend/   → React App
```

---

## ⚙️ PASSO 1: Configurar o Supabase

1. Acesse [supabase.com](https://supabase.com) e crie um projeto
2. No SQL Editor, execute o arquivo: `vellum-backend/supabase-schema.sql`
3. Nas Configurações do projeto, copie:
   - **Project URL** → `SUPABASE_URL`
   - **anon key** → `SUPABASE_ANON_KEY`
   - **service_role key** → `SUPABASE_SERVICE_KEY`

---

## 💳 PASSO 2: Configurar o Stripe

1. Acesse [stripe.com](https://stripe.com) e crie uma conta
2. No Dashboard, crie um produto:
   - Nome: "Vellum Pro"
   - Preço: R$ 4,90 / mês (recorrente)
   - Copie o **Price ID** → `STRIPE_PRO_PRICE_ID`
3. Copie as chaves da API:
   - **Publishable key** → `REACT_APP_STRIPE_PUBLISHABLE_KEY`
   - **Secret key** → `STRIPE_SECRET_KEY`
4. Configure o Webhook no Stripe Dashboard:
   - URL: `https://seu-backend.onrender.com/api/payments/webhook`
   - Eventos: `checkout.session.completed`, `customer.subscription.updated`, `customer.subscription.deleted`, `invoice.payment_failed`
   - Copie o **Webhook Secret** → `STRIPE_WEBHOOK_SECRET`

---

## 🌐 PASSO 3: Deploy no Render

### Backend

1. Faça upload da pasta `vellum-backend` para um repositório GitHub
2. No Render, clique em **New Web Service**
3. Conecte o repositório
4. Configure:
   - **Build Command**: `npm install`
   - **Start Command**: `node server.js`
   - **Environment**: Node
5. Adicione as variáveis de ambiente:

```env
NODE_ENV=production
PORT=10000
SUPABASE_URL=https://xxxxxxxx.supabase.co
SUPABASE_SERVICE_KEY=eyJhbGci...
SUPABASE_ANON_KEY=eyJhbGci...
STRIPE_SECRET_KEY=sk_live_...
STRIPE_WEBHOOK_SECRET=whsec_...
STRIPE_PRO_PRICE_ID=price_...
FRONTEND_URL=https://vellum-frontend.onrender.com
```

6. Salve e faça o deploy. Copie a URL do serviço (ex: `https://vellum-backend.onrender.com`)

### Frontend

1. Faça upload da pasta `vellum-frontend` para GitHub
2. No Render, clique em **New Static Site**
3. Conecte o repositório
4. Configure:
   - **Build Command**: `npm install && npm run build`
   - **Publish Directory**: `build`
5. Adicione as variáveis de ambiente:

```env
REACT_APP_API_URL=https://vellum-backend.onrender.com/api
REACT_APP_SUPABASE_URL=https://xxxxxxxx.supabase.co
REACT_APP_SUPABASE_ANON_KEY=eyJhbGci...
REACT_APP_STRIPE_PUBLISHABLE_KEY=pk_live_...
REACT_APP_NAME=Vellum
```

6. Salve e faça o deploy

---

## 💻 Rodar Localmente

### Backend
```bash
cd vellum-backend
cp .env.example .env
# Edite o .env com suas credenciais
npm install
npm run dev
```

### Frontend
```bash
cd vellum-frontend
cp .env.example .env
# Edite o .env com suas credenciais
npm install
npm start
```

---

## 📡 Endpoints da API

### Auth
- `POST /api/auth/register` - Criar conta
- `POST /api/auth/login` - Entrar
- `POST /api/auth/refresh` - Renovar token
- `POST /api/auth/forgot-password` - Recuperar senha

### Documentos
- `GET /api/documents` - Listar documentos
- `POST /api/documents` - Criar documento
- `GET /api/documents/:id` - Buscar documento
- `PUT /api/documents/:id` - Atualizar documento
- `DELETE /api/documents/:id` - Excluir documento
- `PATCH /api/documents/:id/rename` - Renomear
- `POST /api/documents/:id/duplicate` - Duplicar

### Conversão
- `POST /api/conversion/upload` - Upload e conversão
- `POST /api/conversion/download` - Download em formato
- `GET /api/conversion/formats` - Listar formatos suportados

### Pagamentos
- `POST /api/payments/create-checkout` - Iniciar checkout Stripe
- `POST /api/payments/create-portal` - Gerenciar assinatura
- `POST /api/payments/webhook` - Webhook Stripe
- `GET /api/payments/status` - Status da assinatura

### Usuário
- `GET /api/user/profile` - Perfil do usuário
- `PUT /api/user/profile` - Atualizar perfil
- `PUT /api/user/password` - Alterar senha
- `DELETE /api/user/account` - Excluir conta

---

## 🎨 Funcionalidades do Editor

### Atalhos de Teclado
- `Ctrl + S` - Salvar
- `Delete` / `Backspace` - Excluir elemento selecionado
- `Ctrl + Z` - Desfazer
- `Alt + Drag` - Mover o canvas (pan)
- `Scroll do mouse` - Zoom in/out

### Zoom
- Scroll do mouse sobre o canvas
- Botões + e - no canto inferior direito
- Clique no percentual para digitar valor exato (5% a 1500%)
- Botão "Fit" para ajustar à tela
- Botão "1:1" para zoom 100%

### Formatos de Upload Suportados
PDF, DOCX, DOC, PPTX, XLSX, TXT, HTML, CSV, MD, RTF, JPG, PNG, GIF, WEBP, SVG, BMP, TIFF, JSON

### Formatos de Download Suportados
PDF, DOCX, TXT, HTML, Markdown, RTF, JSON, CSV, PNG, JPEG, WEBP

---

## 🔧 Tecnologias

### Backend
- Node.js + Express.js
- Supabase (Auth + Database)
- Stripe (Pagamentos)
- Multer (Upload de arquivos)
- pdf-parse (Leitura de PDF)
- mammoth (Leitura de DOCX)
- docx (Geração de DOCX)
- sharp (Conversão de imagens)

### Frontend
- React 18
- Fabric.js (Canvas editor)
- React Router v6
- Axios
- jsPDF (Export PDF)
- file-saver (Download)
- react-hot-toast (Notificações)
- Google Fonts (Inter + Space Grotesk)

---

## 📌 Notas Importantes

1. **Plano Gratuito do Render**: Serviços ficam inativos após 15min de inatividade. Primeira requisição pode demorar ~30s.
2. **LibreOffice**: Para conversão avançada de PDF, você pode instalar o LibreOffice no servidor (Render não suporta no plano free).
3. **Stripe Webhook Local**: Use [Stripe CLI](https://stripe.com/docs/stripe-cli) para testar webhooks localmente.
4. **CORS**: Configure `FRONTEND_URL` no backend com a URL exata do seu frontend.

---

© 2024 Vellum. Desenvolvido com ❤️
