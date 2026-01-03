// https://nuxt.com/docs/api/configuration/nuxt-config

import AutoImport from 'unplugin-auto-import/vite'
import Components from 'unplugin-vue-components/vite'
import {ElementPlusResolver} from 'unplugin-vue-components/resolvers'

export default defineNuxtConfig({

    // 路由配置
    routeRules: {
        '/admin/**': { ssr: false }
    },

    compatibilityDate: '2025-07-15',
    devtools: {enabled: true},

    // 让 Nuxt 使用 app/ 作为根目录
    srcDir: 'app',

    css: ['element-plus/dist/index.css', '~/assets/css/main.css', '~/assets/css/theme.css'],

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
        resolve: {
            alias: {
                'dayjs/plugin/advancedFormat': 'dayjs/esm/plugin/advancedFormat',
                'dayjs/plugin/advancedFormat.js': 'dayjs/esm/plugin/advancedFormat/index.js',
                'dayjs/plugin/customParseFormat': 'dayjs/esm/plugin/customParseFormat',
                'dayjs/plugin/customParseFormat.js': 'dayjs/esm/plugin/customParseFormat/index.js',
                'dayjs/plugin/dayOfYear.js': 'dayjs/esm/plugin/dayOfYear/index.js',
                'dayjs/plugin/isoWeek': 'dayjs/esm/plugin/isoWeek',
                'dayjs/plugin/isoWeek.js': 'dayjs/esm/plugin/isoWeek/index.js',
                'dayjs/plugin/localeData': 'dayjs/esm/plugin/localeData',
                'dayjs/plugin/localeData.js': 'dayjs/esm/plugin/localeData/index.js',
                'dayjs/plugin/weekOfYear': 'dayjs/esm/plugin/weekOfYear',
                'dayjs/plugin/weekOfYear.js': 'dayjs/esm/plugin/weekOfYear/index.js',
                'dayjs/plugin/weekYear.js': 'dayjs/esm/plugin/weekYear/index.js',
                'dayjs/plugin/isSameOrAfter.js': 'dayjs/esm/plugin/isSameOrAfter/index.js',
                'dayjs/plugin/isSameOrBefore.js': 'dayjs/esm/plugin/isSameOrBefore/index.js',
            },
        },
        plugins: [
            AutoImport({
                resolvers: [ElementPlusResolver()],
            }),
            Components({
                resolvers: [ElementPlusResolver()],
            }),
        ],
        optimizeDeps: {
            include: [
                'dayjs',
                'dayjs/plugin/customParseFormat',
                'dayjs/plugin/customParseFormat.js',
                'dayjs/plugin/advancedFormat',
                'dayjs/plugin/advancedFormat.js',
                'dayjs/plugin/dayOfYear.js',
                'dayjs/plugin/weekOfYear',
                'dayjs/plugin/weekOfYear.js',
                'dayjs/plugin/isoWeek',
                'dayjs/plugin/isoWeek.js',
                'dayjs/plugin/localeData',
                'dayjs/plugin/localeData.js',
                'dayjs/plugin/weekYear.js',
                'dayjs/plugin/isSameOrAfter.js',
                'dayjs/plugin/isSameOrBefore.js',
                'element-plus/es',
            ],
        },
    },
})
