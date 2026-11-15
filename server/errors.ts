import { Response } from 'express';
import { ZodError } from 'zod';

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
