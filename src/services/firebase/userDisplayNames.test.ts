import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({ getDocument: vi.fn() }))
vi.mock('./firestore', () => ({ getDocument: mocks.getDocument }))
import { getUserDisplayNames } from './userDisplayNames'

describe('getUserDisplayNames', () => {
  beforeEach(() => vi.resetAllMocks())

  it('looks up display names rather than displaying document IDs and deduplicates requests', async () => {
    mocks.getDocument.mockResolvedValue({ displayName: ' Alice ' })
    expect(await getUserDisplayNames(['operator-id', 'operator-id', undefined, ''])).toEqual({ 'operator-id': 'Alice' })
    expect(mocks.getDocument).toHaveBeenCalledTimes(1)
    expect(mocks.getDocument).toHaveBeenCalledWith('users', 'operator-id')
  })

  it('does not expose IDs for missing users or users without a name', async () => {
    mocks.getDocument.mockResolvedValueOnce(null).mockResolvedValueOnce({ displayName: '' })
    expect(await getUserDisplayNames(['deleted-id', 'unnamed-id'])).toEqual({ 'deleted-id': '', 'unnamed-id': '' })
  })

  it('keeps other names available if one user lookup fails', async () => {
    mocks.getDocument.mockRejectedValueOnce(new Error('permission denied')).mockResolvedValueOnce({ displayName: 'Bob' })
    expect(await getUserDisplayNames(['unreadable-id', 'bob-id'])).toEqual({ 'unreadable-id': '', 'bob-id': 'Bob' })
  })
})
