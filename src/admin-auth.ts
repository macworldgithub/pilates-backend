import { Body, Controller, Delete, Injectable, Module, Post, Req, UnauthorizedException, UseGuards } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { ApiBearerAuth, ApiOperation, ApiProperty, ApiTags } from '@nestjs/swagger';
import { Throttle } from '@nestjs/throttler';
import { IsString, Length } from 'class-validator';
import { Model } from 'mongoose';
import { randomBytes, randomUUID, timingSafeEqual } from 'node:crypto';
import { Request } from 'express';
import { AdminGuard, hash } from './common';

// Fixed credentials requested for the isolated internal prototype.
export const DEMO_ADMIN = { username: 'admin', password: 'OrbitAdmin123!' } as const;
export class AdminLoginDto {
  @ApiProperty({ example: 'admin' }) @IsString() @Length(1, 100) username!: string;
  @ApiProperty({ example: 'OrbitAdmin123!' }) @IsString() @Length(1, 200) password!: string;
}
@Injectable()
class AdminAuthService {
  constructor(@InjectModel('AdminSession') private readonly sessions: Model<any>) {}
  async login(dto: AdminLoginDto) {
    const usernameMatches = timingSafeEqual(Buffer.from(hash(dto.username)), Buffer.from(hash(DEMO_ADMIN.username)));
    const passwordMatches = timingSafeEqual(Buffer.from(hash(dto.password)), Buffer.from(hash(DEMO_ADMIN.password)));
    if (!usernameMatches || !passwordMatches) throw new UnauthorizedException('Invalid username or password');
    const accessToken = randomBytes(32).toString('base64url');
    const expiresAt = new Date(Date.now() + 8 * 60 * 60 * 1000);
    await this.sessions.create({ _id: randomUUID(), tokenHash: hash(accessToken), expiresAt });
    return { accessToken, tokenType: 'Bearer', expiresAt, username: DEMO_ADMIN.username };
  }
  async logout(req: Request) {
    const token = req.headers.authorization?.slice(7) ?? '';
    await this.sessions.deleteOne({ tokenHash: hash(token) });
    return { loggedOut: true };
  }
}
@ApiTags('Admin login')
@Controller('admin/auth')
class AdminAuthController {
  constructor(private readonly auth: AdminAuthService) {}
  @Post('login') @Throttle({ default: { limit: 5, ttl: 60000 } })
  @ApiOperation({ summary: 'Log in with fixed prototype credentials and receive an 8-hour admin token' })
  login(@Body() dto: AdminLoginDto) { return this.auth.login(dto); }
  @Delete('session') @UseGuards(AdminGuard) @ApiBearerAuth('admin')
  logout(@Req() req: Request) { return this.auth.logout(req); }
}
@Module({ controllers: [AdminAuthController], providers: [AdminAuthService, AdminGuard] })
export class AdminAuthModule {}
