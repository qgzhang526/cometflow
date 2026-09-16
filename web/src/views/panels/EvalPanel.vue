<template>
  <div class="card">
    <div class="row">
      <h2>评估 Eval</h2>
      <span class="grow" />
      <button class="primary" :disabled="running" @click="run">{{ running ? '运行中…' : '运行评估' }}</button>
    </div>
    <p class="muted">
      运行 <code>.cometflow/eval.yaml</code> 中的本地评估任务（sampling / 断言 / rubric），产出 Pass@k 与 Pass^k。
    </p>
  </div>

  <div v-if="activeJob" class="card">
    <div class="row">
      <StatusBadge :tone="activeJob.status === 'succeeded' ? 'ok' : activeJob.status === 'failed' ? 'err' : 'brand'" :text="activeJob.status" />
      <span class="muted">{{ activeJob.id }} · {{ relativeTime(activeJob.createdAt) }}</span>
      <span class="grow" />
      <button class="ghost" @click="jobs.drawerOpen = true">任务中心</button>
    </div>
    <pre class="logbox">{{ jobLog }}</pre>
  </div>

  <div v-if="report" class="card">
    <div class="row">
      <h2>评估报告</h2>
      <StatusBadge :tone="report.passed ? 'ok' : 'err'" :text="report.passed ? 'PASS' : 'FAIL'" />
      <span class="muted">sampling {{ report.sampling }}</span>
    </div>
    <div class="stat-grid">
      <div class="stat">
        <div class="num">{{ report.passAtK }} / {{ report.sampling }}</div>
        <div class="label">Pass@k（至少一次通过）</div>
      </div>
      <div class="stat">
        <div class="num">{{ report.passAllK }} / {{ report.sampling }}</div>
        <div class="label">Pass^k（每次都通过）</div>
      </div>
      <div class="stat">
        <div class="num">{{ (report.passAtKRate * 100).toFixed(0) }}%</div>
        <div class="label">Pass@k 率</div>
      </div>
      <div class="stat">
        <div class="num">{{ (report.passAllKRate * 100).toFixed(0) }}%</div>
        <div class="label">Pass^k 率</div>
      </div>
    </div>

    <h3>任务</h3>
    <table>
      <thead><tr><th>任务</th><th>结论</th><th>通过轮次</th><th>pass@k</th><th>pass^k</th><th /></tr></thead>
      <tbody>
        <template v-for="task in report.results" :key="task.name">
          <tr>
            <td><b>{{ task.name }}</b></td>
            <td><StatusBadge :tone="task.passed ? 'ok' : 'err'" :text="task.passed ? 'passed' : 'failed'" /></td>
            <td>{{ task.passedRuns }} / {{ task.runs }}</td>
            <td>{{ task.passAtK ? '✔' : '✘' }}</td>
            <td>{{ task.passAllK ? '✔' : '✘' }}</td>
            <td><button class="ghost" @click="toggleTask(task.name)">{{ openTask === task.name ? '收起' : '明细' }}</button></td>
          </tr>
          <tr v-if="openTask === task.name">
            <td colspan="6">
              <div v-for="(run, index) in task.runResults" :key="index" class="run-detail">
                <div class="row">
                  <span class="muted">第 {{ index + 1 }} 轮</span>
                  <StatusBadge :tone="run.passed ? 'ok' : 'err'" :text="run.passed ? 'passed' : 'failed'" />
                  <span class="muted">exit={{ run.exitCode }}<template v-if="run.timedOut"> · timeout</template></span>
                </div>
                <pre class="logbox">{{ (run.stdout + '\n' + run.stderr).trim() || '(无输出)' }}</pre>
              </div>
            </td>
          </tr>
        </template>
      </tbody>
    </table>

    <template v-if="report.rubric.length > 0">
      <h3>Rubric</h3>
      <table>
        <thead><tr><th>ID</th><th>描述</th><th>任务</th><th>通过率</th></tr></thead>
        <tbody>
          <tr v-for="item in report.rubric" :key="item.id">
            <td><b>{{ item.id }}</b></td>
            <td>{{ item.description }}</td>
            <td class="muted">{{ item.task }}</td>
            <td><StatusBadge :tone="item.passed ? 'ok' : 'err'" :text="(item.passRate * 100).toFixed(0) + '%'" /></td>
          </tr>
        </tbody>
      </table>
    </template>

    <template v-if="report.judge">
      <h3>LLM Judge</h3>
      <p>
        <StatusBadge
          :tone="report.judge.verdict === 'pass' ? 'ok' : report.judge.verdict === 'fail' ? 'err' : 'warn'"
          :text="report.judge.provider + ' · ' + report.judge.verdict"
        />
      </p>
      <p v-for="(note, index) in report.judge.notes" :key="index" class="muted">{{ note }}</p>
    </template>
  </div>

  <div v-if="history.length > 0" class="card">
    <div class="row">
      <h2>历史与对比</h2>
      <span class="grow" />
      <span class="muted">{{ history.length }} 次评估（任务中心持久化，重启后仍在）</span>
    </div>
    <table>
      <thead><tr><th>时间</th><th>结论</th><th>Pass@k</th><th>Pass^k</th><th>状态</th><th /></tr></thead>
      <tbody>
        <tr v-for="run in history" :key="run.id">
          <td class="muted">{{ relativeTime(run.createdAt) }}</td>
          <td>
            <StatusBadge
              :tone="evalOf(run)?.passed ? 'ok' : 'err'"
              :text="evalOf(run)?.passed ? 'PASS' : 'FAIL'"
            />
          </td>
          <td>{{ formatRate(evalOf(run)?.passAtKRate) }}</td>
          <td>{{ formatRate(evalOf(run)?.passAllKRate) }}</td>
          <td>
            <StatusBadge v-if="run.id === activeJobId" tone="brand" text="当前" />
            <StatusBadge v-else-if="run.id === compareId" tone="warn" text="对比轮" />
            <span v-else class="muted">—</span>
          </td>
          <td>
            <button class="ghost" :disabled="run.id === compareId" @click="compareId = run.id">设为对比轮</button>
            <button class="ghost" :disabled="run.id === activeJobId" @click="compareId = run.id; activeJobId = run.id">
              打开
            </button>
          </td>
        </tr>
      </tbody>
    </table>

    <template v-if="comparison !== null">
      <h3>两轮对比（对比轮 → 当前）</h3>
      <table>
        <thead><tr><th>指标</th><th>对比轮</th><th>当前</th><th>变化</th></tr></thead>
        <tbody>
          <tr v-for="row in comparison.rows" :key="row.label">
            <td><b>{{ row.label }}</b></td>
            <td>{{ row.before }}</td>
            <td>{{ row.after }}</td>
            <td>
              <StatusBadge :tone="row.tone" :text="row.delta" />
            </td>
          </tr>
        </tbody>
      </table>
      <template v-if="comparison.flipped.length > 0">
        <h3>结论发生变化的任务</h3>
        <table>
          <thead><tr><th>任务</th><th>对比轮</th><th>当前</th></tr></thead>
          <tbody>
            <tr v-for="task in comparison.flipped" :key="task.name">
              <td><b>{{ task.name }}</b></td>
              <td><StatusBadge :tone="task.before ? 'ok' : 'err'" :text="task.before ? 'passed' : 'failed'" /></td>
              <td><StatusBadge :tone="task.after ? 'ok' : 'err'" :text="task.after ? 'passed' : 'failed'" /></td>
            </tr>
          </tbody>
        </table>
      </template>
      <p v-else class="muted">两轮之间没有任何任务改变结论。</p>
    </template>
    <p v-else class="muted">选一轮作为「对比轮」，就能看到与当前报告的逐项差异与翻转的任务。</p>
  </div>
