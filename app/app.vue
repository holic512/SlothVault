<script lang="ts" setup>
import { useTheme } from '~/stores/useTheme'
import { useLocaleStore } from '~/stores/locale'

const { setLocale } = useI18n()
const themeStore = useTheme()
const localeStore = useLocaleStore()
onMounted(() => {
  localeStore.setLocale(localeStore.locale)
  setLocale(localeStore.locale)
  themeStore.applyTheme()
})
</script>

<template>
  <NuxtPage/>

</template>

<style>
html {
  scrollbar-width: thin;
  scrollbar-color: var(--sloth-primary) var(--sloth-bg-hover);
}

*::-webkit-scrollbar {
  width: 10px;
  height: 10px;
}

*::-webkit-scrollbar-track {
  background: var(--sloth-bg-hover);
}

*::-webkit-scrollbar-thumb {
  background: var(--sloth-gradient-primary);
  border-radius: 99px;
  border: 2px solid transparent;
  background-clip: padding-box;
}

*::-webkit-scrollbar-thumb:hover {
  filter: brightness(1.1);
}
</style>
