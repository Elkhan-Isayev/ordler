import { Module, type DynamicModule } from '@nestjs/common';
import { APP_GUARD } from '@nestjs/core';
import {
  HealthController,
  READINESS_CHECK,
  type ReadinessCheck,
} from './health/health.controller.js';
import {
  ACCESS_CONTEXT,
  PermissionGuard,
  type AccessContextSource,
} from './rbac/permission.guard.js';

export interface AppModuleOptions {
  readiness: ReadinessCheck;
  access: AccessContextSource;
}

@Module({})
export class AppModule {
  static forRoot(options: AppModuleOptions): DynamicModule {
    return {
      module: AppModule,
      controllers: [HealthController],
      providers: [
        { provide: READINESS_CHECK, useValue: options.readiness },
        { provide: ACCESS_CONTEXT, useValue: options.access },
        { provide: APP_GUARD, useClass: PermissionGuard },
      ],
    };
  }
}
