import { Global, Module } from '@nestjs/common';
import { REALTIME_EMITTER } from '../../common/realtime/realtime-emitter.interface';
import { SocketRealtimeEmitter } from './socket-realtime-emitter';
import { SocketServerProvider } from './socket-server.provider';

/**
 * Global module so domain services can inject REALTIME_EMITTER without
 * importing the WebSocket layer. Keeps the dependency direction pointing
 * inward: transport depends on domain, never the reverse.
 */
@Global()
@Module({
  providers: [
    SocketServerProvider,
    SocketRealtimeEmitter,
    { provide: REALTIME_EMITTER, useExisting: SocketRealtimeEmitter },
  ],
  exports: [SocketServerProvider, REALTIME_EMITTER],
})
export class RealtimeModule {}