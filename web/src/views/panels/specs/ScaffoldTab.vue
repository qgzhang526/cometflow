<template>
  <div>
    <div class="form-grid">
      <label><input v-model="answers.network" type="checkbox" /> 对外网络接口/协议</label>
      <label><input v-model="answers.runtimeConfig" type="checkbox" /> 运行时配置键</label>
      <label><input v-model="answers.crossApiFlow" type="checkbox" /> 跨接口业务场景</label>
      <label><input v-model="answers.backgroundProcess" type="checkbox" /> 常驻后台进程</label>
      <label><input v-model="answers.domainDsl" type="checkbox" /> 领域 DSL / 业务不变量</label>
      <label><input v-model="answers.manyErrors" type="checkbox" /> 错误码 &gt; 20</label>
      <label>
        鉴权方式
        <select v-model="answers.auth">
          <option value="none">无需</option>
          <option value="machine">机机</option>
          <option value="roles">角色矩阵</option>
        </select>
      </label>
    </div>

    <h3 style="margin-top: 18px">新增 capability 骨架</h3>
    <div class="toolbar">
      <input
        v-model="capabilityDraft"
        class="grow"
        placeholder="auth, orders（逗号或空格分隔，可留空）"
      />
      <!-- 不按 capability 名字禁用：这个按钮同时负责按上面的勾选补 root kind 骨架，可以一个名字都不填。 -->
      <button class="primary" :disabled="busy" @click="scaffold">生成 / 补全</button>
    </div>
    <p class="muted">
      骨架只含 front-matter（<code>module: internal/&lt;name&gt;</code>）与一个示例 anchor，正文是<strong>草案</strong>，
      要自己填、再在「Spec 文件」页签批准定稿。已存在的不会被覆盖（幂等）。
      capability 不由项目类型推导，所以只能在这里点名，或由 <code>plan generate</code> 的 spec-authoring 任务起草。
    </p>
    <p class="muted">
      上面勾选补出来的 root kind 骨架同样是<strong>草案</strong>：机器产的是占位内容，确认后到「Spec 文件」页签
      点「批准定稿」才算契约（草案不能参与 <code>plan freeze</code>）。
    </p>
    <p v-if="invalidNames.length > 0" class="finding warning">
      名称不合法，不会写盘：<b>{{ invalidNames.join(', ') }}</b>
      —— 只能以字母/数字/中文开头，其余可用字母、数字、<code>_</code>、<code>-</code>、<code>.</code>
    </p>
    <p v-if="existingNames.length > 0" class="muted">
      已存在，本次会被跳过：{{ existingNames.join(', ') }}
    </p>

    <div v-if="result" class="muted" style="margin-top: 8px">
      root kind：created {{ result.created.length }} · skipped {{ result.skipped.length }}
      <template v-if="result.created.length > 0">（{{ result.created.join(', ') }}）</template>
    </div>
    <div v-if="capabilityResult" class="muted">
      capability：created {{ capabilityResult.created.length }} · skipped {{ capabilityResult.skipped.length }}
      <template v-if="capabilityResult.created.length > 0">（{{ capabilityResult.created.join(', ') }}）</template>
      <template v-if="capabilityResult.skipped.length > 0">
        · 已存在、未覆盖（{{ capabilityResult.skipped.join(', ') }}）
      </template>
    </div>
    <div v-if="manifestChanged.length > 0" class="muted">
      已按磁盘事实校正 12-kind 状态：{{ manifestChanged.join(', ') }}
    </div>

    <h3 style="margin-top: 18px">已有 capability（{{ existing.length }}）</h3>
    <p class="muted">
      点一行直接打开正文编辑。状态是 spec 自己的定稿状态：草案不能参与 <code>plan freeze</code>，要先批准。
    </p>
    <p v-if="existing.length === 0" class="muted">还没有 capability spec，用上面的输入框建第一个。</p>
    <div v-else class="row">
      <button
        v-for="entry in existing"
        :key="entry.path"
        class="ghost"
        style="display: inline-flex; align-items: center; gap: 8px"
        @click="emit('open', entry.path)"
      >
        {{ entry.name }}
        <StatusBadge
          :tone="entry.status === 'draft' ? 'warn' : 'ok'"
          :text="entry.status === 'draft' ? '草案' : '已定稿'"
        />
      </button>
    </div>
  </div>
