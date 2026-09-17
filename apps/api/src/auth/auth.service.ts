import {
  ConflictException,
  Injectable,
  Logger,
  UnauthorizedException,
} from '@nestjs/common';
import * as argon2 from 'argon2';
import { AppConfigService } from '../config/app-config.service';
import { PrismaService } from '../prisma/prisma.service';
import type { PublicUser } from '../users/user.select';
import { UsersService } from '../users/users.service';
import type { LoginDto } from './dto/login.dto';
import type { RegisterDto } from './dto/register.dto';
import { TokenService, type IssuedTokens } from './token.service';

export interface AuthResult extends IssuedTokens {
  user: PublicUser;
}

interface RequestMeta {
  userAgent?: string;
  ipAddress?: string;
}

/**
 * OWASP-recommended Argon2id baseline (as of 2024).
 * These parameters target ~50ms on commodity hardware.
 */
const ARGON2_OPTIONS: argon2.Options = {
  type: argon2.argon2id,
  memoryCost: 19456,
  timeCost: 2,
  parallelism: 1,
};

@Injectable()
export class AuthService {
  private readonly logger = new Logger(AuthService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly users: UsersService,
    private readonly tokens: TokenService,
    private readonly config: AppConfigService,
  ) {}

  async register(dto: RegisterDto, meta: RequestMeta): Promise<AuthResult> {
    const [emailTaken, usernameTaken] = await Promise.all([
      this.users.emailExists(dto.email),
      this.users.usernameExists(dto.username),
    ]);

    if (emailTaken) {
      throw new ConflictException('An account with this email already exists');
    }
    if (usernameTaken) {
      throw new ConflictException('This username is already taken');
    }

    const passwordHash = await argon2.hash(dto.password, ARGON2_OPTIONS);

    const user = await this.users.create({
      name: dto.name,
      username: dto.username,
      email: dto.email,
      passwordHash,
    });

    const tokens = await this.tokens.issueTokenPair(user, meta);
    this.logger.log(`User registered: ${user.id}`);

    return { user, ...tokens };
  }

  async login(dto: LoginDto, meta: RequestMeta): Promise<AuthResult> {
    const user = await this.resolveLoginUser(dto.identifier);

    // Always run a verification to keep response timing uniform whether or not
    // the account exists — prevents username/email enumeration via timing.
    const hash = user?.passwordHash ?? DUMMY_HASH;
    const passwordValid = await argon2.verify(hash, dto.password).catch(() => false);

    if (!user || !passwordValid) {
      this.logger.warn(`Failed login attempt for identifier=${dto.identifier}`);
      throw new UnauthorizedException('Invalid credentials');
    }

    const publicUser = await this.users.findPublicById(user.id);
    if (!publicUser) {
      throw new UnauthorizedException('Invalid credentials');
    }

    const tokens = await this.tokens.issueTokenPair(
      { id: user.id, username: user.username },
      meta,
    );

    this.logger.log(`User logged in: ${user.id}`);

    return { user: publicUser, ...tokens };
  }

  async refresh(rawRefreshToken: string, meta: RequestMeta): Promise<AuthResult> {
    const record = await this.tokens.consumeRefreshToken(rawRefreshToken);

    const user = await this.users.findPublicById(record.userId);
    if (!user) {
      throw new UnauthorizedException('Account no longer exists');
    }

    // Rotation: issue the new pair first so we can link old -> new for auditing.
    const tokens = await this.tokens.issueTokenPair(user, meta);

    const newRecord = await this.prisma.refreshToken.findFirst({
      where: { userId: user.id, revokedAt: null },
      orderBy: { createdAt: 'desc' },
      select: { id: true },
    });

    await this.tokens.revokeToken(record.id, newRecord?.id);

    return { user, ...tokens };
  }

  async logout(rawRefreshToken: string | undefined): Promise<void> {
    if (!rawRefreshToken) {
      return;
    }
    await this.tokens.revokeByRawToken(rawRefreshToken);
  }

  private async resolveLoginUser(identifier: string) {
    if (identifier.includes('@')) {
      return this.users.findByEmailWithSecret(identifier);
    }

    const byUsername = await this.users.findPublicByUsername(identifier);
    if (!byUsername) {
      return null;
    }
    return this.users.findById(byUsername.id);
  }
}

/**
 * A valid Argon2id hash of a random string, used only to equalise timing
 * when an account does not exist.
 */
const DUMMY_HASH =
  '$argon2id$v=19$m=19456,t=2,p=1$c29tZXNhbHR2YWx1ZQ$3Bq0kQ0mHhQ4Jp0q3g7oOq1pQ8G0u6vBmYy9xW2cA7k';