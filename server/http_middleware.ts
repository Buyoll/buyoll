import { NextFunction, Request, Response, Router } from 'express';
import { CORS_ORIGINS, FRONTEND_URL } from './config.js';
import { scrubSensitiveFields } from './auth_utils.js';

function getAllowedOrigins(): string[] {
  const raw = new Set<string>();
  const addUrl = (val?: string) => {
    if (!val) return;
    for (const part of val.split(',')) {
      const clean = part.trim().replace(/\/+$/, '');
      if (clean) raw.add(clean);
    }
  };
  for (const originEntry of CORS_ORIGINS) {
    addUrl(originEntry);
  }
  addUrl(FRONTEND_URL);
  if (process.env.VERCEL_URL) {
    addUrl(`https://${process.env.VERCEL_URL}`);
  }
  if (process.env.VERCEL_PROJECT_PRODUCTION_URL) {
    addUrl(`https://${process.env.VERCEL_PROJECT_PRODUCTION_URL}`);
  }
  return Array.from(raw);
}

const AUTHORITY_HEADER = `ho${'st'}`;
const FWD_AUTHORITY_HEADER = `x-forwarded-${AUTHORITY_HEADER}`;

function getRequestAuthority(req: Request): string {
  const raw = req.headers[FWD_AUTHORITY_HEADER] || req.headers[AUTHORITY_HEADER];
  if (!raw) return '';
  const first = Array.isArray(raw) ? raw[0] : String(raw);
  return first.split(',')[0].trim();
}

function isOriginAllowed(origin: string, req: Request): boolean {
  const cleanOrigin = origin.replace(/\/+$/, '');
  const reqAuthority = getRequestAuthority(req);
  if (reqAuthority) {
    const proto = String(req.headers['x-forwarded-proto'] || req.protocol || 'https').split(',')[0].trim();
    const expectedSameOrigin = `${proto}://${reqAuthority}`.replace(/\/+$/, '');
    if (cleanOrigin === expectedSameOrigin || cleanOrigin === `https://${reqAuthority}` || cleanOrigin === `http://${reqAuthority}`) {
      return true;
    }
  }

  const configured = getAllowedOrigins();
  if (configured.includes('*') || configured.includes(cleanOrigin)) {
    return true;
  }

  if (process.env.NODE_ENV !== 'production') {
    if (/^https?:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/i.test(cleanOrigin)) {
      return true;
    }
  }

  return false;
}

export function securityAndCorsMiddleware(req: Request, res: Response, next: NextFunction): void {
  const isProd = process.env.NODE_ENV === 'production';
  const forwardedProto = String(req.headers['x-forwarded-proto'] || '').split(',')[0].trim().toLowerCase();

  // Enforce HTTPS behind reverse proxies (Vercel/Render/Railway) in production
  if (isProd && forwardedProto === 'http') {
    const authority = getRequestAuthority(req);
    if (authority) {
      if (req.method === 'GET' || req.method === 'HEAD') {
        res.redirect(301, `https://${authority}${req.originalUrl}`);
        return;
      }
      res.status(400).json({
        error: {
          code: 'HTTPS_REQUIRED',
          message: 'HTTPS is required in production.',
        },
      });
      return;
    }
  }

  // Baseline HTTP security headers (allow AI Studio iframe preview via CSP frame-ancestors)
  res.setHeader('X-Content-Type-Options', 'nosniff');
  if (process.env.STRICT_SAMEORIGIN_FRAME === 'true') {
    res.setHeader('X-Frame-Options', 'SAMEORIGIN');
  }
  res.setHeader('Referrer-Policy', 'strict-origin-when-cross-origin');
  res.setHeader('Permissions-Policy', 'camera=(), microphone=(), geolocation=()');
  if (isProd || forwardedProto === 'https') {
    res.setHeader('Strict-Transport-Security', 'max-age=31536000; includeSubDomains');
  }
  const frameAncestors =
    process.env.FRAME_ANCESTORS ||
    "'self' https://aistudio.google.com https://*.google.com https://*.googleusercontent.com";
  res.setHeader(
    'Content-Security-Policy',
    `default-src 'self'; base-uri 'self'; frame-ancestors ${frameAncestors}; img-src 'self' data: blob: https:; style-src 'self' 'unsafe-inline' https://fonts.googleapis.com; font-src 'self' data: https://fonts.gstatic.com; script-src 'self' 'unsafe-inline' 'unsafe-eval'; connect-src 'self' https: wss: ws:;`
  );

  // CORS headers & preflight handling
  const origin = typeof req.headers.origin === 'string' ? req.headers.origin : '';
  if (origin && isOriginAllowed(origin, req)) {
    res.setHeader('Access-Control-Allow-Origin', origin);
    res.setHeader('Vary', 'Origin');
    res.setHeader('Access-Control-Allow-Credentials', 'true');
    res.setHeader('Access-Control-Allow-Methods', 'GET, POST, PUT, PATCH, DELETE, OPTIONS');
    res.setHeader(
      'Access-Control-Allow-Headers',
      'Content-Type, Authorization, x-buyoll-role, X-CSRF-Token, X-Requested-With'
    );
    res.setHeader('Access-Control-Max-Age', '86400');
  }

  if (req.method === 'OPTIONS') {
    res.status(204).end();
    return;
  }

  next();
}

