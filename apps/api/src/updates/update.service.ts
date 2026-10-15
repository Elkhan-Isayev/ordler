import { eq } from 'drizzle-orm';
import type { Clock } from '../auth/sessions.js';
import type { Db } from '../db/client.js';
import { updateStatus } from '../db/schema.js';
import { fetchLatestRelease, type FetchFn } from './github.js';
import { compareSemver, formatSemver, isMajorUpgrade, parseSemver } from './version.js';

export const CHECK_INTERVAL_MS = 24 * 60 * 60_000;

export interface UpdateStatusView {
  enabled: boolean;
  /** `null` for development builds, which never show the notification. */
  currentVersion: string | null;
  latestVersion: string | null;
  updateAvailable: boolean;
  majorUpgrade: boolean;
  release: { name: string; url: string; notes: string; publishedAt: string } | null;
  checkedAt: string | null;
  lastError: string | null;
}

export interface UpdateServiceOptions {
  db: Db;
  enabled: boolean;
  repository: string;
  currentVersion: string | undefined;
  fetch?: FetchFn;
  now?: Clock;
}

/**
 * Daily check of GitHub releases (SPEC §16.5). The result is stored, so every replica and
 * every admin sees the same answer and GitHub is asked at most about once a day.
 */
export class UpdateService {
  private readonly now: Clock;
  private timer: NodeJS.Timeout | undefined;

  constructor(private readonly options: UpdateServiceOptions) {
    this.now = options.now ?? (() => new Date());
  }

  async check(): Promise<UpdateStatusView> {
    if (!this.options.enabled) return this.status();
    const [row] = await this.options.db.select().from(updateStatus).where(eq(updateStatus.id, 1));
    try {
      const result = await fetchLatestRelease({
        repository: this.options.repository,
        currentVersion: this.options.currentVersion,
        etag: row?.etag ?? undefined,
        ...(this.options.fetch ? { fetch: this.options.fetch } : {}),
      });
      const values =
        result.status === 'not_modified'
          ? { checkedAt: this.now(), lastError: null }
          : {
              latestVersion: result.release ? formatSemver(result.release.version) : null,
              releaseName: result.release?.name ?? null,
              releaseUrl: result.release?.url ?? null,
              releaseNotes: result.release?.notes ?? null,
              publishedAt: result.release?.publishedAt ?? null,
              etag: result.etag ?? null,
              checkedAt: this.now(),
              lastError: null,
            };
      await this.upsert(values);
    } catch (error) {
      // A failed check keeps the last known release; the admin sees when it last worked.
      await this.upsert({
        lastError: error instanceof Error ? error.message.slice(0, 500) : 'unknown error',
      });
    }
    return this.status();
  }

  /** Re-checks only when the stored result is older than a day (cheap to call at startup). */
  async checkIfStale(): Promise<void> {
    const [row] = await this.options.db.select().from(updateStatus).where(eq(updateStatus.id, 1));
    const age = row?.checkedAt ? this.now().getTime() - row.checkedAt.getTime() : Infinity;
    if (age >= CHECK_INTERVAL_MS) await this.check();
  }

  async status(): Promise<UpdateStatusView> {
    const [row] = await this.options.db.select().from(updateStatus).where(eq(updateStatus.id, 1));
    const current = parseSemver(this.options.currentVersion);
    const latest = parseSemver(row?.latestVersion);
    const updateAvailable = Boolean(
      this.options.enabled && current && latest && compareSemver(latest, current) > 0,
    );
    return {
      enabled: this.options.enabled,
      currentVersion: current ? formatSemver(current) : null,
      latestVersion: row?.latestVersion ?? null,
      updateAvailable,
      majorUpgrade: Boolean(
        updateAvailable && current && latest && isMajorUpgrade(current, latest),
      ),
      release:
        row?.releaseUrl && row.releaseName
          ? {
              name: row.releaseName,
              url: row.releaseUrl,
              notes: row.releaseNotes ?? '',
              publishedAt: (row.publishedAt ?? new Date(0)).toISOString(),
            }
          : null,
      checkedAt: row?.checkedAt?.toISOString() ?? null,
      lastError: row?.lastError ?? null,
    };
  }

  /** Background schedule for the worker role; failures never crash the process. */
  start(): void {
    if (!this.options.enabled || this.timer) return;
    const run = () => void this.checkIfStale().catch(() => undefined);
    run();
    // Hourly tick; checkIfStale makes the actual GitHub request at most once a day.
    this.timer = setInterval(run, 60 * 60_000);
    this.timer.unref();
  }

  stop(): void {
    if (this.timer) clearInterval(this.timer);
    this.timer = undefined;
  }

  private async upsert(values: Partial<typeof updateStatus.$inferInsert>): Promise<void> {
    await this.options.db
      .insert(updateStatus)
      .values({ id: 1, ...values })
      .onConflictDoUpdate({ target: updateStatus.id, set: values });
  }
}
