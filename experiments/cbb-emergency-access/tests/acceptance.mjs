#!/usr/bin/env node
/**
 * CBB-应急运维接入的验收执行器。
 *
 * 这个文件是 spec 的判据实现：各 capability spec 里 Acceptance 项的
 * `- check: node tests/acceptance.mjs A<n>` 都指向这里的一个场景。
 *
 * 种子本身不含实现代码（`src/` 由 CometFlow 的 change / daemon 通道产出），
 * 所以在实现产出前这些 check 会失败——这正是 spec 驱动想要的信号：判据先于实现。
 *
 * 用法：
 *   node tests/acceptance.mjs A1     # 单条判据（change verify 就是这么调的）
 *   node tests/acceptance.mjs        # 全部判据（人工复核用）
 *
 * 判据只依赖 Node 内置模块；外部依赖（SSH 转发、系统时钟、管理平台会话）通过
 * config.md 约定的接缝替换成 tests/fixtures/ 下的替身。
 */
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import process from 'node:process';
import { fileURLToPath, pathToFileURL } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
process.chdir(ROOT);

const FAKE_FORWARDER = 'tests/fixtures/fake-forwarder.mjs';
const FAILING_FORWARDER = 'tests/fixtures/failing-forwarder.mjs';
const TARGETS = path.join(ROOT, 'tests/fixtures/server-targets.json');
const ONLINE_SERVER = 'srv-prod-01';
const ALLOWED_SOURCE = '10.1.2.3';
const BLOCKED_SOURCE = '203.0.113.7';
const REQUEST_ID = 'req-trace';

const fakeForwarder = await import(pathToFileURL(path.join(ROOT, FAKE_FORWARDER)).href);

class Failed extends Error {}

function fail(message) {
  throw new Failed(message);
}

function expect(condition, message) {
  if (!condition) fail(message);
}

function expectStatus(res, id, status, code) {
  const body = res.body ?? {};
  expect(
    res.status === status && body.code === code,
    id + ' 期望 HTTP ' + status + ' + code ' + JSON.stringify(code) + '，实际 HTTP ' +
      res.status + ' + code ' + JSON.stringify(body.code) + '（' + res.text.slice(0, 200) + '）',
  );
}

function expectOk(res, id) {
  expectStatus(res, id, 200, 0);
  expect(res.body.data !== null && typeof res.body.data === 'object', id + ' 成功响应缺少 data 对象');
  return res.body.data;
}

function deepMerge(base, patch) {
  const out = { ...base };
  for (const [key, value] of Object.entries(patch ?? {})) {
    const current = out[key];
    const bothPlainObjects =
      value !== null && typeof value === 'object' && !Array.isArray(value) &&
      current !== null && typeof current === 'object' && !Array.isArray(current);
    out[key] = bothPlainObjects ? deepMerge(current, value) : value;
  }
  return out;
}

let requestSequence = 0;

