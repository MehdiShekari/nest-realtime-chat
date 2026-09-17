import { BadRequestException, Injectable, Logger } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import { mkdir, writeFile } from 'node:fs/promises';
import { extname, join } from 'node:path';

const ALLOWED_MIME = new Set(['image/jpeg', 'image/png', 'image/webp', 'image/gif']);
const MAX_BYTES = 5 * 1024 * 1024;
const AVATAR_DIR = join(process.cwd(), 'uploads', 'avatars');

export interface StoredAvatar {
  url: string;
  filename: string;
}

@Injectable()
export class AvatarService {
  private readonly logger = new Logger(AvatarService.name);

  async store(file: Express.Multer.File | undefined, baseUrl: string): Promise<StoredAvatar> {
    if (!file) {
      throw new BadRequestException('No file uploaded');
    }

    if (!ALLOWED_MIME.has(file.mimetype)) {
      throw new BadRequestException('Unsupported image type. Allowed: jpeg, png, webp, gif');
    }

    if (file.size > MAX_BYTES) {
      throw new BadRequestException('Image too large (max 5 MB)');
    }

    await mkdir(AVATAR_DIR, { recursive: true });

    const ext = extname(file.originalname) || this.extensionForMime(file.mimetype);
    const filename = `${randomUUID()}${ext}`;
    const filepath = join(AVATAR_DIR, filename);

    await writeFile(filepath, file.buffer);

    this.logger.log(`Stored avatar ${filename} (${file.size} bytes)`);

    return {
      filename,
      url: `${baseUrl.replace(/\/$/, '')}/uploads/avatars/${filename}`,
    };
  }

  private extensionForMime(mime: string): string {
    switch (mime) {
      case 'image/png':
        return '.png';
      case 'image/webp':
        return '.webp';
      case 'image/gif':
        return '.gif';
      default:
        return '.jpg';
    }
  }
}