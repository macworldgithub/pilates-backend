import { Body, Controller, Delete, Get, Injectable, Module, NotFoundException, Patch, Post, Req, UnauthorizedException, UseGuards } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { InjectModel } from '@nestjs/mongoose';
import { ApiBearerAuth, ApiOperation, ApiProperty, ApiTags } from '@nestjs/swagger';
import { Throttle } from '@nestjs/throttler';
import { IsString, Length } from 'class-validator';
import { Model } from 'mongoose';
import { randomBytes, randomUUID, timingSafeEqual } from 'node:crypto';
import { ProfileDto } from './dto';
import { geo, hash, requireValue, SessionGuard, SessionRequest } from './common';

export const DEMO_STAFF = { username: 'staff', password: 'OrbitStaff123!' } as const;
export class StaffLoginDto {
  @ApiProperty({ example: 'staff' }) @IsString() @Length(1, 100) username!: string;
  @ApiProperty({ example: 'OrbitStaff123!' }) @IsString() @Length(1, 200) password!: string;
}
@Injectable()
export class SessionsService {
  constructor(@InjectModel('Session') private readonly sessions: Model<any>, private readonly config: ConfigService) {}
  async create() {
    const token = randomBytes(32).toString('base64url');
    const expiresAt = new Date(Date.now() + this.config.get<number>('SESSION_TTL_DAYS', 30) * 86400000);
    const id = randomUUID();
    await this.sessions.create({ _id: id, tokenHash: hash(token), expiresAt, accountType: 'guest' });
    return { id, token, expiresAt, mode: 'simulated', accountType: 'guest', profile: {} };
  }
  async get(id: string) {
    const s: any = await this.sessions.findById(id).lean();
    if (!s) throw new NotFoundException('Session not found');
    return { id, profile: s.profile, accountType: s.accountType ?? 'guest', referralCode: s.referralCode ?? null, expiresAt: s.expiresAt, mode: 'simulated' };
  }
  async staffLogin(id: string, dto: StaffLoginDto) {
    const usernameMatches = timingSafeEqual(Buffer.from(hash(dto.username)), Buffer.from(hash(DEMO_STAFF.username)));
    const passwordMatches = timingSafeEqual(Buffer.from(hash(dto.password)), Buffer.from(hash(DEMO_STAFF.password)));
    if (!usernameMatches || !passwordMatches) throw new UnauthorizedException('Invalid username or password');
    await this.sessions.updateOne({ _id: id }, { $set: { accountType: 'staff' } });
    return this.get(id);
  }
  async staffLogout(id: string) {
    await this.sessions.updateOne({ _id: id }, { $set: { accountType: 'guest' } });
    return this.get(id);
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
@ApiTags('Staff sign-in')
@Controller('auth')
class StaffAuthController {
  constructor(private readonly service: SessionsService) {}
  @Post('login') @Throttle({ default: { limit: 5, ttl: 60000 } }) @UseGuards(SessionGuard) @ApiBearerAuth('session')
  @ApiOperation({ summary: 'Sign the current prototype session in to the fixed internal staff account' })
  login(@Req() req: SessionRequest, @Body() dto: StaffLoginDto) { return this.service.staffLogin(req.sessionId, dto); }
  @Post('logout') @UseGuards(SessionGuard) @ApiBearerAuth('session')
  logout(@Req() req: SessionRequest) { return this.service.staffLogout(req.sessionId); }
}
@Module({ controllers: [SessionsController, StaffAuthController], providers: [SessionsService, SessionGuard], exports: [SessionGuard] })
export class SessionsModule {}
