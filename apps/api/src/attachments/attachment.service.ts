import { createHash } from 'node:crypto';
import { attachmentUrl, type AttachmentView } from '@ordler/shared';
import { eq } from 'drizzle-orm';
import { DomainError } from '../auth/errors.js';
import type { Db } from '../db/client.js';
import { attachmentContents, attachments, teams } from '../db/schema.js';
import type { TeamAccess } from '../issues/team-access.js';

export interface UploadedFile {
  filename: string;
  mimetype: string;
  data: Buffer;
}

export interface StoredAttachment {
  filename: string;
  contentType: string;
  isImage: boolean;
  sha256: string;
  data: Buffer;
}

/** Image formats browsers render safely; SVG is excluded because it can carry scripts. */
const IMAGE_SIGNATURES: Array<[string, (b: Buffer) => boolean]> = [
  [
    'image/png',
    (b) => b.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])),
  ],
  ['image/jpeg', (b) => b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff],
  ['image/gif', (b) => b.subarray(0, 6).toString('latin1').startsWith('GIF8')],
  [
    'image/webp',
    (b) =>
      b.subarray(0, 4).toString('latin1') === 'RIFF' &&
      b.subarray(8, 12).toString('latin1') === 'WEBP',
  ],
  ['image/avif', (b) => b.subarray(4, 12).toString('latin1') === 'ftypavif'],
];

/** The image type proven by the file's first bytes, ignoring what the client claimed. */
export function sniffImage(data: Buffer): string | undefined {
  return IMAGE_SIGNATURES.find(([, matches]) => matches(data))?.[0];
}

/** Keeps the visible name, drops paths and control characters. */
export function safeFilename(name: string): string {
  const base = name.split(/[\\/]/).pop() ?? '';
  // Control characters would break Content-Disposition headers.
  // eslint-disable-next-line no-control-regex
  const withoutControls = base.replace(/[\u0000-\u001f\u007f"]/g, '');
  const cleaned = withoutControls.trim().slice(0, 200);
  return cleaned || 'file';
}

const MIME = /^[a-z]+\/[a-z0-9.+-]+$/;

/**
 * Attachments stored in PostgreSQL (ADR 0008). Uploading needs write access to the team's
 * issues; downloading needs read access, the same rule as the issue that shows them.
 */
export class AttachmentService {
  constructor(
    private readonly db: Db,
    private readonly access: TeamAccess,
    readonly maxBytes: number,
  ) {}

  async upload(memberId: string, teamKey: string, file: UploadedFile): Promise<AttachmentView> {
    const [team] = await this.db.select().from(teams).where(eq(teams.key, teamKey.toUpperCase()));
    if (!team || team.archivedAt) throw new DomainError('not_found');
    const can = await this.access.forTeam(memberId, team);
    if (!can.read) throw new DomainError('not_found');
    if (!can.create && !can.update) throw new DomainError('forbidden');
    if (file.data.length === 0) throw new DomainError('file_missing');
    if (file.data.length > this.maxBytes) throw new DomainError('file_too_large');

    const image = sniffImage(file.data);
    const mimetype = file.mimetype.toLowerCase();
    const contentType = image ?? (MIME.test(mimetype) ? mimetype : 'application/octet-stream');
    const filename = safeFilename(file.filename);
    const sha256 = createHash('sha256').update(file.data).digest('hex');

    const id = await this.db.transaction(async (tx) => {
      const [row] = await tx
        .insert(attachments)
        .values({
          teamId: team.id,
          uploadedBy: memberId,
          filename,
          contentType,
          size: file.data.length,
          sha256,
        })
        .returning({ id: attachments.id });
      await tx.insert(attachmentContents).values({ attachmentId: row!.id, data: file.data });
      return row!.id;
    });
    return {
      id,
      url: attachmentUrl(id, filename),
      filename,
      contentType,
      size: file.data.length,
      isImage: Boolean(image),
    };
  }

  async read(memberId: string, id: string): Promise<StoredAttachment> {
    if (!/^[0-9a-f-]{36}$/.test(id)) throw new DomainError('not_found');
    const [row] = await this.db
      .select({ attachment: attachments, team: teams, data: attachmentContents.data })
      .from(attachments)
      .innerJoin(teams, eq(teams.id, attachments.teamId))
      .innerJoin(attachmentContents, eq(attachmentContents.attachmentId, attachments.id))
      .where(eq(attachments.id, id));
    if (!row) throw new DomainError('not_found');
    // Not readable looks like missing, so private teams do not leak through file links.
    if (!(await this.access.forTeam(memberId, row.team)).read) throw new DomainError('not_found');
    return {
      filename: row.attachment.filename,
      contentType: row.attachment.contentType,
      isImage: sniffImage(row.data) !== undefined,
      sha256: row.attachment.sha256,
      data: row.data,
    };
  }
}
