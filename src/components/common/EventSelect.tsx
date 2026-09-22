import React from 'react'
import { Select } from 'antd'
import { useTranslation } from 'react-i18next'
import { useFirestoreQuery } from '../../hooks/useFirestoreQuery'
import { getUpcomingEvents } from '../../services/firebase/firestore'
import type { Event } from '../../types'

interface EventSelectProps {
  value?: string
  onChange?: (eventId: string) => void
  disabled?: boolean
  style?: React.CSSProperties
  placeholder?: string
}

const EventSelect: React.FC<EventSelectProps> = ({
  value,
  onChange,
  disabled,
  style,
  placeholder,
}) => {
  const { t } = useTranslation()
  const { data: allEvents = [], loading } = useFirestoreQuery(getUpcomingEvents)

  const options = (allEvents as Event[])
    .filter((event: Event) => {
      const now = new Date()
      const isStatusValid = event.status === 'upcoming' || event.status === 'ongoing'
      const isDeadlineValid = new Date((event as any).schedule?.endDate) >= now
      return isStatusValid && isDeadlineValid
    })
    .map((event: Event) => ({
      value: event.id,
      label: `${event.title} - ${(event as any).location?.name ?? ''}`,
    }))

  return (
    <Select
      value={value || undefined}
      onChange={onChange}
      options={options}
      loading={loading}
      disabled={disabled || loading}
      placeholder={placeholder ?? t('shop.selectEvent')}
      style={{ width: '100%', ...style }}
      className="gold-select"
      popupClassName="gold-select-dropdown"
    />
  )
}

export default EventSelect
