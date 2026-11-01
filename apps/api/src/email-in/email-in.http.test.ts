import type {
  InboundEmailView,
  InboxSettingsView,
  InviteResponse,
  RequestTypeView,
  RequestView,
} from '@ordler/shared';
import { eq } from 'drizzle-orm';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { SESSION_COOKIE } from '../auth/sessions.js';
import { attachments, auditLog, requests } from '../db/schema.js';
import { cookieFrom, createTestApp, type TestApp } from '../test/app.js';
import { OWNER } from '../test/fixtures.js';
import type { InboxConfig, MailboxConnector } from './mailbox.js';

let t: TestApp;
let owner: string;
let helpdesk: RequestTypeView;
let inbox: Buffer[];
let read: Set<number>;
let connected: InboxConfig[];
let failConnect: string | undefined;

const ADDRESS = 'it@push30.test';

/** In-memory IMAP mailbox: uid = position + 1. */
const connector: MailboxConnector = async (config) => {
  connected.push(config);
  if (failConnect) throw new Error(failConnect);
  return {
    unread: async (limit) =>
      inbox
        .map((_, index) => index + 1)
        .filter((uid) => !read.has(uid))
        .slice(0, limit),
    read: async (uid) => ({ uid, source: inbox[uid - 1]! }),
    markRead: async (uid) => void read.add(uid),
    close: async () => undefined,
  };
};

function email(options: {
  from?: string;
  to?: string;
  subject?: string;
  body?: string;
  messageId?: string;
  headers?: string[];
  attachment?: { name: string; type: string; data: Buffer };
}): Buffer {
  const boundary = 'b-ordler-test';
  const head = [
    `From: Sender <${options.from ?? OWNER.email}>`,
    `To: Helpdesk <${options.to ?? ADDRESS}>`,
    `Subject: ${options.subject ?? 'Printer on floor 3 is jammed'}`,
    `Message-ID: ${options.messageId ?? `<${Math.random().toString(36).slice(2)}@mail.push30.test>`}`,
    'Date: Sun, 01 Nov 2026 09:00:00 +0000',
    'MIME-Version: 1.0',
    ...(options.headers ?? []),
  ];
  const body = options.body ?? 'It shows error E-42 since this morning.';
  if (!options.attachment) {
    return Buffer.from(
      [...head, 'Content-Type: text/plain; charset=utf-8', '', body, ''].join('\r\n'),
    );
  }
  return Buffer.from(
    [
      ...head,
      `Content-Type: multipart/mixed; boundary="${boundary}"`,
      '',
      `--${boundary}`,
      'Content-Type: text/plain; charset=utf-8',
      '',
      body,
      `--${boundary}`,
      `Content-Type: ${options.attachment.type}; name="${options.attachment.name}"`,
      `Content-Disposition: attachment; filename="${options.attachment.name}"`,
      'Content-Transfer-Encoding: base64',
      '',
      options.attachment.data.toString('base64'),
      `--${boundary}--`,
      '',
    ].join('\r\n'),
  );
}

type Method = 'GET' | 'POST' | 'PUT' | 'PATCH';
function call(method: Method, url: string, cookie?: string, payload?: object) {
  return t.app.inject({
    method,
    url,
    ...(cookie ? { headers: { cookie } } : {}),
    ...(payload ? { payload } : {}),
  });
}

async function plainMember(): Promise<{ cookie: string; email: string }> {
  const invite = (
    await call('POST', '/api/admin/members', owner, { email: 'ann@push30.test', name: 'Ann' })
  ).json<InviteResponse>();
  const accepted = await call('POST', '/api/invites/accept', undefined, {
    token: invite.inviteUrl.split('/invite/')[1]!,
    name: 'Ann',
    password: 'ann-password-123',
  });
  return {
    cookie: cookieFrom(accepted.headers['set-cookie'], SESSION_COOKIE),
    email: 'ann@push30.test',
  };
}

const SETTINGS = {
  enabled: true,
  host: 'imap.push30.test',
  port: 993,
  security: 'tls',
  verifyTls: true,
  username: 'ordler',
  password: 'imap-secret',
  folder: 'INBOX',
};

async function poll() {
  const response = await call('POST', '/api/admin/mail/inbox/poll', owner);
  expect(response.statusCode).toBe(200);
  return response.json();
}

