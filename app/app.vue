<script lang="ts" setup>
import {useTheme} from '~/stores/useTheme'
import {useLocaleStore} from '~/stores/locale'

const {setLocale} = useI18n()
const themeStore = useTheme()
const localeStore = useLocaleStore()
onMounted(() => {
  localeStore.setLocale(localeStore.locale)
  setLocale(localeStore.locale)
  themeStore.applyTheme()
})
</script>

<template>
  <NuxtLayout>
    <NuxtPage />
  </NuxtLayout>
</template>

<style>
html {
  scrollbar-width: thin;
  scrollbar-color: #c4c4c4 transparent;
}

*::-webkit-scrollbar {
  width: 6px;
  height: 6px;
}

*::-webkit-scrollbar-track {
  background: transparent;
}

*::-webkit-scrollbar-thumb {
  background: #c4c4c4;
  border-radius: 99px;
}

*::-webkit-scrollbar-thumb:hover {
  background: #a3a3a3;
}
</style>
