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
      <label class="grow">
        capability 骨架（逗号分隔，可留空）
        <span class="row">
          <input v-model="capabilityDraft" placeholder="auth, orders" class="grow" />
        </span>
      </label>
    </div>
    <div class="toolbar" style="margin-top: 12px">
      <button class="primary" :disabled="busy" @click="scaffold">生成 / 补全</button>
      <span class="muted">
        脚手架是幂等的：已存在的文件不会被覆盖。capability 骨架只建骨架（front-matter + 一个示例 anchor），
        内容仍要填——它不由项目类型推导，所以只能在这里点名，或由 <code>plan generate</code> 的 spec-authoring 任务起草。
      </span>
    </div>
    <div v-if="result" class="muted">
      created: {{ result.created.length }} · skipped: {{ result.skipped.length }}
      <template v-if="result.created.length > 0">（{{ result.created.join(', ') }}）</template>
    </div>
    <div v-if="capabilityResult" class="muted">
      capability：created {{ capabilityResult.created.length }} · skipped {{ capabilityResult.skipped.length }}
      <template v-if="capabilityResult.created.length > 0">（{{ capabilityResult.created.join(', ') }}）</template>
      <template v-if="capabilityResult.skipped.length > 0">
        · 已存在、未覆盖（{{ capabilityResult.skipped.join(', ') }}）
      </template>
      <template v-if="capabilityResult.invalid.length > 0">
        <span class="badge err">名称不合法：{{ capabilityResult.invalid.join(', ') }}</span>
      </template>
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
/** 逗号/空白分隔的 capability 名；root kind 靠项目类型推导，capability 只能点名。 */
const capabilityDraft = ref('');
const busy = ref(false);
const result = ref<{ created: string[]; skipped: string[] } | null>(null);
const capabilityResult = ref<CapabilityScaffoldResult | null>(null);

interface CapabilityScaffoldResult {
  created: string[];
  skipped: string[];
  invalid: string[];
}

async function scaffold(): Promise<void> {
  busy.value = true;
  try {
    const capabilities = capabilityDraft.value
      .split(/[,\s]+/u)
      .map((entry) => entry.trim())
      .filter((entry) => entry !== '');
    const data = await project.projectApi<{
      created: string[];
      skipped: string[];
      capabilities: CapabilityScaffoldResult | null;
    }>('/spec/scaffold', {
      method: 'POST',
      body: { answers: { ...answers }, capabilities },
    });
    result.value = data;
    capabilityResult.value = data.capabilities;
    await project.refreshStatus();
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
</script>
