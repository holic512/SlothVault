import {
    ID_INJECTION_KEY,
    ZINDEX_INJECTION_KEY
} from 'element-plus'

export default defineNuxtPlugin((nuxtApp) => {
    nuxtApp.vueApp.provide(ID_INJECTION_KEY, {
        prefix: 1024,
        current: 0
    })

    nuxtApp.vueApp.provide(ZINDEX_INJECTION_KEY, {
        current: 2000
    })
})
