import { createHmac, timingSafeEqual } from 'node:crypto';
import {
  DEFAULT_GITHUB_URL,
  findIssueIdentifiers,
  issueBranchName,
  parseIssueIdentifier,
  formatIssueIdentifier,
  type GithubAppView,
  type GithubLinkKind,
  type GithubLinkView,
  type GithubManifestInput,
  type GithubManifestStart,
  type GithubPullState,
  type IssueGithubView,
  type TeamGithubSettings,
  type UpdateGithubAppInput,
  type UpdateTeamGithubInput,
} from '@ordler/shared';
import { and, asc, desc, eq, isNull, lt, notInArray, or, sql } from 'drizzle-orm';
import { writeAudit, type AuditActor } from '../audit/audit.js';
import { DomainError } from '../auth/errors.js';
import type { SecretBox } from '../crypto/secret-box.js';
import { randomToken } from '../crypto/tokens.js';
import type { Db } from '../db/client.js';
import {
  githubApp,
  githubDeliveries,
  githubLinks,
  githubPullRequestComments,
  issues,
  members,
  teams,
  workflowStatuses,
} from '../db/schema.js';
import type { IssueService } from '../issues/issue.service.js';
import { teamStatuses } from '../issues/workflows.js';
import { getInstance } from '../setup/setup.service.js';
import { GithubApi, type AppCredentials } from './github-api.js';

const SECRETS_AAD = 'github_app:secrets';
const STATE_AAD = 'github_app:manifest_state';
/** Creating the app on GitHub is a short form; half an hour is plenty. */
const STATE_TTL_MS = 30 * 60_000;
const DELIVERY_TTL_MS = 86_400_000;
/** Shown in issue history as the source of automated status changes. */
const VIA = 'GitHub';
/** A push carries at most 20 commits in its payload; cap anyway. */
const MAX_COMMITS = 50;
const REPOSITORY = /^[\w.-]+\/[\w.-]+$/;

interface Secrets {
  privateKey?: string;
  webhookSecret?: string;
  clientSecret?: string;
}

interface ManifestState {
  memberId: string;
  state: string;
  githubUrl: string;
  organization: string | null;
  expiresAt: number;
}

/** An issue a GitHub item mentions, with what automation and the bot comment need. */
interface Target {
  issueId: string;
  identifier: string;
  title: string;
  inTriage: boolean;
  category: string;
  statusName: string;
  team: typeof teams.$inferSelect;
}

interface LinkItem {
  kind: GithubLinkKind;
  repository: string;
  ref: string;
  title: string | null;
  state: GithubPullState | null;
  url: string;
  author: string | null;
}

type Row = typeof githubApp.$inferSelect;

/** A GitHub webhook payload; only the fields Ordler reads are used. */
export type GithubPayload = Record<string, any>; // eslint-disable-line @typescript-eslint/no-explicit-any

export interface GithubServiceDeps {
  db: Db;
  box: SecretBox;
  baseUrl: string;
  issues: Pick<IssueService, 'access' | 'teamFor' | 'setStatusBySystem'>;
  api?: GithubApi;
  now?: () => Date;
  log?: (message: string) => void;
}

/**
 * The GitHub integration (ADR 0019): a GitHub App created from a manifest, a signed webhook
 * receiver that links branches, pull requests and commits to the issues they mention, one bot
 * comment per pull request, and optional per-team status automation.
 */
export class GithubService {
  private readonly api: GithubApi;
  private cache?: { row: Row | undefined; secrets: Secrets; at: number };

  constructor(private readonly deps: GithubServiceDeps) {
    this.api = deps.api ?? new GithubApi(undefined, deps.now);
  }

  // -------------------------------------------------------------------------------------------
  // Settings
  // -------------------------------------------------------------------------------------------

  async view(): Promise<GithubAppView> {
    const { row, secrets } = await this.load(true);
    const githubUrl = row?.githubUrl ?? DEFAULT_GITHUB_URL;
    return {
      enabled: row?.enabled ?? false,
      githubUrl,
      organization: row?.organization ?? null,
      appId: row?.appId ?? null,
      appSlug: row?.appSlug ?? null,
      privateKeySet: Boolean(secrets.privateKey),
      webhookSecretSet: Boolean(secrets.webhookSecret),
      installUrl: row?.appSlug ? installUrl(githubUrl, row.appSlug) : null,
      webhookUrl: this.webhookUrl,
      lastDeliveryAt: row?.lastDeliveryAt?.toISOString() ?? null,
      lastError: row?.lastError ?? null,
    };
  }

