/* CometFlow web client (vanilla JS, no framework) */
const $app = document.getElementById('app');
let token = localStorage.getItem('cometflow_token') || '';

(function initTokenFromUrl() {
  const urlToken = new URLSearchParams(location.search).get('token');
  if (urlToken) {
    token = urlToken;
    localStorage.setItem('cometflow_token', urlToken);
    history.replaceState(null, '', location.pathname + location.hash);
  }
})();
let currentProjectId = null;
let currentProject = null;
let sse = null;
let sseUnsub = null;

function esc(value) {
  return String(value ?? '').replace(/[&<>"]/g, (ch) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[ch]));
}

function api(path, options = {}) {
  const headers = { Authorization: 'Bearer ' + token };
  if (options.body !== undefined) headers['Content-Type'] = 'application/json';
  return fetch('/api' + path, { ...options, headers }).then(async (res) => {
    const data = await res.json().catch(() => ({}));
    if (!res.ok || data.ok === false) {
      throw new Error(data.error?.message || 'HTTP ' + res.status);
    }
    return data.data;
  });
}

function setHtml(html) { $app.innerHTML = html; }

function navigateTo(hash) { location.hash = hash; }

function loadProjects() {
  return api('/workspace');
}

function projectApi(seg, options) {
  return api('/projects/' + currentProjectId + seg, options);
}
function browseFs(pathValue) {
  return api('/fs/list?path=' + encodeURIComponent(pathValue || ''));
}

function openDirectoryPicker(initialPath) {
  return new Promise((resolve) => {
    let current = initialPath || '';
    let resolvedPath = '';
    let parent = null;
    const overlay = document.createElement('div');
    overlay.className = 'modal-overlay';
    overlay.innerHTML = '<div class="modal">' +
      '<div class="modal-head"><strong>选择目录</strong><button class="ghost" data-close>✕</button></div>' +
      '<div class="modal-body">' +
        '<div class="breadcrumb"><button data-root>此电脑</button><button data-up>↑ 上一级</button><span class="muted" data-cur></span></div>' +
        '<div class="dir-list" data-list></div>' +
      '</div>' +
      '<div class="modal-foot"><button data-cancel>取消</button><button class="primary" data-select>选择此目录</button></div>' +
    '</div>';
    document.body.appendChild(overlay);
    const listEl = overlay.querySelector('[data-list]');
    const curEl = overlay.querySelector('[data-cur]');
    const upBtn = overlay.querySelector('[data-up]');
    const selectBtn = overlay.querySelector('[data-select]');
    function close() { overlay.remove(); }
    async function render() {
      curEl.textContent = '当前：' + (current || '此电脑');
      listEl.innerHTML = '<div class="empty">加载中…</div>';
      try {
        const data = await browseFs(current);
        resolvedPath = data.path;
        parent = data.parent;
        upBtn.disabled = parent === null;
        selectBtn.disabled = resolvedPath === '';
        listEl.innerHTML = data.entries.map((e) => '<div class="dir-item" data-path="' + esc(e.path) + '"><span class="folder">📁</span><span>' + esc(e.name) + '</span></div>').join('') || '<div class="empty">此目录为空</div>';
        listEl.querySelectorAll('[data-path]').forEach((item) => { item.onclick = () => { current = item.dataset.path; render(); }; });
      } catch (error) {
        listEl.innerHTML = '<div class="empty">' + esc(error.message) + '</div>';
      }
    }
    overlay.querySelector('[data-close]').onclick = () => { close(); resolve(null); };
    overlay.querySelector('[data-cancel]').onclick = () => { close(); resolve(null); };
    overlay.querySelector('[data-root]').onclick = () => { current = ''; render(); };
    upBtn.onclick = () => { if (parent !== null) { current = parent; render(); } };
    selectBtn.onclick = () => { close(); resolve(resolvedPath || current); };
    render();
  });
}

window.pickWizardPath = async function () {
  const picked = await openDirectoryPicker(wizardData.path);
  if (picked) {
    wizardData.path = picked;
    const input = document.getElementById('w-path');
    if (input) input.value = picked;
  }
};


// ---------- token ----------
function tokenSection() {
  if (token) return '<span class="muted">token 已配置</span>';
  return '<input id="token-input" placeholder="粘贴 serve 启动时打印的 token" style="width:320px"> <button onclick="saveToken()">保存</button>';
}
window.saveToken = function () {
  token = document.getElementById('token-input').value.trim();
  localStorage.setItem('cometflow_token', token);
  render();
};

// ---------- routing ----------
function route() {
  const hash = location.hash || '#/';
  const parts = hash.replace(/^#\/?/, '').split('/').filter(Boolean);
  if (parts.length === 0) return renderHome();
  if (parts[0] === 'project' && parts[1]) {
    currentProjectId = parts[1];
    const panel = parts[2] || 'overview';
    return renderProject(panel);
  }
  renderHome();
}
window.addEventListener('hashchange', route);

function render() { route(); }

// ---------- home ----------
let wizardStep = 1;
let wizardData = { name: '', path: '', frontend: '无', backend: '', database: '无', answers: {} };

function kindPreview() {
  const kinds = {};
  const push = (k, status, reason) => { kinds[k] = { status, reason }; };
  const d = wizardData;
  const none = (v) => !v || v === '无' || v === 'none' || v.includes('[');
  push('project', 'present', 'always');
  push('models', none(d.database) ? 'absent' : 'present', none(d.database) ? 'database == none' : 'database != none');
  push('pages', none(d.frontend) ? 'absent' : 'present', none(d.frontend) ? 'frontend == none' : 'frontend != none');
  push('constraints', none(d.backend) ? 'absent' : 'present', none(d.backend) ? 'no backend' : 'backend present');
  push('capability', 'absent', 'derived from goals, not init');
  push('protocol', d.answers.network ? 'present' : 'deferred', d.answers.network ? 'network: yes' : 'use questions');
  push('config', d.answers.runtimeConfig ? 'present' : 'deferred', d.answers.runtimeConfig ? 'runtime config: yes' : 'use questions');
  push('flow', d.answers.crossApiFlow ? 'present' : 'deferred', d.answers.crossApiFlow ? 'cross-api: yes' : 'use questions');
  push('process', d.answers.backgroundProcess ? 'present' : 'deferred', d.answers.backgroundProcess ? 'process: yes' : 'use questions');
  push('rules', d.answers.domainDsl ? 'present' : 'deferred', d.answers.domainDsl ? 'dsl: yes' : 'use questions');
  push('permissions', d.answers.auth && d.answers.auth !== 'none' ? 'present' : 'absent', d.answers.auth ? 'auth: ' + d.answers.auth : 'auth: none');
  push('errors', d.answers.manyErrors ? 'present' : 'deferred', d.answers.manyErrors ? 'many errors' : 'use questions');
  return kinds;
}

function renderHome() {
  setHtml(`<div class="home">
    <div class="hero">
      <h1>CometFlow</h1>
      <p>全时运行的自主 Agent 开发平台 · 把 CLI 工作流可视化</p>
      <div class="actions">
        <button class="primary" onclick="startWizard()">＋ 新建项目</button>
        <button onclick="importProject()">打开已有项目</button>
      </div>
    </div>
    <div class="tokenbar card">${tokenSection()}</div>
    <div id="wizard"></div>
    <div class="section-title"><h2>最近项目</h2><span class="muted" id="proj-count"></span></div>
    <div class="project-grid" id="project-list">加载中…</div>
  </div>`);
  refreshProjectList();
  if (wizardStep > 1) renderWizard();
}

window.startWizard = function () {
  wizardStep = 1;
  wizardData = { name: '', path: '', frontend: '无', backend: '', database: '无', answers: {} };
  renderWizard();
};

function renderWizard() {
  const box = document.getElementById('wizard');
  if (!box) return;
  if (wizardStep === 1) {
    box.innerHTML = `<h2>新建项目 · ① 基本信息</h2>
      <div class="row">
        <div class="grow">项目名称 <input id="w-name" value="${esc(wizardData.name)}"></div>
        <div class="grow">本地路径 <input id="w-path" value="${esc(wizardData.path)}" placeholder="选择或输入目录路径" style="flex:1"> <button type="button" onclick="pickWizardPath()">浏览…</button></div>
      </div>
      <div class="row">
        <div>前端 <input id="w-frontend" value="${esc(wizardData.frontend)}"></div>
        <div>后端 <input id="w-backend" value="${esc(wizardData.backend)}" placeholder="Go / Node.js"></div>
        <div>数据库 <input id="w-database" value="${esc(wizardData.database)}"></div>
      </div>
      <button onclick="wizardNext()">下一步</button>`;
  } else if (wizardStep === 2) {
    const a = wizardData.answers;
    box.innerHTML = `<h2>新建项目 · ② 项目类型</h2>
      <label><input type="checkbox" id="q-network" ${a.network ? 'checked' : ''}> 对外网络接口/协议</label><br>
      <label><input type="checkbox" id="q-config" ${a.runtimeConfig ? 'checked' : ''}> 运行时配置键</label><br>
      <label><input type="checkbox" id="q-flow" ${a.crossApiFlow ? 'checked' : ''}> 跨接口业务场景</label><br>
      <label><input type="checkbox" id="q-process" ${a.backgroundProcess ? 'checked' : ''}> 常驻后台进程</label><br>
      <label><input type="checkbox" id="q-dsl" ${a.domainDsl ? 'checked' : ''}> 领域 DSL / 业务不变量</label><br>
      <label><input type="checkbox" id="q-errors" ${a.manyErrors ? 'checked' : ''}> 错误码 > 20 个</label><br>
      鉴权方式 <select id="q-auth">
        <option value="none" ${a.auth === 'none' ? 'selected' : ''}>无需</option>
        <option value="machine" ${a.auth === 'machine' ? 'selected' : ''}>机机</option>
        <option value="roles" ${a.auth === 'roles' ? 'selected' : ''}>角色矩阵</option>
      </select><br>
      <button onclick="wizardNext()">下一步</button> <button onclick="wizardBack()">上一步</button>`;
  } else if (wizardStep === 3) {
    const kinds = kindPreview();
    const rows = Object.entries(kinds).map(([k, v]) => {
      const badge = v.status === 'present' ? '<span class="badge ok">present</span>' : v.status === 'deferred' ? '<span class="badge warn">deferred</span>' : '<span class="badge gray">absent</span>';
      return '<tr><td>' + esc(k) + '</td><td>' + badge + '</td><td class="muted">' + esc(v.reason) + '</td></tr>';
    }).join('');
    box.innerHTML = `<h2>新建项目 · ③ 预览并创建</h2>
      <table><tr><th>kind</th><th>状态</th><th>原因</th></tr>${rows}</table>
      <button class="primary" onclick="createProject()">创建</button> <button onclick="wizardBack()">上一步</button>`;
  }
}

window.wizardNext = function () {
  if (wizardStep === 1) {
    wizardData.name = document.getElementById('w-name').value;
    wizardData.path = document.getElementById('w-path').value;
    wizardData.frontend = document.getElementById('w-frontend').value || '无';
    wizardData.backend = document.getElementById('w-backend').value;
    wizardData.database = document.getElementById('w-database').value || '无';
  } else if (wizardStep === 2) {
    wizardData.answers = {
      network: document.getElementById('q-network').checked,
      runtimeConfig: document.getElementById('q-config').checked,
      crossApiFlow: document.getElementById('q-flow').checked,
      backgroundProcess: document.getElementById('q-process').checked,
      domainDsl: document.getElementById('q-dsl').checked,
      manyErrors: document.getElementById('q-errors').checked,
      auth: document.getElementById('q-auth').value,
    };
  }
  wizardStep += 1;
  renderWizard();
};
window.wizardBack = function () { wizardStep -= 1; renderWizard(); };

window.createProject = async function () {
  try {
    const result = await api('/projects', {
      method: 'POST',
      body: JSON.stringify({
        name: wizardData.name,
        path: wizardData.path,
        frontend: wizardData.frontend,
        backend: wizardData.backend,
        database: wizardData.database,
        answers: wizardData.answers,
      }),
    });
    wizardStep = 1;
    navigateTo('#/project/' + result.project.id + '/specs');
  } catch (error) {
    alert('创建失败：' + error.message);
  }
};

window.importProject = async function () {
  const projectPath = await openDirectoryPicker('');
  if (!projectPath) return;
  try {
    const result = await api('/projects/import', { method: 'POST', body: JSON.stringify({ path: projectPath }) });
    navigateTo('#/project/' + result.project.id + '/overview');
  } catch (error) {
    alert('打开失败：' + error.message);
  }
};

async function refreshProjectList() {
  const box = document.getElementById('project-list');
  const count = document.getElementById('proj-count');
  if (!box) return;
  try {
    const data = await loadProjects();
    if (count) count.textContent = data.projects.length + ' 个项目';
    if (!data.projects.length) { box.innerHTML = '<div class="empty">暂无项目，点击上方「＋ 新建项目」开始</div>'; return; }
    box.innerHTML = data.projects.map((p) => {
      const s = p.status || {};
      const goals = (s.goals || []).length;
      const plans = (s.plans || []).length;
      const changes = (s.changes || []).length;
      return '<a class="project-card" href="#/project/' + esc(p.id) + '/overview">' +
        '<div class="name">' + esc(p.name) + '</div>' +
        '<div class="path">' + esc(p.path) + '</div>' +
        '<div class="meta"><span class="badge brand">' + goals + ' 目标</span><span class="badge brand">' + plans + ' 计划</span><span class="badge brand">' + changes + ' 变更</span></div>' +
        '</a>';
    }).join('');
  } catch (error) {
    box.innerHTML = '<div class="empty">' + esc(error.message) + '</div>';
  }
}

// ---------- project shell ----------
async function renderProject(panel) {
  try {
    const data = await api('/projects/' + currentProjectId);
    currentProject = data.project;
  } catch (error) {
    setHtml('<p>' + esc(error.message) + '</p>');
    return;
  }
  const ICONS = { overview: '📊', goals: '🎯', specs: '📐', plans: '🗺️', changes: '🔀', evolve: '🧬', eval: '🧪', settings: '⚙️' };
  const panels = [
    ['overview', '总览'], ['goals', '目标'], ['specs', '规格'], ['plans', '计划'],
    ['changes', '变更'], ['evolve', '进化'], ['eval', '评估'], ['settings', '设置'],
  ];
  const nav = '<div class="nav-label">工作台</div>' + panels.map(([id, label]) => '<a href="#/project/' + esc(currentProjectId) + '/' + id + '" class="' + (panel === id ? 'active' : '') + '"><span class="icon">' + (ICONS[id] || '·') + '</span><span>' + label + '</span></a>').join('');
  setHtml(`<div class="topbar">
    <span class="logo">CometFlow</span>
    <span>${esc(currentProject.name)}</span>
    <span class="muted">${esc(currentProject.path)}</span>
    <a href="#/">切换项目</a>
    <span class="grow"></span>
    <span id="agent-badge" class="muted">agent…</span>
  </div>
  <div class="shell">
    <div class="sidebar">${nav}</div>
    <div class="content" id="panel"></div>
  </div>`);
  connectSse();
  loadAgents();
  const renderers = { overview: renderOverview, goals: renderGoals, specs: renderSpecs, plans: renderPlans, changes: renderChanges, evolve: renderEvolve, eval: renderEval, settings: renderSettings };
  const fn = renderers[panel] || renderOverview;
  await fn();
}

async function loadAgents() {
  try {
    const data = await api('/projects/' + currentProjectId + '/agents');
    const badge = document.getElementById('agent-badge');
    if (badge) badge.innerHTML = data.agents.map((a) => '<span class="badge ' + (a.available ? 'ok' : 'err') + '">' + esc(a.id) + (a.available ? '' : ' missing') + '</span>').join(' ');
  } catch { /* ignore */ }
}

function connectSse() {
  if (sse) { try { sse.close(); } catch {} }
  sse = new EventSource('/api/events?token=' + encodeURIComponent(token));
  sse.onmessage = (event) => {
    try {
      const data = JSON.parse(event.data);
      if (data.type === 'state.changed') {
        const panel = (location.hash.split('/')[3] || 'overview');
        route();
      }
    } catch { /* ignore */ }
  };
}

// ---------- panels ----------
async function renderOverview() {
  const box = document.getElementById('panel');
  box.innerHTML = '<div class="card">加载中…</div>';
  const [status, doctor] = await Promise.all([
    projectApi('/project/status').catch((e) => ({ error: e.message })),
    projectApi('/project/doctor').catch((e) => ({ error: e.message })),
  ]);
  box.innerHTML = `<div class="card"><h2>项目状态</h2>
    <p>目标：<b>${esc(status.goals?.join(', ') || '无')}</b></p>
    <p>计划：<b>${esc((status.plans || []).map((p) => p.goal + '(' + p.status + ')').join(', ') || '无')}</b></p>
    <p>变更：<b>${esc((status.changes || []).map((c) => c.name + ':' + c.phase).join(', ') || '无')}</b></p>
    <p>进化：<b>${esc((status.evolutions || []).map((e) => e.name + ':' + e.status).join(', ') || '无')}</b></p>
  </div>
  <div class="card"><h2>Doctor</h2>
    ${doctor.error ? '<p class="muted">' + esc(doctor.error) + '</p>' :
      (doctor.findings || []).map((f) => '<div class="finding ' + (f.severity === 'error' ? '' : 'warning') + '">[' + esc(f.severity) + '] ' + esc(f.code) + ' ' + esc(f.message) + '</div>').join('') || '<p>OK</p>'}
  </div>`;
}

async function renderGoals() {
  const box = document.getElementById('panel');
  const mission = await projectApi('/mission.md');
  const goals = await projectApi('/goals');
  box.innerHTML = `<div class="card"><h2>总体目标 / 任务目标（COMETFLOW.md）</h2>
    <textarea id="mission-edit">${esc(mission.content)}</textarea>
    <button class="primary" onclick="saveMission()">保存</button>
    <button onclick="syncGoals()">同步 (context + goal)</button>
    <button onclick="addGoal()">+ 添加目标</button>
  </div>
  <div class="card"><h2>目标列表</h2>
    ${(goals.goals || []).map((g) => '<p><b>' + esc(g.id) + '</b> ' + esc(g.title) + ' <span class="muted">scope: ' + esc((g.scope || []).join(',')) + '</span></p>').join('') || '<p class="muted">无目标</p>'}
  </div>`;
}

window.saveMission = async function () {
  try {
    await projectApi('/mission.md', { method: 'PUT', body: JSON.stringify({ content: document.getElementById('mission-edit').value }) });
    alert('已保存');
  } catch (error) { alert(error.message); }
};
window.syncGoals = async function () {
  try {
    await projectApi('/context/sync', { method: 'POST' });
    await projectApi('/goals/sync', { method: 'POST' });
    route();
  } catch (error) { alert(error.message); }
};
window.addGoal = function () {
  const ta = document.getElementById('mission-edit');
  const n = (ta.value.match(/### G\d+/g) || []).length + 1;
  ta.value = ta.value + '\n### G' + n + '：新目标\n- 目标：\n- 范围：\n- 成功标准：\n  - \n- 非目标：\n  - \n';
};

async function renderSpecs() {
  const box = document.getElementById('panel');
  box.innerHTML = '<div class="card">加载中…</div>';
  const [manifest, specs, index] = await Promise.all([
    projectApi('/init-manifest'),
    projectApi('/specs'),
    projectApi('/spec-index').catch(() => ({ apis: [], models: null, flows: [], errors: [], config: [] })),
  ]);
  const kinds = manifest.kinds || {};
  const rows = Object.entries(kinds).map(([k, v]) => {
    const badge = v.status === 'present' ? '<span class="badge ok">present</span>' : v.status === 'deferred' ? '<span class="badge warn">deferred</span>' : '<span class="badge gray">absent</span>';
    return '<tr><td><b>' + esc(k) + '</b></td><td>' + badge + '</td><td class="muted">' + esc(v.reason) + '</td></tr>';
  }).join('');
  const fileRows = (specs.entries || []).map((e) => '<tr><td><a href="javascript:void(0)" onclick="openSpec(\'' + esc(e.path) + '\')">' + esc(e.path) + '</a></td><td>' + esc(e.kind) + '</td></tr>').join('');
  box.innerHTML = `<div class="card"><h2>12-kind 状态</h2><table><tr><th>kind</th><th>状态</th><th>原因</th></tr>${rows}</table></div>
  <div class="card"><h2>脚手架补全</h2>
    <label><input type="checkbox" id="s-network"> 网络接口</label>
    <label><input type="checkbox" id="s-config"> 运行时配置</label>
    <label><input type="checkbox" id="s-flow"> 跨接口流程</label>
    <label><input type="checkbox" id="s-process"> 后台进程</label>
    <label><input type="checkbox" id="s-dsl"> 领域 DSL</label>
    <label><input type="checkbox" id="s-errors"> 错误码>20</label>
    鉴权 <select id="s-auth"><option value="none">无需</option><option value="machine">机机</option><option value="roles">角色矩阵</option></select>
    <button class="primary" onclick="scaffoldKinds()">生成/补全</button>
  </div>
  <div class="card"><h2>跨文件引用索引</h2>
    <p class="muted">apis: ${esc((index.apis || []).length)} · entities: ${esc((index.models?.entities || []).length)} · flows: ${esc((index.flows || []).length)} · errors: ${esc((index.errors || []).length)} · config keys: ${esc((index.config || []).length)}</p>
    <button onclick="validateSpecs()">校验引用</button>
    <div id="validate-result"></div>
  </div>
  <div class="card"><h2>Spec 文件</h2><table><tr><th>路径</th><th>kind</th></tr>${fileRows}</table>
    <div id="spec-editor"></div>
  </div>`;
}

window.scaffoldKinds = async function () {
  try {
    const answers = {
      network: document.getElementById('s-network').checked,
      runtimeConfig: document.getElementById('s-config').checked,
      crossApiFlow: document.getElementById('s-flow').checked,
      backgroundProcess: document.getElementById('s-process').checked,
      domainDsl: document.getElementById('s-dsl').checked,
      manyErrors: document.getElementById('s-errors').checked,
      auth: document.getElementById('s-auth').value,
    };
    await projectApi('/spec/scaffold', { method: 'POST', body: JSON.stringify({ answers }) });
    route();
  } catch (error) { alert(error.message); }
};

window.validateSpecs = async function () {
  try {
    const result = await projectApi('/spec/validate', { method: 'POST' });
    const box = document.getElementById('validate-result');
    box.innerHTML = (result.findings || []).map((f) => '<div class="finding ' + (f.severity === 'error' ? '' : 'warning') + '">[' + esc(f.severity) + '] ' + esc(f.code) + ' <span class="muted">' + esc(f.path) + '</span> ' + esc(f.message) + '</div>').join('') || '<p class="badge ok">0 error</p>';
  } catch (error) { alert(error.message); }
};

window.openSpec = async function (specPath) {
  try {
    const data = await projectApi('/specs/content?path=' + encodeURIComponent(specPath));
    const editor = document.getElementById('spec-editor');
    editor.innerHTML = '<h3>' + esc(data.path) + '</h3><textarea id="spec-text">' + esc(data.content) + '</textarea><button class="primary" onclick="saveSpec(\'' + esc(data.path) + '\')">保存</button>';
  } catch (error) { alert(error.message); }
};
window.saveSpec = async function (specPath) {
  try {
    await projectApi('/specs/content?path=' + encodeURIComponent(specPath), { method: 'PUT', body: JSON.stringify({ content: document.getElementById('spec-text').value }) });
    alert('已保存');
  } catch (error) { alert(error.message); }
};

async function renderPlans() {
  const box = document.getElementById('panel');
  const goals = await projectApi('/goals');
  box.innerHTML = `<div class="card"><h2>计划拆解</h2>
    目标 <select id="plan-goal">${(goals.goals || []).map((g) => '<option>' + esc(g.id) + '</option>').join('')}</select>
    <button onclick="planAction('generate')">生成</button>
    <button onclick="planAction('validate')">校验</button>
    <button onclick="planAction('review')">评审</button>
    <button onclick="planAction('approve')">批准</button>
    <button onclick="planAction('freeze')">冻结</button>
    <button onclick="planAction('regenerate')">重新生成</button>
  </div>
  <div class="card" id="plan-detail"><p class="muted">选择目标并生成计划</p></div>`;
  loadPlan();
}

async function loadPlan() {
  const goal = document.getElementById('plan-goal')?.value;
  if (!goal) return;
  try {
    const plan = await projectApi('/plans/' + goal);
    const box = document.getElementById('plan-detail');
    box.innerHTML = '<p>状态：<b>' + esc(plan.status) + '</b> · 任务 ' + esc((plan.tasks || []).length) + ' 个</p><pre>' + esc(JSON.stringify(plan, null, 2)) + '</pre>';
  } catch {
    document.getElementById('plan-detail').innerHTML = '<p class="muted">该目标尚无计划</p>';
  }
}
window.planAction = async function (action) {
  const goal = document.getElementById('plan-goal').value;
  try {
    if (action === 'generate') await projectApi('/plans/generate', { method: 'POST', body: JSON.stringify({ goal }) });
    else if (action === 'regenerate') await projectApi('/plans/regenerate', { method: 'POST', body: JSON.stringify({ goal, preserveApproved: true }) });
    else if (action === 'validate') {
      const result = await projectApi('/plans/' + goal + '/validate', { method: 'POST' });
      document.getElementById('plan-detail').innerHTML = '<pre>' + esc(JSON.stringify(result, null, 2)) + '</pre>';
      return;
    } else {
      await projectApi('/plans/' + goal + '/' + action, { method: 'POST' });
    }
    loadPlan();
  } catch (error) { alert(error.message); }
};

async function renderChanges() {
  const box = document.getElementById('panel');
  const changes = await projectApi('/changes');
  box.innerHTML = `<div class="card"><h2>变更 Changes</h2>
    <div class="row">
      <input id="c-name" placeholder="change 名称">
      <input id="c-goal" placeholder="goal（如 G1）">
      <input id="c-task" placeholder="task（如 T1）">
      <button class="primary" onclick="newChange()">新建</button>
    </div>
  </div>
  <div class="card" id="change-list"></div>
  <div class="card" id="change-detail"><p class="muted">选择 change</p></div>`;
  const list = document.getElementById('change-list');
  list.innerHTML = (changes.changes || []).map((c) => '<a href="javascript:void(0)" onclick="openChange(\'' + esc(c.name) + '\')">' + esc(c.name) + '</a> <span class="badge ' + (c.archived ? 'gray' : 'ok') + '">' + esc(c.phase) + (c.archived ? ' archived' : '') + '</span><br>').join('') || '<p class="muted">无 change</p>';
}

window.newChange = async function () {
  try {
    await projectApi('/changes', { method: 'POST', body: JSON.stringify({ name: document.getElementById('c-name').value, goal: document.getElementById('c-goal').value, task: document.getElementById('c-task').value }) });
    renderChanges();
  } catch (error) { alert(error.message); }
};

let activeChangeName = null;
window.openChange = async function (name) {
  activeChangeName = name;
  const change = await projectApi('/changes/' + name);
  const box = document.getElementById('change-detail');
  box.innerHTML = `<h3>${esc(name)} <span class="badge ok">${esc(change.phase)}</span></h3>
    <p class="muted">goal=${esc(change.goal)} task=${esc(change.task)} acceptance=${esc((change.acceptance_ids || []).join(','))}</p>
    <button onclick="changeAction('transition','confirm-acceptance')">确认验收</button>
    <button onclick="changeAction('run')">运行 Builder</button>
    <button onclick="changeAction('verify')">验收</button>
    <button onclick="changeAction('archive')">归档</button>
    <div id="change-log" class="logbox" style="margin-top:8px"></div>`;
};
window.changeAction = async function (action, event) {
  try {
    if (action === 'transition') await projectApi('/changes/' + activeChangeName + '/transition', { method: 'POST', body: JSON.stringify({ event }) });
    else if (action === 'run') {
      const result = await projectApi('/changes/' + activeChangeName + '/run', { method: 'POST', body: JSON.stringify({ agent: 'opencode' }) });
      pollJob(result.jobId, document.getElementById('change-log'));
      return;
    } else await projectApi('/changes/' + activeChangeName + '/' + action, { method: 'POST' });
    renderChanges();
  } catch (error) { alert(error.message); }
};

async function pollJob(jobId, logBox) {
  const tick = async () => {
    try {
      const data = await api('/jobs/' + jobId);
      const job = data.job;
      if (logBox) logBox.textContent = (job.logTail || []).join('\n');
      if (job.status === 'succeeded' || job.status === 'failed') {
        if (logBox) logBox.textContent += '\n[' + job.status + ']' + (job.error ? ' ' + job.error : '');
        renderChanges();
        return;
      }
    } catch { /* ignore */ }
    setTimeout(tick, 500);
  };
  tick();
}

async function renderEvolve() {
  const box = document.getElementById('panel');
  const data = await projectApi('/evolutions');
  box.innerHTML = `<div class="card"><h2>进化提案</h2>
    <div class="row"><input id="e-name" placeholder="name"><input id="e-summary" placeholder="summary"><button class="primary" onclick="proposeEvolve()">提出</button></div>
  </div>
  <div class="card" id="evolve-list"></div>`;
  const list = document.getElementById('evolve-list');
  list.innerHTML = (data.evolutions || []).map((e) => '<p><b>' + esc(e.name) + '</b> <span class="badge gray">' + esc(e.status) + '</span> ' + esc(e.summary || '') + ' <button onclick="evolveAction(\'' + esc(e.name) + '\',\'submit\')">submit</button> <button onclick="evolveAction(\'' + esc(e.name) + '\',\'approve\')">approve</button></p>').join('') || '<p class="muted">无提案</p>';
}
window.proposeEvolve = async function () {
  try {
    await projectApi('/evolutions', { method: 'POST', body: JSON.stringify({ name: document.getElementById('e-name').value, summary: document.getElementById('e-summary').value }) });
    renderEvolve();
  } catch (error) { alert(error.message); }
};
window.evolveAction = async function (name, action) {
  try {
    await projectApi('/evolutions/' + name + '/' + action, { method: 'POST', body: JSON.stringify(action === 'approve' ? { note: '' } : {}) });
    renderEvolve();
  } catch (error) { alert(error.message); }
};

async function renderEval() {
  const box = document.getElementById('panel');
  box.innerHTML = `<div class="card"><h2>评估 Eval</h2>
    <p class="muted">运行 .cometflow/eval.yaml 中的本地评估任务（sampling / 断言 / rubric）。</p>
    <button class="primary" onclick="runEval()">运行评估</button>
    <div id="eval-log" class="logbox" style="margin-top:8px"></div>
  </div>`;
}
window.runEval = async function () {
  try {
    const result = await projectApi('/eval/run', { method: 'POST', body: JSON.stringify({}) });
    pollJob(result.jobId, document.getElementById('eval-log'));
  } catch (error) { alert(error.message); }
};

async function renderSettings() {
  const box = document.getElementById('panel');
  const config = await projectApi('/config');
  box.innerHTML = `<div class="card"><h2>Agent 与模型配置</h2>
    <div class="row">
      <div>默认 Agent <input id="cfg-agent" value="${esc(config.agent || 'opencode')}"></div>
      <div>默认模型 <input id="cfg-model" value="${esc(config.model || '')}"></div>
    </div>
    <button class="primary" onclick="saveConfig()">保存配置</button>
  </div>
  <div class="card"><h2>调度器默认参数</h2>
    <div class="row">
      <div>模式 <select id="cfg-mode"><option value="always">always</option><option value="idle">idle</option><option value="schedule">schedule</option><option value="manual">manual</option></select></div>
      <div>间隔ms <input id="cfg-interval" value="${esc(config.scheduler?.intervalMs ?? '')}"></div>
    </div>
  </div>`;
  document.getElementById('cfg-mode').value = config.scheduler?.mode || 'idle';
}
window.saveConfig = async function () {
  try {
    const intervalMs = document.getElementById('cfg-interval').value;
    const scheduler = { mode: document.getElementById('cfg-mode').value, ...(intervalMs === '' ? {} : { intervalMs: Number(intervalMs) }) };
    await projectApi('/config', { method: 'PUT', body: JSON.stringify({ agent: document.getElementById('cfg-agent').value, model: document.getElementById('cfg-model').value, scheduler }) });
    alert('已保存');
  } catch (error) { alert(error.message); }
};

render();