/** 一条判据的运行上下文：临时目录 + 配置文件 + 起停服务。 */
function newCase() {
  const dir = mkdtempSync(path.join(tmpdir(), 'cbb-ea-'));
  const stateFile = path.join(dir, 'state.sqlite');
  const configPath = path.join(dir, 'config.json');
  const apps = [];
  let serverModule = null;

  async function loadServer() {
    if (serverModule !== null) return serverModule;
    let loaded;
    try {
      loaded = await import(pathToFileURL(path.join(ROOT, 'src/server.mjs')).href);
    } catch (error) {
      fail('缺少实现：src/server.mjs 尚不存在或无法加载（spec 先行的种子项目的预期状态）：' + error.message);
    }
    expect(typeof loaded.createApp === 'function', 'src/server.mjs 必须导出 createApp({ configPath })');
    serverModule = loaded;
    return loaded;
  }

  function baseConfig() {
    return {
      auth: { mode: 'header' },
      store: { file: stateFile },
      targets: { file: TARGETS },
      access: {
        max_duration_minutes: 30,
        idle_timeout_minutes: 5,
        require_second_approver: false,
        allowed_source_cidrs: ['127.0.0.0/8', '10.0.0.0/8'],
        reject_limit_per_hour: 3,
        circuit_break_minutes: 30,
      },
      tunnel: { listen_port: 22022, forward_to_port: 22, forwarder_module: FAKE_FORWARDER },
      guard: { tick_seconds: 10, teardown_retries: 1, now: null },
      audit: { export_dir: path.join(dir, 'export'), retention_days: 180 },
      alert: {
        webhook_url: 'http://127.0.0.1:9/unused',
        notify_on: ['request_created', 'request_approved', 'channel_opened', 'session_ended'],
      },
    };
  }

  return {
    dir,
    stateFile,
    configPath,
    async start(overrides = {}) {
      await loadServer();
      writeFileSync(configPath, JSON.stringify(deepMerge(baseConfig(), overrides), null, 2));
      const app = await serverModule.createApp({ configPath });
      expect(typeof app?.url === 'string' && app.url !== '', 'createApp 必须返回 { url, close() }');
      apps.push(app);
      return app;
    },
    async stopAll() {
      while (apps.length > 0) {
        const app = apps.pop();
        try {
          await app.close();
        } catch {
          // 关闭失败不影响判据：下一次 start 用的是同一个 SQLite 文件。
        }
      }
    },
    async dispose() {
      await this.stopAll();
      rmSync(dir, { recursive: true, force: true });
    },
  };
}

async function api(app, method, urlPath, options = {}) {
  requestSequence += 1;
  const headers = {
    'content-type': 'application/json',
    'x-request-id': options.requestId ?? REQUEST_ID + '-' + requestSequence,
  };
  if (options.actor) headers['x-actor-id'] = options.actor;
  if (options.roles) headers['x-actor-roles'] = options.roles.join(',');
  if (options.token) headers['x-operator-token'] = options.token;
  headers['x-forwarded-for'] = options.forwardedFor ?? ALLOWED_SOURCE;

  const response = await fetch(new URL(urlPath, app.url), {
    method,
    headers,
    body: options.body === undefined ? undefined : JSON.stringify(options.body),
  });
  const text = await response.text();
  let body = null;
  try {
    body = JSON.parse(text);
  } catch {
    body = null;
  }
  return { status: response.status, body, text };
}

const requester = { actor: 'ops-on-call', roles: ['requester'] };
const approver = { actor: 'ops-lead', roles: ['approver'] };
const auditor = { actor: 'sec-auditor', roles: ['auditor'] };
const guardBot = { actor: 'guard-bot', roles: ['guard'] };

async function createRequest(app, overrides = {}) {
  return api(app, 'POST', '/api/emergency/access/request', {
    ...requester,
    forwardedFor: overrides.forwardedFor,
    body: { server_id: ONLINE_SERVER, reason: 'INC-1001 紧急排障', duration_minutes: 10, ...(overrides.body ?? {}) },
  });
}

async function approveRequest(app, requestId, overrides = {}) {
  return api(app, 'POST', '/api/emergency/access/approve', {
    ...approver,
    body: { request_id: requestId, decision: 'approve', comment: '已核对工单', ...overrides },
  });
}

async function issueToken(app) {
  const created = expectOk(await createRequest(app), 'flow');
  const approved = expectOk(await approveRequest(app, created.request_id), 'flow');
  return { requestId: created.request_id, token: approved.grant?.token, grant: approved.grant };
}

async function openSession(app, token, options = {}) {
  return api(app, 'POST', '/api/emergency/tunnel/open', {
    ...requester,
    token,
    forwardedFor: options.forwardedFor,
    body: { server_id: options.server_id ?? ONLINE_SERVER },
  });
}

async function exportAudit(app, from, to, actor = auditor) {
  const query = new URLSearchParams({ from, to });
  return api(app, 'GET', '/api/emergency/audit/export?' + query.toString(), actor);
}

function isoMinutesFromNow(minutes) {
  return new Date(Date.now() + minutes * 60_000).toISOString();
}