  /** Saves settings typed in by hand; the alternative to the manifest flow. */
  async update(input: UpdateGithubAppInput, actor: AuditActor & { id: string }) {
    const before = await this.view();
    const { row, secrets: stored } = await this.load(true);
    const secrets: Secrets = { ...stored };
    for (const key of ['privateKey', 'webhookSecret'] as const) {
      const value = input[key];
      if (value === null) delete secrets[key];
      else if (value !== undefined) secrets[key] = value;
    }
    const appId = input.appId === undefined ? (row?.appId ?? null) : input.appId;
    if (input.enabled && (!appId || !secrets.privateKey || !secrets.webhookSecret)) {
      throw new DomainError('github_not_configured');
    }
    await this.save(
      {
        enabled: input.enabled,
        githubUrl: input.githubUrl,
        organization:
          input.organization === undefined ? (row?.organization ?? null) : input.organization,
        appId,
        // A different app id means a different app; its slug is unknown until the next manifest.
        appSlug: appId === row?.appId ? (row?.appSlug ?? null) : null,
      },
      secrets,
      actor,
    );
    const after = await this.view();
    await writeAudit(this.deps.db, {
      actor,
      action: 'github_app.updated',
      targetType: 'github_app',
      before,
      after: {
        ...after,
        changed: (['privateKey', 'webhookSecret'] as const).filter(
          (key) => input[key] !== undefined,
        ),
      },
    });
    return after;
  }

  /** The manifest and where to post it; the sealed state goes into a short-lived cookie. */
  async manifestStart(
    memberId: string,
    input: GithubManifestInput,
  ): Promise<GithubManifestStart & { stateCookie: string }> {
    const flow: ManifestState = {
      memberId,
      state: randomToken(),
      githubUrl: input.githubUrl,
      organization: input.organization ?? null,
      expiresAt: this.now().getTime() + STATE_TTL_MS,
    };
    const instance = await getInstance(this.deps.db);
    // GitHub App names are at most 34 characters and unique on github.com.
    const name = `Ordler ${instance?.companyName ?? ''}`.trim().slice(0, 34);
    const manifest = {
      name,
      url: this.deps.baseUrl,
      description: 'Links branches, pull requests and commits to Ordler issues.',
      hook_attributes: { url: this.webhookUrl, active: true },
      redirect_url: `${this.deps.baseUrl}/api/admin/github-app/callback`,
      public: false,
      default_permissions: { metadata: 'read', contents: 'read', pull_requests: 'write' },
      default_events: ['create', 'delete', 'push', 'pull_request'],
    };
    const path = flow.organization
      ? `/organizations/${encodeURIComponent(flow.organization)}/settings/apps/new`
      : '/settings/apps/new';
    return {
      url: `${input.githubUrl}${path}?state=${flow.state}`,
      manifest: JSON.stringify(manifest),
      stateCookie: this.deps.box.encrypt(JSON.stringify(flow), STATE_AAD),
    };
  }

  /** GitHub redirects back with a one-time code that becomes the app's id, key and secret. */
  async manifestCallback(
    actor: AuditActor & { id: string },
    input: { code?: string; state?: string; stateCookie?: string },
  ): Promise<void> {
    const json = input.stateCookie
      ? this.deps.box.decrypt(input.stateCookie, STATE_AAD)
      : undefined;
    const flow = json ? (JSON.parse(json) as ManifestState) : undefined;
    if (
      !flow ||
      flow.expiresAt <= this.now().getTime() ||
      flow.memberId !== actor.id ||
      flow.state !== input.state ||
      !input.code
    ) {
      throw new DomainError('oauth_failed');
    }
    const before = await this.view();
    const app = await this.api.convertManifest(flow.githubUrl, input.code);
    await this.save(
      {
        enabled: true,
        githubUrl: flow.githubUrl,
        organization: flow.organization,
        appId: String(app.id),
        appSlug: app.slug,
      },
      {
        privateKey: app.pem,
        webhookSecret: app.webhook_secret,
        ...(app.client_secret ? { clientSecret: app.client_secret } : {}),
      },
      actor,
    );
    await writeAudit(this.deps.db, {
      actor,
      action: 'github_app.created',
      targetType: 'github_app',
      before,
      after: await this.view(),
    });
  }

