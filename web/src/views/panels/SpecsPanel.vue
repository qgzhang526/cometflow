<template>
  <div class="card">
    <div class="tabs">
      <button v-for="tab in TABS" :key="tab.id" class="tab" :class="{ active: activeTab === tab.id }" @click="activeTab = tab.id">
        {{ tab.label }}
      </button>
    </div>

    <div v-if="activeTab === 'kinds'" class="tab-panel">
      <table>
        <thead><tr><th>kind</th><th>状态</th><th>原因</th></tr></thead>
        <tbody>
          <tr v-for="(entry, kind) in manifest?.kinds ?? {}" :key="kind">
            <td><b>{{ kind }}</b></td>
            <td>
              <StatusBadge
                :tone="entry.status === 'present' ? 'ok' : entry.status === 'deferred' ? 'warn' : 'gray'"
                :text="entry.status"
              />
            </td>
            <td class="muted">{{ entry.reason }}</td>
          </tr>
        </tbody>
      </table>
    </div>

    <div v-else-if="activeTab === 'scaffold'" class="tab-panel">
      <div class="form-grid">
        <label><input v-model="scaffoldAnswers.network" type="checkbox" /> 对外网络接口/协议</label>
        <label><input v-model="scaffoldAnswers.runtimeConfig" type="checkbox" /> 运行时配置键</label>
        <label><input v-model="scaffoldAnswers.crossApiFlow" type="checkbox" /> 跨接口业务场景</label>
        <label><input v-model="scaffoldAnswers.backgroundProcess" type="checkbox" /> 常驻后台进程</label>
        <label><input v-model="scaffoldAnswers.domainDsl" type="checkbox" /> 领域 DSL / 业务不变量</label>
        <label><input v-model="scaffoldAnswers.manyErrors" type="checkbox" /> 错误码 &gt; 20</label>
        <label>
          鉴权方式
          <select v-model="scaffoldAnswers.auth">
            <option value="none">无需</option>
            <option value="machine">机机</option>
            <option value="roles">角色矩阵</option>
          </select>
        </label>
      </div>
      <button class="primary" @click="scaffold">生成/补全</button>
      <p class="muted">脚手架是幂等的：已存在的文件不会覆盖。</p>
    </div>

    <div v-else-if="activeTab === 'refs'" class="tab-panel">
      <p class="muted">
        apis: {{ index?.apis.length ?? 0 }} · entities: {{ index?.models?.entities.length ?? 0 }} · flows:
        {{ index?.flows.length ?? 0 }} · errors: {{ index?.errors.length ?? 0 }} · config keys: {{ index?.config.length ?? 0 }}
      </p>
      <div class="toolbar">
        <button @click="validate">校验引用</button>
        <span v-if="validation" class="badge" :class="validation.valid ? 'ok' : 'err'">
          {{ validation.valid ? '0 error' : 'has error' }} · {{ validation.findings.length }} findings
        </span>
      </div>
      <div
        v-for="(finding, position) in validation?.findings ?? []"
        :key="position"
        class="finding"
        :class="{ warning: finding.severity === 'warning' }"
      >
        [{{ finding.severity }}] {{ finding.code }} <span class="muted">{{ finding.path }}</span> {{ finding.message }}
      </div>
    </div>

    <div v-else class="tab-panel">
      <div class="toolbar">
        <input v-model="newSpecPath" placeholder="specs/<cap>/spec.md 或 specs/flows/<name>.md" style="width: 360px" />
        <button class="primary" @click="createSpec">+ 新建文件</button>
      </div>
      <table>
        <thead><tr><th>路径</th><th>kind</th><th /></tr></thead>
        <tbody>
          <tr v-for="entry in specs" :key="entry.path">
            <td><b>{{ entry.path }}</b></td>
            <td>{{ entry.kind }}</td>
            <td><button class="ghost" @click="openSpec(entry.path)">编辑</button></td>
          </tr>
          <tr v-if="specs.length === 0"><td colspan="3" class="muted">specs/ 目录为空</td></tr>
        </tbody>
      </table>
    </div>
  </div>

  <ModalCard v-if="editing" :title="editingPath" wide @close="closeEditor">
    <textarea v-model="editing" class="modal-textarea" />
    <p class="muted">保存会登记一次 canonical spec 变更并刷新 lock（等价于 CLI 的 spec lock）。</p>
    <template #footer>
      <button @click="closeEditor">关闭</button>
      <button class="primary" :disabled="savingSpec" @click="saveSpec">保存</button>
    </template>
  </ModalCard>
