const SESSION_KEY = 'buyoll_featured_sid_v1';
const ATTR_MAP_KEY = 'buyoll_featured_attr_v1';
const ATTR_TTL_MS = 24 * 60 * 60 * 1000;

export function getFeaturedSessionId(): string {
  if (typeof window === 'undefined') return 'ssr_session';
  try {
    let existing = window.sessionStorage.getItem(SESSION_KEY);
    if (!existing) {
      existing = `fsid_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 10)}`;
      window.sessionStorage.setItem(SESSION_KEY, existing);
    }
    return existing;
  } catch {
    return 'anon_session';
  }
}

export function rememberFeaturedAttribution(productId: number, featuredRequestId?: string | null): void {
  if (typeof window === 'undefined' || !productId || !featuredRequestId || featuredRequestId.startsWith('fb_')) {
    return;
  }
  try {
    const raw = window.sessionStorage.getItem(ATTR_MAP_KEY);
    const map: Record<string, { featuredRequestId: string; ts: number }> = raw ? JSON.parse(raw) : {};
    map[String(productId)] = { featuredRequestId, ts: Date.now() };
    window.sessionStorage.setItem(ATTR_MAP_KEY, JSON.stringify(map));
  } catch {
    // Ignore storage errors
  }
}

export function getFeaturedAttribution(productId: number): string | undefined {
  if (typeof window === 'undefined' || !productId) return undefined;
  try {
    const raw = window.sessionStorage.getItem(ATTR_MAP_KEY);
    if (!raw) return undefined;
    const map: Record<string, { featuredRequestId: string; ts: number }> = JSON.parse(raw);
    const entry = map[String(productId)];
    if (!entry) return undefined;
    if (Date.now() - entry.ts > ATTR_TTL_MS) {
      delete map[String(productId)];
      window.sessionStorage.setItem(ATTR_MAP_KEY, JSON.stringify(map));
      return undefined;
    }
    return entry.featuredRequestId;
  } catch {
    return undefined;
  }
}
