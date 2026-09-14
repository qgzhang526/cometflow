<template>
  <div class="home">
    <div class="hero">
      <h1>CometFlow</h1>
      <p>全时运行的自主 Agent 开发平台 · 把 CLI 工作流可视化</p>
      <div class="actions">
        <button class="primary" @click="startWizard">＋ 新建项目</button>
        <button @click="openPickerForImport">打开已有项目</button>
      </div>
    </div>

    <div class="tokenbar card">
      <span v-if="session.hasToken" class="muted">token 已配置</span>
      <template v-else>
        <input v-model="tokenDraft" placeholder="粘贴 serve 启动时打印的 token" style="width: 320px" />
        <button @click="saveToken">保存</button>
      </template>
    </div>

    <div v-if="wizardStep > 0" class="card wizard">
      <div class="steps">
        <div v-for="step in 3" :key="step" class="step" :class="{ active: wizardStep === step }">
          {{ ['① 基本信息', '② 项目类型', '③ 预览创建'][step - 1] }}
        </div>
      </div>

      <div v-if="wizardStep === 1" class="form-grid">
        <div class="row">
          <label class="grow">项目名称 <input v-model="wizard.name" placeholder="my-platform" /></label>
          <label class="grow">
            本地路径
            <span class="row">
              <input v-model="wizard.path" placeholder="选择或输入目录路径" class="grow" />
              <button type="button" @click="pickerFor = 'wizard'">浏览…</button>
            </span>
          </label>
        </div>
        <div class="row">
          <label>前端 <input v-model="wizard.frontend" /></label>
          <label>后端 <input v-model="wizard.backend" placeholder="Go / Node.js" /></label>
          <label>数据库 <input v-model="wizard.database" /></label>
        </div>
      </div>

      <div v-else-if="wizardStep === 2" class="form-grid">
        <label><input v-model="answers.network" type="checkbox" /> 对外网络接口/协议</label>
        <label><input v-model="answers.runtimeConfig" type="checkbox" /> 运行时配置键</label>
        <label><input v-model="answers.crossApiFlow" type="checkbox" /> 跨接口业务场景</label>
        <label><input v-model="answers.backgroundProcess" type="checkbox" /> 常驻后台进程</label>
        <label><input v-model="answers.domainDsl" type="checkbox" /> 领域 DSL / 业务不变量</label>
        <label><input v-model="answers.manyErrors" type="checkbox" /> 错误码 &gt; 20 个</label>
        <label>
          鉴权方式
          <select v-model="answers.auth">
            <option value="none">无需</option>
            <option value="machine">机机</option>
            <option value="roles">角色矩阵</option>
          </select>
        </label>
      </div>

      <div v-else>
        <table>
          <thead>
            <tr><th>kind</th><th>状态</th><th>原因</th></tr>
          </thead>
          <tbody>
            <tr v-for="(entry, kind) in kindPreview" :key="kind">
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

      <div class="row toolbar" style="margin-top: 14px">
        <button v-if="wizardStep > 1" @click="wizardStep -= 1">上一步</button>
        <button v-if="wizardStep < 3" class="primary" @click="wizardStep += 1">下一步</button>
        <button v-else class="primary" :disabled="creating" @click="createProject">创建</button>
        <button class="ghost" @click="wizardStep = 0">取消</button>
      </div>
    </div>

    <div class="section-title">
      <h2>最近项目</h2>
      <span class="muted">{{ workspace.projects.length }} 个项目</span>
    </div>
    <div v-if="workspace.loading && workspace.projects.length === 0" class="empty">加载中…</div>
    <div v-else-if="workspace.projects.length === 0" class="empty">
      暂无项目，点击上方「＋ 新建项目」开始
    </div>
    <div v-else class="project-grid">
      <div v-for="project in workspace.projects" :key="project.id" class="project-card">
        <RouterLink :to="'/project/' + project.id + '/overview'" class="name">{{ project.name }}</RouterLink>
        <div class="path">{{ project.path }}</div>
        <div class="meta">
          <span class="badge brand">{{ project.status?.goals.length ?? 0 }} 目标</span>
          <span class="badge brand">{{ project.status?.plans.length ?? 0 }} 计划</span>
          <span class="badge brand">{{ project.status?.changes.length ?? 0 }} 变更</span>
        </div>
        <div class="meta" style="margin-top: 8px">
          <span class="muted">最近打开：{{ relativeTime(project.lastOpenedAt) }}</span>
          <span class="grow" />
          <button class="ghost" @click="removeProject(project)">从工作区移除</button>
        </div>
      </div>
    </div>

    <DirPicker
      v-if="pickerFor !== null"
      :initial-path="pickerFor === 'wizard' ? wizard.path : ''"
      @close="pickerFor = null"
      @select="onPicked"
    />
  </div>
</template>