</template>

<script setup lang="ts">
import { computed, onMounted, ref, watch } from 'vue';
import StatusBadge from '../../components/StatusBadge.vue';
import { errorMessage } from '../../api/client';
import { useJobsStore } from '../../stores/jobs';
import { useProjectStore } from '../../stores/project';
import { useToastStore } from '../../stores/toasts';
import type { EvalReport } from '../../api/types';
import type { JobRecord } from '../../api/types';
import { formatRate, relativeTime } from '../../utils/format';

const project = useProjectStore();
const jobs = useJobsStore();
const toasts = useToastStore();

const activeJobId = ref<string | null>(null);
const openTask = ref('');
const compareId = ref<string | null>(null);

const activeJob = computed(() => (activeJobId.value === null ? null : jobs.jobs[activeJobId.value] ?? null));
const running = computed(() => activeJob.value?.status === 'queued' || activeJob.value?.status === 'running');
const report = computed<EvalReport | null>(() => {
  const raw = activeJob.value?.result as { report?: EvalReport } | undefined;
  return raw?.report ?? null;
});
const jobLog = computed(() => {
  const job = activeJob.value;
  if (job === null) return '';
  const lines = job.logTail.join('\n');
  if (job.status === 'failed') return lines + '\n[failed] ' + (job.error ?? '');
  if (job.status === 'succeeded') return lines + '\n[succeeded]';
  return lines === '' ? '等待日志…' : lines;
});

