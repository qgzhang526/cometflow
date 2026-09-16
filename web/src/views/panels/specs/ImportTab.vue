<template>
  <div>
    <p class="muted">
      把接口清单粘贴进来（支持 Excel/CSV 导出的 <code>,</code> / <code>\t</code> 分隔表，以及 Markdown 表格），
      解析规则与 <code>cometflow spec import &lt;file&gt;</code> 完全同一份实现。流程是
      <strong>先预览后写入</strong>：预览只解析、不落盘，并告诉你哪些能力会新写、哪些因为已存在会被跳过。
    </p>

    <div class="form-grid">
      <label>
        来源标注（写进 spec 的 front-matter，便于回溯）
        <input v-model="source" placeholder="例如 api-inventory.csv" />
      </label>
      <label>
        代码模块（可选，表格里没有「代码模块」列时用它）
        <input v-model="module" placeholder="例如 internal/auth" />
      </label>
      <label>
        表格内容
        <textarea v-model="content" rows="10" placeholder="能力,方法,路径,认证,请求,响应,错误码,说明" />
      </label>
    </div>

    <div class="toolbar">
      <button class="primary" :disabled="busy !== '' || content.trim() === ''" @click="preview">
        {{ busy === 'preview' ? '解析中…' : '预览' }}
      </button>
      <label class="muted"><input v-model="force" type="checkbox" /> 覆盖已存在的 capability spec</label>
      <button
        :disabled="busy !== '' || previewData === null || (previewData.writable.length === 0 && !force)"
        @click="apply"
      >
        {{ busy === 'apply' ? '导入中…' : '导入' }}
      </button>
      <span class="grow" />
      <span v-if="previewData" class="muted">解析出 {{ previewData.rows }} 行</span>
    </div>

    <template v-if="previewData">
      <table style="margin-top: 10px">
        <tbody>
          <tr>
            <th>会新写</th>
            <td>
              <span v-if="previewData.writable.length === 0" class="muted">（无）</span>
              <span v-else>{{ previewData.writable.join(', ') }}</span>
            </td>
          </tr>
          <tr>
            <th>已存在（默认跳过）</th>
            <td>
              <span v-if="previewData.existing.length === 0" class="muted">（无）</span>
              <span v-else>
                {{ previewData.existing.join(', ') }}
                <span class="muted">—— 勾选「覆盖」才会重写，否则保留人工修改</span>
              </span>
            </td>
          </tr>
          <tr v-if="previewData.invalid.length > 0">
            <th>能力名非法</th>
            <td><span class="badge err">{{ previewData.invalid.join(', ') }}</span></td>
          </tr>
        </tbody>
      </table>

      <template v-if="previewData.issues.length > 0">
        <h3>解析问题</h3>
        <div v-for="(issue, index) in previewData.issues" :key="index" class="finding warning">
          第 {{ issue.line }} 行：{{ issue.reason }}
        </div>
      </template>
    </template>

    <template v-if="applied">
      <h3>导入结果</h3>
      <table>
        <tbody>
          <tr><th>已写入</th><td>{{ applied.written.join(', ') || '（无）' }}</td></tr>
          <tr><th>已跳过</th><td>{{ applied.skipped.join(', ') || '（无）' }}</td></tr>
          <tr><th>能力</th><td>{{ applied.capabilities.join(', ') || '（无）' }}</td></tr>
        </tbody>
      </table>
      <p class="muted">
        导入后 spec 已落盘并登记版本；到「影响与门禁」跑一次校验，或切到「Spec 文件」查看生成的正文。
      </p>
    </template>
  </div>
</template>

<script setup lang="ts">
import { ref } from 'vue';
import { errorMessage } from '../../../api/client';
import { useProjectStore } from '../../../stores/project';
import { useToastStore } from '../../../stores/toasts';
import type { SpecImportPreview, SpecImportResult } from '../../../api/types';

const project = useProjectStore();
const toasts = useToastStore();

const content = ref('');
const source = ref('web-paste');
const module = ref('');
const force = ref(false);
const busy = ref<'' | 'preview' | 'apply'>('');
const previewData = ref<SpecImportPreview | null>(null);
const applied = ref<SpecImportResult | null>(null);

async function preview(): Promise<void> {
  busy.value = 'preview';
  applied.value = null;
  try {
    const data = await project.projectApi<{ preview: SpecImportPreview }>('/spec/import', {
      method: 'POST',
      body: { content: content.value, source: source.value, module: module.value },
    });
    previewData.value = data.preview;
  } catch (error) {
    toasts.error('预览失败', errorMessage(error));
  } finally {
    busy.value = '';
  }
}

async function apply(): Promise<void> {
  busy.value = 'apply';
  try {
    const data = await project.projectApi<{ result: SpecImportResult }>('/spec/import', {
      method: 'POST',
      body: {
        content: content.value,
        source: source.value,
        module: module.value,
        force: force.value,
        dryRun: false,
      },
    });
    applied.value = data.result;
    toasts.success(
      '导入完成',
      '写入 ' + data.result.written.length + ' 个 · 跳过 ' + data.result.skipped.length + ' 个',
    );
  } catch (error) {
    toasts.error('导入失败', errorMessage(error));
  } finally {
    busy.value = '';
  }
}
</script>
