import type { ApiError } from './types';

const baseUrl = import.meta.env.VITE_API_BASE_URL || 'http://127.0.0.1:8080';

export type AuthBridge = {
  getAccessToken: () => string;
  getRefreshToken: () => string;
  setTokens: (t: { accessToken: string; refreshToken?: string }) => void;
  clear: () => void;
  refreshOnce: () => Promise<boolean>;
};

let bridge: AuthBridge | null = null;
export function setAuthBridge(b: AuthBridge) { bridge = b; }

export function setTenant(orgId: string, projectId: string) {
  sessionStorage.setItem('nc_org', orgId);
  sessionStorage.setItem('nc_project', projectId);
}

function parseApiError(status: number, body: any, headers: Headers): ApiError {
  return {
    status,
    code: body?.error?.code || `HTTP_${status}`,
    message: body?.error?.message || 'Request failed',
    requestId: body?.error?.details?.requestId || headers.get('x-request-id') || undefined
  };
}

export async function http<T>(path: string, init: RequestInit = {}, retried = false): Promise<T> {
  const headers = new Headers(init.headers || {});
  headers.set('content-type', headers.get('content-type') || 'application/json');
  const token = bridge?.getAccessToken() || '';
  if (token) headers.set('authorization', `Bearer ${token}`);
  headers.set('x-organization', sessionStorage.getItem('nc_org') || 'default-org');
  headers.set('x-project', sessionStorage.getItem('nc_project') || 'default-project');
  const res = await fetch(`${baseUrl}${path}`, { ...init, headers });
  const body = await res.json().catch(() => ({}));

  if (res.status === 401 && !retried && bridge) {
    const ok = await bridge.refreshOnce();
    if (ok) return http<T>(path, init, true);
  }

  if (!res.ok) throw parseApiError(res.status, body, res.headers);
  return body as T;
}

export async function download(path: string, retried = false): Promise<Blob> {
  const headers = new Headers();
  const token = bridge?.getAccessToken() || '';
  if (token) headers.set('authorization', `Bearer ${token}`);
  headers.set('x-organization', sessionStorage.getItem('nc_org') || 'default-org');
  headers.set('x-project', sessionStorage.getItem('nc_project') || 'default-project');
  const res = await fetch(`${baseUrl}${path}`, { headers });
  if (res.status === 401 && !retried && bridge) {
    const ok = await bridge.refreshOnce();
    if (ok) return download(path, true);
  }
  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    throw parseApiError(res.status, body, res.headers);
  }
  return res.blob();
}
