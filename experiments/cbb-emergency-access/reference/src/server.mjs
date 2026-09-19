/**
 * 服务入口：HTTP 路由、认证、来源收敛、响应包络（见 protocol.md）。
 *
 * 同时提供进程形态（CLI，供人工 curl 与部署）与模块形态（createApp，供验收执行器在同进程内起服务）。
 */
import http from 'node:http';
import path from 'node:path';
import { readFileSync } from 'node:fs';
import { pathToFileURL, fileURLToPath } from 'node:url';
import { openStore } from './store.mjs';
import { createAccessService } from './access/index.mjs';
import { createTunnelService } from './tunnel/index.mjs';
import { createGuardService } from './guard/index.mjs';
import { createAuditService } from './audit/index.mjs';

const DEFAULT_CONFIG = {
  auth: { mode: 'platform' },
  store: { file: ':memory:' },
  access: {
    max_duration_minutes: 30,
    idle_timeout_minutes: 5,
    require_second_approver: false,
    allowed_source_cidrs: [],
    reject_limit_per_hour: 3,
    circuit_break_minutes: 30,
  },
  tunnel: { listen_port: 22022, forward_to_port: 22, forwarder_module: 'src/tunnel/forwarder.mjs' },
  guard: { tick_seconds: 10, teardown_retries: 3, now: null },
  audit: { export_dir: '/var/log/emergency-access', retention_days: 180 },
  alert: { webhook_url: '', notify_on: ['request_created', 'request_approved', 'channel_opened', 'session_ended'] },
};

