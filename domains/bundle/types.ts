export interface BundleSkillRef {
  name: string;
  path: string;
}

export interface BundleManifest {
  schema: 'cometflow.bundle.v1';
  name: string;
  version: string;
  skills: BundleSkillRef[];
}

export interface CompiledBundle {
  schema: 'cometflow.compiled-bundle.v1';
  name: string;
  version: string;
  skills: BundleSkillRef[];
  files: string[];
}
