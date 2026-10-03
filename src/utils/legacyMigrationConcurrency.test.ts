import { describe, expect, it } from 'vitest'
import { forEachMigrationMember } from './legacyMigrationConcurrency'

describe('migration member concurrency', () => {
  it('limits concurrent members and preserves order within a member', async () => {
    const rows = [
      { member: 'a', index: 1 }, { member: 'b', index: 1 },
      { member: 'a', index: 2 }, { member: 'c', index: 1 },
    ]
    let active = 0
    let peak = 0
    const running = new Set<string>()
    const finished: string[] = []
    await forEachMigrationMember(rows, row => row.member, async row => {
      expect(running.has(row.member)).toBe(false)
      running.add(row.member)
      peak = Math.max(peak, ++active)
      await new Promise(resolve => setTimeout(resolve, 1))
      finished.push(`${row.member}${row.index}`)
      running.delete(row.member)
      active -= 1
    }, 2)
    expect(peak).toBe(2)
    expect(finished.indexOf('a1')).toBeLessThan(finished.indexOf('a2'))
    expect(finished).toHaveLength(4)
  })

  it('handles empty batches without running a worker', async () => {
    let calls = 0
    await forEachMigrationMember([], () => '', async () => { calls += 1 })
    expect(calls).toBe(0)
  })

  it('continues after a row reports a handled failure', async () => {
    const finished: number[] = []
    await forEachMigrationMember([1, 2, 3], () => 'same-member', async row => {
      try {
        if (row === 2) throw new Error('Invalid row')
        finished.push(row)
      } catch { /* Per-row errors are reported by the migration stage. */ }
    })
    expect(finished).toEqual([1, 3])
  })
})
