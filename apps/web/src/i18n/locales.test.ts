import { parse, TYPE, type MessageFormatElement } from '@formatjs/icu-messageformat-parser';
import { SUPPORTED_LOCALES } from '@ordler/shared';
import { describe, expect, it } from 'vitest';
import { createI18n, resources } from './index.js';

type Tree = { [key: string]: string | Tree };

function flatten(tree: Tree, prefix = ''): Map<string, string> {
  const result = new Map<string, string>();
  for (const [key, value] of Object.entries(tree)) {
    const path = prefix ? `${prefix}.${key}` : key;
    if (typeof value === 'string') result.set(path, value);
    else for (const [k, v] of flatten(value, path)) result.set(k, v);
  }
  return result;
}

function pluralOptions(elements: MessageFormatElement[]): string[][] {
  return elements.flatMap((element) =>
    element.type === TYPE.plural ? [Object.keys(element.options)] : [],
  );
}

const source = flatten(resources.en.translation as Tree);

describe.each(SUPPORTED_LOCALES)('locale %s', (locale) => {
  const messages = flatten(resources[locale].translation as Tree);

  it('has exactly the keys of the English source', () => {
    expect([...messages.keys()].sort()).toEqual([...source.keys()].sort());
  });

  it('has no empty messages', () => {
    for (const [key, message] of messages) expect(message.trim(), key).not.toBe('');
  });

  it('parses as ICU and covers every plural category of the language', () => {
    const categories = new Intl.PluralRules(locale).resolvedOptions().pluralCategories;
    for (const [key, message] of messages) {
      const ast = parse(message);
      for (const options of pluralOptions(ast)) {
        for (const category of categories)
          expect(options, `${key}: ${category}`).toContain(category);
      }
    }
  });
});

describe('createI18n', () => {
  it('formats Russian plurals', async () => {
    const i18n = await createI18n('ru');
    expect(i18n.t('nav.pendingApprovals', { count: 1 })).toBe('1 согласование ожидает');
    expect(i18n.t('nav.pendingApprovals', { count: 3 })).toBe('3 согласования ожидают');
    expect(i18n.t('nav.pendingApprovals', { count: 5 })).toBe('5 согласований ожидают');
  });

  it('formats German and Azerbaijani messages', async () => {
    expect((await createI18n('de')).t('nav.pendingApprovals', { count: 2 })).toBe(
      '2 Freigaben warten',
    );
    expect((await createI18n('az')).t('nav.inbox')).toBe('Gələnlər');
  });
});
