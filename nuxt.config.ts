// https://nuxt.com/docs/api/configuration/nuxt-config

import AutoImport from 'unplugin-auto-import/vite'
import Components from 'unplugin-vue-components/vite'
import {ElementPlusResolver} from 'unplugin-vue-components/resolvers'

export default defineNuxtConfig({
    compatibilityDate: '2025-07-15',
    devtools: {enabled: true},

    // 让 Nuxt 使用 app/ 作为根目录
    srcDir: 'app',

    css: ['~/assets/css/main.css', '~/assets/css/theme.css'],

    modules: [
        '@nuxtjs/i18n',
        '@pinia/nuxt',
        'pinia-plugin-persistedstate/nuxt',
    ],

    i18n: {
        strategy: 'no_prefix',
        defaultLocale: 'en',
        locales: [
            {code: 'en', name: 'English', file: 'en.json'},
            {code: 'zh', name: 'Chinese', file: 'zh.json'},


        ],
    },

    build: {
        transpile: ['element-plus'],
    },

    vite: {
        plugins: [
            AutoImport({
                resolvers: [ElementPlusResolver()],
            }),
            Components({
                resolvers: [ElementPlusResolver()],
            }),
        ],
    },
})