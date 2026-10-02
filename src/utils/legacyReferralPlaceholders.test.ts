import { describe, expect, it } from 'vitest'
import { addUnknownReferralEntries } from './legacyReferralPlaceholders'

describe('addUnknownReferralEntries', () => {
  it('creates enough unknown people to restore the declared referral count', () => {
    const result = addUnknownReferralEntries([], 2, index => `unknown-${index + 1}`)
    expect(result.referrals).toEqual([
      expect.objectContaining({ userId: 'unknown-1', placeholderIndex: 1, isPlaceholder: true }),
      expect.objectContaining({ userId: 'unknown-2', placeholderIndex: 2, isPlaceholder: true }),
    ])
  })

  it('preserves known and previously renamed referrals', () => {
    const existing = [{ userId: 'known-1', userName: 'Alice' }, { userId: 'unknown-1', userName: 'Name Pending', isPlaceholder: true }]
    const result = addUnknownReferralEntries(existing, 2, index => `unknown-${index + 1}`)
    expect(result.referrals).toEqual(existing)
    expect(result.created).toEqual([])
  })

  it('is idempotent when the requested number is already present', () => {
    const existing = [{ userId: 'unknown-1', userName: 'Unknown Person 1', isPlaceholder: true }]
    const first = addUnknownReferralEntries(existing, 3, index => `unknown-${index + 1}`)
    const second = addUnknownReferralEntries(first.referrals, 3, index => `unknown-${index + 1}`)
    expect(second.referrals).toEqual(first.referrals)
    expect(second.created).toEqual([])
  })
})
