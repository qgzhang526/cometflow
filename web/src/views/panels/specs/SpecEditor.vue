<template>
  <div>
    <div class="spec-editor">
      <pre class="spec-editor-mirror" aria-hidden="true"><span ref="mirrorInnerRef" class="spec-editor-mirror-inner"><span
        v-for="(segment, index) in segments"
        :key="index"
        :class="segment.className"
      >{{ segment.text }}</span><span v-if="needsTrailingLine">&#8203;</span></span></pre>
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
/** 镜像层里承载正文的内层：靠 transform 跟随 textarea 的滚动。 */
const mirrorInnerRef = ref<HTMLElement | null>(null);
let debounce: number | null = null;

const unresolvedTokens = computed(() => tokens.value.filter((token) => !token.resolved));

/**
 * 正文以换行结尾时，textarea 会多出一行空行（光标能停在那儿），而 pre 不会——
 * 两层的 scrollHeight 因此差一行。表现就是「滚到底部点击，光标落在两行之间，
 * 改动落到下一行」。补一个零宽字符把那一行撑出来，两层高度就一致了。
 */
const needsTrailingLine = computed(() => props.modelValue.endsWith('\n'));

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

/**
 * 镜像层是**纯跟随**：它自己不滚动，用 transform 平移内层内容。
 *
 * 以前是两层各自滚动、把 textarea 的 scrollTop 抄给镜像层。只要两层的可滚动高度、
 * 滚动条槽位、可用宽度有任何一点不同，抄过去的值就会被裁剪或错位，表现为「光标与
 * 文字恒定错开一点」。transform 不受裁剪影响，也不参与排版，这类差异就都消失了。
 *
 * 宽度也必须一致：textarea 常驻滚动条（overflow-y: scroll），镜像层没有滚动条，
 * 所以要把滚动条那一条宽度补给内层的右内边距，否则长行换行位置会不同。
 */
function syncScroll(event: Event): void {
  const textarea = event.target as HTMLTextAreaElement;
  const inner = mirrorInnerRef.value;
  if (inner === null) return;
  inner.style.transform = 'translate(' + -textarea.scrollLeft + 'px,' + -textarea.scrollTop + 'px)';
  const scrollbarWidth = Math.max(0, textarea.offsetWidth - textarea.clientWidth - 2);
  inner.style.paddingRight = 12 + scrollbarWidth + 'px';
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
  /*
    两层必须逐像素同度量，否则误差会按行累加：几十行之后光标就会比文字偏半行。
    三个细节都要钉死：
    1) 具体字体放最前，别让 monospace 泛型在 pre 与 textarea 上解析成不同字体；
    2) line-height 用像素值，倍数会因元素不同而取整不一致；
    3) tab-size 与连字也要一致，否则含制表符或被连字合并的行宽度不同。
  */
  font-family: Consolas, "Cascadia Mono", ui-monospace, "SFMono-Regular", monospace;
  font-size: 13px;
  line-height: 20px;
  letter-spacing: normal;
  word-spacing: normal;
  font-variant-ligatures: none;
  tab-size: 4;
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
  /* 镜像层自己不滚动：滚动完全由内层的 transform 表现，避免两层滚动范围被裁剪。 */
  padding: 0;
  overflow: hidden;
  background: #fff;
  pointer-events: none;
  color: var(--text);
}
.spec-editor-mirror-inner {
  display: block;
  padding: 12px;
  will-change: transform;
}
.spec-editor-input {
  position: relative;
  background: transparent;
  color: transparent;
  caret-color: var(--text);
  /*
    不允许独立改高度：textarea 被拖高之后，absolute 定位的镜像层（inset: 0）不会跟着变，
    两层高度不同会再次错位。高度交给 min-height 统一决定。
  */
  resize: none;
  overflow-y: scroll;
  overflow-x: auto;
}
.spec-editor-input::selection { background: rgba(99, 102, 241, 0.25); }
.spec-editor-mirror :deep(.ref),
.spec-editor-mirror .ref {
  /*
    刻意不给内边距：镜像层与 textarea 必须逐字对齐。chip 只要有一点内边距，
    长行的换行位置就会和 textarea 不同，两层的 scrollHeight 也随之不同——
    滚动之后看到的行和光标所在的行就对不上了（实测踩到过）。背景与圆角不参与排版。
  */
  padding: 0;
  border-radius: 4px;
}
.spec-editor-mirror .ref-ok { background: #eef2ff; color: #3730a3; }
.spec-editor-mirror .ref-bad { background: #fef2f2; color: var(--err); text-decoration: underline wavy var(--err); }
</style>
