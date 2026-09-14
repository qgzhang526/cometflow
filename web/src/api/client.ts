import { ref } from 'vue';

/**
 * serve API 客户端。
 *
 * 约定：所有响应都是 `{ ok, data } | { ok:false, error }` 信封，这里统一拆包，
 * 把错误抛成 ApiError，界面只处理「成功数据」与「人话错误信息」。
 */

export class ApiError extends Error {
  readonly status: number;
  readonly code: string;
  /** 结构化错误细节（例如 spec 基线冲突的 conflicts 列表）。 */
  readonly details: unknown;

  constructor(message: string, status: number, code: string, details?: unknown) {
    super(message);
    this.name = 'ApiError';
    this.status = status;
    this.code = code;
    this.details = details;
  }
}

interface Envelope<T> {
  ok: boolean;
  data: T;
  error?: { code: string; message: string; details?: unknown };
}

const TOKEN_KEY = 'cometflow_token';

/** 服务端拒绝了凭据（401）。界面据此清掉坏 token 并提示重新粘贴，而不是静默空白。 */
export const tokenRejected = ref(false);

let token = readStoredToken();

function readStoredToken(): string {
  try {
    return window.localStorage.getItem(TOKEN_KEY) ?? '';
  } catch {
    return '';
  }
}

/** 首次访问支持 `?token=...`（serve 启动时打印的地址），随后落到 localStorage 并清掉地址栏。 */
export function initTokenFromUrl(): void {
  const urlToken = new URLSearchParams(window.location.search).get('token');
  if (!urlToken) return;
  setToken(urlToken);
  const url = new URL(window.location.href);
  url.searchParams.delete('token');
  window.history.replaceState(null, '', url.pathname + url.search + url.hash);
}

export function getToken(): string {
  return token;
}

export function setToken(next: string): void {
  token = next.trim();
  tokenRejected.value = false;
  try {
    if (token === '') window.localStorage.removeItem(TOKEN_KEY);
    else window.localStorage.setItem(TOKEN_KEY, token);
  } catch {
    // localStorage 不可用时退化为「本次会话有效」。
  }
}

export function hasToken(): boolean {
  return token !== '';
}

/** SSE 无法自定义请求头，只能把 token 放在查询串上。 */
export function apiUrl(path: string, query: Record<string, string> = {}): string {
  const params = new URLSearchParams(query);
  const suffix = params.toString();
  return '/api' + path + (suffix === '' ? '' : '?' + suffix);
}

/**
 * EventSource 专用地址。
 *
 * 常规请求一律走 Authorization 头，token 只出现在这里：否则每次 API 调用都会
 * 把凭证留在服务端日志与浏览器历史里。
 */
export function eventStreamUrl(): string {
  return apiUrl('/events', { token });
}

export interface RequestOptions {
  method?: 'GET' | 'POST' | 'PUT' | 'DELETE';
  body?: unknown;
  query?: Record<string, string>;
}

export async function api<T>(path: string, options: RequestOptions = {}): Promise<T> {
  const headers: Record<string, string> = { Authorization: 'Bearer ' + token };
  if (options.body !== undefined) headers['Content-Type'] = 'application/json';
  const url = apiUrl(path, options.query ?? {});
  const response = await fetch(url, {
    method: options.method ?? 'GET',
    headers,
    body: options.body === undefined ? undefined : JSON.stringify(options.body),
  });
  let payload: Envelope<T> | null = null;
  try {
    payload = (await response.json()) as Envelope<T>;
  } catch {
    payload = null;
  }
  if (!response.ok || payload === null || payload.ok === false) {
    const message = payload?.error?.message ?? 'HTTP ' + response.status;
    if (response.status === 401) tokenRejected.value = true;
    // 失败请求带路径落一条 warn，便于在浏览器控制台定位是哪个端点在报错。
    console.warn('[api] ' + (options.method ?? 'GET') + ' ' + path + ' → ' + response.status + ' ' + message);
    throw new ApiError(message, response.status, payload?.error?.code ?? 'http-error', payload?.error?.details);
  }
  return payload.data;
}

export function errorMessage(error: unknown): string {
  if (error instanceof ApiError) return error.message;
  if (error instanceof Error) return error.message;
  return String(error);
}
