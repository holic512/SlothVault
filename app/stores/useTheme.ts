import { ref, watch, onMounted } from 'vue'
import { defineStore } from 'pinia'

type Mode = 'light' | 'dark'
type Palette = 'purple' | 'cyan' | 'emerald' | 'rose'

export const useTheme = defineStore('theme', () => {
    const theme = ref<Mode>('dark')
    const palette = ref<Palette>('purple')

    const palettes = ['purple', 'cyan', 'emerald', 'rose']

    /** 核心：统一更新 DOM 的函数 */
    const applyTheme = () => {
        if (!import.meta.client) return
        const htmlEl = document.documentElement
        htmlEl.classList.toggle('dark', theme.value === 'dark')
        palettes.forEach(p => htmlEl.classList.remove(`theme-${p}`))
        htmlEl.classList.add(`theme-${palette.value}`)
    }

    /** 切换主题 */
    const setTheme = (mode: Mode) => {
        theme.value = mode
        applyTheme()
    }

    /** 切换调色盘 */
    const setPalette = (p: Palette) => {
        palette.value = p
        applyTheme()
    }

    // 监听主题 & 调色盘
    watch([theme, palette], applyTheme, { immediate: true })

    // SSR 首屏 hydration 后强制再应用一次，避免闪白
    onMounted(() => applyTheme())

    return {
        theme,
        palette,
        setTheme,
        setPalette,
        applyTheme
    }
}, { persist: true })
