import { Body, Controller, Delete, Get, Injectable, Module, NotFoundException, Patch, Post, Req, UseGuards } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { InjectModel } from '@nestjs/mongoose';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { Model } from 'mongoose';
import { randomBytes, randomUUID } from 'node:crypto';
import { ProfileDto } from './dto';
import { geo, hash, requireValue, SessionGuard, SessionRequest } from './common';

@Injectable()
export class SessionsService {
  constructor(@InjectModel('Session') private readonly sessions: Model<any>, private readonly config: ConfigService) {}
  async create() {
    const token = randomBytes(32).toString('base64url');
    const expiresAt = new Date(Date.now() + this.config.get<number>('SESSION_TTL_DAYS', 30) * 86400000);
    const id = randomUUID();
    await this.sessions.create({ _id: id, tokenHash: hash(token), expiresAt });
    return { id, token, expiresAt, mode: 'simulated', profile: {} };
  }
  async get(id: string) {
    const s: any = await this.sessions.findById(id).lean();
    if (!s) throw new NotFoundException('Session not found');
    return { id, profile: s.profile, referralCode: s.referralCode ?? null, expiresAt: s.expiresAt, mode: 'simulated' };
  }
  async update(id: string, dto: ProfileDto) {
    geo(dto);
    const current = await this.get(id);
    const profile = { ...current.profile, ...Object.fromEntries(Object.entries(dto).filter(([, value]) => value !== undefined)) };
    if (profile.onboardingComplete) {
      requireValue(profile.area || (profile.latitude !== undefined && profile.longitude !== undefined), 'Choose an area or coordinates to complete onboarding');
      requireValue(profile.interests?.length && profile.formats?.length, 'Choose interests and formats to complete onboarding');
    }
    await this.sessions.updateOne({ _id: id }, { $set: { profile } });
    return this.get(id);
  }
  async revoke(id: string) { await this.sessions.deleteOne({ _id: id }); return { revoked: true }; }
}
@ApiTags('Sessions and onboarding')
@Controller('sessions')
export class SessionsController {
  constructor(private readonly service: SessionsService) {}
  @Post() @ApiOperation({ summary: 'Create an anonymous prototype session; save the returned token securely' }) create() { return this.service.create(); }
  @Get('me') @UseGuards(SessionGuard) @ApiBearerAuth('session') get(@Req() req: SessionRequest) { return this.service.get(req.sessionId); }
  @Patch('me') @UseGuards(SessionGuard) @ApiBearerAuth('session') update(@Req() req: SessionRequest, @Body() dto: ProfileDto) { return this.service.update(req.sessionId, dto); }
  @Delete('me') @UseGuards(SessionGuard) @ApiBearerAuth('session') revoke(@Req() req: SessionRequest) { return this.service.revoke(req.sessionId); }
}
@Module({ controllers: [SessionsController], providers: [SessionsService, SessionGuard], exports: [SessionGuard] })
export class SessionsModule {}
