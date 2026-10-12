import type { Cycle, Profile, WaterLookup } from '@shared/types';

/** En dev : proxy Vite (« /api »). En prod : URL du Worker, définie à la construction. */
const BASE = (import.meta.env.VITE_API_URL as string | undefined)?.replace(/\/$/, '') ?? '';

export type EmailPurpose = 'secure' | 'recover';

export class ApiError extends Error {
  constructor(
    public status: number,
    message: string,
    /** Code d'erreur renvoyé par le serveur (ex. « invalid_code »). */
    public code?: string,
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
  if (!res.ok) {
    const detail = (await res.json().catch(() => null)) as { error?: string } | null;
    throw new ApiError(res.status, `${method} ${path} → ${res.status}`, detail?.error);
  }
  return (await res.json()) as T;
}

export const api = {
  createAnonymousAccount: () => request<{ token: string; userId: string }>('POST', '/api/auth/anonymous', null),
  health: () => request<{ ok: true; emailLogin: boolean }>('GET', '/api/health', null),
  water: (postalCode: string) => request<WaterLookup>('GET', `/api/water?postalCode=${encodeURIComponent(postalCode)}`, null),
  me: (token: string) => request<{ profile: Profile | null; cycles: Cycle[]; email: string | null }>('GET', '/api/me', token),
  requestEmailCode: (email: string, purpose: EmailPurpose, token: string | null) =>
    request<{ ok: true; alreadyLinked?: boolean }>('POST', '/api/auth/email/request', token, { email, purpose }),
  verifyEmailCode: (email: string, code: string, purpose: 'secure', token: string) =>
    request<{ ok: true; email: string }>('POST', '/api/auth/email/verify', token, { email, code, purpose }),
  recoverAccount: (email: string, code: string) =>
    request<{ ok: true; token: string; userId: string }>('POST', '/api/auth/email/verify', null, { email, code, purpose: 'recover' }),
  putProfile: (token: string, profile: Profile) => request<{ ok: true }>('PUT', '/api/profile', token, profile),
  postCycle: (token: string, cycle: Cycle) => request<{ ok: true }>('POST', '/api/cycles', token, cycle),
  pushKey: () => request<{ publicKey: string }>('GET', '/api/push/key', null),
  subscribePush: (token: string, sub: PushSubscriptionJSON) => request<{ ok: true }>('POST', '/api/push/subscribe', token, sub),
  unsubscribePush: (token: string, endpoint: string) => request<{ ok: true }>('DELETE', '/api/push/subscribe', token, { endpoint }),
  deleteAccount: (token: string) => request<{ ok: true }>('DELETE', '/api/me', token),
};
