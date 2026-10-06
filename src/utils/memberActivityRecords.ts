import type { Event, VisitSession } from '../types'
import { toDateOrNull } from '../services/firebase/core/sanitize'

type MemberActivity = { kind: 'visit'; record: VisitSession } | { kind: 'event'; record: Event }

export function getMemberActivityEventImage(event: Event): string | undefined {
  return event.coverImage?.trim() || event.image?.trim() || undefined
}

export function getMemberActivityEventStatus(event: Event, now = new Date()): Event['status'] | 'unknown' {
  if (event.status === 'published') {
    const start = toDateOrNull(event.schedule?.startDate)
    const end = toDateOrNull(event.schedule?.endDate)
    if (end && now > end) return 'completed'
    if (start && now >= start) return 'ongoing'
    return start ? 'upcoming' : 'published'
  }
  if (['draft', 'upcoming', 'ongoing', 'completed', 'cancelled'].includes(event.status)) return event.status
  return 'unknown'
}

export function sortMemberActivityRecords(visits: VisitSession[], events: Event[]): MemberActivity[] {
  const activities: MemberActivity[] = [
    ...visits.map(record => ({ kind: 'visit' as const, record })),
    ...events.map(record => ({ kind: 'event' as const, record })),
  ]
  const time = (activity: MemberActivity) => toDateOrNull(activity.kind === 'visit'
    ? activity.record.checkInAt : activity.record.schedule?.startDate)?.getTime() ?? -Infinity
  return activities.sort((a, b) => {
    const dateA = time(a)
    const dateB = time(b)
    if (dateA !== dateB) return dateA > dateB ? -1 : 1
    return `${a.kind}:${a.record.id}`.localeCompare(`${b.kind}:${b.record.id}`)
  })
}
