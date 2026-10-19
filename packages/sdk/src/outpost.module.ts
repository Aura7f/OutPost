import { DynamicModule, Global, Module, Provider } from '@nestjs/common';
import { APP_FILTER } from '@nestjs/core';
import { OutpostExceptionFilter } from './outpost.exception-filter';
import { OutpostOptions, OutpostService } from './outpost.service';

@Global()
@Module({})
export class OutpostModule {
  static forRoot(options: OutpostOptions): DynamicModule {
    const outpostProvider: Provider = {
      provide: OutpostService,
      useFactory: () => new OutpostService(options),
    };
    const filterProvider: Provider = {
      provide: APP_FILTER,
      useFactory: (service: OutpostService) => new OutpostExceptionFilter(service),
      inject: [OutpostService],
    };
    return {
      module: OutpostModule,
      providers: [outpostProvider, filterProvider],
      exports: [OutpostService],
    };
  }
}
