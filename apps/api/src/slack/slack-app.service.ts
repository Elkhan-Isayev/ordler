import { createHmac, timingSafeEqual } from 'node:crypto';
import {
  isLocale,
  type Locale,
  type SlackAppView,
  type SlackChannel,
  type SlackLinkView,
  type UpdateSlackAppInput,
} from '@ordler/shared';
import { count, eq, inArray } from 'drizzle-orm';
import { createRemoteJWKSet, jwtVerify, type JWTVerifyGetKey } from 'jose';
import { writeAudit, type AuditActor } from '../audit/audit.js';
import { DomainError } from '../auth/errors.js';
import type { SecretBox } from '../crypto/secret-box.js';
import { randomToken } from '../crypto/tokens.js';
import type { Db } from '../db/client.js';
import { members, slackApp, slackLinks } from '../db/schema.js';
import type { IssueService } from '../issues/issue.service.js';
import { formatEmailMessage, type EmailMessageKey } from '../mail/templates.js';
import type { ChannelPoster } from '../notifications/slack.service.js';
import { escapeSlack } from '../notifications/slack.service.js';
import type { DirectMessage, DirectMessenger } from '../notifications/notification.service.js';
import type { RequestTypeService } from '../requests/request-types.service.js';
import type { RequestService } from '../requests/request.service.js';
import { getInstance } from '../setup/setup.service.js';
import { SlackApi } from './slack-api.js';

const SECRETS_AAD = 'slack_app:secrets';
const LINK_STATE_AAD = 'slack_link:state';
const LINK_TTL_MS = 10 * 60_000;
/** Slack refuses requests older than five minutes; so does Ordler (replay protection). */
const SIGNATURE_WINDOW_S = 300;
const SLACK_ISSUER = 'https://slack.com';
const SLACK_JWKS = 'https://slack.com/openid/connect/keys';

export const CALLBACKS = {
  createIssue: 'ordler_create_issue',
  createRequest: 'ordler_create_request',
  issueModal: 'ordler_issue_modal',
  requestModal: 'ordler_request_modal',
} as const;

interface Secrets {
  botToken?: string;
  appToken?: string;
  signingSecret?: string;
  clientSecret?: string;
}

interface LinkState {
  memberId: string;
  state: string;
  nonce: string;
  expiresAt: number;
}

type Row = typeof slackApp.$inferSelect;

export interface SlackAppDeps {
  db: Db;
  box: SecretBox;
  baseUrl: string;
  issues: Pick<IssueService, 'get' | 'create' | 'readableTeams' | 'permissionsForTeamId'>;
  requests: Pick<RequestService, 'get' | 'submit'>;
  requestTypes: Pick<RequestTypeService, 'portals'>;
  api?: SlackApi;
  jwks?: JWTVerifyGetKey;
  now?: () => Date;
  log?: (message: string) => void;
}

/** A Slack interactivity or Events API payload; only the fields Ordler reads are typed. */
export type SlackPayload = Record<string, any>; // eslint-disable-line @typescript-eslint/no-explicit-any

/**
 * The Ordler Slack app (SPEC §7.1, level 2): personal DMs, channel picker, link unfurls and
 * "create from message". Every action runs as the linked Ordler member through the same
 * services as the UI; approvals are never decided from Slack.
 */
export class SlackAppService implements ChannelPoster, DirectMessenger {
  private readonly api: SlackApi;
  private readonly jwks: JWTVerifyGetKey;
  private cache?: { row: Row | undefined; secrets: Secrets; at: number };
  connection: SlackAppView['connection'] = 'disconnected';

  constructor(private readonly deps: SlackAppDeps) {
    this.api = deps.api ?? new SlackApi();
    this.jwks = deps.jwks ?? createRemoteJWKSet(new URL(SLACK_JWKS));
  }

  // -------------------------------------------------------------------------------------------
  // Settings
  // -------------------------------------------------------------------------------------------

