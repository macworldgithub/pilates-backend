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
