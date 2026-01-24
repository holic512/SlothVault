/**
 * 统一的页面标题管理 composable
 * 用于设置多语言可配置的页面标题
 */
export const usePageTitle = () => {
  const { t } = useI18n()
  const route = useRoute()

  /**
   * 设置页面标题
   * @param titleKey - i18n 标题键名（PageTitles.xxx）
   * @param params - 标题参数（用于插值）
   * @param suffix - 是否添加站点名称后缀，默认 true
   */
  const setPageTitle = (titleKey: string, params?: Record<string, string>, suffix: boolean = true) => {
    const title = t(`PageTitles.${titleKey}`, params || {})
    const siteName = t('PageTitles.siteName')

    useHead({
      title: suffix ? `${title} - ${siteName}` : title
    })
  }

  /**
   * 设置简单标题（直接传入标题文本）
   * @param title - 标题文本
   * @param suffix - 是否添加站点名称后缀，默认 true
   */
  const setTitle = (title: string, suffix: boolean = true) => {
    const siteName = t('PageTitles.siteName')

    useHead({
      title: suffix ? `${title} - ${siteName}` : title
    })
  }

  return {
    setPageTitle,
    setTitle
  }
}