  async view(): Promise<SlackAppView> {
    const { row, secrets } = await this.load(true);
    const [linked] = await this.deps.db.select({ n: count() }).from(slackLinks);
    return {
      enabled: row?.enabled ?? false,
      mode: row?.mode ?? 'socket',
      workspace:
        row?.workspaceId && row.workspaceName
          ? { id: row.workspaceId, name: row.workspaceName }
          : null,
      botTokenSet: Boolean(secrets.botToken),
      appTokenSet: Boolean(secrets.appToken),
      signingSecretSet: Boolean(secrets.signingSecret),
      clientId: row?.clientId ?? null,
      clientSecretSet: Boolean(secrets.clientSecret),
      connection: row?.mode === 'http' ? 'n/a' : this.connection,
      lastError: row?.lastError ?? null,
      linkedMembers: linked?.n ?? 0,
      urls: {
        redirect: this.redirectUri,
        events: `${this.deps.baseUrl}/api/slack/events`,
        interactivity: `${this.deps.baseUrl}/api/slack/interactivity`,
      },
    };
  }

  /** Saves settings; a new bot token is checked with `auth.test` to learn the workspace. */
  async update(
    input: UpdateSlackAppInput,
    actor: AuditActor & { id: string },
  ): Promise<SlackAppView> {
    const before = await this.view();
    const { row, secrets: stored } = await this.load(true);
    const secrets: Secrets = { ...stored };
    for (const key of ['botToken', 'appToken', 'signingSecret', 'clientSecret'] as const) {
      const value = input[key];
      if (value === null) delete secrets[key];
      else if (value !== undefined) secrets[key] = value;
    }

    let workspace = { id: row?.workspaceId ?? null, name: row?.workspaceName ?? null };
    let botUserId = row?.botUserId ?? null;
    if (input.botToken) {
      const auth = await this.api.call('auth.test', input.botToken);
      if (!auth.ok) throw new DomainError('slack_rejected');
      workspace = { id: String(auth.team_id), name: String(auth.team) };
      botUserId = String(auth.user_id);
    } else if (!secrets.botToken) {
      workspace = { id: null, name: null };
      botUserId = null;
    }
    if (input.enabled && !secrets.botToken) throw new DomainError('slack_not_configured');
    if (input.enabled && input.mode === 'socket' && !secrets.appToken) {
      throw new DomainError('slack_not_configured');
    }
    if (input.enabled && input.mode === 'http' && !secrets.signingSecret) {
      throw new DomainError('slack_not_configured');
    }

    const values = {
      enabled: input.enabled,
      mode: input.mode,
      secretsEncrypted:
        Object.keys(secrets).length > 0
          ? this.deps.box.encrypt(JSON.stringify(secrets), SECRETS_AAD)
          : null,
      clientId: input.clientId === undefined ? (row?.clientId ?? null) : input.clientId,
      workspaceId: workspace.id,
      workspaceName: workspace.name,
      botUserId,
      lastError: null,
      updatedAt: this.now(),
      updatedBy: actor.id,
    };
    await this.deps.db
      .insert(slackApp)
      .values({ id: 1, ...values })
      .onConflictDoUpdate({ target: slackApp.id, set: values });
    this.cache = undefined;
    const after = await this.view();
    await writeAudit(this.deps.db, {
      actor,
      action: 'slack_app.updated',
      targetType: 'slack_app',
      before,
      after: {
        ...after,
        secretsChanged: (['botToken', 'appToken', 'signingSecret', 'clientSecret'] as const).filter(
          (key) => input[key] !== undefined,
        ),
      },
    });
    return after;
  }

