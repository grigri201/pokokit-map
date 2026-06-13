import { createClient, type SupabaseClient } from '@supabase/supabase-js';

export interface SupabasePublicConfig {
  supabaseUrl: string | undefined;
  supabasePublishableKey: string | undefined;
}

export function createSupabasePublicClient(config: SupabasePublicConfig): SupabaseClient | null {
  if (!config.supabaseUrl || !config.supabasePublishableKey) {
    return null;
  }
  return createClient(config.supabaseUrl, config.supabasePublishableKey, {
    auth: {
      persistSession: true,
      autoRefreshToken: true,
      detectSessionInUrl: true,
    },
  });
}
