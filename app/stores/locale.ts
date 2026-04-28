import {defineStore} from 'pinia'

export const useLocaleStore = defineStore('locale', {
    state: () => ({
        locale: 'en'
    }),
    actions: {
        setLocale(l: string) {
            this.locale = l
        }
    },
    persist: true
})
