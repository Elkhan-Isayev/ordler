import type { Plugin } from 'vite';

/**
 * Keeps elkjs (EPL-2.0, not compatible with the AGPL) out of the build. Mermaid registers ELK
 * as an optional layout; without the registration it lays out `layout: elk` diagrams with its
 * default engine (dagre), so every diagram still renders.
 */
export const ELK_REGISTRATION = '...elkLayoutLoaders()';

/** Drops Mermaid's ELK layout registration from one module; null when the module has none. */
export function withoutElk(code: string): string | null {
  return code.includes(ELK_REGISTRATION) ? code.split(ELK_REGISTRATION).join('') : null;
}

/** True when an output chunk still carries elkjs, whose generated code names its Java packages. */
export function containsElk(code: string): boolean {
  return code.includes('org.eclipse.elk');
}

export function noElk(): Plugin {
  let removed = false;
  return {
    name: 'ordler-no-elk',
    apply: 'build',
    transform(code, id) {
      if (!id.includes('/mermaid/')) return null;
      const result = withoutElk(code);
      if (result === null) return null;
      removed = true;
      return { code: result, map: null };
    },
    generateBundle(_options, bundle) {
      // Fails loudly when a Mermaid upgrade changes how ELK is wired in.
      if (!removed) this.error('Mermaid ELK registration not found; update src/vite/no-elk.ts');
      for (const output of Object.values(bundle)) {
        if (output.type === 'chunk' && containsElk(output.code)) {
          this.error(`elkjs (EPL-2.0) ended up in ${output.fileName}`);
        }
      }
    },
  };
}
