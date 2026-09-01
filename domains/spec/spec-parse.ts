import path from 'node:path';
import { readTextFile } from '../../platform/fs/read-file.js';
import { toPosix } from '../../platform/paths/relative.js';
import type { AcceptanceItem, ParsedSpec, SpecAnchor } from './types.js';

const ACCEPTANCE_HEADING = /^(##|###)\s+(acceptance|验收)\s*$/iu;
const HEADING = /^(##|###)\s+(.+?)\s*$/u;
const ACCEPTANCE_ITEM = /^\s*-\s+(A\d+)[：:]?\s*(.*)$/u;

function normalizeHeading(heading: string): string {
  return heading.trim();
}

export function parseSpecContent(content: string, source: string): ParsedSpec {
  const lines = content.split(/\r?\n/u);
  const anchors: SpecAnchor[] = [];
  const fileAcceptance: AcceptanceItem[] = [];
  let inAcceptance = false;
  let currentAnchor: SpecAnchor | null = null;

  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index];
    const trimmed = line.trim();

    if (ACCEPTANCE_HEADING.test(trimmed)) {
      inAcceptance = true;
      continue;
    }

    const headingMatch = HEADING.exec(trimmed);
    if (headingMatch) {
      inAcceptance = false;
      currentAnchor = {
        id: source + '#' + normalizeHeading(headingMatch[2]),
        heading: normalizeHeading(headingMatch[2]),
        line: index + 1,
        source,
        acceptance: [],
      };
      anchors.push(currentAnchor);
      continue;
    }

    if (inAcceptance) {
      const itemMatch = ACCEPTANCE_ITEM.exec(line);
      if (itemMatch) {
        const item: AcceptanceItem = { id: itemMatch[1], text: itemMatch[2].trim() };
        fileAcceptance.push(item);
        if (currentAnchor) currentAnchor.acceptance.push(item);
      }
    }
  }

  return { path: source, anchors, acceptance: fileAcceptance };
}

export async function parseSpecFile(projectRoot: string, relativePath: string): Promise<ParsedSpec> {
  const source = toPosix(relativePath);
  const content = await readTextFile(path.join(projectRoot, relativePath));
  return parseSpecContent(content, source);
}
