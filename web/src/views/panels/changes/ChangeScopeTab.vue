<template>
  <div>
    <div class="row">
      <span class="muted">
        module <b>{{ scope?.module ?? '(unbounded)' }}</b> · baseline
        {{ scope?.baseline_captured_at ?? '(missing)' }} · 扫描文件 {{ scope?.file_count ?? 0 }}
      </span>
      <span class="grow" />
      <StatusBadge v-if="scope" :tone="scope.complete ? 'ok' : 'warn'" :text="scope.complete ? '快照完整' : '快照不完整'" />
      <button class="ghost" @click="load">重新采集</button>
    </div>

    <p v-if="scope && scope.allow.length > 0" class="muted">允许越界路径：{{ scope.allow.join(', ') }}</p>

    <div v-if="scope && scope.baseline_captured_at === null" class="finding warning">
      无法判定实现范围：该 change 创建于实现范围基线机制之前。重建 change 或对它执行「重新冻结基线（rebase）」后才有比对基准。
    </div>

    <template v-else-if="scope">
      <div v-if="scope.unattributed.length > 0" class="finding">
        越界改动（既不在 spec 声明的模块内，也不在 allow 列表里）：
        <ul>
          <li v-for="path in scope.unattributed" :key="path"><code>{{ path }}</code></li>
        </ul>
      </div>
      <p v-else class="badge ok">所有改动都在模块边界内</p>

      <table v-if="scope.changes.length > 0">
        <thead><tr><th>变化</th><th>路径</th><th>归属</th></tr></thead>
        <tbody>
          <tr v-for="entry in scope.changes" :key="entry.path + entry.kind">
            <td><StatusBadge :tone="entry.kind === 'added' ? 'brand' : entry.kind === 'removed' ? 'err' : 'warn'" :text="entry.kind" /></td>
            <td><code>{{ entry.path }}</code></td>
            <td>
              <StatusBadge v-if="entry.attributed" tone="ok" :text="entry.attribution" />
              <StatusBadge v-else tone="err" text="OUTSIDE" />
            </td>
          </tr>
        </tbody>
      </table>
      <p v-else class="muted">与基线相比没有代码改动。</p>
    </template>

    <div v-if="scope && scope.omittedCount > 0" class="finding warning">
      快照跳过了 {{ scope.omittedCount }} 个路径（超过单文件 1MiB 或文件数上限），这些文件不参与比对：
      <ul>
        <li v-for="entry in scope.omitted" :key="entry.path">
          <code>{{ entry.path }}</code> — {{ entry.reason }}<template v-if="entry.size !== null"> ({{ entry.size }} bytes)</template>
        </li>
      </ul>
      <p v-if="scope.omissionOverflow" class="muted">
        另有 {{ scope.omissionOverflow.count }} 条未展开（明细上限 200 条，摘要哈希 {{ shortHash(scope.omissionOverflow.hash) }}）。
      </p>
    </div>
  </div>
</template>

<script setup lang="ts">
import { onMounted, ref, watch } from 'vue';
import StatusBadge from '../../../components/StatusBadge.vue';
import { errorMessage } from '../../../api/client';
import { refreshCounter } from '../../../composables/useRefresh';
import { useProjectStore } from '../../../stores/project';
import { useToastStore } from '../../../stores/toasts';
import type { ImplementationScopeReport } from '../../../api/types';
import { shortHash } from '../../../utils/format';

const props = defineProps<{ change: string }>();

const project = useProjectStore();
const toasts = useToastStore();
const scope = ref<ImplementationScopeReport | null>(null);

async function load(): Promise<void> {
  try {
    scope.value = await project.projectApi<ImplementationScopeReport>(
      '/changes/' + encodeURIComponent(props.change) + '/scope',
    );
  } catch (error) {
    toasts.error('读取实现范围失败', errorMessage(error));
  }
}

onMounted(load);
watch(() => props.change, () => void load());
watch(() => refreshCounter('changes'), () => void load());
</script>
