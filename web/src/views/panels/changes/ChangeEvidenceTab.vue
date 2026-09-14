<template>
  <div>
    <div class="row">
      <span class="muted">{{ evidence?.artifacts.length ?? 0 }} 个证据文件</span>
      <span class="grow" />
      <button class="ghost" @click="load">刷新</button>
    </div>

    <div v-for="transaction in evidence?.incompleteTransactions ?? []" :key="transaction.txId" class="finding">
      归档事务未完成（进程被杀，specs/ 可能处于中间态）：{{ transaction.txId }} · {{ transaction.status }} · {{ transaction.dir }}
    </div>

    <p v-if="(evidence?.proposedSpecs.length ?? 0) > 0" class="muted">
      提案 spec（归档时应用）：{{ evidence?.proposedSpecs.join(', ') }}
    </p>
    <p v-if="(evidence?.staleVerification.length ?? 0) > 0" class="muted">
      已作废的验收记录（rebase 后改名留档）：{{ evidence?.staleVerification.join(', ') }}
    </p>

    <p v-if="(evidence?.artifacts.length ?? 0) === 0" class="empty">
      还没有证据文件。运行一次「验收」会写 <code>changes/&lt;name&gt;/verification.md</code>；<code>brief.md</code> 在创建 change 时生成。
    </p>

    <template v-else>
      <div class="tabs">
        <button
          v-for="artifact in evidence?.artifacts ?? []"
          :key="artifact.name"
          class="tab"
          :class="{ active: active === artifact.name }"
          @click="active = artifact.name"
        >
          {{ artifact.name }} <span class="muted">{{ artifact.bytes }}B</span>
        </button>
      </div>
      <pre class="mdblock">{{ activeArtifact?.content ?? '' }}</pre>
    </template>
  </div>
</template>

<script setup lang="ts">
import { computed, onMounted, ref, watch } from 'vue';
import { errorMessage } from '../../../api/client';
import { refreshCounter } from '../../../composables/useRefresh';
import { useProjectStore } from '../../../stores/project';
import { useToastStore } from '../../../stores/toasts';
import type { ChangeEvidence } from '../../../api/types';

const props = defineProps<{ change: string }>();

const project = useProjectStore();
const toasts = useToastStore();
const evidence = ref<ChangeEvidence | null>(null);
const active = ref('');

const activeArtifact = computed(() => evidence.value?.artifacts.find((entry) => entry.name === active.value) ?? null);

async function load(): Promise<void> {
  try {
    evidence.value = await project.projectApi<ChangeEvidence>(
      '/changes/' + encodeURIComponent(props.change) + '/evidence',
    );
    if (activeArtifact.value === null) active.value = evidence.value.artifacts[0]?.name ?? '';
  } catch (error) {
    toasts.error('读取证据失败', errorMessage(error));
  }
}

onMounted(load);
watch(() => props.change, () => void load());
watch(() => refreshCounter('changes'), () => void load());
</script>
