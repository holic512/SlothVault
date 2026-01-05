// https://nuxt.com/docs/api/configuration/nuxt-config

import AutoImport from 'unplugin-auto-import/vite'
import Components from 'unplugin-vue-components/vite'
import {ElementPlusResolver} from 'unplugin-vue-components/resolvers'
import { Buffer } from 'buffer'

export default defineNuxtConfig({

    // 路由配置 - 管理员不使用 ssr
    routeRules: {
        '/admin/**': { ssr: false }
    },

    compatibilityDate: '2025-07-15',
    devtools: {enabled: false},

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

    // Nitro 服务端配置
    nitro: {
        // ESM 兼容性配置
        esbuild: {
            options: {
                target: 'esnext',
            },
        },
    },

    vite: {
        define: {
            // 为浏览器环境提供 Buffer 全局变量
            'global': 'globalThis',
        },
        resolve: {
            alias: {
                // Buffer polyfill for browser
                'buffer': 'buffer/',
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
                'buffer',
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
            // 排除服务端专用模块
            exclude: ['@solana/spl-account-compression'],
        },
        // SSR 配置 - 将 Solana 相关模块标记为外部依赖
        ssr: {
            external: ['@solana/spl-account-compression'],
            noExternal: [],
        },
    },
})
