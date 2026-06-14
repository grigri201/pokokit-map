import { createClient, type Session, type SupabaseClient } from '@supabase/supabase-js';

export interface SupabasePublicConfig {
  supabaseUrl: string | undefined;
  supabasePublishableKey: string | undefined;
}

export interface IslandAuthClient {
  getSession(): Promise<Session | null>;
  onSessionChange(callback: (session: Session | null, event: string) => void): () => void;
  signIn(email: string, password: string): Promise<{ error: string | null; session: Session | null }>;
  signUp(email: string, password: string, nickname: string, redirectTo: string): Promise<{ error: string | null; session: Session | null }>;
  signOut(): Promise<void>;
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

export function createIslandAuthClient(config: SupabasePublicConfig): IslandAuthClient | null {
  const supabase = createSupabasePublicClient(config);
  return supabase ? new SupabaseIslandAuthClient(supabase) : null;
}

class SupabaseIslandAuthClient implements IslandAuthClient {
  constructor(private readonly supabase: SupabaseClient) {}

  async getSession(): Promise<Session | null> {
    const { data, error } = await this.supabase.auth.getSession();
    if (error) {
      return null;
    }
    return data.session;
  }

  onSessionChange(callback: (session: Session | null, event: string) => void): () => void {
    const { data } = this.supabase.auth.onAuthStateChange((event, session) => {
      callback(session, event);
    });
    return () => data.subscription.unsubscribe();
  }

  async signIn(email: string, password: string): Promise<{ error: string | null; session: Session | null }> {
    const { data, error } = await this.supabase.auth.signInWithPassword({ email, password });
    return { error: error?.message ?? null, session: data.session };
  }

  async signUp(email: string, password: string, nickname: string, redirectTo: string): Promise<{ error: string | null; session: Session | null }> {
    const { data, error } = await this.supabase.auth.signUp({
      email,
      password,
      options: {
        emailRedirectTo: redirectTo,
        data: {
          nickname: nickname.trim(),
        },
      },
    });
    return { error: error?.message ?? null, session: data.session };
  }

  async signOut(): Promise<void> {
    await this.supabase.auth.signOut();
  }
}
