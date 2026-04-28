<script setup lang="ts">
const route = useRoute()
const projectId = computed(() => route.params.id as string)

// 自动跳转到 home 页面
await navigateTo(`/project/${projectId.value}/home`, { replace: true })
</script>
