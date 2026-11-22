export type WebSession = {
  userId: string;
  actorType: 'PATIENT' | 'DOCTOR' | 'STAFF';
  capabilities: string[];
  tokenVersion?: number;
  lease?: (action: string) => Promise<string>;
};

export type GatewayTransport = (
  url: string,
  init?: RequestInit,
) => Promise<Response>;

/** Public adapter boundary; Hưng supplies transport/session and the Identity redirect callback. */
export type WebRuntime = {
  transport: GatewayTransport;
  session?: WebSession;
  onUnauthorized: () => void;
};

export function withAuthRedirect(
  transport: GatewayTransport,
  onUnauthorized: () => void,
): GatewayTransport {
  return async (url, init) => {
    const response = await transport(url, init);
    if (
      response.status === 401 &&
      !(await isExpiredAuthorizationLease(response))
    )
      onUnauthorized();
    return response;
  };
}

async function isExpiredAuthorizationLease(
  response: Response,
): Promise<boolean> {
  if (response.status !== 401) return false;
  const body = await response
    .clone()
    .json()
    .catch(() => null);
  return body?.error?.code === 'AUTHZ_LEASE_EXPIRED';
}

declare global {
  interface Window {
    umcCareWebRuntime?: WebRuntime;
  }
}

// In-memory token & session storage
let currentAccessToken: string | null = null;
let currentRefreshToken: string | null = null;
let currentSession: WebSession | undefined = undefined;

// Khôi phục phiên từ sessionStorage khi F5/reload (không lưu mật khẩu hay OTP)
if (typeof window !== 'undefined') {
  try {
    const savedAccess = window.sessionStorage.getItem('umc_access_token');
    const savedRefresh = window.sessionStorage.getItem('umc_refresh_token');
    const savedSession = window.sessionStorage.getItem('umc_session');
    if (savedAccess && savedSession) {
      currentAccessToken = savedAccess;
      currentRefreshToken = savedRefresh;
      currentSession = JSON.parse(savedSession);
      if (currentSession) {
        currentSession.lease = fetchAuthorizationLease;
      }
    }
  } catch {
    // Không chặn ứng dụng nếu sessionStorage bị hạn chế
  }
}

function syncStorage(rememberMe = true) {
  if (typeof window === 'undefined') return;
  try {
    if (currentAccessToken && currentSession) {
      window.sessionStorage.setItem('umc_access_token', currentAccessToken);
      if (currentRefreshToken) {
        window.sessionStorage.setItem('umc_refresh_token', currentRefreshToken);
      }
      // Loại bỏ lease function trước khi serialize
      const { lease: _, ...serializableSession } = currentSession;
      window.sessionStorage.setItem(
        'umc_session',
        JSON.stringify(serializableSession),
      );
      if (rememberMe) {
        window.localStorage.setItem('umc_remember', 'true');
      }
    } else {
      window.sessionStorage.removeItem('umc_access_token');
      window.sessionStorage.removeItem('umc_refresh_token');
      window.sessionStorage.removeItem('umc_session');
      window.localStorage.removeItem('umc_remember');
    }
  } catch {
    // Không làm gián đoạn luồng chính
  }
}

let authGeneration = 0;

export function clearAuthSession() {
  authGeneration++;
  refreshPromise = null;
  currentAccessToken = null;
  currentRefreshToken = null;
  currentSession = undefined;
  syncStorage(false);
}

let refreshPromise: Promise<string | null> | null = null;

/**
 * Làm mới access token bằng refresh token.
 * Đồng bộ hóa các request đồng thời để tránh race-condition xoay token.
 */
export async function refreshAccessToken(): Promise<string | null> {
  if (!currentRefreshToken) return null;
  if (refreshPromise) return refreshPromise;

  const generationAtStart = authGeneration;
  refreshPromise = (async () => {
    try {
      const response = await fetch('/api/v1/auth/refresh', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Idempotency-Key': crypto.randomUUID(),
        },
        body: JSON.stringify({ refreshToken: currentRefreshToken }),
      });

      if (generationAtStart !== authGeneration) {
        return null;
      }

      if (!response.ok) {
        clearAuthSession();
        notifyUnauthorized();
        return null;
      }

      const result = await response.json();
      const data = result?.data;
      if (data?.accessToken) {
        if (generationAtStart === authGeneration) {
          currentAccessToken = data.accessToken;
          if (data.refreshToken) {
            currentRefreshToken = data.refreshToken;
          }
          syncStorage();
          return data.accessToken;
        }
        return null;
      }

      clearAuthSession();
      notifyUnauthorized();
      return null;
    } catch {
      return null;
    } finally {
      if (generationAtStart === authGeneration) {
        refreshPromise = null;
      }
    }
  })();

  return refreshPromise;
}

/**
 * Lấy authorization lease ngắn hạn cho các hành động nhạy cảm (CA-004, DI-009, CL-009,...)
 */
export async function fetchAuthorizationLease(action: string): Promise<string> {
  if (!currentAccessToken) {
    throw new Error('Chưa đăng nhập, không thể cấp authorization lease.');
  }

  const query = action ? `?action=${encodeURIComponent(action)}` : '';
  let response = await fetch(`/api/v1/auth/session${query}`, {
    headers: {
      Authorization: `Bearer ${currentAccessToken}`,
    },
  });

  if (response.status === 401) {
    const newToken = await refreshAccessToken();
    if (newToken) {
      response = await fetch(`/api/v1/auth/session${query}`, {
        headers: {
          Authorization: `Bearer ${newToken}`,
        },
      });
    }
  }

  if (!response.ok) {
    throw new Error(
      `Không thể lấy authorization lease (HTTP ${response.status}).`,
    );
  }

  const json = await response.json();
  const lease = json?.data?.authorizationLease;
  if (!lease) {
    throw new Error('Máy chủ không cấp authorization lease cho thao tác này.');
  }

  return lease;
}

