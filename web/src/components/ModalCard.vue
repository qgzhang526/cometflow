<template>
  <Teleport to="body">
    <!--
      遮罩不关闭弹窗。以前这里是 @click.self="emit('close')"，结果编辑规格时手一抖点到
      旁边，未保存的内容就没了——正在输入的表单不该被一次误点丢掉。
      只读的弹窗若要保留「点外面关掉」，显式传 dismiss-on-backdrop。
    -->
    <div class="modal-overlay" @click.self="onBackdropClick">
      <div class="modal" :class="{ wide }">
        <div class="modal-head">
          <strong>{{ title }}</strong>
          <button class="ghost" @click="emit('close')">✕</button>
        </div>
        <div class="modal-body">
          <slot />
        </div>
        <div class="modal-foot">
          <slot name="footer" />
        </div>
      </div>
    </div>
  </Teleport>
</template>

<script setup lang="ts">
const props = withDefaults(defineProps<{ title: string; wide?: boolean; dismissOnBackdrop?: boolean }>(), {
  wide: false,
  dismissOnBackdrop: false,
});
const emit = defineEmits<{ close: [] }>();

function onBackdropClick(): void {
  if (props.dismissOnBackdrop) emit('close');
}
</script>
