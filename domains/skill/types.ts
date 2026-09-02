export interface SkillDefinition {
  name: string;
  description: string;
  version: string;
  author?: string;
}

export interface SkillPackage {
  root: string;
  definition: SkillDefinition;
  files: string[];
}

export interface SkillRiskWarning {
  path: string;
  line: number;
  category: "network" | "dangerous-command" | "absolute-path";
  text: string;
}

export interface SkillImportResult {
  name: string;
  destination: string;
  warnings: SkillRiskWarning[];
}
