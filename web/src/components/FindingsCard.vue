<template>
  <div class="card">
    <div class="row">
      <h2>问题清单</h2>
      <span class="grow" />
      <StatusBadge
        :tone="errorCount > 0 ? 'err' : warningCount > 0 ? 'warn' : 'ok'"
        :text="errorCount + ' error · ' + warningCount + ' warning'"
      />
      <button class="ghost" @click="emit('refresh')">刷新</button>
    </div>
    <p class="muted">
      与 <code>cometflow gate check . --findings</code> 同一份投影：spec verify 与 doctor 两个来源合并、
      按 <code>code + subject</code> 去重（同一个判定不会显示两次）。
    </p>

    <p v-if="findings.length === 0" class="badge ok">0 finding</p>
    <table v-else>
      <thead><tr><th>级别</th><th>来源</th><th>code</th><th>对象</th><th>说明</th><th /></tr></thead>
      <tbody>
        <tr v-for="finding in findings" :key="finding.source + '|' + finding.code + '|' + finding.subject">
          <td>
            <StatusBadge
              :tone="finding.severity === 'error' ? 'err' : finding.severity === 'warning' ? 'warn' : 'gray'"
              :text="finding.severity"
            />
          </td>
          <td class="muted">{{ finding.source }}</td>
          <td><code>{{ finding.code }}</code></td>
          <td class="muted">{{ finding.subject === '' ? '—' : finding.subject }}</td>
          <td>{{ finding.message }}</td>
          <td>
            <button
              v-if="targetFor(finding)"
              class="ghost"
              :title="'去「' + describeTarget(targetFor(finding)!) + '」处理'"
              @click="emit('jump', targetFor(finding)!)"
            >
              去处理
            </button>
          </td>
        </tr>
      </tbody>
    </table>
  </div>
</template>

<script setup lang="ts">
import { computed } from 'vue';
import StatusBadge from './StatusBadge.vue';
import type { Finding } from '../api/types';
import { describeTarget, targetForFinding, type PanelTarget } from '../utils/finding-targets';

const props = defineProps<{ findings: Finding[] }>();
const emit = defineEmits<{ refresh: []; jump: [target: PanelTarget] }>();

const errorCount = computed(() => props.findings.filter((finding) => finding.severity === 'error').length);
const warningCount = computed(() => props.findings.filter((finding) => finding.severity === 'warning').length);

/**
 * 映射到能处理它的**面板 + 页签 + 对象**（见 `utils/finding-targets.ts`）。
 * 只做「有明确去处」的映射：映射不准的按钮比没有按钮更糟（点进去发现处理不了）。
 */
function targetFor(finding: Finding): PanelTarget | null {
  return targetForFinding(finding);
}
</script>
