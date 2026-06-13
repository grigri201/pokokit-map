export interface DomainSessionUser {
  id: string;
  email?: string;
}

export type DomainSessionResult =
  | { status: 'anonymous' }
  | { status: 'authenticated'; user: DomainSessionUser }
  | { status: 'error'; message: string };

export async function restoreDomainSession(apiBaseUrl: string, fetcher: typeof fetch = fetch): Promise<DomainSessionResult> {
  const baseUrl = apiBaseUrl.replace(/\/$/, '');
  try {
    const response = await fetcher(`${baseUrl}/api/v1/auth/session`, {
      method: 'GET',
      credentials: 'include',
    });
    if (!response.ok) {
      return { status: 'error', message: '无法恢复云端登录状态，可继续本地编辑。' };
    }
    const value: unknown = await response.json();
    const user = readUser(value);
    return user ? { status: 'authenticated', user } : { status: 'anonymous' };
  } catch {
    return { status: 'error', message: '暂时无法连接 Pokokit Cloud，可继续本地编辑。' };
  }
}

function readUser(value: unknown): DomainSessionUser | null {
  if (!isRecord(value) || !isRecord(value.data)) {
    return null;
  }
  const user = value.data.user;
  if (!isRecord(user) || typeof user.id !== 'string') {
    return null;
  }
  const result: DomainSessionUser = { id: user.id };
  if (typeof user.email === 'string') {
    result.email = user.email;
  }
  return result;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
