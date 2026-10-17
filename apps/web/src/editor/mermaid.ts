/** Example inserted by the "Diagram" button; Mermaid syntax, editable as text. */
export const DIAGRAM_TEMPLATE = `flowchart LR
  request[Request] --> approval{Approved?}
  approval -->|yes| work[In progress]
  approval -->|no| rejected[Rejected]`;

let counter = 0;
let ready: Promise<typeof import('mermaid').default> | undefined;

/** Mermaid is large, so it loads only when a diagram is first shown. */
function load() {
  ready ??= import('mermaid').then(({ default: mermaid }) => {
    const dark = window.matchMedia?.('(prefers-color-scheme: dark)').matches ?? false;
    // strict: labels are sanitised and click handlers or scripts in diagrams are disabled.
    mermaid.initialize({
      startOnLoad: false,
      securityLevel: 'strict',
      theme: dark ? 'dark' : 'neutral',
    });
    return mermaid;
  });
  return ready;
}

export type DiagramResult = { svg: string } | { error: string };

/** Renders Mermaid source to SVG markup, or explains why it could not. */
export async function renderDiagram(source: string): Promise<DiagramResult> {
  const mermaid = await load();
  counter += 1;
  try {
    const { svg } = await mermaid.render(`ordler-diagram-${counter}`, source);
    return { svg };
  } catch (error) {
    return { error: error instanceof Error ? error.message : String(error) };
  }
}
