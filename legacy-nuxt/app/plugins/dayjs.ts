import dayjs from 'dayjs'
import localeData from 'dayjs/plugin/localeData'
import advancedFormat from 'dayjs/plugin/advancedFormat'
import customParseFormat from 'dayjs/plugin/customParseFormat'

export default defineNuxtPlugin(() => {
    dayjs.extend(localeData)
    dayjs.extend(advancedFormat)
    dayjs.extend(customParseFormat)
})
