import { Global, Module } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { EncryptionService } from './crypto';

@Global()
@Module({
  providers: [
    {
      provide: EncryptionService,
      inject: [ConfigService],
      useFactory: (config: ConfigService) =>
        new EncryptionService(
          config.getOrThrow<string>('ENCRYPTION_KEY'),
          config.get<string>('ENCRYPTION_KEY_OLD') || undefined,
        ),
    },
  ],
  exports: [EncryptionService],
})
export class CommonModule {}
