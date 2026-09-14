<template>
  <div>
    <div class="toolbar">
      <button class="primary" :disabled="busy" @click="lock">建立基线（spec lock）</button>
      <button :disabled="busy" @click="loadAll">重新扫描</button>
      <button :disabled="busy" @click="validate">校验引用（spec validate）</button>
      <span class="grow" />
      <StatusBadge :tone="verify?.valid ? 'ok' : verify ? 'err' : 'gray'" :text="verify ? (verify.valid ? 'spec verify OK' : 'spec verify FAILED') : 'verify …'" />
    </div>

    <h3>与基线的差异（spec diff）</h3>
    <p class="muted">
      added {{ diff?.added.length ?? 0 }} · modified {{ diff?.modified.length ?? 0 }} · removed
      {{ diff?.removed.length ?? 0 }} · unchanged {{ diff?.unchanged.length ?? 0 }}
    </p>
    <table v-if="changedEntries.length > 0">
      <thead><tr><th>路径</th><th>变化</th><th>hash</th></tr></thead>
      <tbody>
        <tr v-for="entry in changedEntries" :key="entry.kind + entry.path">
          <td>{{ entry.path }}</td>
          <td><StatusBadge :tone="entry.kind === 'modified' ? 'warn' : 'brand'" :text="entry.kind" /></td>
          <td><code>{{ shortHash(entry.hash) }}</code></td>
        </tr>
      </tbody>
    </table>
    <p v-else class="badge ok">与基线一致</p>

    <h3>影响分析（spec diff --impact）</h3>
    <div class="row">
      <label class="muted">
        预演 change 归档后
        <select v-model="impactChange" @change="loadImpact">
          <option value="">（只看当前工作区）</option>
          <option v-for="change in changeNames" :key="change" :value="change">{{ change }}</option>
        </select>
      </label>
      <span class="grow" />
      <span v-if="impact" class="muted">
        文件 {{ impact.summary.files_changed }} · 锚点 {{ impact.summary.anchors_changed }} · 受影响任务
        {{ impact.summary.tasks_affected }}
      </span>
      <StatusBadge
        v-if="impact"
        :tone="impact.summary.highest_severity === 'none' ? 'ok' : impact.summary.highest_severity === 'high' ? 'err' : 'warn'"
        :text="'最高 ' + impact.summary.highest_severity"
      />
    </div>
    <p v-if="impact && impact.summary.tasks_affected === 0" class="muted">没有冻结任务受影响。</p>
    <table v-if="impact && impact.affected_tasks.length > 0">
      <thead><tr><th>任务</th><th>锚点</th><th>变化</th><th>严重度</th><th>说明</th></tr></thead>
      <tbody>
        <tr v-for="task in impact.affected_tasks" :key="task.goal + '/' + task.task">
          <td><b>{{ task.goal }}/{{ task.task }}</b> <span class="muted">{{ task.task_status }}</span></td>
          <td>{{ task.anchor ?? '—' }}</td>
          <td>{{ task.change }}</td>
          <td><StatusBadge :tone="severityTone(task.severity)" :text="task.severity" /></td>
          <td class="muted">{{ task.message }}</td>
        </tr>
      </tbody>
    </table>
    <p v-if="impact && impact.untracked_changes.length > 0" class="muted">
      改了但没有任务引用的 spec：{{ impact.untracked_changes.join(', ') }}
    </p>

    <h3>一致性门禁（spec verify）</h3>
    <div v-for="(finding, index) in verify?.findings ?? []" :key="index" class="finding" :class="{ warning: finding.severity === 'warning' }">
      [{{ finding.severity }}] {{ finding.code }} <span class="muted">{{ finding.subject }}</span> {{ finding.message }}
    </div>
    <p v-if="verify && verify.findings.length === 0" class="badge ok">0 finding</p>

    <h3>冻结任务漂移（spec drift）</h3>
    <p class="muted">扫描任务 {{ drift?.scannedTasks ?? 0 }} · 漂移 {{ drift?.drift.length ?? 0 }}</p>
    <table v-if="drift && drift.drift.length > 0">
      <thead><tr><th>任务</th><th>spec</th><th>类型</th><th>严重度</th><th>hash</th></tr></thead>
      <tbody>
        <tr v-for="entry in drift.drift" :key="entry.goal + '/' + entry.task + entry.spec_ref">
          <td><b>{{ entry.goal }}/{{ entry.task }}</b></td>
          <td>{{ entry.spec_ref }}#{{ entry.spec_anchor ?? '—' }}</td>
          <td>{{ entry.kind }}</td>
          <td><StatusBadge :tone="severityTone(entry.severity)" :text="entry.severity" /></td>
          <td class="muted"><code>{{ shortHash(entry.frozen_hash) }} → {{ shortHash(entry.current_hash) }}</code></td>
        </tr>
      </tbody>
    </table>
    <p v-else-if="drift" class="badge ok">无漂移</p>
    <p v-if="drift && drift.unresolvable.length > 0" class="muted">
      版本仓缺少冻结内容，无法做锚点级比对：{{ drift.unresolvable.length }} 项（先运行 spec lock）
    </p>

    <h3>跨文件引用校验（spec validate）</h3>
    <p v-if="validation === null" class="muted">点上方「校验引用」运行。</p>
    <template v-else>
      <p class="badge" :class="validation.valid ? 'ok' : 'err'">
        {{ validation.valid ? '0 error' : 'has error' }} · {{ validation.findings.length }} findings
      </p>
      <div v-for="(finding, index) in validation.findings" :key="index" class="finding" :class="{ warning: finding.severity === 'warning' }">
        [{{ finding.severity }}] {{ finding.code }} <span class="muted">{{ finding.path }}</span> {{ finding.message }}
      </div>
    </template>
  </div>
