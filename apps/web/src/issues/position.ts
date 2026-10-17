/**
 * A sortOrder strictly between two neighbours (either may be missing), so moving one card
 * never renumbers the others.
 */
export function positionBetween(before: number | undefined, after: number | undefined): number {
  if (before === undefined && after === undefined) return 0;
  if (before === undefined) return after! - 1;
  if (after === undefined) return before + 1;
  return (before + after) / 2;
}