  get webhookUrl(): string {
    return `${this.deps.baseUrl}/api/github/webhook`;
  }

  // -------------------------------------------------------------------------------------------
  // Webhooks
  // -------------------------------------------------------------------------------------------

  /** `X-Hub-Signature-256: sha256=<hex HMAC of the raw body>`, compared in constant time. */
  async verifySignature(signature: string | undefined, body: string): Promise<boolean> {
    const { row, secrets } = await this.load();
    if (!row?.enabled || !secrets.webhookSecret || !signature?.startsWith('sha256=')) return false;
    const expected = Buffer.from(
      `sha256=${createHmac('sha256', secrets.webhookSecret).update(body).digest('hex')}`,
    );
    const given = Buffer.from(signature);
    return expected.length === given.length && timingSafeEqual(expected, given);
  }

  /** Handles one verified delivery; redeliveries of the same id are ignored. */
  async handleWebhook(
    event: string,
    deliveryId: string | undefined,
    payload: GithubPayload,
  ): Promise<void> {
    const now = this.now();
    if (deliveryId) {
      const fresh = await this.deps.db
        .insert(githubDeliveries)
        .values({ id: deliveryId.slice(0, 100), receivedAt: now })
        .onConflictDoNothing()
        .returning();
      if (fresh.length === 0) return;
      await this.deps.db
        .delete(githubDeliveries)
        .where(lt(githubDeliveries.receivedAt, new Date(now.getTime() - DELIVERY_TTL_MS)));
    }
    await this.deps.db.update(githubApp).set({ lastDeliveryAt: now }).where(eq(githubApp.id, 1));
    try {
      await this.dispatch(event, payload);
    } catch (error) {
      // Forgotten again, so GitHub's redelivery of a failed event is handled.
      if (deliveryId) {
        await this.deps.db
          .delete(githubDeliveries)
          .where(eq(githubDeliveries.id, deliveryId.slice(0, 100)));
      }
      throw error;
    }
  }

