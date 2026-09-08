export interface EntityDef {
  name: string;
  line: number;
}

export interface ProcessDef {
  name: string;
  line: number;
}

export interface ApiReference {
  method: string;
  path: string;
  refFile: string | null;
}

export interface FlowStep {
  step: string;
  apiRefs: ApiReference[];
}

export function extractEntities(content: string): EntityDef[] {
  const out: EntityDef[] = [];
  content.split(/\r?\n/u).forEach((line, index) => {
    const match = /^##\s+实体[:：]\s*(.+?)\s*$/u.exec(line.trim());
    if (match) out.push({ name: match[1], line: index + 1 });
  });
  return out;
}

export function extractProcesses(content: string): ProcessDef[] {
  const out: ProcessDef[] = [];
  content.split(/\r?\n/u).forEach((line, index) => {
    const match = /^##\s+进程[:：]\s*(.+?)\s*$/u.exec(line.trim());
    if (match) out.push({ name: match[1], line: index + 1 });
  });
  return out;
}

export function extractHeadings(content: string, level: 2 | 3 = 2): string[] {
  const pattern = level === 2 ? /^##\s+(.+?)\s*$/u : /^###\s+(.+?)\s*$/u;
  return content
    .split(/\r?\n/u)
    .map((line) => {
      const match = pattern.exec(line.trim());
      return match ? match[1] : null;
    })
    .filter((heading): heading is string => heading !== null);
}

export function extractApiReferencesFromLine(line: string): ApiReference[] {
  const refs: ApiReference[] = [];
  const callPattern = /调用\s*`?([A-Z]{3,8})\s+([^\s`]+)`?/gu;
  let match: RegExpExecArray | null;
  while ((match = callPattern.exec(line)) !== null) {
    const refMatch = /参考\s*([^\s）]+)/u.exec(line);
    refs.push({
      method: match[1].toUpperCase(),
      path: match[2],
      refFile: refMatch ? refMatch[1] : null,
    });
  }
  return refs;
}

export function extractFlowSteps(content: string): FlowStep[] {
  const lines = content.split(/\r?\n/u);
  const steps: FlowStep[] = [];
  let current: FlowStep | null = null;
  for (const line of lines) {
    const stepMatch = /^###\s+(步骤[^\s：:]*)/u.exec(line.trim());
    if (stepMatch) {
      current = { step: stepMatch[1], apiRefs: [] };
      steps.push(current);
      continue;
    }
    if (current) {
      current.apiRefs.push(...extractApiReferencesFromLine(line));
    }
  }
  return steps;
}

export function normalizeApiHeading(heading: string): string {
  const parts = heading.trim().split(/\s+/u);
  if (parts.length >= 2) return parts[0].toUpperCase() + ' ' + parts.slice(1).join(' ');
  return heading.trim();
}
