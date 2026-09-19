/**
 * 转发器适配器的验收替身（tunnel/spec.md「转发器适配器」一节的假实现）。
 *
 * 它只维护规则表、不建立真实 SSH 连接，用来把「通道是否真的存在」变成可判定的事实：
 * 规则表里有该会话 = 通道存在；回收后列表为空 = 不残留。
 *
 * 规则表放在模块级：验收执行器与受测服务在同一进程内，跨 `createApp` 实例也能读到同一份状态
 * （对应真实世界里规则活在 SSH 主机上，不随本服务重启而消失）。
 */
let sequence = 0;
const rules = new Map();

export function createForwarder() {
  return {
    open({ session_id, server_id, source_ip }) {
      sequence += 1;
      const rule_id = 'rule-' + sequence;
      rules.set(rule_id, { rule_id, session_id, server_id, source_ip });
      return { rule_id };
    },
    close({ session_id }) {
      for (const [rule_id, rule] of rules) {
        if (rule.session_id === session_id) rules.delete(rule_id);
      }
    },
    list() {
      return [...rules.keys()];
    },
  };
}

/** 验收专用：规则明细，用于断言「不产生任何转发规则」。 */
export function __rules() {
  return [...rules.values()];
}

/** 验收专用：每条用例开始前清空规则表。 */
export function __reset() {
  rules.clear();
  sequence = 0;
}
