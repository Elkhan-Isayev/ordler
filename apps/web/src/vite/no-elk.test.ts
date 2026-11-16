import { describe, expect, it } from 'vitest';
import { containsElk, ELK_REGISTRATION, withoutElk } from './no-elk.js';

describe('no-elk build plugin', () => {
  it('drops the ELK layout registration and keeps the default layouts', () => {
    const code = `registerLayoutLoaders([{ name: "dagre" }, ...true ? [{ name: "cose" }, ${ELK_REGISTRATION}] : []]);`;
    const result = withoutElk(code)!;
    expect(result).not.toContain('elkLayoutLoaders');
    expect(result).toContain('name: "dagre"');
    expect(result).toContain('name: "cose"');
  });

  it('leaves modules without the registration alone', () => {
    expect(withoutElk('export const x = 1;')).toBeNull();
  });

  it('recognizes elkjs code in an output chunk', () => {
    expect(containsElk('var a = "org.eclipse.elk.layered";')).toBe(true);
    expect(containsElk('var a = "dagre";')).toBe(false);
  });
});
