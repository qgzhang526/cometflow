<template>
  <div class="card">
    <div class="row">
      <h2>Agent 与模型</h2>
      <span class="grow" />
      <span class="muted">配置分层：全局 → 项目（此页写项目层）</span>
    </div>
    <div class="form-grid">
      <label>
        默认 Agent
        <select v-model="form.agent">
          <option v-for="agent in project.agents" :key="agent.id" :value="agent.id">
            {{ agent.id }}{{ agent.available ? '' : '（不可用）' }}
          </option>
        </select>
      </label>
      <label>默认模型 <input v-model="form.model" placeholder="留空 = 由 Agent 自身默认决定" /></label>
      <div class="per-agent">
        <div class="muted">按 Agent 分模型（留空表示不覆盖）</div>
        <label v-for="agent in project.agents" :key="agent.id" class="row">
          <span style="width: 140px">{{ agent.id }}</span>
          <input v-model="form.agentModels[agent.id]" placeholder="模型名" class="grow" />
        </label>
      </div>
    </div>
  </div>

  <div class="card">
    <h2>验收（Verification）</h2>
    <div class="form-grid">
      <label>
        模式
        <select v-model="form.verificationMode">
          <option value="checks">checks · 只跑确定性检查（可离线）</option>
          <option value="checks+agent">checks+agent · 检查 + 独立 Verifier 复核未覆盖项</option>
          <option value="agent-required">agent-required · 必须由 Verifier 给出完整结论</option>
        </select>
      </label>
      <label>
        独立 Verifier Agent
        <select v-model="form.verificationAgent">
          <option value="">（与 Builder 相同）</option>
          <option v-for="agent in project.agents" :key="agent.id" :value="agent.id">{{ agent.id }}</option>
        </select>
      </label>
      <label>Verifier 模型 <input v-model="form.verificationModel" placeholder="留空 = 继承默认" /></label>
    </div>
    <p class="muted">验收项必须可执行；没有 check 的验收项会交给独立 Verifier 或人工判定（ADR 0013）。</p>
  </div>

  <div class="card">
    <h2>实现范围（Scope）</h2>
    <label>
      模块外允许改动的路径（每行一条，项目相对）
      <textarea v-model="form.scopeAllow" rows="4" placeholder="package.json&#10;pnpm-lock.yaml" />
    </label>
  </div>

  <div class="card">
    <h2>调度器默认参数</h2>
    <div class="form-grid">
      <label>
        模式
        <select v-model="form.schedulerMode">
          <option value="always">always</option>
          <option value="idle">idle</option>
          <option value="schedule">schedule</option>
          <option value="manual">manual</option>
        </select>
      </label>
      <label>间隔 ms <input v-model="form.intervalMs" inputmode="numeric" /></label>
      <label>总预算 ms <input v-model="form.budgetMs" inputmode="numeric" /></label>
      <label>空闲 CPU 阈值 <input v-model="form.idleCpuThreshold" inputmode="decimal" /></label>
      <label>窗口开始 <input v-model="form.scheduleStart" placeholder="HH:MM" /></label>
      <label>窗口结束 <input v-model="form.scheduleEnd" placeholder="HH:MM" /></label>
    </div>
    <p class="muted">这些是 daemon 的默认值；`cometflow daemon start` 不带参数时使用。</p>
  </div>

  <div class="card">
    <div class="row">
      <button class="primary" :disabled="saving" @click="save">{{ saving ? '保存中…' : '保存配置' }}</button>
      <button :disabled="saving" @click="load">放弃修改</button>
      <span class="grow" />
      <span v-if="overrideKeys.length > 0" class="muted">项目覆盖的键：{{ overrideKeys.join(', ') }}</span>
      <span v-else class="muted">项目当前完全继承全局配置</span>
    </div>
    <p v-if="lastWritten.length > 0" class="muted">上次写入：{{ lastWritten.join(', ') }}</p>
  </div>
</template>

<script setup lang="ts">
import { onMounted, reactive, ref, watch } from 'vue';
import { errorMessage } from '../../api/client';
import { refreshCounter } from '../../composables/useRefresh';
import { useProjectStore } from '../../stores/project';
import { useToastStore } from '../../stores/toasts';
import type { ProjectConfig } from '../../api/types';
import { clockToMinutes, minutesToClock } from '../../utils/format';

const project = useProjectStore();
const toasts = useToastStore();

const saving = ref(false);
const overrideKeys = ref<string[]>([]);
const lastWritten = ref<string[]>([]);

