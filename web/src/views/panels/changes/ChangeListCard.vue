<template>
  <div class="card" id="change-list-card">
    <div class="row">
      <h2>变更 Changes</h2>
      <span class="grow" />
      <label class="muted"><input v-model="showArchived" type="checkbox" /> 显示已归档</label>
      <button @click="emit('reload')">刷新</button>
    </div>

    <!-- 当前 change 指针：多个活跃 change 时，写入门禁靠它判断「这次写入属于谁」。 -->
    <p class="muted">
      当前 change 指针：
      <template v-if="pointer !== null">
        <b>{{ pointer.change }}</b>
        <span v-if="!pointerResolved" class="badge err">已失效（指向已归档或不存在的 change）</span>
        <button class="ghost" :disabled="busy" @click="emit('clearCurrent')">清除</button>
      </template>
      <template v-else>
        未设置<span v-if="activeCount > 1">（当前有 {{ activeCount }} 个活跃 change，写入门禁会 fail closed）</span>
      </template>
    </p>

    <div class="toolbar">
      <input v-model="draftName" placeholder="change 名称（如 auth-login）" />
      <select v-model="draftGoal" @change="emit('changeGoal')">
        <option value="">选择 goal…</option>
        <option v-for="goal in goals" :key="goal.id" :value="goal.id">{{ goal.id }} · {{ goal.title }}</option>
      </select>
      <select v-model="draftTask" :disabled="tasks.length === 0">
        <option value="">{{ tasks.length === 0 ? '该目标无 frozen 任务' : '选择 task…' }}</option>
        <option v-for="task in tasks" :key="task.id" :value="task.id">{{ task.id }} · {{ task.title }}</option>
      </select>
      <button class="primary" :disabled="creating" @click="emit('create')">新建</button>
    </div>

    <table>
      <thead><tr><th>名称</th><th>phase</th><th>status</th><th /><th /></tr></thead>
      <tbody>
        <tr v-for="change in visibleChanges" :key="change.name" :class="{ selected: change.name === selectedName }">
          <td><b>{{ change.name }}</b></td>
          <td>
            <StatusBadge
              :tone="change.archived ? 'gray' : 'ok'"
              :text="change.phase + (change.archived ? ' · archived' : '')"
            />
          </td>
          <td><StatusBadge :tone="statusTone(change.status)" :text="change.status" /></td>
          <td><button class="ghost" @click="emit('select', change.name)">打开</button></td>
          <td>
            <button
              v-if="!change.archived"
              class="ghost"
              :disabled="busy || pointer?.change === change.name"
              @click="emit('setCurrent', change.name)"
            >
              {{ pointer?.change === change.name ? '当前' : '设为当前' }}
            </button>
          </td>
        </tr>
        <tr v-if="visibleChanges.length === 0"><td colspan="5" class="muted">{{ emptyHint }}</td></tr>
      </tbody>
    </table>
  </div>
</template>

<script setup lang="ts">
import StatusBadge from '../../../components/StatusBadge.vue';
import type { ChangeState, CurrentChangePointer, GoalRecord } from '../../../api/types';

/**
 * 变更列表卡（从 `ChangesPanel.vue` 拆出）。
 *
 * 拆的理由是**它是一块独立的读写单元**：读的是"有哪些 change、当前指针是谁"，
 * 写的是"新建 / 选当前 / 打开"。面板本体负责状态与请求，这里只画与发事件——
 * 新建表单的三个字段走 `v-model`，指针与过滤走 props/emit，没有隐式的双向依赖。
 */
defineProps<{
  visibleChanges: ChangeState[];
  goals: GoalRecord[];
  tasks: Array<{ id: string; title: string }>;
  pointer: CurrentChangePointer | null;
  pointerResolved: boolean;
  activeCount: number;
  emptyHint: string;
  selectedName: string;
  busy: boolean;
  creating: boolean;
}>();

const emit = defineEmits<{
  reload: [];
  select: [name: string];
  setCurrent: [name: string];
  clearCurrent: [];
  changeGoal: [];
  create: [];
}>();

const showArchived = defineModel<boolean>('showArchived', { required: true });
const draftName = defineModel<string>('draftName', { required: true });
const draftGoal = defineModel<string>('draftGoal', { required: true });
const draftTask = defineModel<string>('draftTask', { required: true });

function statusTone(status: ChangeState['status']): 'ok' | 'warn' | 'err' | 'gray' | 'brand' {
  if (status === 'done') return 'ok';
  if (status === 'blocked') return 'err';
  if (status === 'await-user') return 'warn';
  return 'brand';
}
</script>
