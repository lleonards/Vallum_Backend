-- ================================================================
-- Vellum Editor — Supabase Database Setup
-- Execute este SQL no SQL Editor do Supabase:
-- https://app.supabase.com → seu projeto → SQL Editor
-- ================================================================

-- 1. Extensão UUID
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

-- ================================================================
-- 2. Tabela: profiles (dados extras de cada usuário)
-- ================================================================
CREATE TABLE IF NOT EXISTS public.profiles (
  id                           UUID PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  email                        TEXT,
  full_name                    TEXT,
  plan                         TEXT DEFAULT 'free' CHECK (plan IN ('free', 'pro')),
  stripe_customer_id           TEXT UNIQUE,
  stripe_subscription_id       TEXT,
  documents_created_this_month INTEGER DEFAULT 0,
  month_reset_date             TIMESTAMP WITH TIME ZONE DEFAULT DATE_TRUNC('month', NOW()),
  created_at                   TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  updated_at                   TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- ================================================================
-- 3. Tabela: documents
-- ================================================================
CREATE TABLE IF NOT EXISTS public.documents (
  id            UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  user_id       UUID REFERENCES auth.users(id) ON DELETE CASCADE NOT NULL,
  title         TEXT NOT NULL DEFAULT 'Documento sem título',
  content       JSONB DEFAULT '{"pages": []}',
  thumbnail_url TEXT,
  created_at    TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  updated_at    TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- Índices para performance
CREATE INDEX IF NOT EXISTS idx_documents_user_id ON documents(user_id);
CREATE INDEX IF NOT EXISTS idx_documents_updated_at ON documents(updated_at DESC);

-- ================================================================
-- 4. Row Level Security (RLS)
-- ================================================================
ALTER TABLE public.profiles  ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.documents ENABLE ROW LEVEL SECURITY;

-- Profiles: cada usuário vê/edita apenas seu próprio perfil
CREATE POLICY "profiles_select_own" ON public.profiles
  FOR SELECT USING (auth.uid() = id);

CREATE POLICY "profiles_update_own" ON public.profiles
  FOR UPDATE USING (auth.uid() = id);

-- Documents: cada usuário só acessa seus próprios documentos
CREATE POLICY "documents_select_own" ON public.documents
  FOR SELECT USING (auth.uid() = user_id);

CREATE POLICY "documents_insert_own" ON public.documents
  FOR INSERT WITH CHECK (auth.uid() = user_id);

CREATE POLICY "documents_update_own" ON public.documents
  FOR UPDATE USING (auth.uid() = user_id);

CREATE POLICY "documents_delete_own" ON public.documents
  FOR DELETE USING (auth.uid() = user_id);

-- ================================================================
-- 5. Trigger: criar profile automaticamente ao registrar usuário
-- ================================================================
CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER SET search_path = public
AS $$
BEGIN
  INSERT INTO public.profiles (id, email, full_name)
  VALUES (
    NEW.id,
    NEW.email,
    NEW.raw_user_meta_data->>'full_name'
  )
  ON CONFLICT (id) DO NOTHING;
  RETURN NEW;
END;
$$;

-- Remove trigger antigo se existir
DROP TRIGGER IF EXISTS on_auth_user_created ON auth.users;

CREATE TRIGGER on_auth_user_created
  AFTER INSERT ON auth.users
  FOR EACH ROW EXECUTE FUNCTION public.handle_new_user();

-- ================================================================
-- 6. Função: updated_at automático
-- ================================================================
CREATE OR REPLACE FUNCTION public.set_updated_at()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$;

CREATE TRIGGER set_documents_updated_at
  BEFORE UPDATE ON public.documents
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

CREATE TRIGGER set_profiles_updated_at
  BEFORE UPDATE ON public.profiles
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

-- ================================================================
-- ✅ Setup concluído!
-- Agora configure as variáveis de ambiente no .env do backend.
-- ================================================================
