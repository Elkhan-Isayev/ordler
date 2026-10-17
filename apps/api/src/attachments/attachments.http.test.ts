import type { AdminRole, AttachmentView, InviteResponse } from '@ordler/shared';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { SESSION_COOKIE } from '../auth/sessions.js';
import { cookieFrom, createTestApp, type TestApp } from '../test/app.js';
import { OWNER } from '../test/fixtures.js';
import { contentDisposition } from './attachments.controller.js';
import { safeFilename, sniffImage } from './attachment.service.js';

const PNG = Buffer.concat([
  Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
  Buffer.from('rest-of-a-png'),
]);

let t: TestApp;
let owner: string;
let helpdeskId: string;

/** A multipart/form-data body with one file field, as a browser sends it. */
function multipart(filename: string, type: string, data: Buffer) {
  const boundary = '----ordler-test';
  const payload = Buffer.concat([
    Buffer.from(
      `--${boundary}\r\nContent-Disposition: form-data; name="file"; filename="${filename}"\r\nContent-Type: ${type}\r\n\r\n`,
    ),
    data,
    Buffer.from(`\r\n--${boundary}--\r\n`),
  ]);
  return { payload, headers: { 'content-type': `multipart/form-data; boundary=${boundary}` } };
}

async function upload(cookie: string, filename: string, type: string, data: Buffer, team = 'HELP') {
  const body = multipart(filename, type, data);
  return t.app.inject({
    method: 'POST',
    url: `/api/teams/${team}/attachments`,
    headers: { ...body.headers, cookie },
    payload: body.payload,
  });
}

async function person(email: string, role?: { key: string; teamId: string }) {
  const roles = (await t.app.inject({ url: '/api/admin/roles', headers: { cookie: owner } })).json<
    AdminRole[]
  >();
  const invite = (
    await t.app.inject({
      method: 'POST',
      url: '/api/admin/members',
      headers: { cookie: owner },
      payload: {
        email,
        name: 'Person',
        ...(role
          ? {
              role: {
                roleId: roles.find((r) => r.key === role.key)!.id,
                scope: { type: 'team', id: role.teamId },
              },
            }
          : {}),
      },
    })
  ).json<InviteResponse>();
  const accepted = await t.app.inject({
    method: 'POST',
    url: '/api/invites/accept',
    payload: {
      token: invite.inviteUrl.split('/invite/')[1]!,
      name: 'Person',
      password: 'person-password-1',
    },
  });
  return cookieFrom(accepted.headers['set-cookie'], SESSION_COOKIE);
}

beforeEach(async () => {
  t = await createTestApp({ attachmentMaxBytes: 1024 });
  const setup = await t.app.inject({
    method: 'POST',
    url: '/api/setup',
    payload: { companyName: 'Push30', defaultLocale: 'en', owner: OWNER },
  });
  owner = cookieFrom(setup.headers['set-cookie'], SESSION_COOKIE);
  const dept = (
    await t.app.inject({
      method: 'POST',
      url: '/api/admin/departments',
      headers: { cookie: owner },
      payload: { name: 'IT' },
    })
  ).json<{ id: string }>();
  helpdeskId = (
    await t.app.inject({
      method: 'POST',
      url: `/api/admin/departments/${dept.id}/teams`,
      headers: { cookie: owner },
      payload: { name: 'Helpdesk', key: 'HELP' },
    })
  ).json<{ id: string }>().id;
});
afterEach(() => t.close());

