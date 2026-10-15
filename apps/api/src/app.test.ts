import 'reflect-metadata';
import { Controller, Get, Module, Post, type DynamicModule } from '@nestjs/common';
import { APP_GUARD } from '@nestjs/core';
import { FastifyAdapter, type NestFastifyApplication } from '@nestjs/platform-fastify';
import { Test } from '@nestjs/testing';
import { SYSTEM_ROLES, type RoleAssignment, type SystemRoleKey } from '@ordler/shared';
import { afterEach, describe, expect, it } from 'vitest';
import { AppModule } from './app.module.js';
import {
  ACCESS_CONTEXT,
  departmentFromParam,
  PermissionGuard,
  RequirePermission,
  type AccessContextSource,
} from './rbac/permission.guard.js';

@Controller('departments/:departmentId/teams')
class TeamsTestController {
  @Post()
  @RequirePermission('team.create', departmentFromParam())
  create() {
    return { created: true };
  }

  @Get()
  undeclared() {
    return { leaked: true };
  }
}

@Module({})
class GuardTestModule {
  static with(access: AccessContextSource): DynamicModule {
    return {
      module: GuardTestModule,
      controllers: [TeamsTestController],
      providers: [
        { provide: ACCESS_CONTEXT, useValue: access },
        { provide: APP_GUARD, useClass: PermissionGuard },
      ],
    };
  }
}

const accessFor = (assignments: Record<string, RoleAssignment[]>): AccessContextSource => ({
  load: async (memberId) => ({
    assignments: assignments[memberId] ?? [],
    rolePermissions: (roleId) => SYSTEM_ROLES[roleId as SystemRoleKey]?.permissions,
    directory: { departmentOfTeam: () => undefined },
  }),
});

let app: NestFastifyApplication | undefined;

async function start(module: DynamicModule, memberId?: string) {
  const ref = await Test.createTestingModule({ imports: [module] }).compile();
  app = ref.createNestApplication<NestFastifyApplication>(new FastifyAdapter());
  if (memberId) {
    // Stand-in for the auth layer, which attaches the signed-in member.
    app
      .getHttpAdapter()
      .getInstance()
      .addHook('onRequest', async (request) => {
        (request as unknown as { member: { id: string } }).member = { id: memberId };
      });
  }
  await app.init();
  await app.getHttpAdapter().getInstance().ready();
  return app;
}

afterEach(async () => {
  await app?.close();
  app = undefined;
});

describe('health endpoints', () => {
  const noAccess = accessFor({});

  it('reports liveness without checking dependencies', async () => {
    const instance = await start(
      AppModule.forRoot({ readiness: { isReady: async () => false }, access: noAccess }),
    );
    const response = await instance.inject({ method: 'GET', url: '/healthz' });
    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual({ status: 'ok' });
  });

  it('returns 503 until ready', async () => {
    const instance = await start(
      AppModule.forRoot({ readiness: { isReady: async () => false }, access: noAccess }),
    );
    expect((await instance.inject({ method: 'GET', url: '/readyz' })).statusCode).toBe(503);
  });

  it('returns 503 when the readiness check throws', async () => {
    const instance = await start(
      AppModule.forRoot({
        readiness: { isReady: async () => Promise.reject(new Error('db down')) },
        access: noAccess,
      }),
    );
    expect((await instance.inject({ method: 'GET', url: '/readyz' })).statusCode).toBe(503);
  });

  it('returns 200 when ready', async () => {
    const instance = await start(
      AppModule.forRoot({ readiness: { isReady: async () => true }, access: noAccess }),
    );
    const response = await instance.inject({ method: 'GET', url: '/readyz' });
    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual({ status: 'ready' });
  });
});

describe('PermissionGuard', () => {
  const access = accessFor({
    'it-admin': [{ roleId: 'department_admin', scope: { type: 'department', id: 'it' } }],
    'cs-member': [{ roleId: 'member', scope: { type: 'team', id: 'cs1' } }],
  });

  it('returns 401 without a signed-in member', async () => {
    const instance = await start(GuardTestModule.with(access));
    const response = await instance.inject({ method: 'POST', url: '/departments/it/teams' });
    expect(response.statusCode).toBe(401);
  });

  it('allows a department admin in their department', async () => {
    const instance = await start(GuardTestModule.with(access), 'it-admin');
    const response = await instance.inject({ method: 'POST', url: '/departments/it/teams' });
    expect(response.statusCode).toBe(201);
  });

  it('forbids a department admin in another department', async () => {
    const instance = await start(GuardTestModule.with(access), 'it-admin');
    const response = await instance.inject({ method: 'POST', url: '/departments/finance/teams' });
    expect(response.statusCode).toBe(403);
  });

  it('forbids a member without team.create (MVP acceptance criterion 1)', async () => {
    const instance = await start(GuardTestModule.with(access), 'cs-member');
    const response = await instance.inject({ method: 'POST', url: '/departments/it/teams' });
    expect(response.statusCode).toBe(403);
  });

  it('denies routes that declare no access policy, even for admins', async () => {
    const instance = await start(GuardTestModule.with(access), 'it-admin');
    const response = await instance.inject({ method: 'GET', url: '/departments/it/teams' });
    expect(response.statusCode).toBe(403);
  });
});
