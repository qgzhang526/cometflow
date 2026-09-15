/**
 * 凭证脱敏。
 *
 * 分两档是刻意的：
 * - 默认档只处理「几乎不可能是正常文本」的高置信凭证形态（API key、PAT、JWT、URL 口令）；
 *   它可以用在 Builder/Verifier 提示词上，不会把 spec 里的 `password: string` 这类
 *   契约示例误伤。
 * - aggressive 档额外处理 `token: xxx` 这类通用键值，只用在落盘的证据（journal、
 *   verification 报告、命令输出）上——那里不存在「必须保持原文」的契约文本。
 */
export const REDACTED = '***redacted***';

interface Rule {
  pattern: RegExp;
  replacement: string;
  aggressiveOnly?: boolean;
}

const RULES: Rule[] = [
  // OpenAI / Anthropic 风格
  { pattern: /\bsk-[A-Za-z0-9_-]{16,}\b/gu, replacement: REDACTED },
  // GitHub token
  { pattern: /\b(?:ghp|gho|ghu|ghs|ghr)_[A-Za-z0-9]{20,}\b/gu, replacement: REDACTED },
  { pattern: /\bgithub_pat_[A-Za-z0-9_]{20,}\b/gu, replacement: REDACTED },
  // Slack
  { pattern: /\bxox[abprs]-[A-Za-z0-9-]{10,}\b/gu, replacement: REDACTED },
  // AWS access key id
  { pattern: /\bAKIA[0-9A-Z]{16}\b/gu, replacement: REDACTED },
  // Authorization 头
  { pattern: /\bBearer\s+[A-Za-z0-9._~+/-]{16,}=*/gu, replacement: 'Bearer ' + REDACTED },
  // JWT（三段 base64url）
  {
    pattern: /\beyJ[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\b/gu,
    replacement: REDACTED,
  },
  // 连接串口令：scheme://user:password@host
  //
  // 各段都设了上界：`[a-zA-Z][a-zA-Z0-9+.-]*` 这种无界量词在「一长串字母但始终没有 ://」时
  // 会退化成 O(n²)（实测 20KB 同字符行要 0.5s，600KB 直接把调用方钉死）。
  // 真实的 scheme/user/password 都远短于这些上界，因此收紧不会漏检。
  {
    pattern: /([a-zA-Z][a-zA-Z0-9+.-]{0,31}:\/\/[^/\s:@]{1,256}:)([^@\s/]{1,512})(@)/gu,
    replacement: '$1' + REDACTED + '$3',
  },
  // 私钥块
  {
    pattern: /-----BEGIN [A-Z ]*PRIVATE KEY-----[\s\S]*?-----END [A-Z ]*PRIVATE KEY-----/gu,
    replacement: '-----BEGIN PRIVATE KEY----- ' + REDACTED + ' -----END PRIVATE KEY-----',
  },
  // 通用键值：只在落盘证据上启用
  {
    pattern:
      /((?:api[_-]?key|apikey|access[_-]?token|auth[_-]?token|refresh[_-]?token|client[_-]?secret|token|secret|password|passwd|pwd)\s*[:=]\s*)(["']?)([^\s"',;]{6,})(\2)/giu,
    replacement: '$1$2' + REDACTED + '$4',
    aggressiveOnly: true,
  },
];

const SENSITIVE_KEYS = /^(?:token|secret|password|passwd|pwd|api[_-]?key|apikey|access[_-]?token|auth[_-]?token|refresh[_-]?token|client[_-]?secret|authorization|cookie)$/iu;

export interface RedactOptions {
  /** 是否启用通用键值规则（落盘证据用 true，提示词用 false）。 */
  aggressive?: boolean;
}

export function redactSecrets(text: string, options: RedactOptions = {}): string {
  let result = text;
  for (const rule of RULES) {
    if (rule.aggressiveOnly && options.aggressive !== true) continue;
    result = result.replace(rule.pattern, rule.replacement);
  }
  return result;
}

/** 深度裁剪结构化数据：字符串走脱敏，敏感键名的值直接替换。 */
export function redactDeep(value: unknown, options: RedactOptions = {}): unknown {
  if (typeof value === 'string') return redactSecrets(value, options);
  if (value === null || typeof value !== 'object') return value;
  if (Array.isArray(value)) return value.map((entry) => redactDeep(entry, options));

  const result: Record<string, unknown> = {};
  for (const [key, entry] of Object.entries(value as Record<string, unknown>)) {
    if (SENSITIVE_KEYS.test(key) && typeof entry === 'string' && entry !== '') {
      result[key] = REDACTED;
      continue;
    }
    result[key] = redactDeep(entry, options);
  }
  return result;
}

/** 脱敏是否改变了内容；用于在证据里标注「此处经过裁剪」。 */
export function redactionApplied(original: string, redacted: string): boolean {
  return original !== redacted;
}