async function log(): Promise<InboundEmailView[]> {
  return (await call('GET', '/api/admin/mail/inbox/messages', owner)).json<InboundEmailView[]>();
}

beforeEach(async () => {
  inbox = [];
  read = new Set();
  connected = [];
  failConnect = undefined;
  t = await createTestApp({ mailboxConnector: connector });
  const setup = await call('POST', '/api/setup', undefined, {
    companyName: 'Push30',
    defaultLocale: 'en',
    owner: OWNER,
  });
  owner = cookieFrom(setup.headers['set-cookie'], SESSION_COOKIE);
  const department = (await call('POST', '/api/admin/departments', owner, { name: 'IT' })).json<{
    id: string;
  }>().id;
  const team = (
    await call('POST', `/api/admin/departments/${department}/teams`, owner, {
      name: 'Helpdesk',
      key: 'HELP',
    })
  ).json<{ id: string }>().id;
  const created = await call('POST', `/api/admin/departments/${department}/request-types`, owner, {
    name: 'IT support',
    targetTeamId: team,
    emailAddress: 'IT@push30.test',
  });
  expect(created.statusCode).toBe(201);
  helpdesk = created.json<RequestTypeView>();
  expect((await call('PUT', '/api/admin/mail/inbox', owner, SETTINGS)).statusCode).toBe(200);
  t.mailer.sent.length = 0;
});
afterEach(() => t.close());

describe('request type email address', () => {
  it('is stored lowercase, unique, and kept when a client leaves it out', async () => {
    expect(helpdesk.emailAddress).toBe(ADDRESS);
    const second = await call(
      'POST',
      `/api/admin/departments/${helpdesk.departmentId}/request-types`,
      owner,
      { name: 'Other', targetTeamId: helpdesk.targetTeam.id, emailAddress: ADDRESS },
    );
    expect(second.statusCode).toBe(409);
    expect(second.json()).toEqual({ error: 'email_address_taken' });

    const renamed = await call('PUT', `/api/admin/request-types/${helpdesk.id}`, owner, {
      name: 'IT help',
      targetTeamId: helpdesk.targetTeam.id,
    });
    expect(renamed.json<RequestTypeView>().emailAddress).toBe(ADDRESS);
    const cleared = await call('PUT', `/api/admin/request-types/${helpdesk.id}`, owner, {
      name: 'IT help',
      targetTeamId: helpdesk.targetTeam.id,
      emailAddress: null,
    });
    expect(cleared.json<RequestTypeView>().emailAddress).toBeNull();
  });
});

