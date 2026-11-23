import { ArgumentsHost, BadRequestException, Catch, ExceptionFilter, HttpException, INestApplication, Injectable, CanActivate, ExecutionContext, UnauthorizedException, ServiceUnavailableException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import { createHash, timingSafeEqual } from 'node:crypto';
import { Request, Response } from 'express';
import { ValidationPipe } from '@nestjs/common';
import helmet from 'helmet';
import { DiscoverQuery, PageQuery } from './dto';

export const hash = (value: string) => createHash('sha256').update(value).digest('hex');
export function requireValue(condition: unknown, message: string): asserts condition {
  if (!condition) throw new BadRequestException(message);
}
export function page(items: any[], query: PageQuery) {
  return { data: items.slice((query.page - 1) * query.limit, query.page * query.limit), pagination: { page: query.page, limit: query.limit, total: items.length, pages: Math.ceil(items.length / query.limit) } };
}
export function geo(query: { latitude?: number; longitude?: number; radiusKm?: number; sort?: string }) {
  requireValue((query.latitude === undefined) === (query.longitude === undefined), 'latitude and longitude must be supplied together');
  requireValue((query.radiusKm === undefined && query.sort !== 'nearest') || query.latitude !== undefined, 'Coordinates are required for radius or nearest sorting');
  return query.latitude !== undefined;
}
export function distance(a: { latitude: number; longitude: number }, b: { latitude: number; longitude: number }) {
  const rad = (x: number) => x * Math.PI / 180;
  const h = Math.sin(rad(b.latitude - a.latitude) / 2) ** 2 + Math.cos(rad(a.latitude)) * Math.cos(rad(b.latitude)) * Math.sin(rad(b.longitude - a.longitude) / 2) ** 2;
  return Math.round(6371 * 2 * Math.asin(Math.sqrt(Math.min(1, h))) * 100) / 100;
}
export function search(items: any[], q: DiscoverQuery | PageQuery) {
  const term = q.search?.toLocaleLowerCase().trim();
  return term ? items.filter(x => [x.name, x.title, x.description, x.city, x.bio].some(s => typeof s === 'string' && s.toLocaleLowerCase().includes(term))) : items;
}
function bearer(req: Request) {
  const header = req.headers.authorization;
  if (!header?.startsWith('Bearer ') || header.length > 1024) throw new UnauthorizedException('A valid Bearer token is required');
  return header.slice(7);
}
export interface SessionRequest extends Request { sessionId: string }
@Injectable()
export class SessionGuard implements CanActivate {
  constructor(@InjectModel('Session') private readonly sessions: Model<any>) {}
  async canActivate(ctx: ExecutionContext) {
    const req = ctx.switchToHttp().getRequest<SessionRequest>();
    const session: any = await this.sessions.findOne({ tokenHash: hash(bearer(req)), expiresAt: { $gt: new Date() } }).select('_id').lean();
    if (!session) throw new UnauthorizedException('Session is invalid or expired');
    req.sessionId = String(session._id);
    return true;
  }
}
@Injectable()
export class AdminGuard implements CanActivate {
  constructor(private readonly config: ConfigService) {}
  canActivate(ctx: ExecutionContext) {
    const expected = this.config.get<string>('ADMIN_TOKEN');
    if (!expected || expected.length < 32) throw new ServiceUnavailableException('Admin access is not configured');
    const provided = bearer(ctx.switchToHttp().getRequest());
    if (!timingSafeEqual(Buffer.from(hash(expected)), Buffer.from(hash(provided)))) throw new UnauthorizedException('Invalid admin token');
    return true;
  }
}
@Catch()
export class Errors implements ExceptionFilter {
  catch(exception: any, host: ArgumentsHost) {
    const res = host.switchToHttp().getResponse<Response>();
    const duplicate = exception?.code === 11000;
    const bodyError = ['entity.parse.failed', 'entity.too.large'].includes(exception?.type);
    const status = exception instanceof HttpException ? exception.getStatus() : duplicate ? 409 : bodyError ? exception.status : 500;
    const body = exception instanceof HttpException ? exception.getResponse() : null;
    const message = typeof body === 'string' ? body : body && typeof body === 'object' && 'message' in body ? body.message : duplicate ? 'A record with this unique value already exists' : bodyError ? (status === 413 ? 'JSON body exceeds 64 KB limit' : 'Malformed JSON body') : 'Internal server error';
    if (status === 500) console.error(`[backend] ${exception?.name ?? 'Error'}: request failed`);
    res.status(status).json({ error: { status, message }, timestamp: new Date().toISOString() });
  }
}
export function configure(app: INestApplication, origins: string[] = []) {
  app.setGlobalPrefix('api/v1');
  app.use(helmet());
  app.enableCors({ origin: origins, methods: ['GET', 'POST', 'PATCH', 'PUT', 'DELETE', 'OPTIONS'], allowedHeaders: ['Authorization', 'Content-Type', 'Idempotency-Key'] });
  app.useGlobalPipes(new ValidationPipe({ transform: true, whitelist: true, forbidNonWhitelisted: true, forbidUnknownValues: true }));
  app.useGlobalFilters(new Errors());
}