function isPlainObject(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function mergeConfig(base, patch) {
  const out = { ...base };
  for (const [key, value] of Object.entries(patch ?? {})) {
    out[key] = isPlainObject(value) && isPlainObject(out[key]) ? mergeConfig(out[key], value) : value;
  }
  return out;
}

export function readConfig(configPath) {
  const raw = JSON.parse(readFileSync(configPath, 'utf8'));
  return mergeConfig(DEFAULT_CONFIG, raw);
}

/** 取最后一个 X-Forwarded-For，缺省用 socket 远端地址（protocol.md 的请求头约定）。 */
function sourceIpOf(req) {
  const forwarded = req.headers['x-forwarded-for'];
  const raw = Array.isArray(forwarded) ? forwarded.join(',') : (forwarded ?? '');
  const last = raw.split(',').map((part) => part.trim()).filter((part) => part !== '').pop();
  const ip = last ?? req.socket.remoteAddress ?? '';
  return ip.startsWith('::ffff:') ? ip.slice('::ffff:'.length) : ip;
}

function ipv4ToInt(ip) {
  const parts = ip.split('.');
  if (parts.length !== 4) return null;
  let value = 0;
  for (const part of parts) {
    const octet = Number.parseInt(part, 10);
    if (!Number.isInteger(octet) || octet < 0 || octet > 255) return null;
    value = value * 256 + octet;
  }
  return value;
}

/** 白名单判定：支持 IPv4 CIDR；无法解析的地址一律视为不在白名单。 */
export function sourceAllowed(ip, cidrs) {
  const address = ipv4ToInt(ip);
  if (address === null) return false;
  for (const entry of cidrs ?? []) {
    const [network, bitsText] = String(entry).split('/');
    const networkValue = ipv4ToInt(network);
    const bits = bitsText === undefined ? 32 : Number.parseInt(bitsText, 10);
    if (networkValue === null || !Number.isInteger(bits) || bits < 0 || bits > 32) continue;
    const mask = bits === 0 ? 0 : (0xffffffff << (32 - bits)) >>> 0;
    if ((address & mask) === (networkValue & mask)) return true;
  }
  return false;
}

function parseCookies(header) {
  const cookies = {};
  for (const part of String(header ?? '').split(';')) {
    const index = part.indexOf('=');
    if (index < 0) continue;
    cookies[part.slice(0, index).trim()] = decodeURIComponent(part.slice(index + 1).trim());
  }
  return cookies;
}

/**
 * 认证接缝（config.md 的 auth.mode）：
 * - platform：复用管理平台的会话；真实部署在此校验证书/会话签名，参考实现读同名 Cookie
 * - header：读 X-Actor-Id / X-Actor-Roles，仅演练与验收可用
 */
function authenticate(req, config) {
  if (config.auth?.mode === 'header') {
    const roles = String(req.headers['x-actor-roles'] ?? '')
      .split(',')
      .map((role) => role.trim())
      .filter((role) => role !== '');
    return { actor: req.headers['x-actor-id'] ?? null, roles };
  }
  const cookies = parseCookies(req.headers.cookie);
  const roles = String(cookies['cbb-roles'] ?? '')
    .split(',')
    .map((role) => role.trim())
    .filter((role) => role !== '');
  return { actor: cookies['cbb-actor'] ?? null, roles };
}

function routesFor(services) {
  return [
    { method: 'POST', path: '/api/emergency/access/request', roles: ['requester', 'approver'], source: true, handler: (ctx, body) => services.access.request(ctx, body) },
    { method: 'POST', path: '/api/emergency/access/approve', roles: ['approver'], handler: (ctx, body) => services.access.approve(ctx, body) },
    { method: 'POST', path: '/api/emergency/access/revoke', roles: ['approver'], handler: (ctx, body) => services.access.revoke(ctx, body) },
    { method: 'GET', path: '/api/emergency/access/status', roles: ['requester', 'approver', 'auditor'], handler: (ctx, _body, query) => services.access.status(ctx, query) },
    { method: 'POST', path: '/api/emergency/tunnel/open', roles: ['requester'], source: true, handler: (ctx, body) => services.tunnel.open(ctx, body) },
    { method: 'POST', path: '/api/emergency/tunnel/close', roles: ['requester', 'approver', 'guard'], handler: (ctx, body) => services.tunnel.close(ctx, body) },
    { method: 'POST', path: '/api/emergency/guard/sweep', roles: ['guard'], handler: (ctx) => services.guard.sweep(ctx) },
    { method: 'GET', path: '/api/emergency/audit/export', roles: ['auditor'], handler: (ctx, _body, query) => services.audit.export(ctx, query) },
  ];
}

function readBody(req) {
  return new Promise((resolve) => {
    const chunks = [];
    req.on('data', (chunk) => chunks.push(chunk));
    req.on('end', () => {
      const text = Buffer.concat(chunks).toString('utf8');
      if (text.trim() === '') return resolve({});
      try {
        const parsed = JSON.parse(text);
        resolve(isPlainObject(parsed) ? parsed : {});
      } catch {
        resolve({});
      }
    });
    req.on('error', () => resolve({}));
  });
}

function loadTargets(file) {
  const parsed = JSON.parse(readFileSync(file, 'utf8'));
  if (!Array.isArray(parsed)) throw new Error('targets.file 必须是 ServerTarget 数组：' + file);
  return parsed;
}

async function loadForwarder(config) {
  const modulePath = path.resolve(config.tunnel.forwarder_module);
  const module = await import(pathToFileURL(modulePath).href);
  if (typeof module.createForwarder !== 'function') {
    throw new Error('转发器适配器必须导出 createForwarder({ config })：' + modulePath);
  }
  return module.createForwarder({ config });
}

export async function createApp({ configPath, port = 0 }) {
  const config = readConfig(configPath);
  const store = openStore({ file: config.store.file });
  for (const target of loadTargets(config.targets.file)) store.upsertTarget(target);
  const forwarder = await loadForwarder(config);

  const alert = createAlertDispatcher(config);
  const audit = {
    append(ctx, event) {
      store.appendAudit({
        event_type: event.event_type,
        actor: ctx.actor,
        server_id: event.server_id ?? null,
        request_id: event.request_id ?? null,
        session_id: event.session_id ?? null,
        detail: event.detail ?? null,
        occurred_at: ctx.now.toISOString(),
      });
      alert.notify(event.event_type, event.detail ?? {}, ctx);
    },
  };

  const services = {
    access: createAccessService({ config, store, audit }),
    tunnel: createTunnelService({ config, store, forwarder, audit }),
    guard: createGuardService({ config, store, forwarder, audit }),
    audit: createAuditService({ store, audit }),
  };
  const routes = routesFor(services);

  const server = http.createServer(async (req, res) => {
    const url = new URL(req.url ?? '/', 'http://localhost');
    const route = routes.find((entry) => entry.method === req.method && entry.path === url.pathname);
    const send = (result) => {
      const payload = { code: result.code, message: result.message ?? '', data: result.data ?? {} };
      res.writeHead(result.status, { 'content-type': 'application/json; charset=utf-8' });
      res.end(JSON.stringify(payload));
    };

    if (route === undefined) {
      send({ status: 404, code: 'E_REQUEST_NOT_FOUND', message: '接口不存在：' + url.pathname });
      return;
    }

    const identity = authenticate(req, config);
    if (typeof identity.actor !== 'string' || identity.actor === '') {
      send({ status: 401, code: 'E_AUTH_REQUIRED', message: '未登录或会话失效' });
      return;
    }
    if (!identity.roles.some((role) => route.roles.includes(role))) {
      send({ status: 403, code: 'E_FORBIDDEN_ROLE', message: '当前角色不允许该操作：' + identity.roles.join(',') });
      return;
    }

    const sourceIp = sourceIpOf(req);
    if (route.source === true && !sourceAllowed(sourceIp, config.access.allowed_source_cidrs)) {
      send({ status: 403, code: 'E_SOURCE_NOT_ALLOWED', message: '来源地址不在白名单：' + sourceIp });
      return;
    }

    const body = await readBody(req);
    const ctx = {
      actor: identity.actor,
      roles: identity.roles,
      sourceIp,
      now: new Date(),
      requestId: req.headers['x-request-id'] ?? null,
      token: req.headers['x-operator-token'] ?? null,
    };

    try {
      send(await route.handler(ctx, body, url.searchParams));
    } catch (error) {
      send({ status: 500, code: 'E_AUDIT_WRITE_FAILED', message: '服务内部错误：' + error.message });
    }
  });

  await new Promise((resolve) => server.listen(port, '127.0.0.1', resolve));
  const boundPort = server.address().port;

  return {
    port: boundPort,
    url: 'http://127.0.0.1:' + boundPort,
    async close() {
      await new Promise((resolve) => server.close(resolve));
      store.close();
    },
  };
}

/** 告警投递（processes.md 的「告警投递」）：只投配置里声明的事件类型，失败不阻塞主流程。 */
function createAlertDispatcher(config) {
  const webhook = config.alert?.webhook_url ?? '';
  const subscribed = new Set(config.alert?.notify_on ?? []);
  return {
    notify(eventType, detail) {
      if (webhook === '' || !subscribed.has(eventType)) return;
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), 500);
      fetch(webhook, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ event_type: eventType, detail }),
        signal: controller.signal,
      })
        .catch(() => {})
        .finally(() => clearTimeout(timer));
    },
  };
}

function parseArgs(argv) {
  const options = { configPath: null, port: 0 };
  for (let index = 0; index < argv.length; index += 1) {
    if (argv[index] === '--config') options.configPath = argv[index + 1] ?? null;
    if (argv[index] === '--port') options.port = Number.parseInt(argv[index + 1] ?? '0', 10);
  }
  return options;
}

const isMain = process.argv[1] !== undefined && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isMain) {
  const options = parseArgs(process.argv.slice(2));
  if (options.configPath === null) {
    console.error('usage: node src/server.mjs --config <config.json> [--port <port>]');
    process.exit(64);
  }
  const app = await createApp(options);
  console.log('listening on ' + app.port);
  const shutdown = async () => {
    await app.close();
    process.exit(0);
  };
  process.on('SIGTERM', shutdown);
  process.on('SIGINT', shutdown);
}