  /** The app manifest the admin pastes into api.slack.com, pointing at this installation. */
  async manifest(): Promise<object> {
    const instance = await getInstance(this.deps.db);
    const { row } = await this.load();
    const http = row?.mode === 'http';
    return {
      display_information: {
        name: 'Ordler',
        description: `Tasks and requests of ${instance?.companyName ?? 'your company'}`,
      },
      features: {
        bot_user: { display_name: 'Ordler', always_online: true },
        unfurl_domains: [new URL(this.deps.baseUrl).host],
        shortcuts: [
          {
            name: 'Create issue',
            type: 'message',
            callback_id: CALLBACKS.createIssue,
            description: 'Create an Ordler issue from this message',
          },
          {
            name: 'Create request',
            type: 'message',
            callback_id: CALLBACKS.createRequest,
            description: 'Create an Ordler request from this message',
          },
        ],
      },
      oauth_config: {
        redirect_urls: [this.redirectUri],
        scopes: {
          bot: [
            'chat:write',
            'chat:write.public',
            'channels:read',
            'im:write',
            'links:read',
            'links:write',
            'commands',
          ],
        },
      },
      settings: {
        event_subscriptions: {
          ...(http ? { request_url: `${this.deps.baseUrl}/api/slack/events` } : {}),
          bot_events: ['link_shared'],
        },
        interactivity: {
          is_enabled: true,
          ...(http ? { request_url: `${this.deps.baseUrl}/api/slack/interactivity` } : {}),
        },
        org_deploy_enabled: false,
        socket_mode_enabled: !http,
        token_rotation_enabled: false,
      },
    };
  }

  /** Bot and app-level tokens for the Socket Mode client, when Socket Mode is on. */
  async socketConfig(): Promise<{ appToken: string } | undefined> {
    const { row, secrets } = await this.load(true);
    if (!row?.enabled || row.mode !== 'socket' || !secrets.appToken || !secrets.botToken) {
      return undefined;
    }
    return { appToken: secrets.appToken };
  }

  async recordError(message: string | null): Promise<void> {
    await this.deps.db.update(slackApp).set({ lastError: message }).where(eq(slackApp.id, 1));
    this.cache = undefined;
  }

  // -------------------------------------------------------------------------------------------
  // Linking a member's Slack account (Sign in with Slack, OpenID Connect)
  // -------------------------------------------------------------------------------------------

  get redirectUri(): string {
    return `${this.deps.baseUrl}/api/me/slack/callback`;
  }

  async link(memberId: string): Promise<SlackLinkView> {
    const { row, secrets } = await this.load();
    const [linked] = await this.deps.db
      .select()
      .from(slackLinks)
      .where(eq(slackLinks.memberId, memberId));
    return {
      available: Boolean(row?.enabled && row.clientId && secrets.clientSecret && row.workspaceId),
      linked: Boolean(linked && linked.workspaceId === row?.workspaceId),
      workspace: row?.workspaceName ?? null,
      directMessages: linked?.directMessages ?? true,
    };
  }

  async linkStart(memberId: string): Promise<{ url: string; stateCookie: string }> {
    const { row } = await this.requireLinkable();
    const flow: LinkState = {
      memberId,
      state: randomToken(),
      nonce: randomToken(),
      expiresAt: this.now().getTime() + LINK_TTL_MS,
    };
    const params = new URLSearchParams({
      response_type: 'code',
      scope: 'openid',
      client_id: row.clientId!,
      redirect_uri: this.redirectUri,
      state: flow.state,
      nonce: flow.nonce,
      team: row.workspaceId!,
    });
    return {
      url: `https://slack.com/openid/connect/authorize?${params.toString()}`,
      stateCookie: this.deps.box.encrypt(JSON.stringify(flow), LINK_STATE_AAD),
    };
  }

