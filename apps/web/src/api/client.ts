const BASE = '/api';
const UPLOAD_BASE =
  (import.meta.env.VITE_UPLOAD_API_BASE as string | undefined)?.replace(/\/+$/, '') || BASE;

export class ApiError extends Error {
  constructor(public status: number, message: string) {
    super(message);
    this.name = 'ApiError';
  }
}

function request<T = unknown>(base: string, path: string, init: RequestInit = {}): Promise<T> {
  return fetch(base + path, {
    credentials: 'include',
    headers: {
      ...(init.body && !(init.body instanceof FormData) ? { 'Content-Type': 'application/json' } : {}),
      ...(init.headers ?? {}),
    },
    ...init,
  }).then(async (res) => {
    if (!res.ok) {
      const text = await res.text();
      let msg = text || res.statusText;
      try {
        const j = JSON.parse(text);
        msg = j.error || j.message || msg;
      } catch {
        // body wasn't JSON
      }
      throw new ApiError(res.status, msg);
    }
    if (res.headers.get('content-type')?.includes('application/json')) {
      return (await res.json()) as T;
    }
    return undefined as T;
  });
}

export const uploadApiUrl = (path: string) => UPLOAD_BASE + path;

export async function api<T = unknown>(path: string, init: RequestInit = {}): Promise<T> {
  return request<T>(BASE, path, init);
}

export async function uploadApi<T = unknown>(path: string, init: RequestInit = {}): Promise<T> {
  return request<T>(UPLOAD_BASE, path, init);
}
