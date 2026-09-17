import { Injectable } from '@nestjs/common';
import type { User } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { publicUserSelect, type PublicUser } from './user.select';

@Injectable()
export class UsersService {
  constructor(private readonly prisma: PrismaService) {}

  /** Internal use only — includes passwordHash. Never return this from a controller. */
  findByEmailWithSecret(email: string): Promise<User | null> {
    return this.prisma.user.findUnique({ where: { email: email.toLowerCase() } });
  }

  findById(id: string): Promise<User | null> {
    return this.prisma.user.findUnique({ where: { id } });
  }

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
}