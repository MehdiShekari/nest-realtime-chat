import { Global, Logger, Module } from '@nestjs/common';
import Redis from 'ioredis';
import { AppConfigService } from '../config/app-config.service';
import { REDIS_CLIENT } from './redis.constants';

@Global()
@Module({
  providers: [
    {
      provide: REDIS_CLIENT,
      inject: [AppConfigService],
      useFactory: (config: AppConfigService): Redis => {
        const logger = new Logger('RedisClient');
        const client = new Redis(config.redisUrl, {
          maxRetriesPerRequest: null,
          lazyConnect: false,
        });

        client.on('connect', () => logger.log('Connected to Redis'));
        client.on('error', (err: Error) => logger.error(`Redis error: ${err.message}`));

        return client;
      },
    },
  ],
  exports: [REDIS_CLIENT],
})
export class RedisModule {}