</template>

<script setup lang="ts">
import { computed, onMounted, reactive, ref, watch } from 'vue';
import { errorMessage } from '../../../api/client';
import { refreshCounter } from '../../../composables/useRefresh';
import { useProjectStore } from '../../../stores/project';
import { useToastStore } from '../../../stores/toasts';
import StatusBadge from '../../../components/StatusBadge.vue';
import type { ScaffoldAnswers, SpecEntry } from '../../../api/types';

const emit = defineEmits<{ open: [path: string] }>();

const project = useProjectStore();
const toasts = useToastStore();
const answers = reactive<ScaffoldAnswers>({ auth: 'none' });
/** 逗号/空白分隔的 capability 名；root kind 靠项目类型推导，capability 只能点名。 */
const capabilityDraft = ref('');
const busy = ref(false);
const result = ref<{ created: string[]; skipped: string[] } | null>(null);
const capabilityResult = ref<CapabilityScaffoldResult | null>(null);
const manifestChanged = ref<string[]>([]);
const existing = ref<Array<{ name: string; path: string; status: 'draft' | 'approved' }>>([]);

interface CapabilityScaffoldResult {
  created: string[];
  skipped: string[];
  invalid: string[];
}

/** 与 `capabilitySpecPath` 同一口径：在这里先判，是为了不把非法名字发出去再等一个报错。 */
const CAPABILITY_NAME = /^[\p{L}\p{N}][\p{L}\p{N}._-]*$/u;

const typedNames = computed(() =>
  capabilityDraft.value
    .split(/[,\s]+/u)
    .map((entry) => entry.trim())
    .filter((entry) => entry !== ''),
);
const validNames = computed(() => typedNames.value.filter((name) => CAPABILITY_NAME.test(name)));
const invalidNames = computed(() => typedNames.value.filter((name) => !CAPABILITY_NAME.test(name)));
const existingNames = computed(() => {
  const known = new Set(existing.value.map((entry) => entry.name));
  return validNames.value.filter((name) => known.has(name));
});

async function load(): Promise<void> {
  try {
    const data = await project.projectApi<{ entries: SpecEntry[] }>('/specs');
    existing.value = data.entries
      .filter((entry) => entry.kind === 'capability')
      .map((entry) => ({ name: entry.path.split('/')[1] ?? entry.path, path: entry.path, status: entry.status }))
      .sort((left, right) => left.name.localeCompare(right.name));
  } catch (error) {
    toasts.error('读取 capability 列表失败', errorMessage(error));
  }
}

async function scaffold(): Promise<void> {
  busy.value = true;
  try {
    const data = await project.projectApi<{
      created: string[];
      skipped: string[];
      capabilities: CapabilityScaffoldResult | null;
      manifestChanged: string[];
    }>('/spec/scaffold', {
      method: 'POST',
      body: { answers: { ...answers }, capabilities: validNames.value },
    });
    result.value = data;
    capabilityResult.value = data.capabilities;
    manifestChanged.value = data.manifestChanged ?? [];
    await project.refreshStatus();
    await load();
    toasts.success('脚手架已执行', '新增 ' + data.created.length + ' 个文件');
    if (data.capabilities !== null && data.capabilities.invalid.length > 0) {
      // 部分成功：合法名字已经建好，非法名字单独报，避免「整批都失败」的误判。
      toasts.error('部分 capability 名不合法', data.capabilities.invalid.join(', '));
    }
  } catch (error) {
    toasts.error('脚手架失败', errorMessage(error));
  } finally {
    busy.value = false;
  }
}

onMounted(load);
watch(() => refreshCounter('specs'), () => void load());
</script>