async function scenarioA1() {
  const context = newCase();
  try {
    const app = await context.start();
    const data = expectOk(await createRequest(app), 'A1');
    expect(typeof data.request_id === 'string' && data.request_id !== '', 'A1 响应缺少 request_id');
    expect(data.status === 'pending', 'A1 申请单初始状态应为 pending，实际 ' + JSON.stringify(data.status));
    expect(data.server_id === ONLINE_SERVER, 'A1 响应应回显 server_id，实际 ' + JSON.stringify(data.server_id));
    expect(typeof data.created_at === 'string' && !Number.isNaN(Date.parse(data.created_at)), 'A1 响应应带 ISO8601 的 created_at');
    const second = expectOk(await createRequest(app), 'A1');
    expect(second.request_id !== data.request_id, 'A1 两次申请应得到不同的 request_id');
    console.log('A1 ok: 合法申请得到 pending 申请单，request_id 唯一');
  } finally {
    await context.dispose();
  }
}

async function scenarioA2() {
  const context = newCase();
  try {
    const app = await context.start();
    const res = await createRequest(app, { body: { duration_minutes: 999 } });
    expectStatus(res, 'A2', 403, 'E_DURATION_EXCEEDS_LIMIT');
    console.log('A2 ok: 超时长申请被拒');
  } finally {
    await context.dispose();
  }
}

async function scenarioA3() {
  const context = newCase();
  try {
    const app = await context.start();
    const blocked = await createRequest(app, { forwardedFor: BLOCKED_SOURCE });
    expectStatus(blocked, 'A3', 403, 'E_SOURCE_NOT_ALLOWED');
    const emptyWhitelist = await context.start({ access: { allowed_source_cidrs: [] } });
    const denied = await createRequest(emptyWhitelist);
    expectStatus(denied, 'A3（白名单为空）', 403, 'E_SOURCE_NOT_ALLOWED');
    console.log('A3 ok: 白名单外的来源被拒，空白名单全拒');
  } finally {
    await context.dispose();
  }
}

async function scenarioA4() {
  const context = newCase();
  try {
    const app = await context.start();
    const created = expectOk(await createRequest(app), 'A4');
    const data = expectOk(await approveRequest(app, created.request_id), 'A4');
    expect(data.status === 'approved', 'A4 申请单状态应为 approved，实际 ' + JSON.stringify(data.status));
    expect(typeof data.grant?.grant_id === 'string' && data.grant.grant_id !== '', 'A4 应生成授权 grant_id');
    expect(typeof data.grant?.token === 'string' && data.grant.token !== '', 'A4 审批响应应一次性返回明文令牌');
    expect(typeof data.grant?.expires_at === 'string' && !Number.isNaN(Date.parse(data.grant.expires_at)), 'A4 授权应带 expires_at');
    console.log('A4 ok: 审批通过并发放一次性授权');
  } finally {
    await context.dispose();
  }
}

async function scenarioA5() {
  const context = newCase();
  try {
    const app = await context.start();
    const created = expectOk(await createRequest(app), 'A5');
    const selfApproval = await api(app, 'POST', '/api/emergency/access/approve', {
      ...approver,
      actor: requester.actor,
      body: { request_id: created.request_id, decision: 'approve' },
    });
    expectStatus(selfApproval, 'A5', 403, 'E_SELF_APPROVAL');
    expectOk(await approveRequest(app, created.request_id), 'A5（对照）');
    console.log('A5 ok: 自审被拒，他人审批正常');
  } finally {
    await context.dispose();
  }
}

async function scenarioA6() {
  const context = newCase();
  try {
    const app = await context.start();
    const created = expectOk(await createRequest(app), 'A6');
    expectOk(await approveRequest(app, created.request_id), 'A6');
    expectStatus(await approveRequest(app, created.request_id), 'A6', 409, 'E_REQUEST_ALREADY_DECIDED');
    console.log('A6 ok: 重复审批被拒');
  } finally {
    await context.dispose();
  }
}

