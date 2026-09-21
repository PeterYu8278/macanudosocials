import React from 'react'
import { Select } from 'antd'
import { useTranslation } from 'react-i18next'

export type SupportedLanguage = 'zh-CN' | 'en-US'

interface LanguageSelectProps {
  value?: SupportedLanguage
  onChange?: (value: SupportedLanguage) => void
  style?: React.CSSProperties
  disabled?: boolean
}

const LanguageSelect: React.FC<LanguageSelectProps> = ({ value, onChange, style, disabled }) => {
  const { t } = useTranslation()

  const options = [
    { label: t('language.zhCN'), value: 'zh-CN' as SupportedLanguage },
    { label: t('language.enUS'), value: 'en-US' as SupportedLanguage }
  ]

  return (
    <Select
      value={value}
      onChange={onChange}
      options={options}
      style={style}
      disabled={disabled}
      className="gold-select"
      popupClassName="gold-select-dropdown"
    />
  )
}

export default LanguageSelect