/**
 * Thực hiện đăng nhập thật qua POST /api/v1/auth/login và tải quyền từ GET /api/v1/auth/session
 */
export async function loginUser(
  phone: string,
  password: string,
  rememberMe = false,
): Promise<WebSession> {
  const response = await fetch('/api/v1/auth/login', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Idempotency-Key': crypto.randomUUID(),
    },
    body: JSON.stringify({ phone, password }),
  });

  const result = await response.json().catch(() => null);

  if (!response.ok) {
    const err = new Error(
      result?.error?.message || `Đăng nhập thất bại (${response.status})`,
    ) as Error & { status?: number; code?: string };
    err.status = response.status;
    err.code = result?.error?.code;
    throw err;
  }

  const loginData = result?.data;
  if (!loginData?.accessToken) {
    throw new Error('Dữ liệu đăng nhập phản hồi không hợp lệ.');
  }

  authGeneration++;
  refreshPromise = null;
  currentAccessToken = loginData.accessToken;
  currentRefreshToken = loginData.refreshToken;

  // Lấy chi tiết phiên và capabilities từ server
  let session: WebSession;
  try {
    const sessionRes = await fetch('/api/v1/auth/session', {
      headers: {
        Authorization: `Bearer ${currentAccessToken}`,
      },
    });

    if (sessionRes.ok) {
      const sJson = await sessionRes.json();
      const sData = sJson?.data;
      if (
        typeof sData?.userId !== 'string' ||
        !sData.userId ||
        !['PATIENT', 'DOCTOR', 'STAFF'].includes(sData.actorType) ||
        !Array.isArray(sData.capabilities)
      ) {
        throw new Error('Dữ liệu phiên đăng nhập không hợp lệ.');
      }
      const rawCaps = sData.capabilities;
      const capabilities: string[] = rawCaps
        .filter((c: any) =>
          typeof c === 'string'
            ? c.length > 0
            : c && typeof c.capability === 'string' && c.enabled !== false,
        )
        .map((c: any) => (typeof c === 'string' ? c : c.capability));

      session = {
        userId: sData?.userId ?? '',
        actorType: sData?.actorType || loginData.actorType,
        capabilities,
        tokenVersion: sData?.tokenVersion,
        lease: fetchAuthorizationLease,
      };
    } else {
      throw new Error('Không tải được phiên đăng nhập. Vui lòng thử lại.');
    }
  } catch (error) {
    clearAuthSession();
    notifyListeners();
    throw error;
  }

  currentSession = session;
  syncStorage(rememberMe);
  notifyListeners();
  return session;
}

/**
 * Đăng xuất và thu hồi phiên tại Identity
 */
export async function logoutUser(): Promise<void> {
  if (currentRefreshToken && currentAccessToken) {
    try {
      await fetch('/api/v1/auth/logout', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${currentAccessToken}`,
          'Idempotency-Key': crypto.randomUUID(),
        },
        body: JSON.stringify({ refreshToken: currentRefreshToken }),
      });
    } catch {
      // Bỏ qua lỗi mạng khi logout
    }
  }

  clearAuthSession();
  notifyListeners();
}

/**
 * Shared transport tự động gắn Bearer token và xử lý 401 hết phiên
 */
export async function defaultTransport(
  url: string,
  init: RequestInit = {},
): Promise<Response> {
  const initialUserId = currentSession?.userId;
  const initialGeneration = authGeneration;
  const headers = new Headers(init.headers);
  if (currentAccessToken && !headers.has('Authorization')) {
    headers.set('Authorization', `Bearer ${currentAccessToken}`);
  }

  let response = await fetch(url, { ...init, headers });

  // Kiểm tra 401 hết phiên cho các API nghiệp vụ (ngoại trừ auth forms)
  const isAuthForm =
    url.includes('/api/v1/auth/login') ||
    url.includes('/api/v1/auth/register') ||
    url.includes('/api/v1/auth/otp') ||
    url.includes('/api/v1/auth/password');

  if (
    response.status === 401 &&
    !isAuthForm &&
    currentRefreshToken &&
    !(await isExpiredAuthorizationLease(response))
  ) {
    if (
      currentSession?.userId !== initialUserId ||
      authGeneration !== initialGeneration
    ) {
      return response;
    }

    const newToken = await refreshAccessToken();
    if (
      currentSession?.userId !== initialUserId ||
      authGeneration !== initialGeneration
    ) {
      return response;
    }

    if (newToken) {
      headers.set('Authorization', `Bearer ${newToken}`);
      response = await fetch(url, { ...init, headers });
    } else {
      notifyUnauthorized();
    }
  }

  return response;
}

type RuntimeListener = (runtime: WebRuntime) => void;
const runtimeListeners = new Set<RuntimeListener>();

export function subscribeWebRuntime(listener: RuntimeListener): () => void {
  runtimeListeners.add(listener);
  return () => {
    runtimeListeners.delete(listener);
  };
}

function notifyListeners() {
  const runtime = getWebRuntime();
  if (typeof window !== 'undefined') {
    window.umcCareWebRuntime = runtime;
  }
  runtimeListeners.forEach((fn) => fn(runtime));
}

function notifyUnauthorized() {
  clearAuthSession();
  notifyListeners();
  if (typeof window !== 'undefined' && window.location.pathname !== '/login') {
    window.location.href = '/login';
  }
}

export function getWebRuntime(): WebRuntime {
  return {
    transport: defaultTransport,
    session: currentSession,
    onUnauthorized: notifyUnauthorized,
  };
}
