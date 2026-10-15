import type { ReadinessCheck } from '../health/health.controller.js';

export interface Queryable {
  query(sql: string): Promise<unknown>;
}

/** Ready once migrations finished and the database answers a trivial query. */
export class DatabaseReadiness implements ReadinessCheck {
  private migrated = false;

  constructor(private readonly db: Queryable) {}

  markMigrated(): void {
    this.migrated = true;
  }

  async isReady(): Promise<boolean> {
    if (!this.migrated) return false;
    try {
      await this.db.query('select 1');
      return true;
    } catch {
      return false;
    }
  }
}
