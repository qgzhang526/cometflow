<template>
  <div class="card">
    <div class="tabs">
      <button v-for="tab in TABS" :key="tab.id" class="tab" :class="{ active: activeTab === tab.id }" @click="activeTab = tab.id">
        {{ tab.label }}
      </button>
    </div>

    <!-- Skills -->
    <div v-if="activeTab === 'skills'">
      <div class="row">
        <span class="muted">{{ skills.length }} 个已安装 skill（.cometflow/skills）</span>
        <span class="grow" />
        <button class="ghost" @click="loadSkills">刷新</button>
      </div>
      <p v-if="skills.length === 0" class="empty">
        还没有安装 skill。用 <code>cometflow skill add &lt;目录&gt;</code> 安装，
        或用 <code>cometflow skill import &lt;源&gt; &lt;名字&gt;</code> 带风险扫描地导入。
      </p>
      <table v-else>
        <thead><tr><th>名称</th><th>版本</th><th>作者</th><th>文件</th><th /></tr></thead>
        <tbody>
          <tr v-for="skill in skills" :key="skill.name">
            <td><b>{{ skill.name }}</b><div class="muted">{{ skill.description }}</div></td>
            <td>{{ skill.version }}</td>
            <td class="muted">{{ skill.author ?? '—' }}</td>
            <td class="muted">{{ skill.files.length }} 个</td>
            <td><button class="ghost" @click="openSkill(skill.name)">查看</button></td>
          </tr>
        </tbody>
      </table>
    </div>

    <!-- Bundle -->
    <div v-else-if="activeTab === 'bundle'">
      <div class="row">
        <span class="muted">manifest: .cometflow/bundle.yaml</span>
        <span class="grow" />
        <button class="ghost" @click="loadBundle">刷新</button>
      </div>
      <p v-if="bundle?.manifest === null" class="empty">
        还没有 bundle。用 <code>cometflow bundle create &lt;name&gt;</code> 建 manifest，
        再 <code>bundle compile</code> / <code>bundle distribute --platform &lt;平台&gt;</code>。
      </p>
      <template v-else-if="bundle">
        <p>
          <b>{{ bundle.manifest?.name }}</b>
          <span class="badge brand">v{{ bundle.manifest?.version }}</span>
          <span class="muted"> · 引用 {{ bundle.manifest?.skills.length ?? 0 }} 个 skill</span>
        </p>
        <div v-if="bundle.error" class="finding">编译失败：{{ bundle.error }}</div>
        <template v-else>
          <p class="muted">编译后会分发 {{ bundle.compiled?.files.length ?? 0 }} 个文件：</p>
          <table>
            <thead><tr><th>skill</th><th>源路径</th><th>产物文件</th></tr></thead>
            <tbody>
              <tr v-for="skill in bundle.manifest?.skills ?? []" :key="skill.name">
                <td><b>{{ skill.name }}</b></td>
                <td class="muted">{{ skill.path }}</td>
                <td class="muted">
                  {{ (bundle.compiled?.files ?? []).filter((file) => file.startsWith(skill.name + '/')).join(', ') || '—' }}
                </td>
              </tr>
            </tbody>
          </table>
        </template>
        <p class="muted">支持的平台：{{ bundle.platforms.join(', ') }}（分发由 CLI 执行，界面只做预览）。</p>
      </template>
    </div>

    <!-- Classic -->
    <div v-else-if="activeTab === 'classic'">
      <div class="row">
        <span class="muted">{{ classic.length }} 个 classic change</span>
        <span class="grow" />
        <button class="ghost" @click="loadClassic">刷新</button>
      </div>
      <p class="muted">
        Classic 是与 native change 并存的另一条工作流（open → design → build → verify → archive）。
        界面只读，推进仍走 <code>cometflow classic transition</code>。
      </p>
      <p v-if="classic.length === 0" class="empty">
        没有 classic change。用 <code>cometflow classic new &lt;name&gt; --goal G1 --task T1</code> 创建。
      </p>
      <table v-else>
        <thead><tr><th>名称</th><th>goal / task</th><th>profile</th><th>phase</th><th>状态</th></tr></thead>
        <tbody>
          <tr v-for="change in classic" :key="change.name">
            <td><b>{{ change.name }}</b></td>
            <td>{{ change.goal }} / {{ change.task }}</td>
            <td>{{ change.profile }}</td>
            <td><StatusBadge :tone="change.archived ? 'gray' : 'ok'" :text="change.phase" /></td>
            <td><StatusBadge :tone="change.archived ? 'gray' : 'brand'" :text="change.archived ? 'archived' : 'active'" /></td>
          </tr>
        </tbody>
      </table>
    </div>

    <!-- Hook 预览 -->
    <div v-else>
      <h3>写保护状态（ADR 0023）</h3>
      <p class="muted">
        与 <code>cometflow hook status</code> 同源：装没装、条目与守卫脚本是否漂移、守卫要调用的 CLI 能否解析。
        只有 claude-code 支持安装，另外两个平台是「暂不支持」，不是「未安装」。
      </p>
      <p v-if="hookStatus === null" class="muted">加载中…</p>
      <table v-else>
        <thead><tr><th>平台</th><th>状态</th><th>条目</th><th>守卫脚本</th><th>守卫调用的 CLI</th></tr></thead>
        <tbody>
          <tr v-for="entry in hookStatus" :key="entry.platform">
            <td><b>{{ entry.platform }}</b></td>
            <td>
              <StatusBadge v-if="!entry.supported" tone="gray" text="暂不支持安装" />
              <StatusBadge v-else-if="entry.installed && entry.guardOutdated" tone="warn" text="已安装 · 需更新" />
              <StatusBadge v-else-if="entry.installed" tone="ok" text="已安装" />
              <StatusBadge v-else tone="gray" text="未安装（可选）" />
            </td>
            <td>{{ entry.entries }}</td>
            <td class="muted">
              {{ entry.guardExists ? '存在' : '缺失' }}<template v-if="entry.drift"> · {{ entry.drift }}</template>
            </td>
            <td class="muted">
              {{ entry.cli.command }}
              <template v-if="!entry.cli.resolved"> · 解析不到（{{ entry.cli.detail ?? '未知原因' }}）</template>
            </td>
          </tr>
        </tbody>
      </table>
      <p class="muted">
        安装或更新走 <code>cometflow hook install . --platform claude-code</code>，卸载走
        <code>hook uninstall</code>——装配动作会改机器上的配置，界面只做状态与判定预览。
      </p>

      <h3>写入判定预览</h3>
      <p class="muted">
       预览「这次写入会不会被守卫拦下」。判定与 <code>cometflow hook check</code> 完全同源：
        <code>.cometflow</code> 一律不可写；多个活跃 change 且没有 current-change 指针时 fail closed；
        build 阶段写模块外文件会被拒绝。路径按项目根解析。
      </p>
      <div class="toolbar">
        <input v-model="hookTarget" placeholder="src/core/index.ts" style="width: 320px" />
        <select v-model="hookEvent">
          <option value="write">write</option>
          <option value="edit">edit</option>
        </select>
        <button class="primary" :disabled="hookBusy" @click="checkHook">检查</button>
      </div>
      <div v-if="hookResult" :class="hookResult.decision.allowed ? '' : 'finding'">
        <StatusBadge :tone="hookResult.decision.allowed ? 'ok' : 'err'" :text="hookResult.decision.allowed ? 'allowed' : 'denied'" />
        <span> {{ hookResult.decision.reason }}</span>
        <p v-if="hookResult.decision.hint" class="muted">{{ hookResult.decision.hint }}</p>
      </div>

      <!-- 被 current-change 挡住时，就地给出恢复路径：否则用户只能回 CLI 敲 change select。 -->
      <div v-if="needsPointer" class="toolbar" style="margin-top: 10px">
        <span class="muted">设为当前 change 后再检查：</span>
        <select v-model="pointerDraft">
          <option value="">选择 change…</option>
          <option v-for="change in activeChanges" :key="change.name" :value="change.name">
            {{ change.name }}（{{ change.phase }}）
          </option>
        </select>
        <button class="primary" :disabled="pointerDraft === '' || pointerBusy" @click="selectCurrentAndRecheck">
          {{ pointerBusy ? '处理中…' : '设为当前并重新检查' }}
        </button>
      </div>
    </div>
  </div>

  <ModalCard v-if="skillDetail" :title="skillDetail.definition.name" wide @close="skillDetail = null">
    <p class="muted">
      v{{ skillDetail.definition.version }}<template v-if="skillDetail.definition.author"> · {{ skillDetail.definition.author }}</template>
      · {{ skillDetail.files.length }} 个文件
    </p>
    <p>{{ skillDetail.definition.description }}</p>
    <p class="muted">文件：{{ skillDetail.files.join(', ') }}</p>
    <pre class="mdblock">{{ skillDetail.content ?? '(SKILL.md 读不到)' }}</pre>
    <template #footer>
      <button @click="skillDetail = null">关闭</button>
    </template>
  </ModalCard>
