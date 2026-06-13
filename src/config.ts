export interface AppConfig {
  apiBaseUrl: string;
  signInUrl: string;
  supabaseUrl: string | undefined;
  supabasePublishableKey: string | undefined;
}

export function readAppConfig(): AppConfig {
  const env = import.meta.env;
  return {
    apiBaseUrl: env.VITE_POKOKIT_API_BASE_URL || '',
    signInUrl: 'https://gallery.pokokit.com',
    supabaseUrl: env.VITE_SUPABASE_URL || undefined,
    supabasePublishableKey: env.VITE_SUPABASE_PUBLISHABLE_KEY || undefined,
  };
}
