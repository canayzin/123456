export type AuthTokens = { accessToken: string; refreshToken?: string };

const apiBase = import.meta.env.VITE_API_BASE_URL || 'http://127.0.0.1:8080';

async function postJson(path: string, payload: unknown) {
  const res = await fetch(`${apiBase}${path}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(payload)
  });
  const json = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(json?.error?.message || `HTTP_${res.status}`);
  return json;
}

export async function login(email: string, password: string): Promise<AuthTokens> {
  const out = await postJson('/auth/login', { email, password });
  return { accessToken: out.accessToken, refreshToken: out.refreshToken };
}

export async function signup(email: string, password: string): Promise<AuthTokens> {
  await postJson('/auth/signup', { email, password });
  return login(email, password);
}

export async function refresh(refreshToken: string): Promise<AuthTokens> {
  const out = await postJson('/auth/refresh', { refreshToken });
  return { accessToken: out.accessToken, refreshToken: out.refreshToken || refreshToken };
}
