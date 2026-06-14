export interface AppConfig {
  apiBaseUrl: string;
  appUrl: string;
  supabaseUrl: string | undefined;
  supabasePublishableKey: string | undefined;
}

const defaultPokokitApiBaseUrl = 'https://scene-api.pokokit.com';
const defaultMapAppUrl = 'https://map.pokokit.com';

export function readAppConfig(): AppConfig {
  const env = import.meta.env;
  return {
    apiBaseUrl: normalizeBaseUrl(env.VITE_POKOKIT_API_BASE_URL, defaultPokokitApiBaseUrl),
    appUrl: normalizeBaseUrl(env.VITE_MAP_APP_URL, defaultMapAppUrl),
    supabaseUrl: normalizeOptionalUrl(env.VITE_SUPABASE_URL),
    supabasePublishableKey: normalizeOptionalSecret(env.VITE_SUPABASE_PUBLISHABLE_KEY),
  };
}

function normalizeBaseUrl(value: string | undefined, fallback: string): string {
  const raw = value?.trim() || fallback;
  try {
    return new URL(raw).toString().replace(/\/$/, '');
  } catch {
    return new URL(fallback).toString().replace(/\/$/, '');
  }
}

function normalizeOptionalUrl(value: string | undefined): string | undefined {
  const raw = value?.trim();
  if (!raw || isPlaceholder(raw)) {
    return undefined;
  }
  try {
    return new URL(raw).toString().replace(/\/$/, '');
  } catch {
    return undefined;
  }
}

function normalizeOptionalSecret(value: string | undefined): string | undefined {
  const raw = value?.trim();
  return raw && !isPlaceholder(raw) ? raw : undefined;
}

function isPlaceholder(value: string): boolean {
  return /\breplace\b/i.test(value) || /\bplaceholder\b/i.test(value) || /\bexample\b/i.test(value);
}
