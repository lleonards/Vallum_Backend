const { createClient } = require('@supabase/supabase-js');
require('dotenv').config();

const supabaseUrl = process.env.SUPABASE_URL;
const supabaseServiceKey = process.env.SUPABASE_SERVICE_KEY;
const supabaseAnonKey = process.env.SUPABASE_ANON_KEY;

if (!supabaseUrl || !supabaseServiceKey) {
  console.error('❌ Variáveis de ambiente do Supabase não encontradas!');
  console.error('Certifique-se de definir: SUPABASE_URL, SUPABASE_SERVICE_KEY, SUPABASE_ANON_KEY');
  process.exit(1);
}

// Client admin (service_role) - ignora RLS
const supabaseAdmin = createClient(supabaseUrl, supabaseServiceKey, {
  auth: {
    autoRefreshToken: false,
    persistSession: false
  }
});

// Client anon - respeita RLS
const supabase = createClient(supabaseUrl, supabaseAnonKey || '');

module.exports = { supabase, supabaseAdmin };
