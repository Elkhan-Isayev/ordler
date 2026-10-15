import i18next from 'i18next';
import { describe, expect, it } from 'vitest';
import { createIcuFormat } from './icu-format.js';

async function instance(lng: string, translation: Record<string, string>) {
  const i18n = i18next.createInstance();
  await i18n.use(createIcuFormat()).init({ lng, resources: { [lng]: { translation } } });
  return i18n;
}

describe('createIcuFormat', () => {
  it('formats plurals with the language rules', async () => {
    const i18n = await instance('ru', {
      files: '{n, plural, one {# файл} few {# файла} many {# файлов} other {# файла}}',
    });
    expect(i18n.t('files', { n: 1 })).toBe('1 файл');
    expect(i18n.t('files', { n: 2 })).toBe('2 файла');
    expect(i18n.t('files', { n: 11 })).toBe('11 файлов');
  });

  it('formats select and plain arguments', async () => {
    const i18n = await instance('en', {
      greet: '{gender, select, female {She} male {He} other {They}} invited {name}',
    });
    expect(i18n.t('greet', { gender: 'other', name: 'Ann' })).toBe('They invited Ann');
  });

  it('keeps tag placeholders for Trans components', async () => {
    const i18n = await instance('en', { link: 'Open <0>settings</0>' });
    expect(i18n.t('link')).toBe('Open <0>settings</0>');
  });
});
