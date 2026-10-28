import { afterEach, describe, expect, it, vi } from 'vitest';
import { copyText } from './clipboard.js';

const setClipboard = (value: unknown) =>
  Object.defineProperty(navigator, 'clipboard', { value, configurable: true });

afterEach(() => setClipboard(undefined));

describe('copyText', () => {
  it('uses the Clipboard API when it is allowed', async () => {
    const writeText = vi.fn().mockResolvedValue(undefined);
    setClipboard({ writeText });
    expect(await copyText('HELP-7')).toBe(true);
    expect(writeText).toHaveBeenCalledWith('HELP-7');
  });

  it('falls back to the copy command on insecure origins and cleans up', async () => {
    setClipboard(undefined);
    let copied = '';
    document.execCommand = vi.fn(() => {
      copied = document.querySelector('textarea')?.value ?? '';
      return true;
    });
    expect(await copyText('http://ordler.local/issue/HELP-7')).toBe(true);
    expect(copied).toBe('http://ordler.local/issue/HELP-7');
    expect(document.querySelector('textarea')).toBeNull();
  });

  it('reports failure when both ways are blocked', async () => {
    setClipboard({ writeText: vi.fn().mockRejectedValue(new Error('denied')) });
    document.execCommand = vi.fn(() => {
      throw new Error('not supported');
    });
    expect(await copyText('x')).toBe(false);
  });
});
