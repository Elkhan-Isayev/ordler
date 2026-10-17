import { Module, type DynamicModule } from '@nestjs/common';
import { APP_FILTER, APP_GUARD } from '@nestjs/core';
import type { NestFastifyApplication } from '@nestjs/platform-fastify';
import type { AppContext } from './app-context.js';
import { AdminStrategiesController } from './auth/admin-strategies.controller.js';
import { AuthController } from './auth/auth.controller.js';
import { HealthController, READINESS_CHECK } from './health/health.controller.js';
import { APP_CONTEXT, DomainErrorFilter, registerRequestHooks } from './http/http.js';
import { AdminDatabaseController } from './install/admin-database.controller.js';
import { AdminMailController } from './mail/admin-mail.controller.js';
import { AdminMembersController } from './members/admin-members.controller.js';
import { InvitesController } from './members/invites.controller.js';
import { MeController } from './members/me.controller.js';
import { AdminOrgController } from './org/admin-org.controller.js';
import { ACCESS_CONTEXT, PermissionGuard } from './rbac/permission.guard.js';
import { SetupController } from './setup/setup.controller.js';
import { UpdatesController } from './updates/updates.controller.js';

@Module({})
export class AppModule {
  static forRoot(ctx: AppContext): DynamicModule {
    return {
      module: AppModule,
      controllers: [
        HealthController,
        SetupController,
        AuthController,
        MeController,
        AdminStrategiesController,
        UpdatesController,
        AdminOrgController,
        AdminMembersController,
        InvitesController,
        AdminMailController,
        AdminDatabaseController,
      ],
      providers: [
        { provide: APP_CONTEXT, useValue: ctx },
        { provide: READINESS_CHECK, useValue: ctx.readiness },
        { provide: ACCESS_CONTEXT, useValue: ctx.access },
        { provide: APP_GUARD, useClass: PermissionGuard },
        { provide: APP_FILTER, useClass: DomainErrorFilter },
      ],
    };
  }
}

/** Shared by main.ts and tests so both serve the exact same HTTP surface. */
export function configureApp(app: NestFastifyApplication, ctx: AppContext): void {
  app.setGlobalPrefix('api', { exclude: ['healthz', 'readyz'] });
  registerRequestHooks(app.getHttpAdapter().getInstance(), ctx);
}
