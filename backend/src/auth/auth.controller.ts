import {
  Body,
  Controller,
  Get,
  HttpCode,
  HttpException,
  HttpStatus,
  Post,
  Req,
  Res,
  ServiceUnavailableException,
  UnauthorizedException,
} from '@nestjs/common';
import type { Request, Response } from 'express';
import { AuthService, parseCookies, SESSION_COOKIE, SESSION_TTL_SECONDS, sessionCookie } from './auth.service';

// Only send the cookie over HTTPS when the guest reached the site over HTTPS (the frontend proxy
// passes the original protocol on); plain-HTTP deployments would otherwise never get it back
const isHttps = (req: Request) => req.headers['x-forwarded-proto'] === 'https' || req.secure;

@Controller('auth')
export class AuthController {
  constructor(private readonly auth: AuthService) {}

  @Post('login')
  @HttpCode(200)
  login(@Body('password') password: unknown, @Req() req: Request, @Res({ passthrough: true }) res: Response) {
    if (!this.auth.isConfigured()) {
      throw new ServiceUnavailableException('Host login is not set up. Set ADMIN_PASSWORD on the server.');
    }
    if (this.auth.isLockedOut()) {
      throw new HttpException('Too many failed attempts. Wait a minute and try again.', HttpStatus.TOO_MANY_REQUESTS);
    }
    if (!this.auth.checkPassword(password)) {
      this.auth.recordFailure();
      throw new UnauthorizedException('Incorrect password.');
    }

    this.auth.clearFailures();
    res.setHeader('Set-Cookie', sessionCookie(this.auth.createSession(), { secure: isHttps(req), maxAge: SESSION_TTL_SECONDS }));
    return { authenticated: true };
  }

  @Post('logout')
  @HttpCode(200)
  logout(@Req() req: Request, @Res({ passthrough: true }) res: Response) {
    res.setHeader('Set-Cookie', sessionCookie('', { secure: isHttps(req), maxAge: 0 }));
    return { authenticated: false };
  }

  @Get('me')
  me(@Req() req: Request) {
    return { authenticated: this.auth.verifySession(parseCookies(req.headers.cookie)[SESSION_COOKIE]) };
  }
}
