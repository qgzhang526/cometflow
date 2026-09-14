<template>
  <div>
    <div class="spec-editor">
      <pre class="spec-editor-mirror" aria-hidden="true"><span
        v-for="(segment, index) in segments"
        :key="index"
        :class="segment.className"
      >{{ segment.text }}</span></pre>
      <textarea
        ref="textareaRef"
        class="spec-editor-input"
        :value="modelValue"
        spellcheck="false"
        @input="onInput"
        @compositionstart="composing = true"
        @compositionend="onCompositionEnd"
        @scroll="syncScroll"
      />
    </div>

    <div class="row" style="margin-top: 8px">
      <StatusBadge
        :tone="unresolvedTokens.length === 0 ? 'ok' : 'err'"
        :text="unresolvedTokens.length === 0 ? '引用全部可解析' : unresolvedTokens.length + ' 条未解析'"
      />
      <span class="muted">{{ tokens.length }} 条引用 · 高亮随输入实时更新</span>
      <span class="grow" />
      <button v-for="token in unresolvedTokens.slice(0, 3)" :key="token.line + token.value" class="ghost" @click="jumpTo(token.line)">
        L{{ token.line }} {{ token.value }}
      </button>
    </div>
    <p class="muted">
      引用语法与 <code>spec validate</code> 同源（模型：X / 错误码：Y / 配置键：k / 协议头：h / 状态码：n / 调用 METHOD /path）；
      红底表示目标未定义，点上面的按钮可跳到该行。
    </p>
  </div>
</template>

<script setup lang="ts">
import { computed, onMounted, ref, watch } from 'vue';
import StatusBadge from '../../../components/StatusBadge.vue';
import { errorMessage } from '../../../api/client';
import { useProjectStore } from '../../../stores/project';
import type { SpecReferenceToken, SpecReferencesResponse } from '../../../api/types';

const props = defineProps<{ modelValue: string }>();
const emit = defineEmits<{ 'update:modelValue': [value: string] }>();

const project = useProjectStore();
const tokens = ref<SpecReferenceToken[]>([]);
const composing = ref(false);
const textareaRef = ref<HTMLTextAreaElement | null>(null);
let debounce: number | null = null;

const unresolvedTokens = computed(() => tokens.value.filter((token) => !token.resolved));

interface Segment {
  text: string;
  className: string;
}

/** 把正文切成「普通文本 + 引用 chip」的片段，镜像层与 textarea 逐字对齐。 */
const segments = computed<Segment[]>(() => {
  const byLine = new Map<number, SpecReferenceToken[]>();
  for (const token of tokens.value) {
    const bucket = byLine.get(token.line) ?? [];
    bucket.push(token);
    byLine.set(token.line, bucket);
  }
  const out: Segment[] = [];
  const lines = props.modelValue.split('\n');
  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index];
    const lineTokens = (byLine.get(index + 1) ?? []).slice().sort((left, right) => left.start - right.start);
    let cursor = 0;
    for (const token of lineTokens) {
      // 服务端给的是行内区间（left-closed/right-open）；越界时跳过，避免镜像层错位。
      if (token.start < cursor || token.end > line.length) continue;
      if (token.start > cursor) out.push({ text: line.slice(cursor, token.start), className: '' });
      out.push({
        text: line.slice(token.start, token.end),
        className: token.resolved ? 'ref ref-ok' : 'ref ref-bad',
      });
      cursor = token.end;
    }
    out.push({ text: line.slice(cursor) + (index + 1 < lines.length ? '\n' : ''), className: '' });
  }
  return out;
});

async function refresh(): Promise<void> {
  try {
    const data = await project.projectApi<SpecReferencesResponse>('/spec/references', {
      method: 'POST',
      body: { content: props.modelValue },
    });
    tokens.value = data.tokens;
  } catch (error) {
    // 高亮失败不阻塞编辑：清空 token，避免镜像层显示过期位置。
    tokens.value = [];
    void errorMessage(error);
  }
}

function schedule(): void {
  if (composing.value) return;
  if (debounce !== null) window.clearTimeout(debounce);
  debounce = window.setTimeout(() => {
    debounce = null;
    void refresh();
  }, 200);
}

function onInput(event: Event): void {
  emit('update:modelValue', (event.target as HTMLTextAreaElement).value);
  schedule();
}

function onCompositionEnd(): void {
  composing.value = false;
  schedule();
}

function syncScroll(event: Event): void {
  const mirror = (event.target as HTMLElement).previousElementSibling as HTMLElement | null;
  if (mirror !== null) {
    mirror.scrollTop = (event.target as HTMLElement).scrollTop;
    mirror.scrollLeft = (event.target as HTMLElement).scrollLeft;
  }
}

function jumpTo(line: number): void {
  const textarea = textareaRef.value;
  if (textarea === null) return;
  const lines = textarea.value.split('\n');
  const offset = lines.slice(0, Math.max(0, line - 1)).reduce((total, entry) => total + entry.length + 1, 0);
  textarea.focus();
  textarea.setSelectionRange(offset, offset + (lines[line - 1]?.length ?? 0));
}

onMounted(refresh);
watch(() => props.modelValue, () => schedule());
</script>

<style scoped>
.spec-editor { position: relative; }
.spec-editor-mirror,
.spec-editor-input {
  margin: 0;
  padding: 12px;
  font-family: ui-monospace, "SFMono-Regular", Consolas, monospace;
  font-size: 13px;
  line-height: 1.55;
  white-space: pre-wrap;
  word-break: break-word;
  border: 1px solid var(--border);
  border-radius: 8px;
  box-sizing: border-box;
  width: 100%;
  min-height: 55vh;
}
.spec-editor-mirror {
  position: absolute;
  inset: 0;
  overflow: auto;
  background: #fff;
  pointer-events: none;
  color: var(--text);
}
.spec-editor-input {
  position: relative;
  background: transparent;
  color: transparent;
  caret-color: var(--text);
  resize: vertical;
  overflow: auto;
}
.spec-editor-input::selection { background: rgba(99, 102, 241, 0.25); }
.spec-editor-mirror :deep(.ref),
.spec-editor-mirror .ref { border-radius: 4px; padding: 0 2px; }
.spec-editor-mirror .ref-ok { background: #eef2ff; color: #3730a3; }
.spec-editor-mirror .ref-bad { background: #fef2f2; color: var(--err); text-decoration: underline wavy var(--err); }
</style>
