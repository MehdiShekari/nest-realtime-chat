import { ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { Prisma, type User, UserStatus } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import type { UpdateProfileDto } from './dto/update-profile.dto';
import { publicUserSelect, type PublicUser } from './user.select';

@Injectable()
export class UsersService {
  constructor(private readonly prisma: PrismaService) {}

  // ---- internal (may include passwordHash) --------------------------------

  findByEmailWithSecret(email: string): Promise<User | null> {
    return this.prisma.user.findUnique({ where: { email: email.toLowerCase() } });
  }

  findById(id: string): Promise<User | null> {
    return this.prisma.user.findUnique({ where: { id } });
  }

  // ---- public projections -------------------------------------------------

  findPublicById(id: string): Promise<PublicUser | null> {
    return this.prisma.user.findUnique({ where: { id }, select: publicUserSelect });
  }

  findPublicByUsername(username: string): Promise<PublicUser | null> {
    return this.prisma.user.findUnique({
      where: { username: username.toLowerCase() },
      select: publicUserSelect,
    });
  }

  async emailExists(email: string): Promise<boolean> {
    const found = await this.prisma.user.findUnique({
      where: { email: email.toLowerCase() },
      select: { id: true },
    });
    return found !== null;
  }

  async usernameExists(username: string): Promise<boolean> {
    const found = await this.prisma.user.findUnique({
      where: { username: username.toLowerCase() },
      select: { id: true },
    });
    return found !== null;
  }

  create(data: {
    name: string;
    username: string;
    email: string;
    passwordHash: string;
  }): Promise<PublicUser> {
    return this.prisma.user.create({
      data: {
        name: data.name.trim(),
        username: data.username.toLowerCase(),
        email: data.email.toLowerCase(),
        passwordHash: data.passwordHash,
      },
      select: publicUserSelect,
    });
  }

  // ---- profile management -------------------------------------------------

  async updateProfile(userId: string, dto: UpdateProfileDto): Promise<PublicUser> {
    if (dto.username) {
      const existing = await this.prisma.user.findUnique({
        where: { username: dto.username },
        select: { id: true },
      });
      if (existing && existing.id !== userId) {
        throw new ConflictException('This username is already taken');
      }
    }

    const data: Prisma.UserUpdateInput = {};
    if (dto.name !== undefined) data.name = dto.name.trim();
    if (dto.username !== undefined) data.username = dto.username;
    if (dto.bio !== undefined) data.bio = dto.bio;
    if (dto.avatarUrl !== undefined) data.avatarUrl = dto.avatarUrl;
    if (dto.status !== undefined) data.status = dto.status;

    return this.prisma.user.update({
      where: { id: userId },
      data,
      select: publicUserSelect,
    });
  }

  async requirePublicById(id: string): Promise<PublicUser> {
    const user = await this.findPublicById(id);
    if (!user) {
      throw new NotFoundException('User not found');
    }
    return user;
  }

  // ---- batched reads used by other modules --------------------------------

  async findManyPublicByIds(ids: string[]): Promise<PublicUser[]> {
    if (ids.length === 0) return [];
    return this.prisma.user.findMany({
      where: { id: { in: ids } },
      select: publicUserSelect,
    });
  }

  /** Used by the presence layer when a user closes their last socket. */
  async touchLastSeen(userId: string, status: UserStatus): Promise<void> {
    await this.prisma.user
      .update({
        where: { id: userId },
        data: { status, lastSeenAt: new Date() },
      })
      .catch(() => undefined); // user deleted concurrently — nothing to do
  }
}