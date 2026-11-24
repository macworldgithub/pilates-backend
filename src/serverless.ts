import type { Request, Response } from 'express';
import type { NestExpressApplication } from '@nestjs/platform-express';
import { createApplication } from './main';

// Store the pending promise before awaiting it: simultaneous cold-start requests
// must share initialization and the same Mongoose pool. Warm requests reuse it.
let application: Promise<NestExpressApplication> | undefined;
export function getApplication(): Promise<NestExpressApplication> {
  application ??= createApplication().catch(error => {
    application = undefined; // Retry a transient connection failure next request.
    throw error;
  });
  return application;
}

export default async function handler(req: Request, res: Response) {
  try {
    // Vercel's /:path* rewrite forwards its capture as a query parameter.
    // It is transport metadata, not a DiscoverQuery/PageQuery field. Remove it
    // before Nest's strict query validation, preserving every actual API filter.
    const url = new URL(req.url ?? '/', 'http://serverless.internal');
    if (url.searchParams.has('path')) {
      url.searchParams.delete('path');
      req.url = url.pathname + url.search;
    }
    // Some Vercel runtimes also materialize req.query before Express receives it.
    if (Object.prototype.hasOwnProperty.call(req, 'query') && req.query) {
      delete req.query.path;
    }
    const app = await getApplication();
    const express = app.getHttpAdapter().getInstance();
    // Keep the invocation alive through asynchronous controller/database work.
    await new Promise<void>((resolve, reject) => {
      const done = () => { cleanup(); resolve(); };
      const fail = (error: Error) => { cleanup(); reject(error); };
      const cleanup = () => { res.off('finish', done); res.off('close', done); res.off('error', fail); };
      res.once('finish', done);
      res.once('close', done);
      res.once('error', fail);
      try { express(req, res); } catch (error) { cleanup(); reject(error); }
    });
  } catch {
    // Never expose database credentials or a stack trace to clients.
    console.error('API initialization failed. Check deployment environment and MongoDB connectivity.');
    if (!res.headersSent) {
      res.setHeader('Cache-Control', 'no-store');
      res.setHeader('Retry-After', '5');
      res.statusCode = 503;
      res.setHeader('Content-Type', 'application/json; charset=utf-8');
      res.end(JSON.stringify({ error: { status: 503, message: 'API temporarily unavailable. Please retry.' }, timestamp: new Date().toISOString() }));
    }
  }
}