async function scenarioA7() {
  const context = newCase();
  try {
    const app = await context.start();
    const created = expectOk(await createRequest(app), 'A7');
    expectOk(await approveRequest(app, created.request_id), 'A7');
    const data = expectOk(
      await api(app, 'POST', '/api/emergency/access/revoke', { ...approver, body: { request_id: created.request_id } }),
      'A7',
    );
    expect(data.status === 'revoked', 'A7 申请单状态应为 revoked，实际 ' + JSON.stringify(data.status));
    expect(data.grant?.status === 'revoked', 'A7 授权状态应为 revoked，实际 ' + JSON.stringify(data.grant?.status));
    console.log('A7 ok: 吊销后申请与授权同时失效');
  } finally {
    await context.dispose();
  }
}

async function scenarioA8() {
  const context = newCase();
  try {
    const app = await context.start();
    const { requestId, token } = await issueToken(app);
    const query = new URLSearchParams({ request_id: requestId });
    const res = await api(app, 'GET', '/api/emergency/access/status?' + query.toString(), requester);
    const data = expectOk(res, 'A8');
    expect(data.request?.request_id === requestId, 'A8 应返回申请单');
    expect(data.request?.status === 'approved', 'A8 申请单状态应为 approved');
    expect(typeof data.grant?.grant_id === 'string' && data.grant.grant_id !== '', 'A8 应返回关联授权');
    expect(data.session === null || data.session === undefined, 'A8 未建立通道时会话应为 null');
    expect(!res.text.includes(token), 'A8 状态查询不得回显明文令牌');
    expect(!res.text.includes('token_hash'), 'A8 状态查询不得暴露 token_hash');
    console.log('A8 ok: 状态查询可追溯且不回显令牌');
  } finally {
    await context.dispose();
  }
}

async function scenarioA9() {
  const context = newCase();
  try {
    fakeForwarder.__reset();
    const app = await context.start();
    const { token } = await issueToken(app);
    const data = expectOk(await openSession(app, token), 'A9');
    expect(typeof data.session_id === 'string' && data.session_id !== '', 'A9 应生成 session_id');
    expect(data.status === 'active', 'A9 会话状态应为 active，实际 ' + JSON.stringify(data.status));
    expect(data.server_id === ONLINE_SERVER, 'A9 会话应记录 server_id');
    const rules = fakeForwarder.__rules();
    expect(rules.length === 1 && rules[0].session_id === data.session_id, 'A9 应建立一条转发规则，实际 ' + JSON.stringify(rules));
    console.log('A9 ok: 令牌换通道，会话 active 且转发规则已建立');
  } finally {
    await context.dispose();
  }
}

async function scenarioA10() {
  const context = newCase();
  try {
    fakeForwarder.__reset();
    const app = await context.start();
    const { token } = await issueToken(app);
    expectOk(await openSession(app, token), 'A10');
    expectStatus(await openSession(app, token), 'A10', 409, 'E_GRANT_ALREADY_USED');
    expect(fakeForwarder.__rules().length === 1, 'A10 二次使用不得新建转发规则');
    console.log('A10 ok: 一次性令牌不可复用');
  } finally {
    await context.dispose();
  }
}

async function scenarioA11() {
  const context = newCase();
  try {
    fakeForwarder.__reset();
    const app = await context.start();
    const { token } = await issueToken(app);
    expectStatus(await openSession(app, token, { forwardedFor: BLOCKED_SOURCE }), 'A11', 403, 'E_SOURCE_NOT_ALLOWED');
    expect(fakeForwarder.__rules().length === 0, 'A11 白名单外的来源不得产生任何转发规则');
    console.log('A11 ok: 来源收敛在转发器之前生效');
  } finally {
    await context.dispose();
  }
}

async function scenarioA12() {
  const context = newCase();
  try {
    fakeForwarder.__reset();
    const app = await context.start();
    const { token } = await issueToken(app);
    const session = expectOk(await openSession(app, token), 'A12');
    const data = expectOk(
      await api(app, 'POST', '/api/emergency/tunnel/close', { ...requester, body: { session_id: session.session_id } }),
      'A12',
    );
    expect(data.status === 'ended', 'A12 会话状态应为 ended，实际 ' + JSON.stringify(data.status));
    expect(typeof data.end_reason === 'string' && data.end_reason !== '', 'A12 应记录 end_reason');
    expect(typeof data.ended_at === 'string' && !Number.isNaN(Date.parse(data.ended_at)), 'A12 应记录 ended_at');
    expect(fakeForwarder.__rules().length === 0, 'A12 回收后不得残留转发规则');
    console.log('A12 ok: 通道回收且规则不残留');
  } finally {
    await context.dispose();
  }
}

