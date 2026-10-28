import type { Locale } from '@ordler/shared';
import { IntlMessageFormat } from 'intl-messageformat';
import type { Db } from '../db/client.js';
import { getInstance } from '../setup/setup.service.js';

/** Preview copy per locale (ICU MessageFormat); every locale must define every key. */
export const PREVIEW_MESSAGES = {
  en: {
    description:
      '{kind, select, issue {Sign in to {company} on Ordler to see this issue.} request {Sign in to {company} on Ordler to see this request.} other {Tasks and requests of {company} on Ordler.}}',
  },
  ru: {
    description:
      '{kind, select, issue {Войдите в {company} в Ordler, чтобы увидеть задачу.} request {Войдите в {company} в Ordler, чтобы увидеть запрос.} other {Задачи и запросы {company} в Ordler.}}',
  },
  de: {
    description:
      '{kind, select, issue {Melden Sie sich bei {company} in Ordler an, um dieses Issue zu sehen.} request {Melden Sie sich bei {company} in Ordler an, um diese Anfrage zu sehen.} other {Aufgaben und Anfragen von {company} in Ordler.}}',
  },
  az: {
    description:
      '{kind, select, issue {Bu tapşırığı görmək üçün Ordler-də {company} hesabına daxil olun.} request {Bu sorğunu görmək üçün Ordler-də {company} hesabına daxil olun.} other {Ordler-də {company} tapşırıqları və sorğuları.}}',
  },
} satisfies Record<Locale, { description: string }>;

export interface PreviewSite {
  companyName: string;
  locale: Locale;
}

export interface LinkPreview {
  title: string;
  description: string;
  url: string;
  image: string;
}

const ITEM_PATHS: Array<{ pattern: RegExp; kind: 'issue' | 'request' }> = [
  { pattern: /^\/issue\/([A-Za-z0-9]+-\d+)\/?$/, kind: 'issue' },
  { pattern: /^\/requests\/(REQ-\d+)\/?$/i, kind: 'request' },
  { pattern: /^\/request-groups\/(REQ-G-\d+)\/?$/i, kind: 'request' },
];

/**
 * Builds the card messengers show for a pasted link. Crawlers are anonymous, so it carries only
 * what the URL already reveals (the identifier) plus the company name — never titles or status,
 * and no lookup, so it does not even confirm that the item exists.
 */
export function linkPreview(rawUrl: string, site: PreviewSite, baseUrl: string): LinkPreview {
  const path = rawUrl.split(/[?#]/, 1)[0]!;
  const base = baseUrl.replace(/\/+$/, '');
  for (const { pattern, kind } of ITEM_PATHS) {
    const match = pattern.exec(path);
    if (!match) continue;
    const identifier = match[1]!.toUpperCase();
    return {
      title: `${identifier} · ${site.companyName}`,
      description: describe(site, kind),
      url: `${base}${path}`,
      image: `${base}/icon-512.png`,
    };
  }
  return {
    title: site.companyName,
    description: describe(site, 'other'),
    url: `${base}${path}`,
    image: `${base}/icon-512.png`,
  };
}

function describe(site: PreviewSite, kind: string): string {
  return new IntlMessageFormat(PREVIEW_MESSAGES[site.locale].description, site.locale).format({
    kind,
    company: site.companyName,
  }) as string;
}

/** Adds Open Graph and Twitter card tags to the app shell, just before </head>. */
export function injectPreview(indexHtml: string, preview: LinkPreview): string {
  const tags = [
    ['property', 'og:type', 'website'],
    ['property', 'og:site_name', 'Ordler'],
    ['property', 'og:title', preview.title],
    ['property', 'og:description', preview.description],
    ['property', 'og:url', preview.url],
    ['property', 'og:image', preview.image],
    ['name', 'twitter:card', 'summary'],
    ['name', 'twitter:title', preview.title],
    ['name', 'twitter:description', preview.description],
    ['name', 'description', preview.description],
  ]
    .map(([attr, key, value]) => `<meta ${attr}="${key}" content="${escapeHtml(value!)}" />`)
    .join('\n    ');
  return indexHtml.replace('</head>', `  ${tags}\n  </head>`);
}

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/"/g, '&quot;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}

/** Reads the company name and locale at most once a minute; page loads must not hit the DB. */
export function cachedSite(
  db: Db,
  now: () => number = Date.now,
  ttlMs = 60_000,
): () => Promise<PreviewSite | undefined> {
  let cached: { site: PreviewSite | undefined; at: number } | undefined;
  return async () => {
    if (cached && now() - cached.at < ttlMs) return cached.site;
    const instance = await getInstance(db);
    const site = instance
      ? { companyName: instance.companyName, locale: instance.defaultLocale }
      : undefined;
    cached = { site, at: now() };
    return site;
  };
}
