import i18n from 'i18next'
import { initReactI18next } from 'react-i18next'

// 导入语言资源
import zhCN from './locales/zh-CN.json'
import enUS from './locales/en-US.json'

const resources = {
  'zh-CN': {
    translation: zhCN
  },
  'en-US': {
    translation: enUS
  }
}

// 从localStorage获取保存的语言设置
const getStoredLanguage = (): string => {
  try {
    const stored = localStorage.getItem('i18nextLng')
    if (stored && (stored === 'zh-CN' || stored === 'en-US')) {
      return stored
    }
  } catch (error) {
    // 忽略localStorage访问错误
  }
  return 'en-US' // 默认英文
}

i18n
  .use(initReactI18next)
  .init({
    resources,
    lng: getStoredLanguage(), // 使用保存的语言或默认语言
    fallbackLng: 'en-US',
    debug: false, // 禁用调试日志
    
    // 禁用缺失键的警告
    saveMissing: false,
    missingKeyHandler: false,
    
    interpolation: {
      escapeValue: false, // React已经处理了XSS
    },
  })

if (import.meta.hot) {
  import.meta.hot.accept(['./locales/zh-CN.json', './locales/en-US.json'], ([zhModule, enModule]) => {
    if (zhModule) i18n.addResourceBundle('zh-CN', 'translation', zhModule.default, true, true)
    if (enModule) i18n.addResourceBundle('en-US', 'translation', enModule.default, true, true)
    // Existing React views must rerender after replacing in-memory translations.
    void i18n.changeLanguage(i18n.language)
  })
}

// 监听语言变化，自动保存到localStorage
i18n.on('languageChanged', (lng) => {
  try {
    localStorage.setItem('i18nextLng', lng)
  } catch (error) {
    // 忽略localStorage访问错误
  }
})

// 导出类型
export type { SupportedLanguage, TranslationKey, TFunction, LanguageConfig, TranslationNamespace } from './types'
export { AVAILABLE_LANGUAGES, TRANSLATION_NAMESPACES } from './types'

export default i18n