async function scenarioA13() {
  const context = newCase();
  try {
    fakeForwarder.__reset();
    const app = await context.start();
    const { token } = await issueToken(app);
    const session = expectOk(await openSession(app, token), 'A13');
    const first = expectOk(
      await api(app, 'POST', '/api/emergency/tunnel/close', { ...requester, body: { session_id: session.session_id } }),
      'A13',
    );
    const again = expectOk(
      await api(app, 'POST', '/api/emergency/tunnel/close', { ...requester, body: { session_id: session.session_id } }),
      'A13（重复回收）',
    );
    expect(again.status === 'ended', 'A13 重复回收应仍是 ended');
    expect(again.ended_at === first.ended_at, 'A13 重复回收不得改动 ended_at');
    expect(again.end_reason === first.end_reason, 'A13 重复回收不得改动 end_reason');
    expect(fakeForwarder.__rules().length === 0, 'A13 重复回收后仍不得残留规则');
    console.log('A13 ok: 重复回收幂等');
  } finally {
    await context.dispose();
  }
}

/** A14/A15 共用：旧 app 建会话 → 重启（同一个 SQLite 文件）并注入未来时刻 → 扫描。 */
async function sweepAcrossRestart(context, overrides) {
  fakeForwarder.__reset();
  const first = await context.start();
  const { token } = await issueToken(first);
  const session = expectOk(await openSession(first, token), 'sweep');
  expect(fakeForwarder.__rules().length === 1, 'sweep 前置：应已建立一条转发规则');
  await context.stopAll();
  const second = await context.start({ guard: { now: isoMinutesFromNow(31) }, ...overrides });
  const sweep = await api(second, 'POST', '/api/emergency/guard/sweep', guardBot);
  return { sweep, session };
}

async function scenarioA14() {
  const context = newCase();
  try {
    const { sweep, session } = await sweepAcrossRestart(context, {});
    const data = expectOk(sweep, 'A14');
    expect(Array.isArray(data.reclaimed), 'A14 响应应包含 reclaimed 数组');
    expect(
      data.reclaimed.includes(session.session_id),
      'A14 超时会话应出现在 reclaimed 中，实际 ' + JSON.stringify(data.reclaimed),
    );
    expect(fakeForwarder.__rules().length === 0, 'A14 回收后不得残留转发规则');
    console.log('A14 ok: 超过最长时长的会话被守卫回收（跨进程重启）');
  } finally {
    await context.dispose();
  }
}

async function scenarioA15() {
  const context = newCase();
  try {
    const { sweep, session } = await sweepAcrossRestart(context, {
      tunnel: { forwarder_module: FAILING_FORWARDER },
    });
    const data = expectOk(sweep, 'A15');
    expect(Array.isArray(data.failed), 'A15 响应应包含 failed 数组');
    const entry = data.failed.find((item) => item?.session_id === session.session_id);
    expect(entry !== undefined, 'A15 失败会话应出现在 failed 中，实际 ' + JSON.stringify(data.failed));
    expect(
      entry.code === 'E_CHANNEL_TEARDOWN_FAILED',
      'A15 失败项应带 E_CHANNEL_TEARDOWN_FAILED，实际 ' + JSON.stringify(entry.code),
    );
    console.log('A15 ok: 回收失败被显式列出，不静默');
  } finally {
    await context.dispose();
  }
}

