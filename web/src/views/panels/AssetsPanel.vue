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
import { onMounted, ref } from 'vue';
import ModalCard from '../../components/ModalCard.vue';
import StatusBadge from '../../components/StatusBadge.vue';
import { errorMessage } from '../../api/client';
import { useProjectStore } from '../../stores/project';
import { useToastStore } from '../../stores/toasts';
import type {
  BundleResponse,
  ClassicResponse,
  ClassicState,
  HookCheckResponse,
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
});
</script>
