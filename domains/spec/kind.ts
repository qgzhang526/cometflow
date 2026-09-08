export type SpecKind =
  | 'project'
  | 'models'
  | 'protocol'
  | 'errors'
  | 'config'
  | 'capability'
  | 'flow'
  | 'process'
  | 'rules'
  | 'constraints'
  | 'permissions'
  | 'pages';

export const SPEC_KINDS: readonly SpecKind[] = [
  'project',
  'models',
  'protocol',
  'errors',
  'config',
  'capability',
  'flow',
  'process',
  'rules',
  'constraints',
  'permissions',
  'pages',
];

// Root-level spec kinds that map to a single file under specs/.
export const ROOT_KIND_FILES: Partial<Record<SpecKind, string>> = {
  models: 'specs/models.md',
  protocol: 'specs/protocol.md',
  errors: 'specs/errors.md',
  config: 'specs/config.md',
  constraints: 'specs/constraints.md',
  permissions: 'specs/permissions.md',
  rules: 'specs/rules.md',
  process: 'specs/processes.md',
  pages: 'specs/pages.md',
};

export function kindForSpecFile(relativePath: string): SpecKind {
  const p = relativePath.replace(/\\/g, '/');
  if (p === 'COMETFLOW.md') return 'project';

  for (const [kind, file] of Object.entries(ROOT_KIND_FILES) as [SpecKind, string][]) {
    if (file === p) return kind;
  }

  if (p.startsWith('specs/flows/') && p.endsWith('.md')) return 'flow';
  if (/^specs\/[^/]+\/spec\.md$/.test(p)) return 'capability';

  // Unknown specs are validated as capability specs (anchor + acceptance contract).
  return 'capability';
}