  async linkCallback(
    memberId: string,
    input: { code?: string; state?: string; stateCookie?: string },
  ): Promise<void> {
    const { row, secrets } = await this.requireLinkable();
    const json = input.stateCookie
      ? this.deps.box.decrypt(input.stateCookie, LINK_STATE_AAD)
      : undefined;
    const flow = json ? (JSON.parse(json) as LinkState) : undefined;
    if (
      !flow ||
      flow.expiresAt <= this.now().getTime() ||
      flow.memberId !== memberId ||
      flow.state !== input.state ||
      !input.code
    ) {
      throw new DomainError('oauth_failed');
    }
    const token = await this.api.form('openid.connect.token', {
      client_id: row.clientId!,
      client_secret: secrets.clientSecret!,
      code: input.code,
      redirect_uri: this.redirectUri,
    });
    if (!token.ok || typeof token.id_token !== 'string') throw new DomainError('oauth_failed');
    let userId: unknown;
    let teamId: unknown;
    try {
      const { payload } = await jwtVerify(token.id_token, this.jwks, {
        issuer: SLACK_ISSUER,
        audience: row.clientId!,
        currentDate: this.now(),
      });
      if (payload.nonce !== flow.nonce) throw new Error('nonce');
      userId = payload['https://slack.com/user_id'];
      teamId = payload['https://slack.com/team_id'];
    } catch {
      throw new DomainError('oauth_failed');
    }
    // Only the connected workspace: another workspace's user id would mean someone else.
    if (typeof userId !== 'string' || teamId !== row.workspaceId) {
      throw new DomainError('oauth_failed');
    }
    await this.deps.db.transaction(async (tx) => {
      // One Slack user maps to one member; relinking moves it.
      await tx.delete(slackLinks).where(eq(slackLinks.slackUserId, userId));
      await tx
        .insert(slackLinks)
        .values({ memberId, workspaceId: row.workspaceId!, slackUserId: userId })
        .onConflictDoUpdate({
          target: slackLinks.memberId,
          set: { workspaceId: row.workspaceId!, slackUserId: userId, linkedAt: this.now() },
        });
    });
    await writeAudit(this.deps.db, {
      actor: { type: 'member', id: memberId },
      action: 'slack_link.created',
      targetType: 'member',
      targetId: memberId,
      after: { workspaceId: row.workspaceId, slackUserId: userId },
    });
  }

  async unlink(memberId: string): Promise<void> {
    const removed = await this.deps.db
      .delete(slackLinks)
      .where(eq(slackLinks.memberId, memberId))
      .returning({ id: slackLinks.memberId });
    if (removed.length === 0) return;
    await writeAudit(this.deps.db, {
      actor: { type: 'member', id: memberId },
      action: 'slack_link.deleted',
      targetType: 'member',
      targetId: memberId,
    });
  }

  async setDirectMessages(memberId: string, on: boolean): Promise<SlackLinkView> {
    await this.deps.db
      .update(slackLinks)
      .set({ directMessages: on })
      .where(eq(slackLinks.memberId, memberId));
    return this.link(memberId);
  }

  // -------------------------------------------------------------------------------------------
  // Outgoing: channels and DMs
  // -------------------------------------------------------------------------------------------

  async channels(): Promise<SlackChannel[]> {
    const token = await this.botToken();
    if (!token) throw new DomainError('slack_not_configured');
    const result = await this.api.call('conversations.list', token, {
      types: 'public_channel',
      exclude_archived: true,
      limit: 1000,
    });
    if (!result.ok) throw new DomainError('slack_rejected');
    return ((result.channels as Array<{ id: string; name: string }>) ?? [])
      .map((c) => ({ id: c.id, name: c.name }))
      .sort((a, b) => a.name.localeCompare(b.name));
  }

  async channelName(channelId: string): Promise<string | undefined> {
    const token = await this.botToken();
    if (!token) return undefined;
    const result = await this.api.call('conversations.info', token, { channel: channelId });
    const channel = result.channel as { name?: string; is_private?: boolean } | undefined;
    // Private channels are refused: their members are not Ordler's to know.
    return result.ok && channel?.name && !channel.is_private ? channel.name : undefined;
  }

