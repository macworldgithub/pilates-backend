import 'reflect-metadata';
import { NestFactory } from '@nestjs/core';
import { ConfigService } from '@nestjs/config';
import { NestExpressApplication } from '@nestjs/platform-express';
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';
import { json } from 'express';
import { AppModule } from './app.module';
import { configure } from './common';

export async function bootstrap() {
  const app = await NestFactory.create<NestExpressApplication>(AppModule, { bodyParser: false });
  const config = app.get(ConfigService);
  app.use(json({ limit: '64kb', strict: true }));
  configure(app, config.get<string>('CORS_ORIGINS', '').split(',').map(s => s.trim()).filter(Boolean));
  app.disable('x-powered-by');
  app.enableShutdownHooks();
  const document = SwaggerModule.createDocument(app, new DocumentBuilder().setTitle('Project Orbit MVP API')
    .setDescription('Isolated prototype with sample data. No live payments, studio inventory, commissions or bookings. Prices use minor currency units. Session and admin tokens are separate.')
    .setVersion('1.0.0').addBearerAuth({ type: 'http', scheme: 'bearer', description: 'Token from POST /sessions' }, 'session')
    .addBearerAuth({ type: 'http', scheme: 'bearer', description: 'Private server-side ADMIN_TOKEN' }, 'admin').build());
  SwaggerModule.setup('docs', app, document, { jsonDocumentUrl: 'docs/openapi.json', swaggerOptions: { persistAuthorization: false } });
  await app.listen(config.get<number>('PORT', 4000), config.get<string>('HOST', '127.0.0.1'));
  console.log(`Project Orbit API: ${await app.getUrl()}/api/v1 | Swagger: /docs | sample-data mode`);
  return app;
}
if (require.main === module) bootstrap().catch(() => { console.error('Startup failed. Check environment configuration and MongoDB connectivity.'); process.exitCode = 1; });