const form = reactive({
  agent: 'opencode',
  model: '',
  agentModels: {} as Record<string, string>,
  verificationMode: 'checks' as NonNullable<ProjectConfig['verification']>['mode'],
  verificationAgent: '',
  verificationModel: '',
  scopeAllow: '',
  schedulerMode: 'idle' as NonNullable<ProjectConfig['scheduler']>['mode'],
  intervalMs: '',
  budgetMs: '',
  idleCpuThreshold: '',
  scheduleStart: '',
  scheduleEnd: '',
});

async function load(): Promise<void> {
  try {
    await project.loadAgents();
    const data = await project.loadConfig();
    const config = data.config;
    overrideKeys.value = Object.keys(data.projectOverride).sort();
    form.agent = config.agent ?? 'opencode';
    form.model = config.model ?? '';
    form.agentModels = Object.fromEntries(
      project.agents.map((agent) => [agent.id, config.agents?.[agent.id]?.model ?? '']),
    );
    form.verificationMode = config.verification?.mode ?? 'checks';
    form.verificationAgent = config.verification?.agent ?? '';
    form.verificationModel = config.verification?.model ?? '';
    form.scopeAllow = (config.scope?.allow ?? []).join('\n');
    form.schedulerMode = config.scheduler?.mode ?? 'idle';
    form.intervalMs = config.scheduler?.intervalMs === undefined ? '' : String(config.scheduler.intervalMs);
    form.budgetMs = config.scheduler?.budgetMs === undefined ? '' : String(config.scheduler.budgetMs);
    form.idleCpuThreshold =
      config.scheduler?.idleCpuThreshold === undefined ? '' : String(config.scheduler.idleCpuThreshold);
    form.scheduleStart = minutesToClock(config.scheduler?.scheduleStartMinutes);
    form.scheduleEnd = minutesToClock(config.scheduler?.scheduleEndMinutes);
  } catch (error) {
    toasts.error('读取配置失败', errorMessage(error));
  }
}

function numberOrUndefined(value: string): number | undefined {
  const trimmed = value.trim();
  if (trimmed === '') return undefined;
  const parsed = Number(trimmed);
  return Number.isFinite(parsed) ? parsed : undefined;
}

async function save(): Promise<void> {
  saving.value = true;
  try {
    const agents: Record<string, { model: string }> = {};
    for (const [agentId, model] of Object.entries(form.agentModels)) {
      if (model.trim() !== '') agents[agentId] = { model: model.trim() };
    }
    const scheduler: NonNullable<ProjectConfig['scheduler']> = { mode: form.schedulerMode };
    const intervalMs = numberOrUndefined(form.intervalMs);
    if (intervalMs !== undefined) scheduler.intervalMs = intervalMs;
    const budgetMs = numberOrUndefined(form.budgetMs);
    if (budgetMs !== undefined) scheduler.budgetMs = budgetMs;
    const idleCpuThreshold = numberOrUndefined(form.idleCpuThreshold);
    if (idleCpuThreshold !== undefined) scheduler.idleCpuThreshold = idleCpuThreshold;
    if (form.schedulerMode === 'schedule') {
      const start = clockToMinutes(form.scheduleStart);
      const end = clockToMinutes(form.scheduleEnd);
      if (start !== undefined) scheduler.scheduleStartMinutes = start;
      if (end !== undefined) scheduler.scheduleEndMinutes = end;
    }

    const verification: NonNullable<ProjectConfig['verification']> = { mode: form.verificationMode };
    if (form.verificationAgent !== '') verification.agent = form.verificationAgent;
    if (form.verificationModel.trim() !== '') verification.model = form.verificationModel.trim();

    const payload: Partial<ProjectConfig> = {
      agent: form.agent,
      scheduler,
      verification,
      scope: {
        allow: form.scopeAllow
          .split('\n')
          .map((line) => line.trim())
          .filter(Boolean),
      },
    };
    // 空模型名表示「由 agent 自身决定」，必须省略而不是写空串（空串校验不通过）。
    if (form.model.trim() !== '') payload.model = form.model.trim();
    if (Object.keys(agents).length > 0) payload.agents = agents;

    const response = await project.projectApi<{ writtenKeys?: string[] }>('/config', { method: 'PUT', body: payload });
    lastWritten.value = response.writtenKeys ?? Object.keys(payload).sort();
    await load();
    toasts.success('配置已保存', '已写入 ' + lastWritten.value.join(', '));
  } catch (error) {
    toasts.error('保存失败', errorMessage(error));
  } finally {
    saving.value = false;
  }
}

onMounted(load);
watch(() => refreshCounter('config'), () => void load());
</script>
