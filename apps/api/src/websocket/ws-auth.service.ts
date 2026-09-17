import { Injectable, Logger } from '@nestjs/common';
import { TokenService } from '../auth/token.service';
import { UsersService } from '../users/users.service';
import type { AuthenticatedUser } from '../common/interfaces/authenticated-user.interface';

@Injectable()
export class WsAuthService {
  private readonly logger = new Logger(WsAuthService.name);

  constructor(
    private readonly tokens: TokenService,
    private readonly users: UsersService,
  ) {}

  /**
   * Validates the access token presented in the Socket.IO handshake and
   * resolves the caller's public profile. Any failure closes the connection
   * — there is no anonymous socket in this application.
   */
  async authenticate(rawToken: unknown): Promise<AuthenticatedUser> {
    if (typeof rawToken !== 'string' || rawToken.length === 0) {
      throw new Error('Missing authentication token');
    }

    const payload = await this.tokens.verifyAccessToken(rawToken);
    const user = await this.users.findById(payload.sub);

    if (!user) {
      throw new Error('Account no longer exists');
    }

    return {
      id: user.id,
      email: user.email,
      username: user.username,
      name: user.name,
    };
  }
}