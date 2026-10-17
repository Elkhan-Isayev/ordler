/** Response of POST /api/teams/:key/attachments; `url` is what Markdown links point to. */
export interface AttachmentView {
  id: string;
  url: string;
  filename: string;
  contentType: string;
  size: number;
  /** Verified from the file's bytes; only these are shown inline. */
  isImage: boolean;
}

export const ATTACHMENT_ERROR_CODES = ['file_too_large', 'file_missing'] as const;
export type AttachmentErrorCode = (typeof ATTACHMENT_ERROR_CODES)[number];

/** Default upload limit; ATTACHMENT_MAX_MB overrides it. */
export const DEFAULT_ATTACHMENT_MAX_MB = 25;

export function attachmentUrl(id: string, filename: string): string {
  return `/api/attachments/${id}/${encodeURIComponent(filename)}`;
}