</template>

<script setup lang="ts">
import { computed, onMounted, ref, watch } from 'vue';
import ModalCard from '../../components/ModalCard.vue';
import StatusBadge from '../../components/StatusBadge.vue';
import { errorMessage } from '../../api/client';
import { useProjectStore } from '../../stores/project';
import { useToastStore } from '../../stores/toasts';
import type {
  BundleResponse,
  ClassicResponse,
  ClassicState,
  ChangeState,
  HookCheckResponse,
  HookStatus,
  HookStatusResponse,
  SkillDetail,
  SkillsResponse,
  SkillSummary,
} from '../../api/types';

const TABS = [
  { id: 'skills', label: 'Skills' },
  { id: 'bundle', label: 'Bundle' },
  { id: 'classic', label: 'Classic' },
  { id: 'hook', label: 'Hook 预览' },
] as const;

const project = useProjectStore();
const toasts = useToastStore();

const activeTab = ref<(typeof TABS)[number]['id']>('skills');
const skills = ref<SkillSummary[]>([]);
const skillDetail = ref<SkillDetail | null>(null);
const bundle = ref<BundleResponse | null>(null);
const classic = ref<ClassicState[]>([]);
const hookTarget = ref('src/core/index.ts');
const hookEvent = ref<'write' | 'edit'>('write');
const hookResult = ref<HookCheckResponse | null>(null);
const hookBusy = ref(false);
const hookStatus = ref<HookStatus[] | null>(null);
const pointerDraft = ref('');
const pointerBusy = ref(false);
const activeChanges = ref<ChangeState[]>([]);

