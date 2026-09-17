import { Injectable, UnauthorizedException } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { createHash, randomUUID } from 'node:crypto';
import { AppConfigService } from '../config/app-config.service';
import { PrismaService } from '../prisma/prisma.service';
import type {
  AccessTokenPayload,
  RefreshTokenPayload,
} from '../common/interfaces/authenticated-user.interface';

export interface IssuedTokens {
  accessToken: string;
  refreshToken: string;
  refreshTokenExpiresAt: Date;
}

@Injectable()
export class TokenService {
  constructor(
    private readonly jwt: JwtService,
    private readonly prisma: PrismaService,
    private readonly config: AppConfigService,
  ) {}

  /**
   * Refresh tokens are high-entropy signed JWTs, not human passwords.
   * A fast hash is the correct choice here — Argon2 would only add latency
   * to every refresh without adding meaningful resistance to brute force.
   */
  private hashToken(token: string): string {
    return createHash('sha256').update(token).digest('hex');
  }

  async issueTokenPair(
    user: { id: string; username: string },
    meta: { userAgent?: string; ipAddress?: string } = {},
  ): Promise<IssuedTokens> {
    const accessToken = await this.jwt.signAsync(
      { sub: user.id, username: user.username, jti: randomUUID() } satisfies AccessTokenPayload,
      {
        secret: this.config.jwtAccessSecret,
        expiresIn: this.config.jwtAccessExpiresIn,
      },
    );

    const refreshToken = await this.jwt.signAsync(
      { sub: user.id, jti: randomUUID() } satisfies RefreshTokenPayload,
      {
        secret: this.config.jwtRefreshSecret,
        expiresIn: this.config.jwtRefreshExpiresIn,
      },
    );

    const decoded = this.jwt.decode(refreshToken) as { exp: number };
    const refreshTokenExpiresAt = new Date(decoded.exp * 1000);

    await this.prisma.refreshToken.create({
      data: {
        userId: user.id,
        tokenHash: this.hashToken(refreshToken),
        expiresAt: refreshTokenExpiresAt,
        userAgent: meta.userAgent?.slice(0, 255),
        ipAddress: meta.ipAddress,
      },
    });

    return { accessToken, refreshToken, refreshTokenExpiresAt };
  }

  async verifyAccessToken(token: string): Promise<AccessTokenPayload> {
    try {
      return await this.jwt.verifyAsync<AccessTokenPayload>(token, {
        secret: this.config.jwtAccessSecret,
      });
    } catch {
      throw new UnauthorizedException('Invalid or expired access token');
    }
  }

  /**
   * Verifies the refresh token and returns the matching, non-revoked DB row.
   * Reuse of an already-rotated token revokes the entire family for that user.
   */
  async consumeRefreshToken(rawToken: string) {
    let payload: RefreshTokenPayload;

    try {
      payload = await this.jwt.verifyAsync<RefreshTokenPayload>(rawToken, {
        secret: this.config.jwtRefreshSecret,
      });
    } catch {
      throw new UnauthorizedException('Invalid or expired refresh token');
    }

    const record = await this.prisma.refreshToken.findUnique({
      where: { tokenHash: this.hashToken(rawToken) },
    });

    if (!record || record.userId !== payload.sub) {
      throw new UnauthorizedException('Invalid refresh token');
    }

    if (record.revokedAt !== null) {
      // Token replay: this token was already rotated away.
      // Assume compromise and kill every active session for the user.
      await this.prisma.refreshToken.updateMany({
        where: { userId: record.userId, revokedAt: null },
        data: { revokedAt: new Date() },
      });
      throw new UnauthorizedException('Refresh token reuse detected. Please sign in again.');
    }

    if (record.expiresAt.getTime() <= Date.now()) {
      throw new UnauthorizedException('Refresh token has expired');
    }

    return record;
  }

  async revokeToken(recordId: string, replacedById?: string): Promise<void> {
    await this.prisma.refreshToken.update({
      where: { id: recordId },
      data: { revokedAt: new Date(), replacedById },
    });
  }

  /** Best-effort revocation for logout — never throws on an unknown token. */
  async revokeByRawToken(rawToken: string): Promise<void> {
    await this.prisma.refreshToken.updateMany({
      where: { tokenHash: this.hashToken(rawToken), revokedAt: null },
      data: { revokedAt: new Date() },
    });
  }
}