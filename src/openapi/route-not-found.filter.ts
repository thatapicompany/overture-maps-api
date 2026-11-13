import { ArgumentsHost, Catch, ExceptionFilter, NotFoundException } from '@nestjs/common';
import { Response } from 'express';
import { DOCS_URL, PUBLIC_API_URL } from './openapi.document';

// Nest's message for a request that matched no route, e.g. "Cannot GET /foo".
const UNMATCHED_ROUTE = /^Cannot [A-Z]+ /;

/** Links that help a person or an AI agent that guessed a wrong path. */
export function routeNotFoundBody(method: string, path: string) {
  return {
    statusCode: 404,
    error: 'Not Found',
    message: `There is no endpoint at ${method} ${path}. See the API reference for the available endpoints and parameters.`,
    docs: `${DOCS_URL}/docs/intro`,
    openapi: `${PUBLIC_API_URL}/api-docs.json`,
    llms_txt: `${DOCS_URL}/llms.txt`,
  };
}

/**
 * Replaces the bare "Cannot GET /x" body for unknown routes with pointers to
 * the docs and the OpenAPI spec. 404s thrown by handlers (e.g. an unknown
 * division id) keep their own message.
 */
@Catch(NotFoundException)
export class RouteNotFoundFilter implements ExceptionFilter {
  catch(exception: NotFoundException, host: ArgumentsHost): void {
    const ctx = host.switchToHttp();
    const res = ctx.getResponse<Response>();
    const req = ctx.getRequest();
    const body = exception.getResponse() as any;
    const message = typeof body === 'string' ? body : body?.message;
    if (typeof message === 'string' && UNMATCHED_ROUTE.test(message)) {
      const path = String(req.originalUrl ?? req.url ?? '').split('?')[0];
      res.status(404).json(routeNotFoundBody(req.method, path));
      return;
    }
    res.status(404).json(typeof body === 'string' ? { statusCode: 404, message: body } : body);
  }
}
