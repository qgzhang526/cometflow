export interface AcceptanceItem {
  id: string;
  text: string;
  /**
   * 可执行验收命令（spec 里写成缩进的 `- check: <command>`）。
   * null 表示该项无法自动判定，需要独立 Verifier 或人工给出结论。
   */
  check: string | null;
}

export interface SpecAnchor {
  id: string;
  heading: string;
  level: number;
  line: number;
  source: string;
  /** 该 anchor 覆盖段落（含子标题，直到同级或更高级标题）的内容哈希。 */
  hash: string;
  acceptance: AcceptanceItem[];
}

export interface ParsedSpec {
  path: string;
  /** 整份 spec 文件的内容哈希（行尾归一化后）。 */
  hash: string;
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
