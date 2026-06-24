import { createClient } from '@supabase/supabase-js';

// .env.local に書いたURLとカギを自動で読み込む
const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
const supabaseAnonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

// Next.js全体で使えるSupabaseのクライアントを作る
export const supabase = createClient(supabaseUrl, supabaseAnonKey);