async function scenarioA16() {
  const context = newCase();
  try {
    const app = await context.start();
    await issueToken(app);
    const from = isoMinutesFromNow(-60);
    const to = isoMinutesFromNow(60);
    const data = expectOk(await exportAudit(app, from, to), 'A16');
    expect(Number.isInteger(data.count), 'A16 data.count 应为整数');
    expect(Array.isArray(data.events), 'A16 data.events 应为数组');
    expect(data.count === data.events.length, 'A16 count 应等于 events 长度：' + data.count + ' vs ' + data.events.length);
    expect(data.count >= 3, 'A16 一次申请 + 审批至少产生 3 条审计事件，实际 ' + data.count);
    const times = data.events.map((event) => Date.parse(event.occurred_at));
    expect(times.every((value) => !Number.isNaN(value)), 'A16 事件应带可解析的 occurred_at');
    expect(
      data.events.every((event, index) => index === 0 || times[index - 1] <= times[index]),
      'A16 events 应按 occurred_at 升序',
    );
    expect(
      data.events.every(
        (event) => Date.parse(event.occurred_at) >= Date.parse(from) && Date.parse(event.occurred_at) <= Date.parse(to),
      ),
      'A16 不应返回区间外的事件',
    );
    const past = expectOk(await exportAudit(app, '2000-01-01T00:00:00.000Z', '2000-01-02T00:00:00.000Z'), 'A16（区间外）');
    expect(past.count === 0, 'A16 区间外应导出 0 条，实际 ' + past.count);
    console.log('A16 ok: 按时间范围导出，条数与内容自洽');
  } finally {
    await context.dispose();
  }
}

async function scenarioA17() {
  const context = newCase();
  try {
    const app = await context.start();
    await issueToken(app);
    const from = isoMinutesFromNow(-60);
    const to = isoMinutesFromNow(60);
    expectStatus(await exportAudit(app, from, to, requester), 'A17', 403, 'E_FORBIDDEN_ROLE');
    const first = expectOk(await exportAudit(app, from, to), 'A17');
    const second = expectOk(await exportAudit(app, from, to), 'A17');
    expect(second.count === first.count + 1, 'A17 导出本身应新增一条审计事件：' + first.count + ' → ' + second.count);
    const last = second.events[second.events.length - 1];
    expect(last?.event_type === 'audit_exported', 'A17 新增事件应为 audit_exported，实际 ' + JSON.stringify(last?.event_type));
    expect(last?.actor === auditor.actor, 'A17 导出事件应记录导出者，实际 ' + JSON.stringify(last?.actor));
    console.log('A17 ok: 仅 auditor 可导出，且导出行为本身被记录');
  } finally {
    await context.dispose();
  }
}

async function scenarioA18() {
  const context = newCase();
  try {
    fakeForwarder.__reset();
    const app = await context.start();
    const { requestId, token } = await issueToken(app);
    expectOk(
      await api(app, 'POST', '/api/emergency/access/revoke', { ...approver, body: { request_id: requestId } }),
      'A18',
    );
    expectStatus(await openSession(app, token), 'A18', 403, 'E_GRANT_REVOKED');
    expect(fakeForwarder.__rules().length === 0, 'A18 吊销后的令牌不得建立转发规则');
    console.log('A18 ok: 吊销即时生效');
  } finally {
    await context.dispose();
  }
}

const scenarios = {
  A1: scenarioA1,
  A2: scenarioA2,
  A3: scenarioA3,
  A4: scenarioA4,
  A5: scenarioA5,
  A6: scenarioA6,
  A7: scenarioA7,
  A8: scenarioA8,
  A9: scenarioA9,
  A10: scenarioA10,
  A11: scenarioA11,
  A12: scenarioA12,
  A13: scenarioA13,
  A14: scenarioA14,
  A15: scenarioA15,
  A16: scenarioA16,
  A17: scenarioA17,
  A18: scenarioA18,
};

const requested = process.argv.slice(2).filter((arg) => arg.startsWith('A'));
const ids = requested.length > 0 ? requested : Object.keys(scenarios);

for (const id of ids) {
  const scenario = scenarios[id];
  if (scenario === undefined) {
    console.error('unknown acceptance id: ' + id + '（可用：' + Object.keys(scenarios).join('|') + '）');
    process.exit(64);
  }
  try {
    await scenario();
  } catch (error) {
    if (error instanceof Failed) {
      console.error('FAIL ' + id + '：' + error.message);
    } else {
      console.error('FAIL ' + id + '：' + (error?.stack ?? error));
    }
    process.exit(1);
  }
}

console.log('acceptance: OK (' + ids.length + '/' + ids.length + ')');
