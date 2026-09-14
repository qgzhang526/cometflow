import { createHash } from 'node:crypto';

/**
 * Spec 内容哈希的唯一实现。
 *
 * 行尾归一化是刻意的：git 的 autocrlf 会把 checkout 出来的文件转成 CRLF，
 * 如果哈希依赖原始字节，同一份 spec 在不同平台上会得到不同的版本号。
 */
export function normalizeSpecText(text: string): string {
  return text.replace(/\r\n/g, '\n');
}

export function hashSpecText(text: string): string {
  return createHash('sha256').update(normalizeSpecText(text)).digest('hex');
}

export function shortHash(hash: string, length = 12): string {
  return hash.slice(0, length);
}
