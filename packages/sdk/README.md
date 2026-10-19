# @outpost/sdk

Lightweight exception reporting for NestJS services.

```bash
npm install @outpost/sdk
```

```ts
// app.module.ts
import { Module } from '@nestjs/common';
import { OutpostModule } from '@outpost/sdk';

@Module({
  imports: [
    OutpostModule.forRoot({
      endpoint: process.env.OUTPOST_ENDPOINT!,
      apiKey: process.env.OUTPOST_INGESTION_KEY!,
      serviceName: 'checkout-api',
      environment: process.env.NODE_ENV ?? 'production',
    }),
  ],
})
export class AppModule {}
```

The SDK buffers sanitized unhandled 5xx errors and sends them in the background. It redacts authorization headers, cookies, JWTs, database URLs, and common secret query/body keys. It does not collect request bodies or authenticated user data.

The ingestion endpoint is designed to accept OpenTelemetry exception payloads in a future API version. This SDK intentionally covers unhandled application exceptions, not infrastructure telemetry.
