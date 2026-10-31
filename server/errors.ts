import { ZodError } from 'zod';
import type { ErrorRequestHandler } from 'express';

export class DomainError extends Error {
  constructor(public status: number, public code: string, message: string, public fields?: Record<string, string>) { super(message); }
}
export const errorHandler: ErrorRequestHandler = (error: unknown, _req, res, _next) => {
  let domain: DomainError;
  if (error instanceof DomainError) domain = error;
  else if (error instanceof ZodError) {
    const fields: Record<string, string> = {};
    for (const issue of error.issues) { const key = issue.path.join('.'); if (key && !fields[key]) fields[key] = issue.message; }
    domain = new DomainError(400, 'VALIDATION', 'Check the highlighted fields and try again.', fields);
  } else if (error instanceof SyntaxError && 'body' in error) domain = new DomainError(400, 'INVALID_JSON', 'Send valid JSON and try again.');
  else if (typeof error === 'object' && error !== null && 'type' in error && error.type === 'entity.too.large') domain = new DomainError(413, 'TOO_LARGE', 'This request is too large. Use fewer characters.');
  else {
    console.error(`Request ${String(res.locals.requestId)} failed with an unexpected server error.`);
    domain = new DomainError(500, 'INTERNAL', 'The operation could not be completed. Your changes were not saved. Try again.');
  }
  res.status(domain.status).json({ error: { code: domain.code, message: domain.message, ...(domain.fields ? { fields: domain.fields } : {}), requestId: res.locals.requestId } });
};
