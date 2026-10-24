import { Module, type DynamicModule } from '@nestjs/common';
import { APP_FILTER, APP_GUARD } from '@nestjs/core';
import type { NestFastifyApplication } from '@nestjs/platform-fastify';
import type { AppContext } from './app-context.js';
import fastifyMultipart from '@fastify/multipart';
import { AttachmentsController } from './attachments/attachments.controller.js';
import { AdminStrategiesController } from './auth/admin-strategies.controller.js';
import { AuthController } from './auth/auth.controller.js';
import { HealthController, READINESS_CHECK } from './health/health.controller.js';
import { APP_CONTEXT, DomainErrorFilter, registerRequestHooks } from './http/http.js';
import { AdminDatabaseController } from './install/admin-database.controller.js';
import { IssuesController } from './issues/issues.controller.js';
import { AdminRolesController } from './admin/admin-roles.controller.js';
import { CyclesController } from './cycles/cycles.controller.js';
import { ProjectsController } from './projects/projects.controller.js';
import { InitiativesController } from './projects/initiatives.controller.js';
import { ImportsController } from './imports/imports.controller.js';
import { McpServer } from './mcp/mcp.server.js';
import { TokensController } from './tokens/tokens.controller.js';
import { NotificationsController } from './notifications/notifications.controller.js';
import { RequestsController } from './requests/requests.controller.js';
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
        IssuesController,
        AttachmentsController,
        RequestsController,
        NotificationsController,
        TokensController,
        CyclesController,
        ProjectsController,
        InitiativesController,
        ImportsController,
        AdminRolesController,
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
export async function configureApp(app: NestFastifyApplication, ctx: AppContext): Promise<void> {
  app.setGlobalPrefix('api', { exclude: ['healthz', 'readyz'] });
  const instance = app.getHttpAdapter().getInstance();
  registerRequestHooks(instance, ctx);
  await instance.register(fastifyMultipart);
  await ctx.realtime.register(instance);
  new McpServer(ctx, ctx.version).register(instance);
}
