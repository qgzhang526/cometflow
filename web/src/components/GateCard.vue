<template>
  <div class="card">
    <div class="row">
      <h2>门禁</h2>
      <span class="grow" />
      <StatusBadge
        :tone="gate === null ? 'gray' : gate.check.ok ? 'ok' : 'err'"
        :text="gate === null ? '…' : gate.check.ok ? 'gate check: PASS' : 'gate check: FAILED'"
      />
      <button class="ghost" @click="emit('refresh')">刷新</button>
    </div>
    <p class="muted">
      与 <code>cometflow gate check .</code> 同一套判定（CI 的 <code>spec-gates</code> 也调它）：
      结论会挡住本地提交——前提是装了 git hook，装没装见下表。
    </p>

    <p v-if="gate === null" class="muted">加载中…</p>
    <template v-else>
      <table>
        <thead><tr><th>判定项</th><th>结论</th><th>说明</th></tr></thead>
        <tbody>
          <tr v-for="step in gate.check.steps" :key="step.name">
            <td><b>{{ step.name }}</b></td>
            <td><StatusBadge :tone="step.ok ? 'ok' : 'err'" :text="step.ok ? 'PASS' : 'FAIL'" /></td>
            <td class="muted">{{ step.detail === '' ? '—' : step.detail }}</td>
          </tr>
        </tbody>
      </table>

      <table style="margin-top: 10px">
        <tbody>
          <tr>
            <th>本地提交门禁</th>
            <td>
              <template v-if="!gate.install.isRepository">
                <span class="muted">不适用：{{ gate.install.note ?? '不是 git 仓库' }}</span>
              </template>
              <template v-else>
                <StatusBadge
                  :tone="gate.install.installed ? (gate.install.drifted ? 'warn' : 'ok') : 'gray'"
                  :text="
                    gate.install.installed
                      ? (gate.install.drifted ? '已安装 · 内容漂移' : '已安装')
                      : '未安装（可选）'
                  "
                />
                <span class="muted">
                  · {{ gate.install.host }}{{ gate.install.chained ? '（链式：原有 pre-commit 会先执行）' : '' }}
                </span>
                <div v-if="gate.install.hookPath" class="muted">管理文件：{{ gate.install.hookPath }}</div>
                <div v-if="gate.install.hooksPathOverride" class="muted">
                  core.hooksPath 指向 {{ gate.install.hooksPathOverride }}
                </div>
                <div v-if="gate.install.note" class="muted">{{ gate.install.note }}</div>
              </template>
            </td>
          </tr>
        </tbody>
      </table>
      <p class="muted">
        安装/卸载走 CLI：<code>cometflow gate install . --git-hooks</code> /
        <code>gate uninstall . --git-hooks</code>；临时跳过提交门禁用 git 原生的 <code>--no-verify</code>。
      </p>
    </template>
  </div>
</template>

<script setup lang="ts">
import StatusBadge from './StatusBadge.vue';
import type { GateResponse } from '../api/types';

defineProps<{ gate: GateResponse | null }>();
const emit = defineEmits<{ refresh: [] }>();
</script>