  async postToChannel(channelId: string, message: object): Promise<boolean> {
    const token = await this.botToken();
    if (!token) return false;
    const result = await this.api.call('chat.postMessage', token, {
      channel: channelId,
      unfurl_links: false,
      ...message,
    });
    if (!result.ok) this.deps.log?.(`Slack chat.postMessage to ${channelId}: ${result.error}`);
    return result.ok;
  }

  /** Inbox events as DMs, in each member's language (SPEC §7.1). */
  async send(memberIds: string[], message: DirectMessage): Promise<void> {
    const token = await this.botToken();
    if (!token || memberIds.length === 0) return;
    const { row } = await this.load();
    const rows = await this.deps.db
      .select({ link: slackLinks, locale: members.locale })
      .from(slackLinks)
      .innerJoin(members, eq(members.id, slackLinks.memberId))
      .where(inArray(slackLinks.memberId, memberIds));
    const fallback = await this.defaultLocale();
    for (const { link, locale } of rows) {
      if (!link.directMessages || link.workspaceId !== row?.workspaceId) continue;
      const language = locale && isLocale(locale) ? locale : fallback;
      const heading = formatEmailMessage(language, 'notifySubject', {
        kind: message.kind,
        actor: message.actor ?? 'Ordler',
        item: message.identifier,
      });
      const url = `${this.deps.baseUrl}${message.path}`;
      await this.api.call('chat.postMessage', token, {
        channel: link.slackUserId,
        text: `${heading}: ${message.title}`,
        unfurl_links: false,
        blocks: [
          {
            type: 'section',
            text: {
              type: 'mrkdwn',
              text: `${escapeSlack(heading)}\n*<${url}|${escapeSlack(message.identifier)}>* ${escapeSlack(message.title)}`,
            },
          },
          openButton(language, url),
        ],
      });
    }
  }

  // -------------------------------------------------------------------------------------------
  // Incoming: Events API and interactivity, over Socket Mode or HTTPS
  // -------------------------------------------------------------------------------------------

  /** Slack's v0 request signature (HTTP mode); rejects stale timestamps against replays. */
  async verifySignature(
    timestamp: string | undefined,
    signature: string | undefined,
    body: string,
  ): Promise<boolean> {
    const { row, secrets } = await this.load();
    if (!row?.enabled || row.mode !== 'http' || !secrets.signingSecret) return false;
    if (!timestamp || !signature || !/^\d+$/.test(timestamp)) return false;
    if (Math.abs(this.now().getTime() / 1000 - Number(timestamp)) > SIGNATURE_WINDOW_S) {
      return false;
    }
    const expected = `v0=${createHmac('sha256', secrets.signingSecret).update(`v0:${timestamp}:${body}`).digest('hex')}`;
    const a = Buffer.from(expected);
    const b = Buffer.from(signature);
    return a.length === b.length && timingSafeEqual(a, b);
  }

  /** Events API callbacks: only `link_shared` (unfurls). */
  async handleEvent(payload: SlackPayload): Promise<void> {
    const event = payload.event as SlackPayload | undefined;
    if (event?.type !== 'link_shared') return;
    const { row } = await this.load();
    if (payload.team_id !== row?.workspaceId) return;
    const memberId = await this.memberFor(String(event.user));
    // Nothing for people Ordler does not know: a card could leak what they may not see.
    if (!memberId) return;
    const unfurls: Record<string, object> = {};
    for (const link of (event.links as Array<{ url: string }>) ?? []) {
      const card = await this.card(memberId, link.url);
      if (card) unfurls[link.url] = card;
    }
    if (Object.keys(unfurls).length === 0) return;
    const token = await this.botToken();
    if (!token) return;
    await this.api.call('chat.unfurl', token, {
      ...(event.unfurl_id
        ? { unfurl_id: event.unfurl_id, source: event.source }
        : { channel: event.channel, ts: event.message_ts }),
      unfurls,
    });
  }

