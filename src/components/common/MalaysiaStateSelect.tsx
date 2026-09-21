import React from 'react'
import { Select } from 'antd'
import { useTranslation } from 'react-i18next'

const MALAYSIA_STATES = [
  'Johor', 'Kedah', 'Kelantan', 'Melaka', 'Negeri Sembilan',
  'Pahang', 'Perak', 'Perlis', 'Pulau Pinang', 'Sabah',
  'Sarawak', 'Selangor', 'Terengganu', 'Wilayah Persekutuan',
]

const STATE_I18N_KEYS: Record<string, string> = {
  'Johor': 'address.states.johor',
  'Kedah': 'address.states.kedah',
  'Kelantan': 'address.states.kelantan',
  'Melaka': 'address.states.melaka',
  'Negeri Sembilan': 'address.states.negerisembilan',
  'Pahang': 'address.states.pahang',
  'Perak': 'address.states.perak',
  'Perlis': 'address.states.perlis',
  'Pulau Pinang': 'address.states.pulaupinang',
  'Sabah': 'address.states.sabah',
  'Sarawak': 'address.states.sarawak',
  'Selangor': 'address.states.selangor',
  'Terengganu': 'address.states.terengganu',
  'Wilayah Persekutuan': 'address.states.wilayahpersekutuan',
}

interface MalaysiaStateSelectProps {
  value?: string
  onChange?: (value: string) => void
  disabled?: boolean
  style?: React.CSSProperties
  placeholder?: string
}

const MalaysiaStateSelect: React.FC<MalaysiaStateSelectProps> = ({
  value,
  onChange,
  disabled,
  style,
  placeholder,
}) => {
  const { t } = useTranslation()

  const options = MALAYSIA_STATES.map(state => ({
    value: state,
    label: t(STATE_I18N_KEYS[state]),
  }))

  return (
    <Select
      value={value || undefined}
      onChange={onChange}
      options={options}
      disabled={disabled}
      placeholder={placeholder ?? t('address.pleaseSelectProvince')}
      style={{ width: '100%', ...style }}
      className="gold-select"
      popupClassName="gold-select-dropdown"
    />
  )
}

export default MalaysiaStateSelect