describe('email-in', () => {
  it('turns a member email into a request and confirms it in the same thread', async () => {
    inbox.push(
      email({
        messageId: '<m1@mail.push30.test>',
        attachment: {
          name: 'error.png',
          type: 'image/png',
          data: Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 1, 2, 3]),
        },
      }),
    );
    expect(await poll()).toEqual({ ok: true, processed: 1 });
    expect(read.has(1)).toBe(true);
    expect(connected[0]).toMatchObject({ host: 'imap.push30.test', password: 'imap-secret' });

    const [entry] = await log();
    expect(entry).toMatchObject({ status: 'created', from: OWNER.email, to: [ADDRESS] });
    const request = (
      await call('GET', `/api/requests/${entry!.request!.identifier}`, owner)
    ).json<RequestView>();
    expect(request.title).toBe('Printer on floor 3 is jammed');
    expect(request.description).toContain('error E-42');
    expect(request.description).toMatch(/!\[error\.png\]\(\/api\/attachments\/[0-9a-f-]+\//);
    const [stored] = await t.database.db.select().from(attachments);
    expect(stored).toMatchObject({ teamId: helpdesk.targetTeam.id, contentType: 'image/png' });

    expect(t.mailer.sent).toHaveLength(1);
    expect(t.mailer.sent[0]).toMatchObject({
      to: OWNER.email,
      inReplyTo: '<m1@mail.push30.test>',
      headers: { 'Auto-Submitted': 'auto-replied' },
    });
    expect(t.mailer.sent[0]!.text).toContain(`https://ordler.test/requests/${request.identifier}`);
  });

  it('handles each Message-ID once, even when the mailbox shows it again', async () => {
    const message = email({ messageId: '<again@mail.push30.test>' });
    inbox.push(message, message);
    await poll();
    expect(await t.database.db.select().from(requests)).toHaveLength(1);
    expect(await log()).toHaveLength(1);
    expect(read).toEqual(new Set([1, 2]));
  });

  it('ignores strangers, unknown addresses and robots without replying', async () => {
    inbox.push(
      email({ from: 'stranger@elsewhere.test' }),
      email({ to: 'nobody@push30.test' }),
      email({ headers: ['Auto-Submitted: auto-replied'] }),
      email({ from: 'MAILER-DAEMON@push30.test' }),
    );
    await poll();
    expect((await log()).map((e) => e.status).sort()).toEqual([
      'ignored',
      'ignored',
      'no_route',
      'unknown_sender',
    ]);
    expect(await t.database.db.select().from(requests)).toHaveLength(0);
    expect(t.mailer.sent).toHaveLength(0);
  });

  it('routes by a Delivered-To alias when the To header names a list', async () => {
    inbox.push(email({ to: 'all-staff@push30.test', headers: [`Delivered-To: ${ADDRESS}`] }));
    await poll();
    expect((await log())[0]!.status).toBe('created');
  });

  it('declines a type whose form has required fields and points to the portal', async () => {
    await call('PUT', `/api/admin/request-types/${helpdesk.id}`, owner, {
      name: 'IT support',
      targetTeamId: helpdesk.targetTeam.id,
      fields: [{ id: 'asset', label: 'Asset tag', type: 'text', required: true }],
    });
    inbox.push(email({}));
    await poll();
    expect((await log())[0]).toMatchObject({ status: 'rejected', reason: 'form_invalid' });
    expect(await t.database.db.select().from(requests)).toHaveLength(0);
    expect(t.mailer.sent[0]!.text).toContain(`https://ordler.test/portals/new/${helpdesk.id}`);
  });

  it('declines a member who may not submit requests', async () => {
    const ann = await plainMember();
    inbox.push(email({ from: ann.email }));
    await poll();
    expect((await log())[0]).toMatchObject({ status: 'rejected', reason: 'forbidden' });
  });

  it('does not act for a deactivated member', async () => {
    const ann = await plainMember();
    const [member] = (await call('GET', '/api/admin/members', owner))
      .json<Array<{ id: string; email: string }>>()
      .filter((m) => m.email === ann.email);
    await call('PATCH', `/api/admin/members/${member!.id}`, owner, { status: 'deactivated' });
    inbox.push(email({ from: ann.email }));
    await poll();
    expect((await log())[0]!.status).toBe('unknown_sender');
  });

  it('reports a connection error and keeps it for the admin panel', async () => {
    failConnect = 'Invalid credentials (Failure)';
    expect(await poll()).toEqual({ ok: false, error: 'Invalid credentials (Failure)' });
    const view = (await call('GET', '/api/admin/mail/inbox', owner)).json<InboxSettingsView>();
    expect(view.lastError).toBe('Invalid credentials (Failure)');
    expect(view.lastPollAt).not.toBeNull();
  });
});

describe('Admin → Incoming mail', () => {
  it('never returns the password and audits changes', async () => {
    const response = await call('GET', '/api/admin/mail/inbox', owner);
    expect(response.body).not.toContain('imap-secret');
    expect(response.json<InboxSettingsView>()).toMatchObject({
      configured: true,
      enabled: true,
      passwordSet: true,
    });
    const rows = await t.database.db
      .select()
      .from(auditLog)
      .where(eq(auditLog.action, 'inbox_settings.updated'));
    expect(JSON.stringify(rows)).not.toContain('imap-secret');

    // Leaving the password out keeps it.
    const withoutPassword: Partial<typeof SETTINGS> = { ...SETTINGS, folder: 'Requests' };
    delete withoutPassword.password;
    await call('PUT', '/api/admin/mail/inbox', owner, withoutPassword);
    inbox.push(email({}));
    await poll();
    expect(connected.at(-1)).toMatchObject({ password: 'imap-secret', folder: 'Requests' });
  });

  it('denies members without mail.manage', async () => {
    const ann = await plainMember();
    for (const [method, url] of [
      ['GET', '/api/admin/mail/inbox'],
      ['PUT', '/api/admin/mail/inbox'],
      ['GET', '/api/admin/mail/inbox/messages'],
      ['POST', '/api/admin/mail/inbox/poll'],
    ] as const) {
      expect((await call(method, url, ann.cookie, SETTINGS)).statusCode, url).toBe(403);
    }
  });
});