  /** Message shortcuts and modal submissions; the return value is the HTTP/socket ack body. */
  async handleInteraction(payload: SlackPayload): Promise<object | undefined> {
    const { row } = await this.load();
    if (payload.team?.id !== row?.workspaceId) return undefined;
    const slackUserId = String(payload.user?.id ?? '');
    const memberId = await this.memberFor(slackUserId);
    const locale = await this.localeOf(memberId);

    if (payload.type === 'message_action') {
      if (!memberId) {
        await this.respond(
          payload.response_url,
          this.text(locale, 'slackLinkFirst', { url: `${this.deps.baseUrl}/settings/slack` }),
        );
        return undefined;
      }
      const view =
        payload.callback_id === CALLBACKS.createIssue
          ? await this.issueModal(memberId, locale, payload)
          : payload.callback_id === CALLBACKS.createRequest
            ? await this.requestModal(memberId, locale, payload)
            : undefined;
      if (!view) {
        await this.respond(payload.response_url, this.text(locale, 'slackNothingToCreate', {}));
        return undefined;
      }
      const token = await this.botToken();
      if (token) await this.api.call('views.open', token, { trigger_id: payload.trigger_id, view });
      return undefined;
    }

    if (payload.type === 'view_submission' && memberId) {
      const callback = payload.view?.callback_id;
      if (callback === CALLBACKS.issueModal || callback === CALLBACKS.requestModal) {
        return this.submitModal(memberId, slackUserId, locale, payload);
      }
    }
    return undefined;
  }

  private async issueModal(memberId: string, locale: Locale, payload: SlackPayload) {
    const teams = [];
    for (const team of await this.deps.issues.readableTeams(memberId)) {
      if ((await this.deps.issues.permissionsForTeamId(memberId, team.id)).create) teams.push(team);
    }
    if (teams.length === 0) return undefined;
    return this.modal(
      locale,
      CALLBACKS.issueModal,
      'slackCreateIssue',
      'slackTeam',
      teams.slice(0, 100).map((t) => ({ value: t.key, label: `${t.key} · ${t.name}` })),
      payload,
    );
  }

  private async requestModal(memberId: string, locale: Locale, payload: SlackPayload) {
    const portals = await this.deps.requestTypes.portals(memberId).catch(() => []);
    const types = portals.flatMap((portal) =>
      portal.requestTypes.map((type) => ({
        value: type.id,
        label: `${portal.department.name} · ${type.name}`,
      })),
    );
    if (types.length === 0) return undefined;
    return this.modal(
      locale,
      CALLBACKS.requestModal,
      'slackCreateRequest',
      'slackRequestType',
      types.slice(0, 100),
      payload,
    );
  }

  private modal(
    locale: Locale,
    callbackId: string,
    title: EmailMessageKey,
    targetLabel: EmailMessageKey,
    options: Array<{ value: string; label: string }>,
    payload: SlackPayload,
  ) {
    const text = String(payload.message?.text ?? '');
    const firstLine = text.split('\n')[0]?.trim().slice(0, 150) ?? '';
    const permalink = String(payload.message?.permalink ?? '');
    const plain = (key: EmailMessageKey) => ({
      type: 'plain_text',
      text: this.text(locale, key, {}).slice(0, 24),
    });
    return {
      type: 'modal',
      callback_id: callbackId,
      private_metadata: JSON.stringify({ permalink }),
      title: plain(title),
      submit: plain('slackSubmit'),
      close: plain('slackCancel'),
      blocks: [
        {
          type: 'input',
          block_id: 'target',
          label: { type: 'plain_text', text: this.text(locale, targetLabel, {}) },
          element: {
            type: 'static_select',
            action_id: 'value',
            initial_option: option(options[0]!),
            options: options.map(option),
          },
        },
        {
          type: 'input',
          block_id: 'title',
          label: { type: 'plain_text', text: this.text(locale, 'slackTitle', {}) },
          element: {
            type: 'plain_text_input',
            action_id: 'value',
            initial_value: firstLine,
            max_length: 255,
          },
        },
        {
          type: 'input',
          block_id: 'description',
          optional: true,
          label: { type: 'plain_text', text: this.text(locale, 'slackDescription', {}) },
          element: {
            type: 'plain_text_input',
            action_id: 'value',
            multiline: true,
            initial_value: text.slice(0, 2900),
          },
        },
      ],
    };
  }