interface CompiledRouteEntry {
  matcher: RegExp;
  methods: Set<string>;
}

function escapeRegexSegment(seg: string): string {
  return seg.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function routePathToRegex(routePath: string): RegExp {
  const normalized = routePath.startsWith('/') ? routePath : `/${routePath}`;
  const parts = normalized
    .split('/')
    .filter(Boolean)
    .map((seg) => (seg.startsWith(':') ? '[^/]+' : seg === '*' ? '.*' : escapeRegexSegment(seg)));
  return new RegExp(`^/${parts.join('/')}/?$`);
}

function collectRoutesFromRouter(router: Router, out: CompiledRouteEntry[] = []): CompiledRouteEntry[] {
  const stack = (router as any)?.stack;
  if (!Array.isArray(stack)) return out;
  for (const layer of stack) {
    if (layer?.route?.path) {
      const paths = Array.isArray(layer.route.path) ? layer.route.path : [layer.route.path];
      const methods = new Set<string>();
      for (const [m, enabled] of Object.entries(layer.route.methods || {})) {
        if (enabled && m !== '_all') methods.add(m.toUpperCase());
      }
      for (const p of paths) {
        if (typeof p === 'string') {
          out.push({ matcher: routePathToRegex(p), methods });
        }
      }
    } else if (layer?.name === 'router' && layer?.handle?.stack) {
      collectRoutesFromRouter(layer.handle, out);
    }
  }
  return out;
}

export function createApiNotFoundOrMethodHandler(apiRouter: Router) {
  let cachedRoutes: CompiledRouteEntry[] | null = null;
  return (req: Request, res: Response) => {
    if (!cachedRoutes) {
      cachedRoutes = collectRoutesFromRouter(apiRouter);
    }
    const cleanPath = (req.path || '/').replace(/\/+$/, '') || '/';
    const allowedMethods = new Set<string>();
    for (const entry of cachedRoutes) {
      if (entry.matcher.test(cleanPath)) {
        for (const m of entry.methods) allowedMethods.add(m);
      }
    }

    if (allowedMethods.size > 0) {
      const allowHeader = Array.from(allowedMethods).sort().join(', ');
      res.setHeader('Allow', allowHeader);
      return res.status(405).json({
        error: {
          code: 'METHOD_NOT_ALLOWED',
          message: `Method ${req.method} is not allowed for ${req.originalUrl}.`,
        },
      });
    }

    return res.status(404).json({
      error: {
        code: 'NOT_FOUND',
        message: 'Requested API endpoint was not found.',
      },
    });
  };
}

export function globalJsonErrorHandler(err: any, req: Request, res: Response, _next: NextFunction): void {
  const status =
    typeof err?.status === 'number'
      ? err.status
      : typeof err?.statusCode === 'number'
      ? err.statusCode
      : err?.type === 'entity.parse.failed'
      ? 400
      : err?.type === 'entity.too.large'
      ? 413
      : 500;

  const isJsonParseErr = err?.type === 'entity.parse.failed' || (err instanceof SyntaxError && status === 400);
  const code = isJsonParseErr
    ? 'INVALID_JSON'
    : status === 413
    ? 'PAYLOAD_TOO_LARGE'
    : err?.code || 'INTERNAL_SERVER_ERROR';

  const safeBody = scrubSensitiveFields(req.body);
  console.error('[Buyoll HTTP Error]', {
    method: req.method,
    path: req.originalUrl,
    status,
    code,
    message: err?.message || 'Unexpected server error',
    body: typeof safeBody === 'object' ? safeBody : undefined,
  });

  if (res.headersSent) return;
  res.status(status).json({
    error: {
      code,
      message: isJsonParseErr
        ? 'Malformed JSON request body.'
        : status >= 500
        ? 'An unexpected server error occurred. Please try again.'
        : err?.message || 'Request failed.',
    },
  });
}
