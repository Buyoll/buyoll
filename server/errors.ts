import { NextFunction, Request, Response, Router } from 'express';
import { ZodError } from 'zod';

export type AsyncRequestHandler = (
  req: Request,
  res: Response,
  next: NextFunction
) => unknown | Promise<unknown>;

export function asyncHandler(fn: AsyncRequestHandler) {
  return function wrappedAsyncHandler(req: Request, res: Response, next: NextFunction) {
    Promise.resolve(fn(req, res, next)).catch(next);
  };
}

export function wrapRouterAsync(router: Router): Router {
  const methods = ['get', 'post', 'put', 'patch', 'delete', 'options', 'head', 'all'] as const;
  for (const method of methods) {
    const orig = (router as any)[method].bind(router);
    (router as any)[method] = function (path: any, ...handlers: any[]) {
      const wrapped = handlers.map((h) => {
        if (typeof h !== 'function' || h.length >= 4) return h;
        return function safeHandler(req: Request, res: Response, next: NextFunction) {
          try {
            const out = h(req, res, next);
            if (out && typeof out.then === 'function') {
              out.catch(next);
            }
          } catch (err) {
            next(err);
          }
        };
      });
      return orig(path, ...wrapped);
    };
  }
  return router;
}

export interface ApiErrorBody {
  error: {
    code: string;
    message: string;
    fields?: Record<string, string>;
  };
}

export function sendApiError(
  res: Response,
  status: number,
  code: string,
  message: string,
  fields?: Record<string, string | undefined>
): Response {
  const cleanFields = fields
    ? (Object.fromEntries(
        Object.entries(fields).filter(([, v]) => typeof v === 'string' && v.length > 0)
      ) as Record<string, string>)
    : undefined;
  const body: ApiErrorBody = {
    error: {
      code,
      message,
      ...(cleanFields && Object.keys(cleanFields).length > 0 ? { fields: cleanFields } : {}),
    },
  };
  return res.status(status).json(body);
}

export function formatZodError(err: ZodError): {
  message: string;
  fields: Record<string, string>;
} {
  const fields: Record<string, string> = {};
  for (const issue of err.issues) {
    const key = issue.path.join('.') || 'body';
    if (!fields[key]) {
      fields[key] = issue.message;
    }
  }
  const firstMessage = err.issues[0]?.message || 'Invalid request input.';
  return { message: firstMessage, fields };
}

export function sendZodError(res: Response, err: ZodError, status = 400): Response {
  const { message, fields } = formatZodError(err);
  return sendApiError(res, status, 'VALIDATION_ERROR', message, fields);
}
