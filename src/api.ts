import {
  User,
  Product,
  ChamaGroup,
  GroupSlot,
  PaymentRecord,
  DefaultRecord,
  RefundRequest,
  StoreCreditLedgerEntry,
  AuditLog,
  SpeedOption,
  PeerLoanRequest,
  MemberStatement,
  HelpChatMessage,
  ProductAIInquiry,
  WalletDepositRequest,
  ChamaActivityItem,
  Announcement,
  SupportTicket,
  UserNotification,
  DeliveryAddress,
  MemberOrder,
  MerchantSubscriptionTier,
  MerchantVerificationRecord,
  MerchantSubscriptionRecord,
  BillingPeriod,
  PaymentReceivingDetails,
  GroupJoinRequest,
  GroupCallerMembership,
  GroupLenderAuthorization,
} from './types.ts';
import {
  getFallbackAnnouncements,
  getFallbackGroup,
  getFallbackGroups,
  getFallbackHeroAnnouncementCards,
  getFallbackMerchant,
  getFallbackProduct,
  getFallbackProducts,
  getFallbackSearchProducts,
  getFallbackSubscriptionTiers,
} from './data/publicCatalogFallback.ts';

const USER_STORAGE_KEY = 'alibaird_current_user';

export const SESSION_EXPIRED_EVENT = 'buyoll:session-expired';
export const ACCESS_TOKEN_KEY = 'buyoll_access_token';

export const API_BASE = (
  (typeof import.meta !== 'undefined' &&
    ((import.meta as any).env?.VITE_API_URL || (import.meta as any).env?.VITE_API_BASE_URL)) ||
  '/api'
).replace(/\/+$/, '');

function getAssetBaseUrl(): string {
  const raw = (typeof import.meta !== 'undefined' && (import.meta as any).env?.BASE_URL) || '/';
  return raw.endsWith('/') ? raw : `${raw}/`;
}

export function getAccessToken(): string | null {
  try {
    return localStorage.getItem(ACCESS_TOKEN_KEY) || sessionStorage.getItem(ACCESS_TOKEN_KEY);
  } catch {
    return null;
  }
}

export function setAccessToken(token: string | null, remember = true): void {
  try {
    if (token) {
      if (remember) {
        localStorage.setItem(ACCESS_TOKEN_KEY, token);
        sessionStorage.removeItem(ACCESS_TOKEN_KEY);
      } else {
        sessionStorage.setItem(ACCESS_TOKEN_KEY, token);
        localStorage.removeItem(ACCESS_TOKEN_KEY);
      }
    } else {
      localStorage.removeItem(ACCESS_TOKEN_KEY);
      sessionStorage.removeItem(ACCESS_TOKEN_KEY);
    }
  } catch {}
}