</template>

<script setup lang="ts">
import { onMounted, reactive, ref, watch } from 'vue';
import ModalCard from '../../components/ModalCard.vue';
import StatusBadge from '../../components/StatusBadge.vue';
import { errorMessage } from '../../api/client';
import { refreshCounter, resumeRefresh, suspendRefresh } from '../../composables/useRefresh';
import { useProjectStore } from '../../stores/project';
import { useToastStore } from '../../stores/toasts';
import type { InitManifest, ScaffoldAnswers, SpecEntry, SpecIndex, SpecValidationResult } from '../../api/types';

const project = useProjectStore();
const toasts = useToastStore();

const TABS = [
  { id: 'kinds', label: '12-kind 状态' },
  { id: 'scaffold', label: '脚手架' },
  { id: 'refs', label: '引用检查' },
  { id: 'files', label: 'Spec 文件' },
] as const;

const activeTab = ref<(typeof TABS)[number]['id']>('kinds');
const manifest = ref<InitManifest | null>(null);
const specs = ref<SpecEntry[]>([]);
const index = ref<SpecIndex | null>(null);
const validation = ref<SpecValidationResult | null>(null);
const newSpecPath = ref('');
const editingPath = ref('');
const editing = ref<string | null>(null);
const savingSpec = ref(false);
const scaffoldAnswers = reactive<ScaffoldAnswers>({ auth: 'none' });

async function load(): Promise<void> {
  try {
    const [manifestData, specsData, indexData] = await Promise.all([
      project.projectApi<InitManifest>('/init-manifest'),
      project.projectApi<{ entries: SpecEntry[] }>('/specs'),
      project.projectApi<SpecIndex>('/spec-index').catch(() => null),
    ]);
    manifest.value = manifestData;
    specs.value = specsData.entries;
    index.value = indexData;
  } catch (error) {
    toasts.error('加载 spec 失败', errorMessage(error));
  }
}

async function scaffold(): Promise<void> {
  try {
    await project.projectApi('/spec/scaffold', { method: 'POST', body: { answers: { ...scaffoldAnswers } } });
    await load();
    await project.refreshStatus();
    toasts.success('已生成/补全 spec kind');
  } catch (error) {
    toasts.error('脚手架失败', errorMessage(error));
  }
}

async function validate(): Promise<void> {
  try {
    validation.value = await project.projectApi<SpecValidationResult>('/spec/validate', { method: 'POST' });
  } catch (error) {
    toasts.error('校验失败', errorMessage(error));
  }
}

async function createSpec(): Promise<void> {
  const rel = newSpecPath.value.trim();
  if (rel === '') {
    toasts.error('请输入文件路径', '例如 specs/engine/spec.md 或 specs/flows/build-facility.md');
    return;
  }
  try {
    await project.projectApi('/specs', { method: 'POST', body: { path: rel, content: '' } });
    newSpecPath.value = '';
    await load();
    await openSpec(rel);
  } catch (error) {
    toasts.error('新建失败', errorMessage(error));
  }
}

async function openSpec(specPath: string): Promise<void> {
  try {
    const data = await project.projectApi<{ content: string }>('/specs/content', { query: { path: specPath } });
    editingPath.value = specPath;
    editing.value = data.content;
    suspendRefresh();
  } catch (error) {
    toasts.error('打开失败', errorMessage(error));
  }
}

function closeEditor(): void {
  editing.value = null;
  resumeRefresh();
}

async function saveSpec(): Promise<void> {
  if (editing.value === null) return;
  savingSpec.value = true;
  try {
    await project.projectApi('/specs/content', {
      method: 'PUT',
      query: { path: editingPath.value },
      body: { content: editing.value },
    });
    toasts.success('spec 已保存', editingPath.value + ' 已登记新版本');
    closeEditor();
    await load();
  } catch (error) {
    toasts.error('保存失败', errorMessage(error));
  } finally {
    savingSpec.value = false;
  }
}

onMounted(load);
watch(() => refreshCounter('specs'), () => {
  if (editing.value === null) void load();
});
</script>