  private async submitModal(
    memberId: string,
    slackUserId: string,
    locale: Locale,
    payload: SlackPayload,
  ): Promise<object> {
    const values = payload.view.state?.values ?? {};
    const target = String(values.target?.value?.selected_option?.value ?? '');
    const title = String(values.title?.value?.value ?? '').trim();
    const meta = safeJson(payload.view.private_metadata) as { permalink?: string };
    const body = String(values.description?.value?.value ?? '').trim();
    const description = [
      body,
      meta.permalink ? this.text(locale, 'slackFromSlack', { url: meta.permalink }) : '',
    ]
      .filter(Boolean)
      .join('\n\n');
    if (!title) {
      return {
        response_action: 'errors',
        errors: { title: this.text(locale, 'slackCreateFailed', { reason: 'other' }) },
      };
    }

    let identifier: string;
    try {
      if (payload.view.callback_id === CALLBACKS.issueModal) {
        const issue = await this.deps.issues.create(
          memberId,
          target,
          {
            title,
            description,
            priority: 'none',
            assigneeId: null,
            dueDate: null,
            labelIds: [],
            parentId: null,
            cycleId: null,
            projectId: null,
            milestoneId: null,
          },
          'slack',
        );
        identifier = issue.identifier;
      } else {
        const request = await this.deps.requests.submit(
          { memberId, tokenName: 'slack' },
          {
            requestTypeId: target,
            title,
            description,
            priority: 'none',
            formData: {},
            extraApprovals: [],
          },
        );
        identifier = request.identifier;
      }
    } catch (error) {
      if (!(error instanceof DomainError)) throw error;
      // Shown under the select: the usual cause is a form that needs the portal.
      return {
        response_action: 'errors',
        errors: { target: this.text(locale, 'slackCreateFailed', { reason: error.code }) },
      };
    }
    const path =
      payload.view.callback_id === CALLBACKS.issueModal
        ? `/issue/${identifier}`
        : `/requests/${identifier}`;
    const url = `${this.deps.baseUrl}${path}`;
    const token = await this.botToken();
    if (token) {
      await this.api.call('chat.postMessage', token, {
        channel: slackUserId,
        text: this.text(locale, 'slackCreated', { item: identifier, title }),
        blocks: [
          {
            type: 'section',
            text: {
              type: 'mrkdwn',
              text: `*<${url}|${escapeSlack(identifier)}>* ${escapeSlack(title)}`,
            },
          },
          openButton(locale, url),
        ],
      });
    }
    return { response_action: 'clear' };
  }

  /** An unfurl card for an issue or request link the member may open; otherwise nothing. */
  private async card(memberId: string, url: string): Promise<object | undefined> {
    let path: string;
    try {
      const parsed = new URL(url);
      if (parsed.origin !== new URL(this.deps.baseUrl).origin) return undefined;
      path = parsed.pathname;
    } catch {
      return undefined;
    }
    const issueMatch = /^\/issue\/([A-Za-z0-9]+-\d+)\/?$/.exec(path);
    const requestMatch = /^\/requests\/(REQ-\d+)\/?$/i.exec(path);
    try {
      if (issueMatch) {
        const issue = await this.deps.issues.get(memberId, issueMatch[1]!);
        return cardBlocks(
          url,
          issue.identifier,
          issue.title,
          [issue.status.name, issue.assignee?.name].filter(Boolean) as string[],
        );
      }
      if (requestMatch) {
        const request = await this.deps.requests.get(memberId, requestMatch[1]!.toUpperCase());
        return cardBlocks(url, request.identifier, request.title, [request.targetTeam.name]);
      }
    } catch {
      // Not readable for this member: Slack keeps the plain link.
    }
    return undefined;
  }