  private async dispatch(event: string, payload: GithubPayload): Promise<void> {
    const repository = String(payload.repository?.full_name ?? '');
    const htmlUrl = String(payload.repository?.html_url ?? '');
    if (!REPOSITORY.test(repository) || !/^https?:\/\//.test(htmlUrl)) return;
    const sender = typeof payload.sender?.login === 'string' ? payload.sender.login : null;

    switch (event) {
      case 'create':
        if (payload.ref_type === 'branch') {
          await this.linkBranch(repository, htmlUrl, String(payload.ref ?? ''), sender);
        }
        return;
      case 'delete':
        if (payload.ref_type === 'branch') {
          await this.deps.db
            .delete(githubLinks)
            .where(
              and(
                eq(githubLinks.kind, 'branch'),
                eq(githubLinks.repository, repository),
                eq(githubLinks.ref, String(payload.ref ?? '')),
              ),
            );
        }
        return;
      case 'push':
        await this.push(repository, htmlUrl, payload, sender);
        return;
      case 'pull_request':
        await this.pullRequest(repository, payload);
        return;
      default:
        return;
    }
  }

  private async push(
    repository: string,
    htmlUrl: string,
    payload: GithubPayload,
    sender: string | null,
  ): Promise<void> {
    const ref = String(payload.ref ?? '');
    if (!ref.startsWith('refs/heads/')) return;
    if (!payload.deleted) {
      await this.linkBranch(repository, htmlUrl, ref.slice('refs/heads/'.length), sender);
    }
    const commits = (Array.isArray(payload.commits) ? payload.commits : []).slice(0, MAX_COMMITS);
    for (const commit of commits as GithubPayload[]) {
      const sha = String(commit.id ?? '');
      const message = String(commit.message ?? '');
      if (!/^[0-9a-f]{7,64}$/.test(sha)) continue;
      const targets = await this.resolve(findIssueIdentifiers(message));
      await this.link(
        targets.map((t) => t.issueId),
        {
          kind: 'commit',
          repository,
          ref: sha,
          title: message.split('\n')[0]!.slice(0, 500),
          state: null,
          url: typeof commit.url === 'string' ? commit.url : `${htmlUrl}/commit/${sha}`,
          author:
            (commit.author?.username as string | undefined) ??
            (commit.author?.name as string | undefined) ??
            null,
        },
      );
    }
  }

  private async linkBranch(
    repository: string,
    htmlUrl: string,
    branch: string,
    author: string | null,
  ): Promise<void> {
    if (!branch) return;
    const targets = await this.resolve(findIssueIdentifiers(branch));
    await this.link(
      targets.map((t) => t.issueId),
      {
        kind: 'branch',
        repository,
        ref: branch,
        title: null,
        state: null,
        url: `${htmlUrl}/tree/${branch.split('/').map(encodeURIComponent).join('/')}`,
        author,
      },
    );
  }

  private async pullRequest(repository: string, payload: GithubPayload): Promise<void> {
    const pr = payload.pull_request as GithubPayload | undefined;
    const number = Number(pr?.number);
    if (!pr || !Number.isInteger(number) || number <= 0) return;
    const action = String(payload.action ?? '');
    const state: GithubPullState = pr.merged
      ? 'merged'
      : pr.state === 'closed'
        ? 'closed'
        : pr.draft
          ? 'draft'
          : 'open';
    const title = typeof pr.title === 'string' ? pr.title : '';
    const body = typeof pr.body === 'string' ? pr.body : '';
    const targets = await this.resolve(findIssueIdentifiers(pr.head?.ref, title, body));
    const ids = targets.map((t) => t.issueId);
    const ref = String(number);

    // A mention edited out of the title or body unlinks that issue.
    await this.deps.db
      .delete(githubLinks)
      .where(
        and(
          eq(githubLinks.kind, 'pull_request'),
          eq(githubLinks.repository, repository),
          eq(githubLinks.ref, ref),
          ...(ids.length > 0 ? [notInArray(githubLinks.issueId, ids)] : []),
        ),
      );
    await this.link(ids, {
      kind: 'pull_request',
      repository,
      ref,
      title: title.slice(0, 500),
      state,
      url: String(pr.html_url ?? ''),
      author: typeof pr.user?.login === 'string' ? pr.user.login : null,
    });
    if (targets.length === 0) return;

    if (action === 'opened' || action === 'reopened') {
      await this.automate(targets, 'opened');
    } else if (action === 'closed' && pr.merged) {
      await this.automate(targets, 'merged');
    }
    if (['opened', 'reopened', 'edited', 'ready_for_review'].includes(action)) {
      // Re-read so the comment shows the status automation just set.
      const fresh = await this.resolve(targets.map((t) => t.identifier));
      await this.comment(payload, repository, number, fresh);
    }
  }

  /** Team automation: opening moves not-started issues, merging moves unfinished ones. */
  private async automate(targets: Target[], on: 'opened' | 'merged'): Promise<void> {
    for (const target of targets) {
      const statusId =
        on === 'opened' ? target.team.githubOpenedStatusId : target.team.githubMergedStatusId;
      if (!statusId) continue;
      const eligible =
        on === 'opened'
          ? !target.inTriage && (target.category === 'backlog' || target.category === 'unstarted')
          : target.category !== 'completed' && target.category !== 'canceled';
      if (!eligible) continue;
      try {
        await this.deps.issues.setStatusBySystem(target.issueId, statusId, VIA);
      } catch (error) {
        this.deps.log?.(`GitHub automation failed for ${target.identifier}: ${String(error)}`);
      }
    }
  }

  /** One bot comment per pull request, edited when the set of linked issues changes. */
  private async comment(
    payload: GithubPayload,
    repository: string,
    number: number,
    targets: Target[],
  ): Promise<void> {
    const installationId = Number(payload.installation?.id);
    const { row, secrets } = await this.load();
    if (!installationId || !row?.appId || !secrets.privateKey) return;
    const app: AppCredentials = {
      githubUrl: row.githubUrl,
      appId: row.appId,
      privateKey: secrets.privateKey,
    };
    const identifiers = targets.map((t) => t.identifier).sort();
    const body = this.commentBody(targets);
    const where = and(
      eq(githubPullRequestComments.repository, repository),
      eq(githubPullRequestComments.number, number),
    );
    const now = this.now();
    // The insert is the claim: of several replicas handling events of one PR, one posts.
    const claimed = await this.deps.db
      .insert(githubPullRequestComments)
      .values({ repository, number, identifiers, updatedAt: now })
      .onConflictDoNothing()
      .returning();
    if (claimed.length > 0) {
      try {
        const commentId = await this.api.createComment(
          app,
          installationId,
          repository,
          number,
          body,
        );
        await this.deps.db.update(githubPullRequestComments).set({ commentId }).where(where);
      } catch (error) {
        // Released so the next event of this pull request tries again.
        await this.deps.db.delete(githubPullRequestComments).where(where);
        await this.recordError(`Comment on ${repository}#${number} failed: ${String(error)}`);
      }
      return;
    }
    const [existing] = await this.deps.db.select().from(githubPullRequestComments).where(where);
    if (!existing?.commentId || existing.identifiers.join() === identifiers.join()) return;
    const updated = await this.deps.db
      .update(githubPullRequestComments)
      .set({ identifiers, updatedAt: now })
      // Optimistic: only the replica that saw this version edits the comment.
      .where(and(where, eq(githubPullRequestComments.updatedAt, existing.updatedAt)))
      .returning();
    if (updated.length === 0) return;
    try {
      await this.api.updateComment(app, installationId, repository, existing.commentId, body);
    } catch (error) {
      await this.recordError(`Comment on ${repository}#${number} failed: ${String(error)}`);
    }
  }

  /** Identifier, title, status and link; private teams show identifier and link only. */
  commentBody(targets: Target[]): string {
    const lines = targets.map((target) => {
      const link = `[${target.identifier}](${this.deps.baseUrl}/issue/${target.identifier})`;
      if (target.team.isPrivate) return `- **${link}**`;
      return `- **${link}** ${escapeMarkdown(target.title)} · ${escapeMarkdown(target.statusName)}`;
    });
    return [`Linked to Ordler:`, '', ...lines].join('\n');
  }

  /** Current, non-archived issues for identifiers; unknown team keys are ignored. */
  private async resolve(identifiers: string[]): Promise<Target[]> {
    const wanted = identifiers.map((id) => parseIssueIdentifier(id)).filter((p) => p !== undefined);
    if (wanted.length === 0) return [];
    const rows = await this.deps.db
      .select({
        issueId: issues.id,
        number: issues.number,
        title: issues.title,
        inTriage: issues.inTriage,
        category: workflowStatuses.category,
        statusName: workflowStatuses.name,
        team: teams,
      })
      .from(issues)
      .innerJoin(teams, eq(teams.id, issues.teamId))
      .innerJoin(workflowStatuses, eq(workflowStatuses.id, issues.statusId))
      .where(
        and(
          isNull(issues.archivedAt),
          isNull(teams.archivedAt),
          or(...wanted.map((p) => and(eq(teams.key, p.teamKey), eq(issues.number, p.number)))),
        ),
      );
    const order = identifiers.map((id) => id.toUpperCase());
    return rows
      .map((row) => ({ ...row, identifier: formatIssueIdentifier(row.team.key, row.number) }))
      .sort((a, b) => order.indexOf(a.identifier) - order.indexOf(b.identifier));
  }

  private async link(issueIds: string[], item: LinkItem): Promise<void> {
    if (issueIds.length === 0 || !item.url) return;
    const now = this.now();
    await this.deps.db
      .insert(githubLinks)
      .values(issueIds.map((issueId) => ({ issueId, ...item, createdAt: now, updatedAt: now })))
      .onConflictDoUpdate({
        target: [githubLinks.issueId, githubLinks.kind, githubLinks.repository, githubLinks.ref],
        set: {
          title: sql`excluded.title`,
          state: sql`excluded.state`,
          url: sql`excluded.url`,
          updatedAt: now,
        },
      });
  }

  // -------------------------------------------------------------------------------------------
  // Issue page and team settings
  // -------------------------------------------------------------------------------------------

  /** Links of an issue the member may read, plus their suggested branch name. */
  async issueView(memberId: string, identifier: string): Promise<IssueGithubView> {
    const issue = await this.deps.issues.access(memberId, identifier);
    const [member] = await this.deps.db
      .select({ email: members.email })
      .from(members)
      .where(eq(members.id, memberId));
    const rows = await this.deps.db
      .select()
      .from(githubLinks)
      .where(eq(githubLinks.issueId, issue.issueId))
      .orderBy(asc(githubLinks.kind), desc(githubLinks.updatedAt));
    return {
      branchName: issueBranchName(member?.email ?? '', issue.identifier, issue.title),
      links: rows.map((row): GithubLinkView => ({
        id: row.id,
        kind: row.kind,
        repository: row.repository,
        ref: row.ref,
        title: row.title,
        state: row.state,
        url: row.url,
        author: row.author,
        updatedAt: row.updatedAt.toISOString(),
      })),
    };
  }

  async teamSettings(memberId: string, key: string): Promise<TeamGithubSettings> {
    const { team, can } = await this.deps.issues.teamFor(memberId, key);
    if (!can.manage) throw new DomainError('forbidden');
    return {
      openedStatusId: team.githubOpenedStatusId,
      mergedStatusId: team.githubMergedStatusId,
    };
  }

  async updateTeamSettings(
    memberId: string,
    key: string,
    input: UpdateTeamGithubInput,
  ): Promise<TeamGithubSettings> {
    const { team, can } = await this.deps.issues.teamFor(memberId, key);
    if (!can.manage) throw new DomainError('forbidden');
    const statuses = await teamStatuses(this.deps.db, team.id);
    for (const statusId of [input.openedStatusId, input.mergedStatusId]) {
      if (statusId && !statuses.some((s) => s.id === statusId)) {
        throw new DomainError('status_not_in_workflow');
      }
    }
    const before = {
      openedStatusId: team.githubOpenedStatusId,
      mergedStatusId: team.githubMergedStatusId,
    };
    await this.deps.db
      .update(teams)
      .set({
        githubOpenedStatusId: input.openedStatusId,
        githubMergedStatusId: input.mergedStatusId,
      })
      .where(eq(teams.id, team.id));
    await writeAudit(this.deps.db, {
      actor: { type: 'member', id: memberId },
      action: 'team.github_updated',
      targetType: 'team',
      targetId: team.id,
      before,
      after: input,
    });
    return { openedStatusId: input.openedStatusId, mergedStatusId: input.mergedStatusId };
  }

  // -------------------------------------------------------------------------------------------

  private async save(
    values: Pick<Row, 'enabled' | 'githubUrl' | 'organization' | 'appId' | 'appSlug'>,
    secrets: Secrets,
    actor: { id: string },
  ): Promise<void> {
    const set = {
      ...values,
      secretsEncrypted:
        Object.keys(secrets).length > 0
          ? this.deps.box.encrypt(JSON.stringify(secrets), SECRETS_AAD)
          : null,
      lastError: null,
      updatedAt: this.now(),
      updatedBy: actor.id,
    };
    await this.deps.db
      .insert(githubApp)
      .values({ id: 1, ...set })
      .onConflictDoUpdate({ target: githubApp.id, set });
    this.cache = undefined;
    this.api.reset();
  }

  private async recordError(message: string): Promise<void> {
    this.deps.log?.(message);
    await this.deps.db
      .update(githubApp)
      .set({ lastError: message.slice(0, 500) })
      .where(eq(githubApp.id, 1));
    this.cache = undefined;
  }

  private async load(fresh = false): Promise<{ row: Row | undefined; secrets: Secrets }> {
    const at = this.now().getTime();
    if (!fresh && this.cache && at - this.cache.at < 15_000) return this.cache;
    const [row] = await this.deps.db.select().from(githubApp).where(eq(githubApp.id, 1));
    const json = row?.secretsEncrypted
      ? this.deps.box.decrypt(row.secretsEncrypted, SECRETS_AAD)
      : undefined;
    this.cache = { row, secrets: json ? (JSON.parse(json) as Secrets) : {}, at };
    return this.cache;
  }

  private now(): Date {
    return this.deps.now?.() ?? new Date();
  }
}

/** github.com lists apps under /apps; GitHub Enterprise Server under /github-apps. */
function installUrl(githubUrl: string, slug: string): string {
  const host = new URL(githubUrl).host;
  return `${githubUrl}/${host === 'github.com' ? 'apps' : 'github-apps'}/${slug}/installations/new`;
}

/** Titles are plain text in the comment: no links, formatting or @mentions of GitHub users. */
function escapeMarkdown(text: string): string {
  return text.replace(/\s+/g, ' ').replace(/([\\`*_[\]<>#@|~!])/g, '\\$1');
}
