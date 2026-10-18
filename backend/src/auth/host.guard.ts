import { CanActivate, ExecutionContext, Injectable, UnauthorizedException } from '@nestjs/common';
import type { Request } from 'express';
import { AuthService, parseCookies, SESSION_COOKIE } from './auth.service';

// Protects host-only routes (managing events, deleting photos)
@Injectable()
export class HostGuard implements CanActivate {
  constructor(private readonly auth: AuthService) {}

  canActivate(context: ExecutionContext): boolean {
    const req = context.switchToHttp().getRequest<Request>();
    const session = parseCookies(req.headers.cookie)[SESSION_COOKIE];
    if (!this.auth.verifySession(session)) throw new UnauthorizedException('Host login required.');
    return true;
  }
}