/**
 * 这两种拒绝不是「这个改动违规」，而是「守卫不知道这次写入属于谁」——
 * 它们有确定的恢复路径（设 current-change 指针），所以界面必须就地给出，而不是只报个 reason。
 */
const needsPointer = computed(() => {
  const reason = hookResult.value?.decision.reason ?? '';
  return reason === 'multiple-active-changes' || reason === 'stale-current-change';
});

async function loadActiveChanges(): Promise<void> {
  try {
    const data = await project.projectApi<{ changes: ChangeState[] }>('/changes');
    activeChanges.value = data.changes.filter((change) => !change.archived);
  } catch (error) {
    toasts.error('读取 change 列表失败', errorMessage(error));
  }
}

async function selectCurrentAndRecheck(): Promise<void> {
  if (pointerDraft.value === '') return;
  pointerBusy.value = true;
  try {
    await project.projectApi('/current-change', { method: 'POST', body: { name: pointerDraft.value } });
    toasts.success('已设为当前 change', pointerDraft.value);
    await checkHook();
  } catch (error) {
    toasts.error('设置失败', errorMessage(error));
  } finally {
    pointerBusy.value = false;
  }
}

async function loadSkills(): Promise<void> {
  try {
    const data = await project.projectApi<SkillsResponse>('/skills');
    skills.value = data.skills;
  } catch (error) {
    toasts.error('读取 skill 列表失败', errorMessage(error));
  }
}

async function openSkill(name: string): Promise<void> {
  try {
    skillDetail.value = await project.projectApi<SkillDetail>('/skills/' + encodeURIComponent(name));
  } catch (error) {
    toasts.error('读取 skill 失败', errorMessage(error));
  }
}

async function loadBundle(): Promise<void> {
  try {
    bundle.value = await project.projectApi<BundleResponse>('/bundles');
  } catch (error) {
    toasts.error('读取 bundle 失败', errorMessage(error));
  }
}

async function loadClassic(): Promise<void> {
  try {
    const data = await project.projectApi<ClassicResponse>('/classic');
    classic.value = data.changes;
  } catch (error) {
    toasts.error('读取 classic 失败', errorMessage(error));
  }
}

async function loadHookStatus(): Promise<void> {
  try {
    const data = await project.projectApi<HookStatusResponse>('/hook/status');
    hookStatus.value = data.platforms;
  } catch (error) {
    toasts.error('读取写保护状态失败', errorMessage(error));
  }
}

async function checkHook(): Promise<void> {
  if (hookTarget.value.trim() === '') {
    toasts.error('请填写目标路径');
    return;
  }
  hookBusy.value = true;
  hookResult.value = null;
  try {
    hookResult.value = await project.projectApi<HookCheckResponse>('/hook/check', {
      method: 'POST',
      body: { target: hookTarget.value, event: hookEvent.value },
    });
  } catch (error) {
    toasts.error('检查失败', errorMessage(error));
  } finally {
    hookBusy.value = false;
  }
}

onMounted(() => {
  void loadSkills();
  void loadBundle();
  void loadClassic();
  void loadHookStatus();
});

// 只有真的被 current-change 挡住时才去拉 change 列表：这个页签平时是只读预览，不多打一次请求。
watch(needsPointer, (blocked) => {
  if (blocked && activeChanges.value.length === 0) void loadActiveChanges();
});
</script>
