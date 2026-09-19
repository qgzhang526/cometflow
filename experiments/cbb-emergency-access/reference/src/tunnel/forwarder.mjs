/**
 * 默认转发器适配器：**演练实现**。
 *
 * 它只维护规则表，不建立真实 SSH 连接——因此禁止用于生产（见 constraints.md 的部署约束）。
 * 生产部署必须由 配置：tunnel.forwarder_module 指向真实转发实现（例如以 ssh -L 建立端口转发），
 * 该实现必须满足 tunnel/spec.md 里同一个适配器契约，从而复用同一批判据。
 */
const rules = new Map();
let sequence = 0;

export function createForwarder() {
  return {
    open({ session_id, server_id, source_ip }) {
      sequence += 1;
      const rule_id = 'rule-' + sequence;
      rules.set(rule_id, { rule_id, session_id, server_id, source_ip, opened_at: new Date().toISOString() });
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