describe('attachments', () => {
  it('stores an image in PostgreSQL and serves it inline with caching', async () => {
    const uploaded = await upload(owner, 'Скриншот ошибки.png', 'image/png', PNG);
    expect(uploaded.statusCode).toBe(201);
    const view = uploaded.json<AttachmentView>();
    expect(view).toMatchObject({
      filename: 'Скриншот ошибки.png',
      contentType: 'image/png',
      isImage: true,
      size: PNG.length,
    });
    expect(view.url).toBe(
      `/api/attachments/${view.id}/${encodeURIComponent('Скриншот ошибки.png')}`,
    );

    const file = await t.app.inject({ url: view.url, headers: { cookie: owner } });
    expect(file.statusCode).toBe(200);
    expect(file.rawPayload.equals(PNG)).toBe(true);
    expect(file.headers).toMatchObject({
      'content-type': 'image/png',
      'x-content-type-options': 'nosniff',
      'content-security-policy': "default-src 'none'; sandbox",
    });
    expect(String(file.headers['content-disposition'])).toMatch(/^inline;/);

    const cached = await t.app.inject({
      url: view.url,
      headers: { cookie: owner, 'if-none-match': String(file.headers.etag) },
    });
    expect(cached.statusCode).toBe(304);
  });

  it('never serves disguised or scriptable files inline', async () => {
    const html = (
      await upload(owner, 'x.png', 'image/png', Buffer.from('<script>alert(1)</script>'))
    ).json<AttachmentView>();
    expect(html.isImage).toBe(false);
    const svg = (
      await upload(owner, 'logo.svg', 'image/svg+xml', Buffer.from('<svg onload="alert(1)"/>'))
    ).json<AttachmentView>();
    expect(svg.isImage).toBe(false);
    for (const view of [html, svg]) {
      const file = await t.app.inject({ url: view.url, headers: { cookie: owner } });
      expect(String(file.headers['content-disposition'])).toMatch(/^attachment;/);
      expect(file.headers['content-security-policy']).toBe("default-src 'none'; sandbox");
    }
  });

  it('enforces the size limit', async () => {
    const result = await upload(
      owner,
      'big.bin',
      'application/octet-stream',
      Buffer.alloc(2048, 1),
    );
    expect(result.statusCode).toBe(413);
    expect(result.json()).toEqual({ error: 'file_too_large' });
  });

  it('rejects requests without a file', async () => {
    const result = await t.app.inject({
      method: 'POST',
      url: '/api/teams/HELP/attachments',
      headers: { cookie: owner, 'content-type': 'application/json' },
      payload: {},
    });
    expect(result.json()).toEqual({ error: 'file_missing' });
  });

  it('lets viewers download but not upload', async () => {
    const view = (await upload(owner, 'a.png', 'image/png', PNG)).json<AttachmentView>();
    const viewer = await person('vic@push30.test', { key: 'viewer', teamId: helpdeskId });
    expect((await t.app.inject({ url: view.url, headers: { cookie: viewer } })).statusCode).toBe(
      200,
    );
    expect((await upload(viewer, 'b.png', 'image/png', PNG)).json()).toEqual({
      error: 'forbidden',
    });
  });

  it('hides files of teams the member cannot read', async () => {
    const view = (await upload(owner, 'a.png', 'image/png', PNG)).json<AttachmentView>();
    const stranger = await person('sam@push30.test');
    expect((await t.app.inject({ url: view.url, headers: { cookie: stranger } })).statusCode).toBe(
      404,
    );
    expect((await upload(stranger, 'b.png', 'image/png', PNG)).statusCode).toBe(404);
    expect(
      (await t.app.inject({ url: '/api/attachments/not-an-id/x', headers: { cookie: owner } }))
        .statusCode,
    ).toBe(404);
  });

  it('requires a session', async () => {
    const view = (await upload(owner, 'a.png', 'image/png', PNG)).json<AttachmentView>();
    expect((await t.app.inject({ url: view.url })).statusCode).toBe(401);
  });
});

describe('helpers', () => {
  it('recognises images by their bytes', () => {
    expect(sniffImage(PNG)).toBe('image/png');
    expect(sniffImage(Buffer.from([0xff, 0xd8, 0xff, 0xe0]))).toBe('image/jpeg');
    expect(sniffImage(Buffer.from('GIF89a'))).toBe('image/gif');
    expect(sniffImage(Buffer.from('<svg/>'))).toBeUndefined();
  });

  it('cleans file names', () => {
    expect(safeFilename('../../etc/passwd')).toBe('passwd');
    expect(safeFilename('C:\\Users\\a\\report "final".pdf')).toBe('report final.pdf');
    expect(safeFilename('\u0000')).toBe('file');
  });

  it('keeps non-ASCII names in Content-Disposition', () => {
    expect(contentDisposition('attachment', 'Отчёт.pdf')).toBe(
      `attachment; filename="_____.pdf"; filename*=UTF-8''${encodeURIComponent('Отчёт.pdf')}`,
    );
  });
});