<script setup lang="ts">
import { reactive, ref, onMounted, watch } from 'vue';
import { RouterLink, useRouter } from 'vue-router';
import DirPicker from '../components/DirPicker.vue';
import StatusBadge from '../components/StatusBadge.vue';
import { errorMessage } from '../api/client';
import { useSessionStore } from '../stores/session';
import { useEventStore } from '../stores/events';
import { useToastStore } from '../stores/toasts';
import { useWorkspaceStore } from '../stores/workspace';
import type { ProjectSummary, ScaffoldAnswers } from '../api/types';
import { relativeTime } from '../utils/format';

const router = useRouter();
const session = useSessionStore();
const events = useEventStore();
const toasts = useToastStore();
const workspace = useWorkspaceStore();

const tokenDraft = ref('');
const wizardStep = ref(0);
const creating = ref(false);
const pickerFor = ref<'wizard' | 'import' | null>(null);

const wizard = reactive({ name: '', path: '', frontend: '无', backend: '', database: '无' });
const answers = reactive<ScaffoldAnswers>({ auth: 'none' });

function startWizard(): void {
  Object.assign(wizard, { name: '', path: '', frontend: '无', backend: '', database: '无' });
  Object.assign(answers, {
    network: false,
    runtimeConfig: false,
    crossApiFlow: false,
    backgroundProcess: false,
    domainDsl: false,
    manyErrors: false,
    auth: 'none',
  });
  wizardStep.value = 1;
}

function saveToken(): void {
  session.save(tokenDraft.value);
  toasts.success('token 已保存');
  events.reconnectNow();
  void workspace.load();
}

function openPickerForImport(): void {
  pickerFor.value = 'import';
}

async function onPicked(path: string): Promise<void> {
  const target = pickerFor.value;
  pickerFor.value = null;
  if (target === 'wizard') {
    wizard.path = path;
    return;
  }
  try {
    const project = await workspace.importExisting(path);
    toasts.success('已打开项目', project.name);
    void router.push('/project/' + project.id + '/overview');
  } catch (error) {
    toasts.error('打开失败', errorMessage(error));
  }
}

/** 12-kind 预览只是「创建前的心智模型」，真正判定以服务端 init-manifest 为准。 */
const kindPreview = reactive<Record<string, { status: 'present' | 'deferred' | 'absent'; reason: string }>>({});

function recomputePreview(): void {
  const none = (value: string): boolean => value === '' || value === '无' || value === 'none' || value.includes('[');
  const push = (kind: string, status: 'present' | 'deferred' | 'absent', reason: string): void => {
    kindPreview[kind] = { status, reason };
  };
  push('project', 'present', 'always');
  push('models', none(wizard.database) ? 'absent' : 'present', none(wizard.database) ? 'database == none' : 'database != none');
  push('pages', none(wizard.frontend) ? 'absent' : 'present', none(wizard.frontend) ? 'frontend == none' : 'frontend != none');
  push('constraints', 'present', 'tech stack declared');
  push('capability', 'absent', 'derived from goals, not init');
  push('protocol', answers.network ? 'present' : 'deferred', answers.network ? 'network: yes' : 'use questions');
  push('config', answers.runtimeConfig ? 'present' : 'deferred', answers.runtimeConfig ? 'runtime config: yes' : 'use questions');
  push('flow', answers.crossApiFlow ? 'present' : 'deferred', answers.crossApiFlow ? 'cross-api: yes' : 'use questions');
  push('process', answers.backgroundProcess ? 'present' : 'deferred', answers.backgroundProcess ? 'process: yes' : 'use questions');
  push('rules', answers.domainDsl ? 'present' : 'deferred', answers.domainDsl ? 'dsl: yes' : 'use questions');
  push(
    'permissions',
    answers.auth && answers.auth !== 'none' ? 'present' : 'absent',
    answers.auth ? 'auth: ' + answers.auth : 'auth: none',
  );
  push('errors', answers.manyErrors ? 'present' : 'deferred', answers.manyErrors ? 'many errors' : 'use questions');
}

async function createProject(): Promise<void> {
  recomputePreview();
  if (wizard.path.trim() === '') {
    toasts.error('缺少路径', '请选择或输入本地目录');
    return;
  }
  creating.value = true;
  try {
    const project = await workspace.create({
      name: wizard.name,
      path: wizard.path,
      frontend: wizard.frontend,
      backend: wizard.backend,
      database: wizard.database,
      answers: { ...answers },
    });
    wizardStep.value = 0;
    toasts.success('项目已创建', project.name);
    void router.push('/project/' + project.id + '/specs');
  } catch (error) {
    toasts.error('创建失败', errorMessage(error));
  } finally {
    creating.value = false;
  }
}

async function removeProject(project: ProjectSummary): Promise<void> {
  if (!window.confirm('从工作区移除「' + project.name + '」？不会删除磁盘上的项目文件。')) return;
  try {
    await workspace.remove(project.id);
    toasts.info('已从工作区移除', project.name);
  } catch (error) {
    toasts.error('移除失败', errorMessage(error));
  }
}

onMounted(() => {
  void workspace.load();
});

watch(wizardStep, (step) => {
  if (step === 3) recomputePreview();
});
</script>
