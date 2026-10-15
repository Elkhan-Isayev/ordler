import { Controller, Get, Inject, ServiceUnavailableException } from '@nestjs/common';
import { Public } from '../rbac/permission.guard.js';

export interface ReadinessCheck {
  /** Resolves true when the instance can serve traffic (database reachable, migrations done). */
  isReady(): Promise<boolean>;
}

export const READINESS_CHECK = Symbol('READINESS_CHECK');

@Public()
@Controller()
export class HealthController {
  constructor(@Inject(READINESS_CHECK) private readonly readiness: ReadinessCheck) {}

  /** Liveness: the process is up. Never touches dependencies, so restarts stay rare. */
  @Get('healthz')
  liveness() {
    return { status: 'ok' };
  }

  @Get('readyz')
  async ready() {
    const ready = await this.readiness.isReady().catch(() => false);
    if (!ready) throw new ServiceUnavailableException({ status: 'not_ready' });
    return { status: 'ready' };
  }
}