/** 这个 job 的评估报告（没有报告的历史任务——比如失败的——不参与对比）。 */
function evalOf(job: JobRecord): EvalReport | null {
  return (job.result as { report?: EvalReport } | undefined)?.report ?? null;
}

/**
 * 同一项目下带报告的历史评估。
 *
 * 任务中心本来就持久化这些 job（`runtime/jobs/`），所以「历史对比」不需要新端点，
 * 只需要把已经存下来的报告按时间排开、算一次差异。
 */
const history = computed(() =>
  jobs
    .forProject(project.currentId)
    .filter((job) => job.kind === 'eval-run' && evalOf(job) !== null)
    .sort((left, right) => right.createdAt.localeCompare(left.createdAt)),
);

const compareJob = computed(() => (compareId.value === null ? null : jobs.jobs[compareId.value] ?? null));

/** 两轮对比：比率类指标给百分比与差值的颜色方向，另附「结论翻转」的任务清单。 */
const comparison = computed(() => {
  const before = compareJob.value === null ? null : evalOf(compareJob.value);
  const after = report.value;
  if (before === null || after === null) return null;

  const rateRow = (label: string, beforeValue: number, afterValue: number) => {
    const delta = afterValue - beforeValue;
    return {
      label,
      before: formatRate(beforeValue),
      after: formatRate(afterValue),
      delta: (delta >= 0 ? '+' : '') + (delta * 100).toFixed(1) + '%',
      tone: (delta > 0 ? 'ok' : delta < 0 ? 'err' : 'gray') as 'ok' | 'err' | 'gray',
    };
  };
  const countRow = (label: string, beforeValue: number, afterValue: number) => {
    const delta = afterValue - beforeValue;
    return {
      label,
      before: String(beforeValue),
      after: String(afterValue),
      delta: (delta >= 0 ? '+' : '') + delta,
      tone: (delta > 0 ? 'ok' : delta < 0 ? 'err' : 'gray') as 'ok' | 'err' | 'gray',
    };
  };

  const beforeByName = new Map(before.results.map((task) => [task.name, task]));
  const flipped = after.results
    .filter((task) => beforeByName.has(task.name) && beforeByName.get(task.name)!.passed !== task.passed)
    .map((task) => ({ name: task.name, before: beforeByName.get(task.name)!.passed, after: task.passed }));

  return {
    rows: [
      rateRow('Pass@k 率', before.passAtKRate, after.passAtKRate),
      rateRow('Pass^k 率', before.passAllKRate, after.passAllKRate),
      countRow('通过轮次（Pass@k）', before.passAtK, after.passAtK),
      countRow('全通过轮次（Pass^k）', before.passAllK, after.passAllK),
    ],
    flipped,
  };
});

/** 刷新页面后，从任务列表里找回最近一次 eval 的 job（结果随 job 一起返回）。 */
function adoptLatestJob(): void {
  if (activeJobId.value !== null) return;
  const latest = jobs
    .forProject(project.currentId)
    .find((job) => job.kind === 'eval-run' && job.result !== undefined);
  if (latest) activeJobId.value = latest.id;
}

async function run(): Promise<void> {
  try {
    const data = await project.projectApi<{ jobId: string }>('/eval/run', { method: 'POST', body: {} });
    activeJobId.value = data.jobId;
    openTask.value = '';
    await jobs.track(data.jobId);
  } catch (error) {
    toasts.error('启动评估失败', errorMessage(error));
  }
}

function toggleTask(name: string): void {
  openTask.value = openTask.value === name ? '' : name;
}

onMounted(() => {
  void jobs.load().catch(() => undefined).then(adoptLatestJob);
});

watch(
  () => jobs.list.map((job) => job.id + ':' + job.status).join(','),
  () => adoptLatestJob(),
);
</script>
