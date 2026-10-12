import type { Cycle, Profile } from '@shared/types';

/** En dev : proxy Vite (« /api »). En prod : URL du Worker, définie à la construction. */
const BASE = (import.meta.env.VITE_API_URL as string | undefined)?.replace(/\/$/, '') ?? '';

export class ApiError extends Error {
  constructor(
    public status: number,
    message: string,
  ) {
    super(message);
  }
}

async function request<T>(method: string, path: string, token: string | null, body?: unknown): Promise<T> {
  const res = await fetch(BASE + path, {
    method,
    headers: {
      ...(body !== undefined ? { 'Content-Type': 'application/json' } : {}),
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });
  if (!res.ok) throw new ApiError(res.status, `${method} ${path} → ${res.status}`);
  return (await res.json()) as T;
}

export const api = {
  createAnonymousAccount: () => request<{ token: string; userId: string }>('POST', '/api/auth/anonymous', null),
  me: (token: string) => request<{ profile: Profile | null; cycles: Cycle[] }>('GET', '/api/me', token),
  putProfile: (token: string, profile: Profile) => request<{ ok: true }>('PUT', '/api/profile', token, profile),
  postCycle: (token: string, cycle: Cycle) => request<{ ok: true }>('POST', '/api/cycles', token, cycle),
  pushKey: () => request<{ publicKey: string }>('GET', '/api/push/key', null),
  subscribePush: (token: string, sub: PushSubscriptionJSON) => request<{ ok: true }>('POST', '/api/push/subscribe', token, sub),
  unsubscribePush: (token: string, endpoint: string) => request<{ ok: true }>('DELETE', '/api/push/subscribe', token, { endpoint }),
  deleteAccount: (token: string) => request<{ ok: true }>('DELETE', '/api/me', token),
};
