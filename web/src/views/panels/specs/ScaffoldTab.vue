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
    <div class="toolbar" style="margin-top: 12px">
      <button class="primary" :disabled="busy" @click="scaffold">生成 / 补全</button>
      <span class="muted">脚手架是幂等的：已存在的文件不会被覆盖。</span>
    </div>
    <div v-if="result" class="muted">
      created: {{ result.created.length }} · skipped: {{ result.skipped.length }}
      <template v-if="result.created.length > 0">（{{ result.created.join(', ') }}）</template>
    </div>
  </div>
</template>

<script setup lang="ts">
import { reactive, ref } from 'vue';
import { errorMessage } from '../../../api/client';
import { useProjectStore } from '../../../stores/project';
import { useToastStore } from '../../../stores/toasts';
import type { ScaffoldAnswers } from '../../../api/types';

const project = useProjectStore();
const toasts = useToastStore();
const answers = reactive<ScaffoldAnswers>({ auth: 'none' });
const busy = ref(false);
const result = ref<{ created: string[]; skipped: string[] } | null>(null);

async function scaffold(): Promise<void> {
  busy.value = true;
  try {
    const data = await project.projectApi<{ created: string[]; skipped: string[] }>('/spec/scaffold', {
      method: 'POST',
      body: { answers: { ...answers } },
    });
    result.value = data;
    await project.refreshStatus();
    toasts.success('脚手架已执行', '新增 ' + data.created.length + ' 个文件');
  } catch (error) {
    toasts.error('脚手架失败', errorMessage(error));
  } finally {
    busy.value = false;
  }
}
</script>
