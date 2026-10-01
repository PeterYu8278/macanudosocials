export const toDateOrNull = (value: any): Date | null => {
  if (!value) return null
  if (value?.toDate) return value.toDate()

  const date = new Date(value)
  return Number.isNaN(date.getTime()) ? null : date
}

export const formatDisplayDate = (value: unknown, language: string): string => {
  const date = toDateOrNull(value)
  if (!date) return '-'

  if (language.startsWith('zh')) {
    return date.toLocaleDateString('zh-CN', { year: 'numeric', month: 'long', day: 'numeric' })
  }

  return `${date.getDate()} ${date.toLocaleString('en-US', { month: 'short' })}, ${date.getFullYear()}`
}

export const formatDisplayTime = (value: unknown, language: string): string => {
  const date = toDateOrNull(value)
  if (!date) return '-'

  return date.toLocaleTimeString(language.startsWith('zh') ? 'zh-CN' : 'en-US', {
    hour: 'numeric',
    minute: '2-digit',
  })
}

export const formatDisplayDateRange = (startValue: unknown, endValue: unknown, language: string): string => {
  const start = toDateOrNull(startValue)
  const end = toDateOrNull(endValue)
  if (!start || !end) return `${formatDisplayDate(start, language)} - ${formatDisplayDate(end, language)}`

  if (
    start.getFullYear() === end.getFullYear()
    && start.getMonth() === end.getMonth()
    && start.getDate() === end.getDate()
  ) {
    return formatDisplayDate(start, language)
  }

  if (language.startsWith('zh')) {
    if (start.getFullYear() === end.getFullYear()) {
      return `${start.getFullYear()}/${start.getMonth() + 1}/${start.getDate()} - ${end.getMonth() + 1}/${end.getDate()}`
    }
    return `${start.getFullYear()}/${start.getMonth() + 1}/${start.getDate()} - ${end.getFullYear()}/${end.getMonth() + 1}/${end.getDate()}`
  }

  if (start.getFullYear() === end.getFullYear() && start.getMonth() === end.getMonth()) {
    return `${start.getDate()} - ${end.getDate()} ${end.toLocaleString('en-US', { month: 'short' })} ${end.getFullYear()}`
  }
  if (start.getFullYear() === end.getFullYear()) {
    return `${start.getDate()} ${start.toLocaleString('en-US', { month: 'short' })} - ${end.getDate()} ${end.toLocaleString('en-US', { month: 'short' })} ${end.getFullYear()}`
  }
  return `${formatDisplayDate(start, language)} - ${formatDisplayDate(end, language)}`
}
