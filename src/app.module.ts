import { Controller, Get, Module, ServiceUnavailableException } from '@nestjs/common';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { APP_GUARD } from '@nestjs/core';
import { InjectConnection, MongooseModule } from '@nestjs/mongoose';
import { ThrottlerGuard, ThrottlerModule } from '@nestjs/throttler';
import { ApiTags } from '@nestjs/swagger';
import { Connection } from 'mongoose';
import { ModelsModule } from './models';
import { SessionsModule } from './sessions';
import { CatalogModule } from './catalog';
import { CommerceModule } from './commerce';
import { AdminModule } from './admin';
import { AdminAuthModule } from './admin-auth';

export function validateEnv(env: Record<string, unknown>) {
  const uri = String(env.MONGODB_URI ?? '');
  if (!/^mongodb(?:\+srv)?:\/\//.test(uri) || /[\r\n\\]/.test(uri)) throw new Error('MONGODB_URI must be a valid MongoDB connection string without trailing backslashes');
  const port = Number(env.PORT ?? 4000), days = Number(env.SESSION_TTL_DAYS ?? 30);
  if (!Number.isInteger(port) || port < 0 || port > 65535) throw new Error('PORT must be between 0 and 65535');
  if (!Number.isInteger(days) || days < 1 || days > 90) throw new Error('SESSION_TTL_DAYS must be between 1 and 90');
  const admin = String(env.ADMIN_TOKEN ?? '');
  if (admin && (admin.length < 32 || admin.startsWith('replace-'))) throw new Error('ADMIN_TOKEN must be a private token of at least 32 characters');
  return { ...env, PORT: port, SESSION_TTL_DAYS: days };
}
@ApiTags('Health')
@Controller('health')
class HealthController {
  constructor(@InjectConnection() private readonly db: Connection) {}
  @Get() async health() {
    try { await this.db.db?.admin().ping(); }
    catch { throw new ServiceUnavailableException('Database unavailable'); }
    if (this.db.readyState !== 1) throw new ServiceUnavailableException('Database unavailable');
    return { status: 'ok', database: 'connected', mode: 'simulated', version: '1.0.0' };
  }
}
@Module({
  imports: [
    ConfigModule.forRoot({ isGlobal: true, validate: validateEnv }),
    MongooseModule.forRootAsync({ inject: [ConfigService], useFactory: (config: ConfigService) => ({
      uri: config.getOrThrow<string>('MONGODB_URI'), serverSelectionTimeoutMS: 10000, connectTimeoutMS: 10000,
      retryAttempts: 0, autoIndex: true,
      connectionErrorFactory: () => new Error('MongoDB connection failed. Check credentials, network access and Atlas IP allowlist.'),
    }) }),
    ThrottlerModule.forRoot([{ ttl: 60000, limit: 180 }]),
    ModelsModule, SessionsModule, CatalogModule, CommerceModule, AdminAuthModule, AdminModule,
  ],
  controllers: [HealthController], providers: [{ provide: APP_GUARD, useClass: ThrottlerGuard }],
})
export class AppModule {}