// Helper to resolve image paths reliably on subpaths (e.g. /buyoll/), uploads, and root domains
export function resolveImageUrl(url?: string): string {
  const base = getAssetBaseUrl();
  if (!url) return `${base}images/cookware_set.jpg`;
  if (url.startsWith('http://') || url.startsWith('https://') || url.startsWith('data:')) {
    return url;
  }
  if (url.startsWith('/uploads/') || url.startsWith('uploads/')) {
    return url.startsWith('/') ? url : `/${url}`;
  }
  const clean = url.replace(/^\.\//, '').replace(/^\/+/, '');
  if (clean.startsWith('assets/')) return `${base}${clean}`;
  if (clean.includes('buyoll_logo') || clean.includes('logo')) return `${base}buyoll_logo.png`;
  if (clean.includes('solar_power')) return `${base}images/solar_power.jpg`;
  if (clean.includes('stainless_cookware') || clean.includes('cookware')) return `${base}images/cookware_set.jpg`;
  if (clean.includes('smart_uhd') || clean.includes('smart_tv')) return `${base}images/smart_tv.jpg`;
  if (clean.includes('executive') || clean.includes('office_chair')) return `${base}images/office_chair.jpg`;
  return `${base}${clean}`;
}

export function getStoredUser(): User | null {
  try {
    const raw = localStorage.getItem(USER_STORAGE_KEY);
    return raw ? JSON.parse(raw) : null;
  } catch {
    return null;
  }
}

export function setStoredUser(user: User | null): void {
  try {
    if (user) {
      localStorage.setItem(USER_STORAGE_KEY, JSON.stringify(user));
    } else {
      localStorage.removeItem(USER_STORAGE_KEY);
      setAccessToken(null);
    }
  } catch {}
}

export function getActiveRoleHeader(): string | undefined {
  const user = getStoredUser();
  if (!user) return undefined;
  return (user.activeRole || user.role || undefined) as string | undefined;
}

let inflightRefresh: Promise<boolean> | null = null;

async function tryRefreshTokens(): Promise<boolean> {
  if (inflightRefresh) return inflightRefresh;
  inflightRefresh = (async () => {
    try {
      const headers: Record<string, string> = { 'Content-Type': 'application/json' };
      const activeRole = getActiveRoleHeader();
      if (activeRole) headers['x-buyoll-role'] = activeRole;
      const res = await fetch(`${API_BASE}/auth/refresh`, {
        method: 'POST',
        credentials: 'include',
        headers,
      });
      if (!res.ok) return false;
      const data = await res.json();
      if (data?.accessToken) {
        const remember = Boolean(localStorage.getItem(ACCESS_TOKEN_KEY));
        setAccessToken(data.accessToken, remember);
      }
      if (data?.user) {
        setStoredUser(data.user);
      }
      return true;
    } catch {
      return false;
    } finally {
      inflightRefresh = null;
    }
  })();
  return inflightRefresh;
}

async function fetchApi<T>(endpoint: string, options: RequestInit = {}, _retried = false): Promise<T> {
  const token = getAccessToken();
  const activeRole = getActiveRoleHeader();
  const headers = new Headers(options.headers || {});
  if (!(options.body instanceof FormData) && !headers.has('Content-Type')) {
    headers.set('Content-Type', 'application/json');
  }
  if (token && !headers.has('Authorization')) {
    headers.set('Authorization', `Bearer ${token}`);
  }
  if (activeRole && !headers.has('x-buyoll-role')) {
    headers.set('x-buyoll-role', activeRole);
  }

  const normalizedEndpoint = endpoint.startsWith('/') ? endpoint : `/${endpoint}`;
  let res: Response;
  try {
    res = await fetch(`${API_BASE}${normalizedEndpoint}`, {
      credentials: 'include',
      ...options,
      headers,
    });
  } catch {
    const netErr = new Error('Unable to reach the Buyoll server. Please check your internet connection and try again.') as any;
    netErr.isNetworkError = true;
    throw netErr;
  }

  const contentType = res.headers.get('content-type') || '';
  if (!contentType.includes('application/json')) {
    const friendlyMessage =
      res.status === 405
        ? 'The authentication service could not process this request (HTTP 405). Please refresh and try again.'
        : res.status >= 500
        ? `Server temporarily unavailable (${res.status}). Please try again shortly.`
        : `Unexpected response from server (${res.status}). Please try again.`;
    const nonJsonErr = new Error(friendlyMessage) as any;
    nonJsonErr.status = res.status;
    nonJsonErr.isNonJsonResponse = true;
    throw nonJsonErr;
  }

  if (res.status === 401) {
    const peek = await res.clone().json().catch(() => null);
    const errCode = peek?.error?.code;
    if (errCode === 'SESSION_IDLE_EXPIRED') {
      const expiredMsg = peek?.error?.message || 'Your session expired after 20 minutes of inactivity. Please sign in again.';
      setStoredUser(null);
      if (typeof window !== 'undefined') {
        window.dispatchEvent(
          new CustomEvent(SESSION_EXPIRED_EVENT, {
            detail: { code: errCode, message: expiredMsg, role: headers.get('x-buyoll-role') || activeRole },
          })
        );
      }
      const err = new Error(expiredMsg) as any;
      err.status = 401;
      err.code = errCode;
      err.data = peek;
      throw err;
    }

    if (
      !_retried &&
      !endpoint.startsWith('/auth/login') &&
      !endpoint.startsWith('/admin/auth/login') &&
      !endpoint.startsWith('/auth/register') &&
      !endpoint.startsWith('/auth/refresh')
    ) {
      const refreshed = await tryRefreshTokens();
      if (refreshed) {
        return fetchApi<T>(endpoint, options, true);
      }
    }
  }

  const data = await res.json();
  if (!res.ok) {
    const errorMsg =
      typeof data.error === 'object' && data.error?.message
        ? data.error.message
        : typeof data.error === 'string'
        ? data.error
        : data.message || 'Server request failed';
    const error = new Error(errorMsg) as any;
    error.status = res.status;
    error.code = data.error?.code || (res.status === 409 ? 'CONFLICT' : res.status === 422 ? 'VALIDATION' : 'ERROR');
    error.fields = data.error?.fields;
    error.data = data;
    throw error;
  }
  return data as T;
}

/**
 * Wraps public read-only GET endpoints so static deployments without an Express /api server
 * (e.g. GitHub Pages 404 HTML or Vercel SPA rewrite returning index.html) gracefully display
 * public catalog, featured deals, newly posted items, and announcements while preserving
 * all real backend JSON responses and backend error semantics when /api is active.
 */
async function fetchPublicWithFallback<T>(
  endpoint: string,
  fallbackFn: () => T,
  options: RequestInit = {}
): Promise<T> {
  try {
    return await fetchApi<T>(endpoint, options);
  } catch (err: any) {
    const isStaticOrOffline =
      err?.isNonJsonResponse === true ||
      err?.isNetworkError === true ||
      err instanceof TypeError ||
      (typeof err?.status !== 'number' && String(err?.message || '').includes('Unexpected response from server'));
    if (isStaticOrOffline) {
      return fallbackFn();
    }
    throw err;
  }
}

// -------------------------------------------------------------
// EXPORTED API METHODS
// -------------------------------------------------------------
export const api = {
  // Auth
  async getMe(role?: string): Promise<{ user: User; session?: any }> {
    const qs = role ? `?role=${encodeURIComponent(role)}` : '';
    const res = await fetchApi<{ user: User; session?: any }>(`/auth/me${qs}`, {
      headers: role ? { 'x-buyoll-role': role } : undefined,
    });
    if (res?.user) {
      setStoredUser(res.user);
    }
    return res;
  },

  async login(payload: {
    identifier?: string;
    phone?: string;
    password?: string;
    passkey?: string;
    role?: string;
    rememberMe?: boolean;
    name?: string;
    shopName?: string;
    shopDescription?: string;
  }): Promise<{ user: User; accessToken?: string; refreshToken?: string; session?: any; mustChangeCredentials?: boolean; notice?: string }> {
    const data = await fetchApi<{
      user: User;
      accessToken?: string;
      refreshToken?: string;
      session?: any;
      mustChangeCredentials?: boolean;
      notice?: string;
    }>('/auth/login', {
      method: 'POST',
      body: JSON.stringify(payload),
    });
    if (data.accessToken) {
      setAccessToken(data.accessToken, payload.rememberMe !== false);
    }
    setStoredUser(data.user);
    return data;
  },

  async adminLogin(payload: {
    identifier: string;
    password: string;
    passkey: string;
    rememberMe?: boolean;
  }): Promise<{ user: User; accessToken?: string; refreshToken?: string; session?: any; mustChangeCredentials?: boolean; notice?: string }> {
    const data = await fetchApi<{
      user: User;
      accessToken?: string;
      refreshToken?: string;
      session?: any;
      mustChangeCredentials?: boolean;
      notice?: string;
    }>('/admin/auth/login', {
      method: 'POST',
      headers: { 'x-buyoll-role': 'admin' },
      body: JSON.stringify(payload),
    });
    if (data.accessToken) {
      setAccessToken(data.accessToken, payload.rememberMe !== false);
    }
    setStoredUser(data.user);
    return data;
  },

  async register(payload: {
    role: string;
    name: string;
    username?: string;
    email: string;
    password: string;
    confirmPassword?: string;
    phone?: string;
    shopName?: string;
    shopDescription?: string;
    lenderType?: string;
    referredBy?: string;
    rememberMe?: boolean;
  }): Promise<{ user: User; accessToken?: string; refreshToken?: string; session?: any; notice?: string }> {
    const data = await fetchApi<{
      user: User;
      accessToken?: string;
      refreshToken?: string;
      session?: any;
      notice?: string;
    }>('/auth/register', {
      method: 'POST',
      body: JSON.stringify(payload),
    });
    if (data.accessToken) {
      setAccessToken(data.accessToken, payload.rememberMe !== false);
    }
    setStoredUser(data.user);
    return data;
  },

  async getUsersList(): Promise<{ users: Array<Partial<User>> }> {
    return await fetchApi<{ users: Array<Partial<User>> }>('/auth/users');
  },

  async logout(role?: string): Promise<{ success: boolean; loggedOutRole?: string }> {
    const targetRole = role || getActiveRoleHeader();
    let res: { success: boolean; loggedOutRole?: string } = { success: true, loggedOutRole: targetRole };
    try {
      res = await fetchApi<{ success: boolean; loggedOutRole?: string }>('/auth/logout', {
        method: 'POST',
        headers: targetRole ? { 'x-buyoll-role': targetRole } : undefined,
        body: JSON.stringify(targetRole ? { role: targetRole } : {}),
      });
    } catch {
      // Ignore network/401 error on logout and still clear local state if matching
    }
    const currentRole = getActiveRoleHeader();
    if (!role || role === currentRole) {
      setStoredUser(null);
    }
    return res;
  },

  async keepaliveSession(role?: string): Promise<{
    ok: boolean;
    sessionId: number;
    role: string;
    lastActivityAt: number;
    idleTimeoutMs: number;
    idleExpiresAt: number;
    serverNow: number;
  }> {
    const targetRole = role || getActiveRoleHeader();
    return await fetchApi<any>('/auth/keepalive', {
      method: 'POST',
      headers: targetRole ? { 'x-buyoll-role': targetRole } : undefined,
      body: JSON.stringify(targetRole ? { role: targetRole } : {}),
    });
  },

  async checkUsername(username: string): Promise<{ valid: boolean; available: boolean; normalized?: string; message?: string }> {
    return await fetchApi<{ valid: boolean; available: boolean; normalized?: string; message?: string }>(
      `/auth/username-available?username=${encodeURIComponent(username)}`
    );
  },

  async forgotStart(payload: {
    type: 'forgot_password' | 'forgot_username';
    identifier: string;
  }): Promise<{ success: boolean; purpose: string; mode: string; message: string; devOtp?: string }> {
    return await fetchApi<any>('/auth/forgot/start', {
      method: 'POST',
      body: JSON.stringify(payload),
    });
  },

  async forgotVerify(payload: {
    type: 'forgot_password' | 'forgot_username';
    identifier: string;
    otp: string;
  }): Promise<{
    success: boolean;
    mode: string;
    verificationToken?: string;
    sentExisting?: boolean;
    username?: string;
    message?: string;
  }> {
    return await fetchApi<any>('/auth/forgot/verify', {
      method: 'POST',
      body: JSON.stringify(payload),
    });
  },

  async forgotResetPassword(payload: {
    verificationToken: string;
    newPassword: string;
  }): Promise<{ success: boolean; message: string }> {
    return await fetchApi<{ success: boolean; message: string }>('/auth/forgot/reset-password', {
      method: 'POST',
      body: JSON.stringify(payload),
    });
  },

  async forgotResetUsername(payload: {
    verificationToken: string;
    newUsername: string;
  }): Promise<{ success: boolean; username: string; message: string }> {
    return await fetchApi<{ success: boolean; username: string; message: string }>('/auth/forgot/reset-username', {
      method: 'POST',
      body: JSON.stringify(payload),
    });
  },

  async adminForgotStart(payload: { identifier: string }): Promise<{ success: boolean; message: string; devOtp?: string }> {
    return await fetchApi<any>('/admin/auth/forgot/start', {
      method: 'POST',
      body: JSON.stringify(payload),
    });
  },

  async adminForgotVerify(payload: { identifier: string; otp: string }): Promise<{ success: boolean; verificationToken: string }> {
    return await fetchApi<any>('/admin/auth/forgot/verify', {
      method: 'POST',
      body: JSON.stringify(payload),
    });
  },

  async adminForgotReset(payload: {
    verificationToken: string;
    newPassword?: string;
    newPasskey?: string;
  }): Promise<{ success: boolean; message: string }> {
    return await fetchApi<any>('/admin/auth/forgot/reset', {
      method: 'POST',
      body: JSON.stringify(payload),
    });
  },

  async forgotPassword(identifier: string): Promise<{ success: boolean; message: string; devResetToken?: string }> {
    return await fetchApi<{ success: boolean; message: string; devResetToken?: string }>('/auth/forgot-password', {
      method: 'POST',
      body: JSON.stringify({ identifier }),
    });
  },

  async forgotUsername(contact: string): Promise<{ success: boolean; message: string }> {
    return await fetchApi<{ success: boolean; message: string }>('/auth/forgot-username', {
      method: 'POST',
      body: JSON.stringify({ contact }),
    });
  },

  async resetPassword(
    tokenOrPayload:
      | string
      | { token?: string; identifier?: string; code?: string; newPassword: string; confirmPassword?: string },
    newPasswordArg?: string
  ): Promise<{ success: boolean; message: string }> {
    const body =
      typeof tokenOrPayload === 'string'
        ? { token: tokenOrPayload, newPassword: newPasswordArg }
        : tokenOrPayload;
    return await fetchApi<{ success: boolean; message: string }>('/auth/reset-password', {
      method: 'POST',
      body: JSON.stringify(body),
    });
  },

  async changePassword(
    currentPassword: string,
    newPassword: string
  ): Promise<{ success: boolean; user: User; accessToken?: string }> {
    const res = await fetchApi<{ success: boolean; user: User; accessToken?: string }>('/auth/change-password', {
      method: 'POST',
      body: JSON.stringify({ currentPassword, newPassword }),
    });
    if (res.accessToken) {
      const remember = Boolean(localStorage.getItem(ACCESS_TOKEN_KEY));
      setAccessToken(res.accessToken, remember);
    }
    if (res.user) setStoredUser(res.user);
    return res;
  },

  async logoutAll(): Promise<{ success: boolean }> {
    const res = await fetchApi<{ success: boolean }>('/auth/logout-all', { method: 'POST' });
    setStoredUser(null);
    return res;
  },

  async registerRole(
    payloadOrRole: 'merchant' | 'lender' | 'member' | {
      role: 'merchant' | 'lender' | 'member';
      shopName?: string;
      shopDescription?: string;
      category?: string;
      merchantCategory?: string;
      lenderType?: string;
      location?: string;
      lenderLocation?: string;
    },
    extraDetails?: any
  ): Promise<{ success: boolean; user: User; message: string }> {
    const payload =
      typeof payloadOrRole === 'string'
        ? { role: payloadOrRole, ...(extraDetails || {}) }
        : payloadOrRole;
    const data = await fetchApi<{ success: boolean; user: User; message: string }>('/user/roles/register', {
      method: 'POST',
      body: JSON.stringify(payload),
    });
    setStoredUser(data.user);
    return data;
  },

  async switchRole(role: string): Promise<{ success: boolean; user: User; message: string }> {
    const data = await fetchApi<{ success: boolean; user: User; message: string }>('/user/roles/switch', {
      method: 'POST',
      body: JSON.stringify({ role }),
    });
    setStoredUser(data.user);
    return data;
  },

  // Products
  async getProducts(params?: {
    category?: string;
    search?: string;
    vendorId?: number;
    merchantId?: number;
    groupId?: number;
    includeDrafts?: boolean;
    status?: 'draft' | 'published' | 'posted' | 'all';
    limit?: number;
    offset?: number;
  }): Promise<{ products: Product[]; total?: number; limit?: number; offset?: number }> {
    const q = new URLSearchParams();
    if (params?.category) q.set('category', params.category);
    if (params?.search) q.set('search', params.search);
    if (params?.vendorId) q.set('vendorId', String(params.vendorId));
    if (params?.merchantId) q.set('merchantId', String(params.merchantId));
    if (params?.groupId) q.set('groupId', String(params.groupId));
    if (params?.includeDrafts) q.set('includeDrafts', 'true');
    if (params?.status) q.set('status', params.status);
    if (params?.limit) q.set('limit', String(params.limit));
    if (params?.offset) q.set('offset', String(params.offset));
    const qs = q.toString();
    return await fetchPublicWithFallback<{ products: Product[]; total?: number; limit?: number; offset?: number }>(
      `/products${qs ? `?${qs}` : ''}`,
      () => getFallbackProducts(params)
    );
  },

  async getProduct(id: number): Promise<{ product: Product; groups: ChamaGroup[] }> {
    return await fetchPublicWithFallback<{ product: Product; groups: ChamaGroup[] }>(
      `/products/${id}`,
      () => {
        const found = getFallbackProduct(id);
        if (!found) {
          const err = new Error('Product not found') as any;
          err.status = 404;
          throw err;
        }
        return found;
      }
    );
  },

  async createProduct(data: Partial<Product>): Promise<{ product: Product; message?: string }> {
    return await fetchApi<{ product: Product; message?: string }>('/products', {
      method: 'POST',
      body: JSON.stringify(data),
    });
  },

  async publishProduct(id: number): Promise<{ success: boolean; product: Product; groups: ChamaGroup[]; message: string }> {
    return await fetchApi<{ success: boolean; product: Product; groups: ChamaGroup[]; message: string }>(`/products/${id}/publish`, {
      method: 'POST',
    });
  },

  async updateProduct(id: number, data: Partial<Product>): Promise<{ product: Product; message: string }> {
    return await fetchApi<{ product: Product; message: string }>(`/products/${id}`, {
      method: 'PUT',
      body: JSON.stringify(data),
    });
  },

  async updateProductMedia(id: number, media: { images?: string[]; videos?: string[] }): Promise<{ success: boolean; images: string[]; videos: string[]; message?: string }> {
    return await fetchApi<{ success: boolean; images: string[]; videos: string[]; message?: string }>(`/products/${id}/media`, {
      method: 'POST',
      body: JSON.stringify(media),
    });
  },

  async deleteProduct(id: number): Promise<{ success: boolean; message: string }> {
    return await fetchApi<{ success: boolean; message: string }>(`/products/${id}`, {
      method: 'DELETE',
    });
  },

  async askProductAI(productId: number, question: string): Promise<{ inquiry: ProductAIInquiry; history: ProductAIInquiry[] }> {
    return await fetchApi<{ inquiry: ProductAIInquiry; history: ProductAIInquiry[] }>(`/products/${productId}/ai-chat`, {
      method: 'POST',
      body: JSON.stringify({ question }),
    });
  },

  async getProductAIHistory(productId: number): Promise<{ history: ProductAIInquiry[] }> {
    return await fetchApi<{ history: ProductAIInquiry[] }>(`/products/${productId}/ai-history`);
  },

  // Groups
  async getMyGroups(): Promise<{ groups: ChamaGroup[] }> {
    return await fetchApi<{ groups: ChamaGroup[] }>('/groups/my');
  },

  async getGroups(params?: { productId?: number; status?: string }): Promise<{ groups: ChamaGroup[] }> {
    const q = new URLSearchParams();
    if (params?.productId) q.set('productId', String(params.productId));
    if (params?.status) q.set('status', params.status);
    const qs = q.toString();
    return await fetchPublicWithFallback<{ groups: ChamaGroup[] }>(
      `/groups${qs ? `?${qs}` : ''}`,
      () => getFallbackGroups(params)
    );
  },

  async getGroup(id: number): Promise<{ group: ChamaGroup; membership?: GroupCallerMembership }> {
    return await fetchPublicWithFallback<{ group: ChamaGroup; membership?: GroupCallerMembership }>(
      `/groups/${id}`,
      () => {
        const found = getFallbackGroup(id);
        if (!found) {
          const err = new Error('Group not found') as any;
          err.status = 404;
          throw err;
        }
        return found;
      }
    );
  },

  async createGroup(data: {
    productId: number;
    size: number;
    name?: string;
    paymentMode?: 'merchant' | 'platform';
    paymentDurationDays?: number;
    paymentReceiving?: PaymentReceivingDetails;
  }): Promise<{ group: ChamaGroup; usage?: { used: number; limit: number }; message: string }> {
    return await fetchApi<{ group: ChamaGroup; usage?: { used: number; limit: number }; message: string }>('/groups', {
      method: 'POST',
      body: JSON.stringify(data),
    });
  },

  async joinGroup(
    id: number,
    inviteCode?: string,
    slotNumber?: number,
    note?: string
  ): Promise<{
    group: ChamaGroup;
    assignedSlot?: number;
    memberCode?: string;
    pending?: boolean;
    joinRequest?: GroupJoinRequest;
    membership?: GroupCallerMembership;
    isModerator?: boolean;
    message: string;
  }> {
    return await fetchApi<any>(`/groups/${id}/join`, {
      method: 'POST',
      body: JSON.stringify({
        ...(inviteCode ? { inviteCode } : {}),
        ...(slotNumber ? { slotNumber } : {}),
        ...(note ? { note } : {}),
      }),
    });
  },

  async cancelGroupJoinRequest(groupId: number): Promise<{ success: boolean; message: string }> {
    return await fetchApi<{ success: boolean; message: string }>(`/groups/${groupId}/join-request`, {
      method: 'DELETE',
    });
  },

  async leaveGroup(groupId: number): Promise<{ success: boolean; group: ChamaGroup; message: string }> {
    return await fetchApi<{ success: boolean; group: ChamaGroup; message: string }>(`/groups/${groupId}/leave`, {
      method: 'POST',
    });
  },

  async getNumericGroupJoinRequests(groupId: number): Promise<{ requests: GroupJoinRequest[] }> {
    return await fetchApi<{ requests: GroupJoinRequest[] }>(`/groups/${groupId}/join-requests`);
  },

  async approveNumericJoinRequest(
    groupId: number,
    requestId: string
  ): Promise<{ success: boolean; group: ChamaGroup; joinRequest: GroupJoinRequest }> {
    return await fetchApi<any>(`/groups/${groupId}/join-requests/${encodeURIComponent(requestId)}/approve`, {
      method: 'POST',
    });
  },

  async rejectNumericJoinRequest(
    groupId: number,
    requestId: string,
    reason?: string
  ): Promise<{ success: boolean; joinRequest: GroupJoinRequest }> {
    return await fetchApi<any>(`/groups/${groupId}/join-requests/${encodeURIComponent(requestId)}/reject`, {
      method: 'POST',
      body: JSON.stringify({ reason }),
    });
  },

  async removeGroupMember(groupId: number, userId: number): Promise<{ success: boolean; group: ChamaGroup }> {
    return await fetchApi<any>(`/groups/${groupId}/members/${userId}`, {
      method: 'DELETE',
    });
  },

  async updateGroupJoinPolicy(
    groupId: number,
    joinPolicy: 'OPEN' | 'APPROVAL' | 'INVITE_ONLY'
  ): Promise<{ success: boolean; group: ChamaGroup }> {
    return await fetchApi<any>(`/groups/${groupId}/join-policy`, {
      method: 'PATCH',
      body: JSON.stringify({ joinPolicy }),
    });
  },

  async setGroupPayoutOption(
    groupId: number,
    payload: { payoutOption: 'turn_by_turn' | 'end_together'; paymentDurationDays?: number }
  ): Promise<{ success: boolean; group: ChamaGroup; message: string }> {
    return await fetchApi<{ success: boolean; group: ChamaGroup; message: string }>(`/groups/${groupId}/payout-option`, {
      method: 'POST',
      body: JSON.stringify(payload),
    });
  },

  async agreeGroupPayout(
    groupId: number,
    confirmLock = false
  ): Promise<{ success: boolean; group: ChamaGroup; payoutLocked: boolean; agreedCount: number; activeCount: number; message: string }> {
    return await fetchApi<{ success: boolean; group: ChamaGroup; payoutLocked: boolean; agreedCount: number; activeCount: number; message: string }>(`/groups/${groupId}/payout-agree`, {
      method: 'POST',
      body: JSON.stringify({ confirmLock }),
    });
  },

  async manageModerator(
    groupId: number,
    targetUserId: number,
    action: 'appoint' | 'remove' | 'transfer'
  ): Promise<{ group: ChamaGroup; message: string }> {
    return await fetchApi<{ group: ChamaGroup; message: string }>(`/groups/${groupId}/moderator`, {
      method: 'POST',
      body: JSON.stringify({ targetUserId, action }),
    });
  },

  async markDefault(
    groupId: number,
    slotNumber: number,
    reason?: string
  ): Promise<{ group: ChamaGroup; defaultRecord: DefaultRecord; message: string }> {
    return await fetchApi<{ group: ChamaGroup; defaultRecord: DefaultRecord; message: string }>(`/groups/${groupId}/default`, {
      method: 'POST',
      body: JSON.stringify({ slotNumber, reason }),
    });
  },

  async removeMember(
    groupId: number,
    data: { slotNumber: number; reason?: string }
  ): Promise<{ group: ChamaGroup; message: string }> {
    return await fetchApi<{ group: ChamaGroup; message: string }>(`/groups/${groupId}/remove-member`, {
      method: 'POST',
      body: JSON.stringify(data),
    });
  },

  async sendGroupChat(
    groupId: number,
    payload: { text?: string; kind?: string; targetUserId?: number; coinAmount?: number }
  ): Promise<{ group: ChamaGroup; message?: string }> {
    return await fetchApi<{ group: ChamaGroup; message?: string }>(`/groups/${groupId}/chat`, {
      method: 'POST',
      body: JSON.stringify(payload),
    });
  },

  // Defaults & Refunds
  async getMyDefaults(): Promise<{ defaults: DefaultRecord[]; refunds: RefundRequest[] }> {
    return await fetchApi<{ defaults: DefaultRecord[]; refunds: RefundRequest[] }>('/defaults/my');
  },

  async resolveDefault(defaultRecordId: number, option: 'refund' | 'store_credit' | 'alternate_purchase', userPhone?: string): Promise<{ message: string; refundRequest?: RefundRequest; creditBalance?: number }> {
    return await fetchApi<{ message: string; refundRequest?: RefundRequest; creditBalance?: number }>('/defaults/resolve', {
      method: 'POST',
      body: JSON.stringify({ defaultRecordId, option, userPhone }),
    });
  },

  // Payments & Ledger
  async postPayment(payload: {
    type?: string;
    code: string;
    amount: number;
    groupId?: number;
    slotNumber?: number;
    productId?: number;
  }): Promise<{ payment: PaymentRecord; message: string }> {
    return await fetchApi<{ payment: PaymentRecord; message: string }>('/payments', {
      method: 'POST',
      body: JSON.stringify(payload),
    });
  },

  async getMyPayments(): Promise<{
    payments: PaymentRecord[];
    ledger: StoreCreditLedgerEntry[];
    credit: number;
    coins: number;
    points: number;
    creditCents?: number;
    nonWithdrawableCents?: number;
    availableCents?: number;
  }> {
    return await fetchApi<any>('/payments/my');
  },

  async redeemPoints(): Promise<{ credit: number; points: number; message: string }> {
    return await fetchApi<{ credit: number; points: number; message: string }>('/wallet/redeem-points', {
      method: 'POST',
    });
  },

  // Admin
  async getAdminOverview(): Promise<{
    pendingPayments: PaymentRecord[];
    allPayments: PaymentRecord[];
    refundRequests: RefundRequest[];
    merchants: User[];
    allUsers: User[];
    auditLogs: AuditLog[];
    groups: ChamaGroup[];
    products: Product[];
  }> {
    return await fetchApi<any>('/admin/overview');
  },

  async adminPaymentDecision(paymentId: number, decision: 'approve' | 'reject'): Promise<{ payment: PaymentRecord; message: string }> {
    return await fetchApi<any>(`/admin/payments/${paymentId}/decision`, {
      method: 'POST',
      body: JSON.stringify({ decision }),
    });
  },

  async adminRefundStatus(refundId: number, status: string, adminNote?: string): Promise<{ refund: RefundRequest; message: string }> {
    return await fetchApi<any>(`/admin/refunds/${refundId}/status`, {
      method: 'POST',
      body: JSON.stringify({ status, adminNote }),
    });
  },

  async adminVerifyMerchant(merchantId: number, verified: boolean): Promise<{ merchant: User; message: string }> {
    return await fetchApi<any>(`/admin/merchants/${merchantId}/verify`, {
      method: 'POST',
      body: JSON.stringify({ verified }),
    });
  },

  // Search
  async searchProducts(query: string): Promise<{ products: Product[]; query: string; total: number }> {
    return await fetchPublicWithFallback<any>(
      `/search?q=${encodeURIComponent(query)}`,
      () => getFallbackSearchProducts(query)
    );
  },

  // Peer-to-Peer Loans
  async getGroupLoans(groupId: number): Promise<{ loans: PeerLoanRequest[]; lenders?: GroupLenderAuthorization[]; feeRate?: number }> {
    return await fetchApi<any>(`/groups/${groupId}/loans`);
  },

  async getGroupLenders(groupId: number): Promise<{ lenders: GroupLenderAuthorization[]; feeRate: number }> {
    return await fetchApi<{ lenders: GroupLenderAuthorization[]; feeRate: number }>(`/groups/${groupId}/lenders`);
  },

  async authorizeGroupLender(
    groupId: number,
    data: { userId?: number; identifier?: string }
  ): Promise<{ lender: GroupLenderAuthorization; lenders: GroupLenderAuthorization[]; group: ChamaGroup; message: string }> {
    return await fetchApi<any>(`/groups/${groupId}/lenders`, {
      method: 'POST',
      body: JSON.stringify(data),
    });
  },

  async revokeGroupLender(
    groupId: number,
    userId: number
  ): Promise<{ lenders: GroupLenderAuthorization[]; group: ChamaGroup; message: string }> {
    return await fetchApi<any>(`/groups/${groupId}/lenders/${userId}`, {
      method: 'DELETE',
    });
  },

  async markLoanContacted(
    groupId: number,
    loanId: number
  ): Promise<{ loan: PeerLoanRequest; message: string }> {
    return await fetchApi<any>(`/groups/${groupId}/loans/${loanId}/contacted`, {
      method: 'POST',
    });
  },

  async withdrawFromWallet(amount?: number): Promise<any> {
    return await fetchApi<any>('/wallet/withdraw', {
      method: 'POST',
      body: JSON.stringify(amount ? { amount } : {}),
    });
  },

  async completeGroupRound(groupId: number): Promise<{ group: ChamaGroup; message: string }> {
    return await fetchApi<{ group: ChamaGroup; message: string }>(`/groups/${groupId}/complete-round`, {
      method: 'POST',
    });
  },

  async requestPeerLoan(
    groupId: number,
    data: { amount: number; purpose?: string; repaymentPeriod?: string; repaymentDays?: number; productId?: number }
  ): Promise<{ loan: PeerLoanRequest; message: string }> {
    return await fetchApi<any>(`/groups/${groupId}/loans`, {
      method: 'POST',
      body: JSON.stringify(data),
    });
  },

  async exportGroupMembersCsv(groupId: number): Promise<string> {
    const token = getAccessToken();
    const activeRole = getActiveRoleHeader();
    const headers: Record<string, string> = {};
    if (token) headers['Authorization'] = `Bearer ${token}`;
    if (activeRole) headers['x-buyoll-role'] = activeRole;
    const res = await fetch(`/api/groups/${groupId}/members/export-csv`, {
      credentials: 'include',
      headers,
    });
    if (!res.ok) throw new Error(`HTTP error ${res.status}`);
    return await res.text();
  },

  async submitLoanFee(groupId: number, loanId: number, data: { approvedAmount: number; paymentCode: string }): Promise<{ loan: PeerLoanRequest; message: string }> {
    return await fetchApi<any>(`/groups/${groupId}/loans/${loanId}/submit-fee`, {
      method: 'POST',
      body: JSON.stringify(data),
    });
  },

  async adminApproveLoanFee(loanId: number): Promise<{ loan: PeerLoanRequest; message: string }> {
    return await fetchApi<any>(`/admin/loan-fees/${loanId}/approve`, {
      method: 'POST',
    });
  },

  async fundPeerLoan(groupId: number, loanId: number): Promise<{ loan: PeerLoanRequest; lenderBalance?: number; feeAmount?: number; netCredited?: number; message: string }> {
    return await fetchApi<any>(`/groups/${groupId}/loans/${loanId}/fund`, {
      method: 'POST',
    });
  },

  async getHelpChat(): Promise<{ messages: HelpChatMessage[] }> {
    return await fetchApi<{ messages: HelpChatMessage[] }>('/help-chat');
  },

  async postHelpMessage(data: { text: string; category?: string; visitorName?: string }): Promise<{ message: HelpChatMessage; allMessages: HelpChatMessage[] }> {
    return await fetchApi<{ message: HelpChatMessage; allMessages: HelpChatMessage[] }>('/help-chat', {
      method: 'POST',
      body: JSON.stringify(data),
    });
  },

  async adminReplyHelp(id: string, reply: string): Promise<{ message: HelpChatMessage; allMessages: HelpChatMessage[] }> {
    return await fetchApi<{ message: HelpChatMessage; allMessages: HelpChatMessage[] }>(`/help-chat/${id}/reply`, {
      method: 'POST',
      body: JSON.stringify({ reply }),
    });
  },

  async getLenderAlerts(): Promise<{ alerts: any[] }> {
    return await fetchApi<{ alerts: any[] }>('/lenders/alerts');
  },

  async claimGroupLender(groupId: number): Promise<{ group: ChamaGroup; message: string }> {
    return await fetchApi<{ group: ChamaGroup; message: string }>(`/groups/${groupId}/claim-lender`, {
      method: 'POST',
    });
  },

  async generateProductGroups(productId: number): Promise<{ createdCount: number; groups: ChamaGroup[]; message: string }> {
    return await fetchApi<{ createdCount: number; groups: ChamaGroup[]; message: string }>(`/products/${productId}/generate-groups`, {
      method: 'POST',
    });
  },

  async paySlotFromWallet(groupId: number, data: { slotNumber: number; amount: number }): Promise<{
    group: ChamaGroup;
    walletBalance: number;
    restrictedLoanBalance?: number;
    restrictedLoanByGroup?: Record<number, number>;
    paidAmount: number;
    progressPercent: number;
    message: string;
  }> {
    return await fetchApi<any>(`/groups/${groupId}/pay-from-wallet`, {
      method: 'POST',
      body: JSON.stringify(data),
    });
  },

  async getMemberStatement(userId: number): Promise<{ statement: MemberStatement }> {
    return await fetchApi<any>(`/ledger/statement/${userId}`);
  },

  async rateMerchant(merchantId: number, rating: number, comment?: string): Promise<{ success: boolean; merchant: User; message: string }> {
    return await fetchApi<any>(`/merchants/${merchantId}/rate`, {
      method: 'POST',
      body: JSON.stringify({ rating, comment }),
    });
  },

  async getMerchant(merchantId: number): Promise<{ merchant: User }> {
    return await fetchPublicWithFallback<any>(
      `/merchants/${merchantId}`,
      () => {
        const found = getFallbackMerchant(merchantId);
        if (!found) {
          const err = new Error('Merchant not found.') as any;
          err.status = 404;
          throw err;
        }
        return found;
      }
    );
  },

  // PROMPT 3: Daily payment & arrears
  async payDay(
    groupId: number,
    data: { slotNumber: number; dayNumber?: number; days?: number[]; code: string; amount: number }
  ): Promise<{ group: ChamaGroup; payment: PaymentRecord; message: string }> {
    return await fetchApi<{ group: ChamaGroup; payment: PaymentRecord; message: string }>(`/groups/${groupId}/pay-day`, {
      method: 'POST',
      body: JSON.stringify(data),
    });
  },

  async getGroupNotifications(groupId: number): Promise<{ notifications: any[] }> {
    return await fetchApi<{ notifications: any[] }>(`/groups/${groupId}/notifications`);
  },

  async requestGroupLoan(
    groupId: number,
    data: { amount: number; purpose?: string; slotNumber: number }
  ): Promise<{ loan: PeerLoanRequest; group: ChamaGroup; message: string }> {
    return await fetchApi<{ loan: PeerLoanRequest; group: ChamaGroup; message: string }>(`/groups/${groupId}/loan-request`, {
      method: 'POST',
      body: JSON.stringify(data),
    });
  },

  // PROMPT 4: Merchant onboarding & subscription
  async subscribeMerchant(data: {
    plan: string;
    paymentCode: string;
    tillNumber?: string;
    paybillNumber?: string;
  }): Promise<{ user: User; payment: PaymentRecord; message: string }> {
    return await fetchApi<{ user: User; payment: PaymentRecord; message: string }>('/merchant/subscribe', {
      method: 'POST',
      body: JSON.stringify(data),
    });
  },

  // PROMPT 5: Lender atomic funding
  async fundLoan(loanId: number, groupId?: number): Promise<any> {
    const endpoint = groupId ? `/groups/${groupId}/loans/${loanId}/fund` : `/loans/${loanId}/fund`;
    return await fetchApi<any>(endpoint, {
      method: 'POST',
    });
  },

  // PROMPT 6: Admin payment reconciliation, user management & moderation
  async getAdminPayments(): Promise<{ payments: any[]; statements: any[] }> {
    return await fetchApi<{ payments: any[]; statements: any[] }>('/admin/payments');
  },

  async adminDecidePayment(paymentId: number, decision: 'approve' | 'reject', reason?: string): Promise<any> {
    return await fetchApi<any>(`/admin/payments/${paymentId}/decision`, {
      method: 'POST',
      body: JSON.stringify({ decision, reason }),
    });
  },

  async getAdminUsers(): Promise<{ users: User[] }> {
    return await fetchApi<{ users: User[] }>('/admin/users');
  },

  async adminVerifyUser(userId: number, verified: boolean, notes?: string): Promise<any> {
    return await fetchApi<any>(`/admin/users/${userId}/verify`, {
      method: 'POST',
      body: JSON.stringify({ verified, notes }),
    });
  },

  async adminSuspendUser(userId: number, isSuspended: boolean, reason?: string): Promise<any> {
    return await fetchApi<any>(`/admin/users/${userId}/suspend`, {
      method: 'POST',
      body: JSON.stringify({ isSuspended, reason }),
    });
  },

  async adminAwardPoints(userId: number, points: number, reason?: string): Promise<any> {
    return await fetchApi<any>(`/admin/users/${userId}/award-points`, {
      method: 'POST',
      body: JSON.stringify({ points, reason }),
    });
  },

  async getAdminWallets(): Promise<any> {
    return await fetchApi<any>('/admin/wallets');
  },

  async getAdminChatLogs(): Promise<any> {
    return await fetchApi<any>('/admin/chat-logs');
  },

  async moderateChat(data: {
    action: string;
    targetUserId: number;
    groupId?: number;
    messageId?: string;
    reason?: string;
  }): Promise<any> {
    return await fetchApi<any>('/admin/chat/moderate', {
      method: 'POST',
      body: JSON.stringify(data),
    });
  },

  // PROMPT 7: Coins transfer, reward platform & deposit
  async awardCoins(recipientIds: number[], amountPerRecipient: number, reason?: string): Promise<any> {
    return await fetchApi<any>('/coins/award', {
      method: 'POST',
      body: JSON.stringify({ recipientIds, amountPerRecipient, reason }),
    });
  },

  async rewardPlatform(amount: number, message?: string): Promise<any> {
    return await fetchApi<any>('/coins/reward-platform', {
      method: 'POST',
      body: JSON.stringify({ amount, message }),
    });
  },

  async depositCoins(amount: number, paymentCode: string, packageId?: string): Promise<any> {
    return await fetchApi<any>('/coins/deposit', {
      method: 'POST',
      body: JSON.stringify({ amount, paymentCode, packageId }),
    });
  },

  async getCoinLedger(): Promise<{ ledger: any[] }> {
    return await fetchApi<{ ledger: any[] }>('/coins/ledger');
  },

  // Service worker push & Chama Invite methods
  async requestGroupInvite(groupId: number, data: { desiredSlot?: number; note?: string }): Promise<any> {
    return await fetchApi<any>(`/groups/${groupId}/invite-request`, {
      method: 'POST',
      body: JSON.stringify(data),
    });
  },

  async decideGroupInvite(groupId: number, data: { requestId: string; action: 'approve' | 'decline' }): Promise<any> {
    return await fetchApi<any>(`/groups/${groupId}/invite-decide`, {
      method: 'POST',
      body: JSON.stringify(data),
    });
  },

  async getGroupInviteRequests(groupId: number): Promise<{ requests: any[] }> {
    return await fetchApi<{ requests: any[] }>(`/groups/${groupId}/invite-requests`);
  },

  async getSystemNotifications(): Promise<{ notifications: any[] }> {
    return await fetchApi<{ notifications: any[] }>('/notifications/system');
  },

  // Wallet M-Pesa Deposit Flow
  async depositToWallet(data: { amount: number; mpesaCode: string; notes?: string; role?: string }): Promise<any> {
    return await fetchApi<any>('/wallet/deposit', {
      method: 'POST',
      body: JSON.stringify(data),
    });
  },

  async getMyWalletDeposits(): Promise<{ deposits: WalletDepositRequest[] }> {
    return await fetchApi<{ deposits: WalletDepositRequest[] }>('/wallet/deposits');
  },

  async getAdminWalletDeposits(): Promise<{ deposits: WalletDepositRequest[] }> {
    return await fetchApi<{ deposits: WalletDepositRequest[] }>('/admin/wallet-deposits');
  },

  async decideWalletDeposit(id: string, data: { action: 'approve' | 'decline'; notes?: string }): Promise<any> {
    return await fetchApi<any>(`/admin/wallet-deposits/${id}/decide`, {
      method: 'POST',
      body: JSON.stringify(data),
    });
  },

  // In-Group Award Coins to Members
  async awardGroupMemberCoins(groupId: number, data: { targetUserId?: number; targetUserIds?: number[]; coinAmount: number; note?: string }): Promise<any> {
    return await fetchApi<any>(`/groups/${groupId}/award-coins`, {
      method: 'POST',
      body: JSON.stringify(data),
    });
  },

  // Group Activities Feed
  async getGroupActivities(groupId: number): Promise<{ activities: ChamaActivityItem[] }> {
    return await fetchApi<{ activities: ChamaActivityItem[] }>(`/groups/${groupId}/activities`);
  },

  // User Preferences (Dynamic Enable Toggles)
  async getUserPreferences(): Promise<{ preferences: Record<string, any> }> {
    return await fetchApi<{ preferences: Record<string, any> }>('/user/preferences');
  },

  async updateUserPreferences(preferences: Record<string, any>): Promise<{ success: boolean; preferences: Record<string, any> }> {
    return await fetchApi<{ success: boolean; preferences: Record<string, any> }>('/user/preferences', {
      method: 'POST',
      body: JSON.stringify({ preferences }),
    });
  },

  // Moderator Dormant Warning
  async warnDormantMember(groupId: number, data: { slotNumber: number; targetUserId: number; reason?: string; deadlineDays?: number }): Promise<any> {
    return await fetchApi<any>(`/groups/${groupId}/warn-dormant`, {
      method: 'POST',
      body: JSON.stringify(data),
    });
  },

  // Trigger Chama Slot Reorder & Priority Check
  async checkReorderGroup(groupId: number): Promise<any> {
    return await fetchApi<any>(`/groups/${groupId}/reorder-check`, {
      method: 'POST',
    });
  },

  // Public Announcements Feed & Admin Announcements/Notices
  async getAnnouncements(params?: {
    type?: string;
    audience?: string;
    pinnedOnly?: boolean;
    limit?: number;
  }): Promise<{ announcements: Announcement[]; total?: number }> {
    const q = new URLSearchParams();
    if (params?.type && params.type !== 'ALL') q.set('type', params.type);
    if (params?.audience && params.audience !== 'ALL') q.set('audience', params.audience);
    if (params?.pinnedOnly) q.set('pinnedOnly', 'true');
    if (params?.limit) q.set('limit', String(params.limit));
    const qs = q.toString();
    return await fetchPublicWithFallback<{ announcements: Announcement[]; total?: number }>(
      `/announcements${qs ? `?${qs}` : ''}`,
      () => getFallbackAnnouncements(params)
    );
  },

  async dismissAnnouncement(id: string | number): Promise<{ success: boolean; announcementId: string | number }> {
    return await fetchApi<{ success: boolean; announcementId: string | number }>(`/announcements/${id}/dismiss`, {
      method: 'POST',
    });
  },

  async getAdminAnnouncements(params?: {
    status?: string;
    type?: string;
    audience?: string;
    search?: string;
  }): Promise<{ announcements: Announcement[]; total: number }> {
    const q = new URLSearchParams();
    if (params?.status && params.status !== 'ALL') q.set('status', params.status);
    if (params?.type && params.type !== 'ALL') q.set('type', params.type);
    if (params?.audience && params.audience !== 'ALL') q.set('audience', params.audience);
    if (params?.search) q.set('search', params.search);
    const qs = q.toString();
    return await fetchApi<{ announcements: Announcement[]; total: number }>(
      `/admin/announcements${qs ? `?${qs}` : ''}`
    );
  },

  async uploadAdminAnnouncementImage(file: File): Promise<{ success: boolean; url: string; mime: string; size: number }> {
    const formData = new FormData();
    formData.append('image', file);
    return await fetchApi<{ success: boolean; url: string; mime: string; size: number }>(
      '/admin/uploads/announcement-image',
      {
        method: 'POST',
        body: formData,
      }
    );
  },

  async createAdminAnnouncement(data: {
    title: string;
    body: string;
    type?: 'NOTICE' | 'ANNOUNCEMENT' | 'PROMOTION';
    audience?: 'ALL' | 'MEMBERS' | 'MERCHANTS';
    category?: string;
    pinned?: boolean;
    startsAt?: number | string | null;
    endsAt?: number | string | null;
    ctaLabel?: string;
    ctaUrl?: string;
    imageUrl?: string | null;
    status?: 'DRAFT' | 'PUBLISHED' | 'SCHEDULED' | 'ARCHIVED';
    publishNow?: boolean;
  }): Promise<{ success: boolean; announcement: Announcement; message: string }> {
    return await fetchApi<{ success: boolean; announcement: Announcement; message: string }>(
      '/admin/announcements',
      {
        method: 'POST',
        body: JSON.stringify(data),
      }
    );
  },

  async updateAdminAnnouncement(
    id: string | number,
    data: Partial<Announcement>
  ): Promise<{ success: boolean; announcement: Announcement; message: string }> {
    return await fetchApi<{ success: boolean; announcement: Announcement; message: string }>(
      `/admin/announcements/${id}`,
      {
        method: 'PATCH',
        body: JSON.stringify(data),
      }
    );
  },

  async publishAdminAnnouncement(id: string | number): Promise<{ success: boolean; announcement: Announcement; message: string }> {
    return await fetchApi<{ success: boolean; announcement: Announcement; message: string }>(
      `/admin/announcements/${id}/publish`,
      { method: 'POST' }
    );
  },

  async unpublishAdminAnnouncement(
    id: string | number,
    archive = false
  ): Promise<{ success: boolean; announcement: Announcement; message: string }> {
    return await fetchApi<{ success: boolean; announcement: Announcement; message: string }>(
      `/admin/announcements/${id}/unpublish`,
      {
        method: 'POST',
        body: JSON.stringify({ archive }),
      }
    );
  },

  async pinAdminAnnouncement(
    id: string | number,
    pinned: boolean
  ): Promise<{ success: boolean; announcement: Announcement }> {
    return await fetchApi<{ success: boolean; announcement: Announcement }>(
      `/admin/announcements/${id}/pin`,
      {
        method: 'POST',
        body: JSON.stringify({ pinned }),
      }
    );
  },

  async archiveAdminAnnouncement(id: string | number): Promise<{ success: boolean; announcement: Announcement; message: string }> {
    return await fetchApi<{ success: boolean; announcement: Announcement; message: string }>(
      `/admin/announcements/${id}`,
      { method: 'DELETE' }
    );
  },

  async getAdminAnnouncementRevisions(id: string | number): Promise<{ revisions: import('./types.ts').AnnouncementRevisionRecord[] }> {
    return await fetchApi<{ revisions: import('./types.ts').AnnouncementRevisionRecord[] }>(
      `/admin/announcements/${id}/revisions`
    );
  },

  async createAnnouncement(data: { title: string; body: string; imageUrl?: string; category?: string }): Promise<any> {
    return await fetchApi<any>('/announcements', {
      method: 'POST',
      body: JSON.stringify(data),
    });
  },

  async deleteAnnouncement(id: string | number): Promise<any> {
    return await fetchApi<any>(`/announcements/${id}`, {
      method: 'DELETE',
    });
  },

  // Group-Level Moderator-Only Theme Toggle
  async updateGroupTheme(groupId: number, theme: 'light' | 'dark'): Promise<{ success: boolean; theme: 'light' | 'dark'; message: string }> {
    return await fetchApi<{ success: boolean; theme: 'light' | 'dark'; message: string }>(`/groups/${groupId}/theme`, {
      method: 'POST',
      body: JSON.stringify({ theme }),
    });
  },

  // Support Tickets
  async getUserTickets(): Promise<{ tickets: SupportTicket[] }> {
    return await fetchApi<{ tickets: SupportTicket[] }>('/user/tickets');
  },

  async createSupportTicket(data: { subject: string; message: string; category?: string }): Promise<any> {
    return await fetchApi<any>('/user/tickets', {
      method: 'POST',
      body: JSON.stringify(data),
    });
  },

  // -------------------------------------------------------------------
  // PART A: USER NOTIFICATIONS
  // -------------------------------------------------------------------
  async getUserNotifications(): Promise<{ notifications: UserNotification[]; unreadCount: number }> {
    return await fetchApi<{ notifications: UserNotification[]; unreadCount: number }>('/user/notifications');
  },

  async markNotificationRead(id: string | number): Promise<any> {
    return await fetchApi<any>(`/user/notifications/${id}/read`, {
      method: 'PUT',
    });
  },

  async markAllNotificationsRead(): Promise<any> {
    return await fetchApi<any>('/user/notifications/mark-all-read', {
      method: 'PUT',
    });
  },

  async clearUserNotifications(): Promise<any> {
    return await fetchApi<any>('/user/notifications', {
      method: 'DELETE',
    });
  },

  // -------------------------------------------------------------------
  // PART B: USER PROFILE (JUMIA-STYLE, NO CART)
  // -------------------------------------------------------------------
  async getUserProfile(): Promise<any> {
    return await fetchApi<any>('/user/profile');
  },

  async updateUserProfile(data: { name?: string; phone?: string; email?: string; avatarUrl?: string; paymentReceiving?: PaymentReceivingDetails }): Promise<any> {
    const res = await fetchApi<any>('/user/profile', {
      method: 'PUT',
      body: JSON.stringify(data),
    });
    if (res?.user) setStoredUser(res.user);
    return res;
  },

  async uploadMyAvatar(fileOrDataUrl: File | Blob | string): Promise<{ success: boolean; avatarUrl: string; user: User }> {
    let res: { success: boolean; avatarUrl: string; user: User };
    if (typeof fileOrDataUrl === 'string') {
      res = await fetchApi<{ success: boolean; avatarUrl: string; user: User }>('/users/me/avatar', {
        method: 'POST',
        body: JSON.stringify({ dataUrl: fileOrDataUrl }),
      });
    } else {
      const formData = new FormData();
      formData.append('avatar', fileOrDataUrl, fileOrDataUrl instanceof File ? fileOrDataUrl.name : 'avatar.jpg');
      res = await fetchApi<{ success: boolean; avatarUrl: string; user: User }>('/users/me/avatar', {
        method: 'POST',
        body: formData,
      });
    }
    if (res?.user) setStoredUser(res.user);
    return res;
  },

  async deleteMyAvatar(): Promise<{ success: boolean; user: User }> {
    const res = await fetchApi<{ success: boolean; user: User }>('/users/me/avatar', {
      method: 'DELETE',
    });
    if (res?.user) setStoredUser(res.user);
    return res;
  },

  async patchMyProfile(data: {
    name?: string;
    phone?: string;
    email?: string;
    shopName?: string;
    shopDescription?: string;
    avatarUrl?: string | null;
  }): Promise<{ success: boolean; user: User }> {
    const res = await fetchApi<{ success: boolean; user: User }>('/users/me', {
      method: 'PATCH',
      body: JSON.stringify(data),
    });
    if (res?.user) setStoredUser(res.user);
    return res;
  },

  async addUserAddress(data: Omit<DeliveryAddress, 'id' | 'userId' | 'createdAt'>): Promise<any> {
    return await fetchApi<any>('/user/addresses', {
      method: 'POST',
      body: JSON.stringify(data),
    });
  },

  async updateUserAddress(id: string, data: Partial<DeliveryAddress>): Promise<any> {
    return await fetchApi<any>(`/user/addresses/${id}`, {
      method: 'PUT',
      body: JSON.stringify(data),
    });
  },

  async deleteUserAddress(id: string): Promise<any> {
    return await fetchApi<any>(`/user/addresses/${id}`, {
      method: 'DELETE',
    });
  },

  async saveItemWishlist(productId: number): Promise<any> {
    return await fetchApi<any>('/user/saved-items', {
      method: 'POST',
      body: JSON.stringify({ productId }),
    });
  },

  async removeSavedItem(productId: number): Promise<any> {
    return await fetchApi<any>(`/user/saved-items/${productId}`, {
      method: 'DELETE',
    });
  },

  async followMerchant(merchantId: number): Promise<any> {
    return await fetchApi<any>('/user/follow-merchant', {
      method: 'POST',
      body: JSON.stringify({ merchantId }),
    });
  },

  async unfollowMerchant(merchantId: number): Promise<any> {
    return await fetchApi<any>(`/user/follow-merchant/${merchantId}`, {
      method: 'DELETE',
    });
  },

  async recordRecentlyViewed(productId: number): Promise<any> {
    return await fetchApi<any>('/user/recently-viewed', {
      method: 'POST',
      body: JSON.stringify({ productId }),
    });
  },

  // -------------------------------------------------------------------
  // PART C & D: MERCHANT SUBSCRIPTION & UPGRADE
  // -------------------------------------------------------------------
  async getSubscriptionTiers(): Promise<{ tiers: MerchantSubscriptionTier[] }> {
    return await fetchPublicWithFallback<{ tiers: MerchantSubscriptionTier[] }>(
      '/subscription-tiers',
      () => getFallbackSubscriptionTiers()
    );
  },

  async adminUpdateSubscriptionTier(
    id: string,
    data: { monthlyFee?: number; yearlyFee?: number; yearlyDiscountPercent?: number }
  ): Promise<{ success: boolean; tiers: MerchantSubscriptionTier[] }> {
    return await fetchApi<{ success: boolean; tiers: MerchantSubscriptionTier[] }>(`/admin/subscription-tiers/${encodeURIComponent(id)}`, {
      method: 'PATCH',
      body: JSON.stringify(data),
    });
  },

  async getMerchantSubscription(): Promise<any> {
    return await fetchApi<any>('/merchant/subscription');
  },

  async getMerchantSubscriptionCurrent(): Promise<any> {
    return await fetchApi<any>('/merchant/subscription/current');
  },

  async createMerchantSubscription(data: {
    tierId: string;
    billingPeriod?: BillingPeriod;
    paymentMethod?: 'mpesa' | 'wallet' | 'coins';
    mpesaCode?: string;
    autoRenew?: boolean;
  }): Promise<any> {
    return await fetchApi<any>('/merchant/subscription', {
      method: 'POST',
      body: JSON.stringify(data),
    });
  },

  async changeSubscriptionInterval(billingPeriod: BillingPeriod): Promise<any> {
    return await fetchApi<any>('/merchant/subscription/change-interval', {
      method: 'POST',
      body: JSON.stringify({
        billingPeriod,
        interval: billingPeriod === 'yearly' ? 'YEARLY' : 'MONTHLY',
      }),
    });
  },

  async cancelMerchantSubscription(): Promise<any> {
    return await fetchApi<any>('/merchant/subscription/cancel', {
      method: 'POST',
    });
  },

  async getGroupProducts(groupId: number, includeDrafts = false): Promise<{
    groupId: number;
    canManage: boolean;
    productsInGroup: import('./types.ts').GroupProductEntry[];
    items: Array<import('./types.ts').GroupProductEntry & { product: Product }>;
    products: Product[];
  }> {
    const q = includeDrafts ? '?includeDrafts=true' : '';
    return await fetchApi<any>(`/groups/${groupId}/products${q}`);
  },

  async addGroupProduct(
    groupId: number,
    data: { productId: number; featured?: boolean; order?: number }
  ): Promise<any> {
    return await fetchApi<any>(`/groups/${groupId}/products`, {
      method: 'POST',
      body: JSON.stringify(data),
    });
  },

  async updateGroupProduct(
    groupId: number,
    productId: number,
    data: { featured?: boolean; order?: number }
  ): Promise<any> {
    return await fetchApi<any>(`/groups/${groupId}/products/${productId}`, {
      method: 'PATCH',
      body: JSON.stringify(data),
    });
  },

  async removeGroupProduct(groupId: number, productId: number): Promise<any> {
    return await fetchApi<any>(`/groups/${groupId}/products/${productId}`, {
      method: 'DELETE',
    });
  },

  async paySubscriptionCoins(tierId: string, paymentMethod: 'wallet_coins' | 'wallet_credit' = 'wallet_coins', billingPeriod: BillingPeriod = 'monthly'): Promise<any> {
    return await fetchApi<any>('/merchant/subscription/pay-coins', {
      method: 'POST',
      body: JSON.stringify({ tierId, paymentMethod, billingPeriod }),
    });
  },

  async submitSubscriptionRequest(data: {
    planId: string;
    paymentMethod: 'mpesa' | 'wallet' | 'coins';
    mpesaCode?: string;
    notes?: string;
    billingPeriod?: BillingPeriod;
  }): Promise<any> {
    return await fetchApi<any>('/subscriptions/requests', {
      method: 'POST',
      body: JSON.stringify(data),
    });
  },

  async getMySubscriptionRequest(): Promise<any> {
    return await fetchApi<any>('/subscriptions/requests/me');
  },

  async getAdminSubscriptionRequests(status?: string): Promise<{ success: boolean; requests: any[] }> {
    const q = status ? `?status=${encodeURIComponent(status)}` : '';
    return await fetchApi<{ success: boolean; requests: any[] }>(`/admin/subscriptions/requests${q}`);
  },

  async approveAdminSubscriptionRequest(id: string): Promise<any> {
    return await fetchApi<any>(`/admin/subscriptions/requests/${encodeURIComponent(id)}/approve`, {
      method: 'POST',
    });
  },

  async getMerchantSubscriptionStatus(): Promise<{
    status: 'ACTIVE' | 'EXPIRED' | 'NONE';
    alarm_level: 'GREEN' | 'RED' | 'EXPIRED' | 'NONE';
    days_remaining: number;
    expiresAt: number | null;
    expiresAtEatDate: string | null;
    currentEatDate: string;
    nextEatMidnightUtcMs: number;
    hasActiveSubscription: boolean;
    hasPendingRequest: boolean;
    pendingSubscription: any;
    activeSubscription: any;
    latestSubscription: any;
    planId: string | null;
    planName: string | null;
    billingPeriod: string | null;
    renewalMode: 'reset' | 'stack';
    warningMessage: string | null;
  }> {
    return await fetchApi<any>('/merchant/subscription/status');
  },

  async getPendingMerchantNotices(): Promise<{ notices: any[] }> {
    return await fetchApi<{ notices: any[] }>('/merchant/notices/pending');
  },

  async markMerchantNoticeSeen(id: string): Promise<{ success: boolean; notice: any }> {
    return await fetchApi<{ success: boolean; notice: any }>(`/merchant/notices/${encodeURIComponent(id)}/seen`, {
      method: 'POST',
    });
  },

  async rejectAdminSubscriptionRequest(id: string, reason: string): Promise<any> {
    return await fetchApi<any>(`/admin/subscriptions/requests/${encodeURIComponent(id)}/reject`, {
      method: 'POST',
      body: JSON.stringify({ reason }),
    });
  },

  async submitManualSubscription(data: { tierId: string; paymentCode: string; amount: number; channel?: string; billingPeriod?: BillingPeriod }): Promise<any> {
    try {
      return await fetchApi<any>('/subscriptions/requests', {
        method: 'POST',
        body: JSON.stringify({
          planId: data.tierId,
          paymentMethod: 'mpesa',
          mpesaCode: data.paymentCode,
          billingPeriod: data.billingPeriod || 'monthly',
        }),
      });
    } catch (err: any) {
      if (err?.status && err.status !== 404) {
        throw err;
      }
      return await fetchApi<any>('/merchant/subscription/submit-manual', {
        method: 'POST',
        body: JSON.stringify(data),
      });
    }
  },

  async payFeaturedCoins(productId: number, days: number): Promise<any> {
    return await fetchApi<any>('/products/feature/pay-coins', {
      method: 'POST',
      body: JSON.stringify({ productId, days }),
    });
  },

  // -------------------------------------------------------------------
  // PART C & G: MERCHANT VERIFICATION
  // -------------------------------------------------------------------
  async getMerchantVerificationStatus(): Promise<any> {
    return await fetchApi<any>('/merchant/verification/status');
  },

  async submitMerchantVerification(data: Partial<MerchantVerificationRecord>): Promise<any> {
    return await fetchApi<any>('/merchant/verification/submit', {
      method: 'POST',
      body: JSON.stringify(data),
    });
  },

  async getAdminMerchantVerifications(): Promise<{ verifications: any[] }> {
    return await fetchApi<{ verifications: any[] }>('/admin/merchant-verifications');
  },

  async adminScheduleVisit(merchantId: number, data: { scheduledDate?: string; representative?: string }): Promise<any> {
    return await fetchApi<any>(`/admin/merchant-verifications/${merchantId}/schedule-visit`, {
      method: 'POST',
      body: JSON.stringify(data),
    });
  },

  async adminCompleteVisit(merchantId: number, data: { notes?: string; advertInstalled?: boolean; photoUrl?: string }): Promise<any> {
    return await fetchApi<any>(`/admin/merchant-verifications/${merchantId}/complete-visit`, {
      method: 'POST',
      body: JSON.stringify(data),
    });
  },

  async adminGrantExemption(merchantId: number, data: { requirement: string; reason: string }): Promise<any> {
    return await fetchApi<any>(`/admin/merchant-verifications/${merchantId}/grant-exemption`, {
      method: 'POST',
      body: JSON.stringify(data),
    });
  },

  async adminDecideVerification(merchantId: number, data: { action: 'verify' | 'decline'; declineReason?: string }): Promise<any> {
    return await fetchApi<any>(`/admin/merchant-verifications/${merchantId}/decide`, {
      method: 'POST',
      body: JSON.stringify(data),
    });
  },

  // Moderated Chat Send
  async sendModeratedChatMessage(groupId: number, text: string): Promise<any> {
    return await fetchApi<any>(`/groups/${groupId}/chat-moderated`, {
      method: 'POST',
      body: JSON.stringify({ text }),
    });
  },

  // Admin Subscriptions & Featured Products
  async getAdminMerchantSubscriptions(): Promise<{ subscriptions: any[] }> {
    try {
      const res = await fetchApi<{ requests: any[] }>('/admin/subscriptions/requests');
      if (res?.requests) {
        return {
          subscriptions: res.requests.map((r) => ({
            ...r,
            tierId: r.planId,
            tierName: r.planName,
            amount: r.amountExpected,
            paymentCode: r.mpesaCode,
            status: r.status === 'approved' ? 'active' : r.status === 'rejected' ? 'declined' : 'pending',
          })),
        };
      }
    } catch {}
    return await fetchApi<{ subscriptions: any[] }>('/admin/merchant-subscriptions');
  },

  async approveAdminMerchantSubscription(subscriptionId: string): Promise<any> {
    try {
      return await fetchApi<any>(`/admin/subscriptions/requests/${encodeURIComponent(subscriptionId)}/approve`, {
        method: 'POST',
      });
    } catch {
      return await fetchApi<any>(`/admin/merchant-subscriptions/${encodeURIComponent(subscriptionId)}/approve`, {
        method: 'POST',
      });
    }
  },

  async declineAdminMerchantSubscription(subscriptionId: string, reason?: string): Promise<any> {
    try {
      return await fetchApi<any>(`/admin/subscriptions/requests/${encodeURIComponent(subscriptionId)}/reject`, {
        method: 'POST',
        body: JSON.stringify({ reason: reason || 'Declined by Admin' }),
      });
    } catch {
      return await fetchApi<any>(`/admin/merchant-subscriptions/${encodeURIComponent(subscriptionId)}/decline`, {
        method: 'POST',
        body: JSON.stringify({ reason: reason || 'Declined by Admin' }),
      });
    }
  },

  async setAdminEnterprisePrice(merchantId: number, agreedPrice: number): Promise<any> {
    return await fetchApi<any>('/admin/merchant-subscriptions/set-enterprise-price', {
      method: 'POST',
      body: JSON.stringify({ merchantId, agreedPrice }),
    });
  },

  async getAdminFeaturedProducts(): Promise<{ featured: any[]; allProducts: any[] }> {
    return await fetchApi<{ featured: any[]; allProducts: any[] }>('/admin/featured-products');
  },

  async toggleAdminFeaturedProduct(productId: number): Promise<any> {
    return await fetchApi<any>(`/admin/featured-products/${productId}/toggle`, {
      method: 'POST',
    });
  },

  // -------------------------------------------------------------
  // FEATURE A: CHAMA GROUPS (TRUST & VETTING)
  // -------------------------------------------------------------
  async createTrustGroup(data: {
    name: string;
    description: string;
    contributionAmount?: number;
    cycleType?: 'weekly' | 'biweekly' | 'monthly' | string;
    rules?: string;
    contributionNote?: string;
    maxMembers?: number;
    workplace?: string;
    residence?: string;
  }): Promise<any> {
    return await fetchApi<any>('/groups', {
      method: 'POST',
      body: JSON.stringify(data),
    });
  },

  async getMyTrustGroups(): Promise<{ groups: any[] }> {
    return await fetchApi<{ groups: any[] }>('/groups/mine');
  },

  async getTrustGroup(id: string): Promise<{ group: any }> {
    return await fetchApi<{ group: any }>(`/groups/${id}`);
  },

  async getMyGroupCode(groupId: string): Promise<{ memberCode: string; groupId: string; status: string; code?: string }> {
    return await fetchApi<any>(`/groups/${groupId}/my-code`);
  },

  async submitJoinRequest(data: {
    referralCode?: string;
    memberCode?: string;
    workplace?: string;
    employer?: string;
    workplaceAddress?: string;
    residence?: string;
    residentialAddress?: string;
    residentialLandmark?: string;
    phone?: string;
    applicantPhone?: string;
    applicantName?: string;
    relationship: string;
    yearsKnown: number;
    consentGiven?: boolean;
    consentSigned?: boolean;
  }): Promise<any> {
    return await fetchApi<any>('/groups/join-requests', {
      method: 'POST',
      body: JSON.stringify({
        ...data,
        referralCode: data.memberCode || data.referralCode,
        phone: data.applicantPhone || data.phone,
        workplace: data.workplace || `${data.employer || ''} - ${data.workplaceAddress || ''}`,
        residence: data.residence || `${data.residentialAddress || ''} (Landmark: ${data.residentialLandmark || ''})`,
        consentGiven: data.consentSigned !== undefined ? data.consentSigned : (data.consentGiven !== undefined ? data.consentGiven : true),
      }),
    });
  },

  async getMyJoinRequests(): Promise<{ requests: any[] }> {
    return await fetchApi<{ requests: any[] }>('/groups/join-requests/mine');
  },

  async withdrawJoinRequest(requestId: string): Promise<any> {
    return await fetchApi<any>(`/groups/join-requests/${requestId}/withdraw`, {
      method: 'POST',
    });
  },

  async getPendingReferrals(): Promise<{ pendingRequests: any[]; referrals: any[]; totalVouchedMembersCount: number }> {
    const res = await fetchApi<any>('/groups/referrals/pending');
    return {
      pendingRequests: res.pendingRequests || res.referrals || [],
      referrals: res.referrals || res.pendingRequests || [],
      totalVouchedMembersCount: res.totalVouchedMembersCount || 0,
    };
  },

  async respondToReferral(requestId: string, responseOrObj: 'yes' | 'no' | { action: 'confirm' | 'deny'; note?: string }): Promise<any> {
    const resp = typeof responseOrObj === 'string'
      ? responseOrObj
      : (responseOrObj.action === 'confirm' ? 'yes' : 'no');
    return await fetchApi<any>(`/groups/join-requests/${requestId}/referrer-response`, {
      method: 'POST',
      body: JSON.stringify({ response: resp }),
    });
  },

  async getGroupVettingQueue(groupId: string): Promise<{ requests: any[]; queue: any[] }> {
    const res = await fetchApi<any>(`/groups/${groupId}/join-requests`);
    return {
      requests: res.requests || res.queue || [],
      queue: res.queue || res.requests || [],
    };
  },

  async logVettingCall(
    groupIdOrRequestId: string,
    requestIdOrData: any,
    maybeData?: any
  ): Promise<any> {
    let groupId = groupIdOrRequestId;
    let requestId = typeof requestIdOrData === 'string' ? requestIdOrData : groupIdOrRequestId;
    let data = maybeData || requestIdOrData;

    return await fetchApi<any>(`/groups/${groupId}/join-requests/${requestId}/log-call`, {
      method: 'POST',
      body: JSON.stringify({
        referrerKnowsWorkplaceOrResidence: data.confirmedWorkplaceResidence !== undefined ? data.confirmedWorkplaceResidence : data.referrerKnowsWorkplaceOrResidence,
        referrerAcceptsResponsibility: data.spokeWithReferrer !== undefined ? data.spokeWithReferrer : data.referrerAcceptsResponsibility,
        notes: data.notes || '',
        phoneCalled: data.phoneCalled,
        ...data,
      }),
    });
  },

  async approveJoinRequest(groupIdOrRequestId: string, maybeRequestId?: string): Promise<any> {
    const groupId = maybeRequestId ? groupIdOrRequestId : 'any';
    const requestId = maybeRequestId || groupIdOrRequestId;
    return await fetchApi<any>(`/groups/${groupId}/join-requests/${requestId}/approve`, {
      method: 'POST',
    });
  },

  async rejectJoinRequest(groupIdOrRequestId: string, reqIdOrObj?: any, maybeReason?: string): Promise<any> {
    const groupId = (maybeReason !== undefined || (typeof reqIdOrObj === 'string' && maybeReason !== undefined))
      ? groupIdOrRequestId
      : 'any';
    const requestId = (typeof reqIdOrObj === 'string') ? reqIdOrObj : groupIdOrRequestId;
    const reason = typeof reqIdOrObj === 'object' ? reqIdOrObj.reason : (maybeReason || 'Rejected');
    return await fetchApi<any>(`/groups/${groupId}/join-requests/${requestId}/reject`, {
      method: 'POST',
      body: JSON.stringify({ reason }),
    });
  },

  async getGroupMembers(groupId: string): Promise<{ members: any[]; isModerator: boolean }> {
    return await fetchApi<{ members: any[]; isModerator: boolean }>(`/groups/${groupId}/members`);
  },

  async updateGroupMemberStatus(
    groupId: string,
    memberId: string,
    data: { status?: string; role?: string; reason?: string }
  ): Promise<any> {
    return await fetchApi<any>(`/groups/${groupId}/members/${memberId}/status`, {
      method: 'PATCH',
      body: JSON.stringify(data),
    });
  },

  async getMemberTraceCard(groupId: string, memberId: string): Promise<{ traceCard: any }> {
    return await fetchApi<{ traceCard: any }>(`/groups/${groupId}/members/${memberId}/trace`);
  },

  // -------------------------------------------------------------
  // FEATURE B: 3 HERO PLATFORM ANNOUNCEMENT CARDS
  // -------------------------------------------------------------
  async getHeroAnnouncementCards(): Promise<{ announcements: import('./types.ts').PlatformAnnouncementSlot[]; cards: import('./types.ts').PlatformAnnouncementSlot[] }> {
    return await fetchPublicWithFallback<{
      announcements: import('./types.ts').PlatformAnnouncementSlot[];
      cards: import('./types.ts').PlatformAnnouncementSlot[];
    }>('/announcement-cards', () => getFallbackHeroAnnouncementCards());
  },

  async getAdminHeroAnnouncementCards(): Promise<{ cards: import('./types.ts').PlatformAnnouncementSlot[] }> {
    return await fetchApi<{ cards: import('./types.ts').PlatformAnnouncementSlot[] }>('/admin/announcement-cards');
  },

  async updateAdminHeroAnnouncementCard(
    slot: number,
    data: Partial<import('./types.ts').PlatformAnnouncementSlot>
  ): Promise<any> {
    return await fetchApi<any>(`/admin/announcement-cards/${slot}`, {
      method: 'PUT',
      body: JSON.stringify(data),
    });
  },

  async publishAdminHeroAnnouncementCard(slot: number): Promise<any> {
    return await fetchApi<any>(`/admin/announcement-cards/${slot}/publish`, {
      method: 'POST',
    });
  },

  async unpublishAdminHeroAnnouncementCard(slot: number): Promise<any> {
    return await fetchApi<any>(`/admin/announcement-cards/${slot}/unpublish`, {
      method: 'POST',
    });
  },

  async getAdminHeroAnnouncementHistory(slot: number): Promise<{ history: import('./types.ts').PlatformAnnouncementRevision[]; revisions: import('./types.ts').PlatformAnnouncementRevision[] }> {
    return await fetchApi<{ history: import('./types.ts').PlatformAnnouncementRevision[]; revisions: import('./types.ts').PlatformAnnouncementRevision[] }>(`/admin/announcement-cards/${slot}/history`);
  },

  async revertAdminHeroAnnouncementCard(slot: number, revisionId: string): Promise<any> {
    return await fetchApi<any>(`/admin/announcement-cards/${slot}/revert`, {
      method: 'POST',
      body: JSON.stringify({ revisionId }),
    });
  },

  // -------------------------------------------------------------
  // PRIVATE ADMIN PORTAL & SECURITY SETTINGS
  // -------------------------------------------------------------
  async getAdminSetupStatus(): Promise<{ adminExists: boolean; canRegisterAdmin: boolean }> {
    try {
      return await fetchApi<{ adminExists: boolean; canRegisterAdmin: boolean }>('/admin/setup-status');
    } catch {
      return { adminExists: true, canRegisterAdmin: false };
    }
  },

  async getAdminSecuritySettings(): Promise<{
    username: string;
    email: string;
    mustChangeCredentials: boolean;
    lastPasswordChangedAt: number | null;
    lastPasskeyChangedAt: number | null;
    securityBannerDismissedAt: number | null;
    securityBannerSnoozedUntil: number | null;
    showSecurityBanner: boolean;
    recentReauthValid: boolean;
  }> {
    return await fetchApi<any>('/admin/settings/security');
  },

  async dismissAdminSecurityBanner(mode: 'dismiss' | 'snooze'): Promise<{ success: boolean; showSecurityBanner: boolean }> {
    return await fetchApi<any>('/admin/settings/security/dismiss', {
      method: 'POST',
      body: JSON.stringify({ mode }),
    });
  },

  async adminChangePassword(payload: {
    currentPassword?: string;
    currentPasskey?: string;
    newPassword: string;
  }): Promise<{ success: boolean; user: User; accessToken?: string; lastPasswordChangedAt: number; message: string }> {
    const res = await fetchApi<any>('/admin/settings/change-password', {
      method: 'POST',
      body: JSON.stringify(payload),
    });
    if (res?.accessToken) {
      const remember = Boolean(localStorage.getItem(ACCESS_TOKEN_KEY));
      setAccessToken(res.accessToken, remember);
    }
    if (res?.user) setStoredUser(res.user);
    return res;
  },

  async adminChangePasskey(payload: {
    currentPassword?: string;
    currentPasskey?: string;
    newPasskey: string;
  }): Promise<{ success: boolean; user: User; accessToken?: string; lastPasskeyChangedAt: number; message: string }> {
    const res = await fetchApi<any>('/admin/settings/change-passkey', {
      method: 'POST',
      body: JSON.stringify(payload),
    });
    if (res?.accessToken) {
      const remember = Boolean(localStorage.getItem(ACCESS_TOKEN_KEY));
      setAccessToken(res.accessToken, remember);
    }
    if (res?.user) setStoredUser(res.user);
    return res;
  },

  async updateAdminAccount(payload: {
    name?: string;
    email?: string;
    currentPassword?: string;
    newPassword?: string;
  }): Promise<{ success: boolean; user: User; message: string }> {
    const res = await fetchApi<{ success: boolean; user: User; message: string }>('/admin/account/update', {
      method: 'POST',
      body: JSON.stringify(payload),
    });
    if (res?.user) {
      setStoredUser(res.user);
    }
    return res;
  },
};