  private async respond(responseUrl: unknown, text: string): Promise<void> {
    if (typeof responseUrl !== 'string' || !responseUrl.startsWith('https://hooks.slack.com/'))
      return;
    await fetch(responseUrl, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ response_type: 'ephemeral', text }),
    }).catch(() => undefined);
  }

  private async memberFor(slackUserId: string): Promise<string | undefined> {
    const { row } = await this.load();
    if (!row?.workspaceId || !slackUserId) return undefined;
    const [link] = await this.deps.db
      .select({
        memberId: slackLinks.memberId,
        status: members.status,
        workspaceId: slackLinks.workspaceId,
      })
      .from(slackLinks)
      .innerJoin(members, eq(members.id, slackLinks.memberId))
      .where(eq(slackLinks.slackUserId, slackUserId));
    return link && link.status === 'active' && link.workspaceId === row.workspaceId
      ? link.memberId
      : undefined;
  }

  private async localeOf(memberId: string | undefined): Promise<Locale> {
    if (memberId) {
      const [member] = await this.deps.db
        .select({ locale: members.locale })
        .from(members)
        .where(eq(members.id, memberId));
      if (member?.locale && isLocale(member.locale)) return member.locale;
    }
    return this.defaultLocale();
  }

  private async defaultLocale(): Promise<Locale> {
    const instance = await getInstance(this.deps.db);
    return instance && isLocale(instance.defaultLocale) ? instance.defaultLocale : 'en';
  }

  private text(locale: Locale, key: EmailMessageKey, values: Record<string, string>): string {
    return formatEmailMessage(locale, key, values);
  }

  private async requireLinkable(): Promise<{ row: Row; secrets: Secrets }> {
    const { row, secrets } = await this.load();
    if (!row?.enabled || !row.clientId || !secrets.clientSecret || !row.workspaceId) {
      throw new DomainError('slack_not_configured');
    }
    return { row, secrets };
  }

  private async botToken(): Promise<string | undefined> {
    const { row, secrets } = await this.load();
    return row?.enabled ? secrets.botToken : undefined;
  }

  /** Settings with a short cache, so a burst of notifications does not re-read them each time. */
  private async load(fresh = false): Promise<{ row: Row | undefined; secrets: Secrets }> {
    const at = this.now().getTime();
    if (!fresh && this.cache && at - this.cache.at < 15_000) return this.cache;
    const [row] = await this.deps.db.select().from(slackApp).where(eq(slackApp.id, 1));
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

function option(entry: { value: string; label: string }) {
  return { text: { type: 'plain_text', text: entry.label.slice(0, 75) }, value: entry.value };
}

function openButton(locale: Locale, url: string) {
  return {
    type: 'actions',
    elements: [
      {
        type: 'button',
        text: { type: 'plain_text', text: formatEmailMessage(locale, 'slackOpen', {}) },
        url,
      },
    ],
  };
}

function cardBlocks(url: string, identifier: string, title: string, context: string[]) {
  return {
    blocks: [
      {
        type: 'section',
        text: {
          type: 'mrkdwn',
          text: `*<${url}|${escapeSlack(identifier)}>* ${escapeSlack(title)}`,
        },
      },
      ...(context.length
        ? [
            {
              type: 'context',
              elements: [{ type: 'mrkdwn', text: escapeSlack(context.join(' · ')) }],
            },
          ]
        : []),
    ],
  };
}

function safeJson(value: unknown): unknown {
  try {
    return typeof value === 'string' ? JSON.parse(value) : {};
  } catch {
    return {};
  }
}
