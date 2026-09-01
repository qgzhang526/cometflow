export interface AcceptanceItem {
  id: string;
  text: string;
}

export interface SpecAnchor {
  id: string;
  heading: string;
  line: number;
  source: string;
  acceptance: AcceptanceItem[];
}

export interface ParsedSpec {
  path: string;
  anchors: SpecAnchor[];
  acceptance: AcceptanceItem[];
}

export interface SpecValidationFinding {
  path: string;
  severity: 'error' | 'warning';
  code: string;
  message: string;
}

export interface SpecValidationResult {
  valid: boolean;
  findings: SpecValidationFinding[];
}
