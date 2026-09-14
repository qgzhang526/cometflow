import { createHash } from 'node:crypto';

/**
 * 结构化状态的规范哈希。
 *
 * 与文件哈希的分工：
 * - `spec-hash.ts` 回答「这份文本是什么」（行尾归一化后的 sha256）；
 * - 这里回答「这份结构化状态是什么」——键序无关、数组顺序敏感、带域标签。
 *
 * 带域标签（tag）是刻意的：同一份内容在不同语义下必须得到不同哈希，
 * 否则「计划哈希」和「状态哈希」会互相冒充。
 */
export const PLAN_HASH_TAG = 'cometflow.task-plan.v1';
export const CHANGE_STATE_HASH_TAG = 'cometflow.change.v1';

function invalid(detail: string): never {
  throw new TypeError('value is not canonical-JSON serializable: ' + detail);
}

function canonicalValue(value: unknown, ancestors: Set<object>): string {
  if (value === null) return 'null';
  switch (typeof value) {
    case 'boolean':
      return value ? 'true' : 'false';
    case 'number':
      if (!Number.isFinite(value)) invalid('numbers must be finite');
      // -0 与 0 序列化不同会让等价状态得到不同哈希。
      return JSON.stringify(Object.is(value, -0) ? 0 : value);
    case 'string':
      return JSON.stringify(value);
    case 'object': {
      if (Array.isArray(value)) {
        if (ancestors.has(value)) invalid('cyclic structures are not supported');
        if (Object.getOwnPropertySymbols(value).length > 0) invalid('symbol properties are not supported');
        ancestors.add(value);
        try {
          const items = value.map((entry, index) => {
            if (entry === undefined) invalid('array item ' + index + ' is undefined');
            return canonicalValue(entry, ancestors);
          });
          return '[' + items.join(',') + ']';
        } finally {
          ancestors.delete(value);
        }
      }
      const prototype = Object.getPrototypeOf(value);
      if (prototype !== Object.prototype && prototype !== null) {
        invalid('only plain objects are supported');
      }
      if (ancestors.has(value)) invalid('cyclic structures are not supported');
      if (Object.getOwnPropertySymbols(value).length > 0) invalid('symbol properties are not supported');
      ancestors.add(value);
      try {
        const record = value as Record<string, unknown>;
        const fields: string[] = [];
        for (const key of Object.keys(record).sort()) {
          const entry = record[key];
          // 与 JSON.stringify 一致：对象里值为 undefined 的字段直接丢弃。
          if (entry === undefined) continue;
          fields.push(JSON.stringify(key) + ':' + canonicalValue(entry, ancestors));
        }
        return '{' + fields.join(',') + '}';
      } finally {
        ancestors.delete(value);
      }
    }
    default:
      return invalid(typeof value + ' values are not supported');
  }
}

/** 确定性序列化：键排序、数组保序、拒绝无法表达为 JSON 的值。 */
export function canonicalJson(value: unknown): string {
  return canonicalValue(value, new Set<object>());
}

export function canonicalHash(tag: string, value: unknown): string {
  if (tag.trim() === '') invalid('hash tag must be non-empty');
  if (/[\r\n]/u.test(tag)) invalid('hash tag must not contain a line break');
  return createHash('sha256').update(tag + '\n' + canonicalJson(value)).digest('hex');
}

function withoutKey<T extends Record<string, unknown>>(value: T, key: string): Record<string, unknown> {
  const { [key]: _ignored, ...rest } = value;
  void _ignored;
  return rest;
}

/**
 * 计划哈希：刻意排除 `plan_hash` 自身，否则会陷入自指。
 * 这正是「先算内容、再盖戳」的做法——戳不参与被戳的内容。
 */
export function hashTaskPlan(plan: Record<string, unknown>): string {
  return canonicalHash(PLAN_HASH_TAG, withoutKey(plan, 'plan_hash'));
}

export function hashChangeState(state: Record<string, unknown>): string {
  return canonicalHash(CHANGE_STATE_HASH_TAG, withoutKey(state, 'state_hash'));
}

export function verifyPlanHash(plan: Record<string, unknown>): string | null {
  const stamped = plan.plan_hash;
  if (typeof stamped !== 'string' || stamped === '') return null;
  const actual = hashTaskPlan(plan);
  if (actual === stamped) return null;
  return 'plan content changed after hashing (stamped ' + stamped.slice(0, 12) + ', actual ' + actual.slice(0, 12) + ')';
}

export function verifyChangeStateHash(state: Record<string, unknown>): string | null {
  const stamped = state.state_hash;
  if (typeof stamped !== 'string' || stamped === '') return null;
  const actual = hashChangeState(state);
  if (actual === stamped) return null;
  return 'change state content changed after hashing (stamped ' + stamped.slice(0, 12) + ', actual ' + actual.slice(0, 12) + ')';
}
