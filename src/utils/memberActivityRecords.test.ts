import { describe, expect, it } from 'vitest'
import type { Event, VisitSession } from '../types'
import { sortMemberActivityRecords, getMemberActivityEventImage, getMemberActivityEventStatus } from './memberActivityRecords'
const visit = (id: string, date: unknown) => ({ id, checkInAt: date } as VisitSession)
const event = (id: string, date: unknown) => ({ id, schedule: { startDate: date } } as Event)
describe('member activity chronology', () => {
  it('merges visits and events with the latest date first', () => {
    const visits = [visit('july', new Date('2026-07-21')), visit('october', new Date('2026-10-05'))]
    const events = [event('august', new Date('2026-08-01'))]
    expect(sortMemberActivityRecords(visits, events).map(a => a.record.id)).toEqual(['october', 'august', 'july'])
    expect(visits[0].id).toBe('july')
  })
  it('accepts Firestore timestamps and legacy date strings', () => {
    expect(sortMemberActivityRecords([visit('visit', { toDate: () => new Date('2026-10-05') })], [event('event', '2026-10-06')])
      .map(a => a.record.id)).toEqual(['event', 'visit'])
  })
  it('puts missing or invalid dates last with deterministic ties', () => {
    const records = sortMemberActivityRecords([visit('z', null), visit('a', 'invalid')], [event('valid', '2026-10-06')])
    expect(records.map(a => a.record.id)).toEqual(['valid', 'a', 'z'])
  })
})

describe('member activity event display', () => {
  const now = new Date('2026-10-06T00:00:00Z')
  const published = { ...event('event', new Date('2026-10-15T00:00:00Z')), status: 'published' as const }
  it('uses the canonical image field when the cover alias is missing', () => {
    expect(getMemberActivityEventImage({ ...published, image: 'https://example.com/image.jpg' })).toBe('https://example.com/image.jpg')
    expect(getMemberActivityEventImage({ ...published, coverImage: ' ', image: 'image.jpg' })).toBe('image.jpg')
    expect(getMemberActivityEventImage({ ...published, coverImage: 'cover.jpg', image: 'image.jpg' })).toBe('cover.jpg')
    expect(getMemberActivityEventImage(published)).toBeUndefined()
  })
  it('does not mark a future published activity completed', () => {
    expect(getMemberActivityEventStatus(published, now)).toBe('upcoming')
  })
  it('calculates ongoing and ended published activities from timestamp dates', () => {
    const scheduled = { ...published, schedule: { startDate: { toDate: () => new Date('2026-10-05') }, endDate: new Date('2026-10-07') } } as unknown as Event
    expect(getMemberActivityEventStatus(scheduled, now)).toBe('ongoing')
    expect(getMemberActivityEventStatus(scheduled, new Date('2026-10-08'))).toBe('completed')
  })
  it('preserves explicit draft, cancelled and completed states', () => {
    for (const status of ['draft', 'cancelled', 'completed'] as const) {
      expect(getMemberActivityEventStatus({ ...published, status }, now)).toBe(status)
    }
  })
  it('does not mislabel unknown or undated published records', () => {
    expect(getMemberActivityEventStatus({ ...published, status: 'legacy' } as unknown as Event, now)).toBe('unknown')
    expect(getMemberActivityEventStatus({ ...published, schedule: undefined } as unknown as Event, now)).toBe('published')
  })
})
