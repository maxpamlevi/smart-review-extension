/**
 * Full diff parser + accurate mapping from diff "new file line"
 * to RIGHT editor zero‑based index.
 *
 * This implementation supports multiple hunks and correct handling of:
 *  - context lines
 *  - added lines (+)
 *  - removed lines (-)
 */

export interface DiffHunk {
  oldStart: number;
  oldCount: number;
  newStart: number;
  newCount: number;
  lines: string[];
}

/**
 * Parse a unified diff string into structured hunks
 */
export function parseDiff(diff: string): DiffHunk[] {
  const lines = diff.split("\n");
  const hunks: DiffHunk[] = [];

  let current: DiffHunk | null = null;

  for (const line of lines) {
    const m = line.match(/^@@ -(\d+),?(\d+)? \+(\d+),?(\d+)? @@/);
    if (m) {
      if (current) hunks.push(current);

      const oldStart = parseInt(m[1], 10);
      const oldCount = parseInt(m[2] || "1", 10);
      const newStart = parseInt(m[3], 10);
      const newCount = parseInt(m[4] || "1", 10);

      current = {
        oldStart,
        oldCount,
        newStart,
        newCount,
        lines: [],
      };
      continue;
    }

    if (current) {
      current.lines.push(line);
    }
  }

  if (current) hunks.push(current);
  return hunks;
}

/**
 * Map a "new file line number" (1-based, from diff)
 * to RIGHT editor's zero-based index.
 *
 * Example:
 *   AI returns line = 42 → we need to find what actual
 *   zero-based line in the editor corresponds to that.
 */
export function mapRightLine(diff: string, targetRightLine: number): number {
  const hunks = parseDiff(diff);

  for (const hunk of hunks) {
    const newStart = hunk.newStart;
    const newEnd = hunk.newStart + hunk.newCount - 1;

    // Not inside this hunk → skip
    if (targetRightLine < newStart || targetRightLine > newEnd) {
      continue;
    }

    // Walk hunk lines
    let rightLine = newStart; // 1-based tracking

    for (const line of hunk.lines) {
      const first = line[0];

      if (first === "+" || first === " ") {
        if (rightLine === targetRightLine) {
          return rightLine - 1; // convert to 0-based
        }
        rightLine++;
      } else if (first === "-") {
        // removed line → does NOT increase rightLine
        continue;
      }
    }

    // If not found inside hunk (rare fallback)
    return targetRightLine - 1;
  }

  // Outside all hunks → assume unchanged
  return targetRightLine - 1;
}