</template>

<script setup lang="ts">
import { computed, onMounted, ref, watch } from 'vue';
import StatusBadge from '../../../components/StatusBadge.vue';
import { errorMessage } from '../../../api/client';
import { refreshCounter } from '../../../composables/useRefresh';
import { useProjectStore } from '../../../stores/project';
import { useToastStore } from '../../../stores/toasts';
import type {
  ChangeState,
  SpecDiffResult,
  SpecDriftReport,
  SpecDriftSeverity,
  SpecImpactReport,
  SpecLockResult,
  SpecValidationResult,
  SpecVerifyResult,
} from '../../../api/types';
import { shortHash } from '../../../utils/format';

const project = useProjectStore();
const toasts = useToastStore();

const verify = ref<SpecVerifyResult | null>(null);
const diff = ref<SpecDiffResult | null>(null);
const drift = ref<SpecDriftReport | null>(null);
const impact = ref<SpecImpactReport | null>(null);
const validation = ref<SpecValidationResult | null>(null);
const changeNames = ref<string[]>([]);
const impactChange = ref('');
const busy = ref(false);

const changedEntries = computed(() => {
  const current = diff.value;
  if (current === null) return [];
  return [
    ...current.modified.map((entry) => ({ kind: 'modified', path: entry.path, hash: entry.hash })),
    ...current.added.map((entry) => ({ kind: 'added', path: entry.path, hash: entry.hash })),
    ...current.removed.map((entry) => ({ kind: 'removed', path: entry.path, hash: entry.hash })),
  ];
});

function severityTone(severity: SpecDriftSeverity | 'none'): 'ok' | 'warn' | 'err' | 'brand' {
  if (severity === 'high') return 'err';
  if (severity === 'medium') return 'warn';
  if (severity === 'low') return 'brand';
  return 'ok';
}

async function loadImpact(): Promise<void> {
  try {
    impact.value = await project.projectApi<SpecImpactReport>('/spec/impact', {
      query: impactChange.value === '' ? undefined : { change: impactChange.value },
    });
  } catch (error) {
    toasts.error('影响分析失败', errorMessage(error));
  }
}

async function loadAll(): Promise<void> {
  busy.value = true;
  try {
    const [verifyData, diffData, driftData, changes] = await Promise.all([
      project.projectApi<SpecVerifyResult>('/spec/verify'),
      project.projectApi<SpecDiffResult>('/spec/diff'),
      project.projectApi<SpecDriftReport>('/spec/drift'),
      project.projectApi<{ changes: ChangeState[] }>('/changes'),
    ]);
    verify.value = verifyData;
    diff.value = diffData;
    drift.value = driftData;
    changeNames.value = changes.changes.filter((change) => !change.archived).map((change) => change.name);
    await loadImpact();
  } catch (error) {
    toasts.error('扫描失败', errorMessage(error));
  } finally {
    busy.value = false;
  }
}

async function lock(): Promise<void> {
  busy.value = true;
  try {
    const result = await project.projectApi<SpecLockResult>('/spec/lock', { method: 'POST', body: {} });
    await loadAll();
    toasts.success('已建立基线', '登记 ' + result.recorded.length + ' 份 spec 的版本与 hash');
  } catch (error) {
    toasts.error('建立基线失败', errorMessage(error));
  } finally {
    busy.value = false;
  }
}

async function validate(): Promise<void> {
  busy.value = true;
  try {
    validation.value = await project.projectApi<SpecValidationResult>('/spec/validate', { method: 'POST' });
  } catch (error) {
    toasts.error('校验失败', errorMessage(error));
  } finally {
    busy.value = false;
  }
}

onMounted(loadAll);
watch(() => refreshCounter('specs'), () => void loadAll());
</script>
