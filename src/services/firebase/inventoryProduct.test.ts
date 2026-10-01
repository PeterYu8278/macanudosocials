import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  getDocs: vi.fn(), get: vi.fn(), set: vi.fn(), update: vi.fn(), delete: vi.fn(), run: vi.fn(), audit: vi.fn(),
}))
vi.mock('firebase/firestore', () => ({
  collection: (_db: unknown, name: string) => ({ name }),
  doc: (ref: { name: string }, collection?: string, id?: string) => ({ id: id || `new-${ref.name}`, collection: collection || ref.name }),
  getDocs: mocks.getDocs,
  runTransaction: mocks.run,
}))
vi.mock('../../config/firebase', () => ({ db: {} }))
vi.mock('./auditLog', () => ({ saveAuditLog: mocks.audit }))
import { createInventoryProduct, updateInventoryProduct, saveInventoryBrand } from './inventoryProduct'

const snapshot = (collection: string, id: string, data?: Record<string, unknown>) => ({ id, ref: { collection, id }, exists: () => data !== undefined, data: () => data })
const seed = (brands: ReturnType<typeof snapshot>[], cigars: ReturnType<typeof snapshot>[] = []) => {
  mocks.getDocs.mockImplementation(async (ref: { name: string }) => ({ docs: ref.name === 'brands' ? brands : cigars }))
  mocks.get.mockImplementation(async (ref: { collection: string; id: string }) => [...brands, ...cigars].find(item => item.ref.collection === ref.collection && item.id === ref.id) || snapshot(ref.collection, ref.id))
}

describe('createInventoryProduct', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mocks.getDocs.mockResolvedValue({ docs: [] })
    seed([])
    mocks.run.mockImplementation(async (_db, callback) => callback({ get: mocks.get, set: mocks.set, update: mocks.update, delete: mocks.delete }))
    mocks.audit.mockResolvedValue(undefined)
  })

  it('creates the brand and linked cigar in one commit', async () => {
    const result = await createInventoryProduct({ name: 'Robusto', brand: ' New Brand ' })
    expect(result.success).toBe(true)
    expect(mocks.set).toHaveBeenCalledTimes(2)
    const [brandRef, brand] = mocks.set.mock.calls[0]
    expect(brand).toMatchObject({ name: 'New Brand', status: 'active', country: '' })
    expect(mocks.set.mock.calls[1][1]).toMatchObject({ brand: 'New Brand', brandId: brandRef.id })
    expect(mocks.run).toHaveBeenCalledTimes(1)
  })

  it('reuses an existing brand despite differences in case and surrounding spaces', async () => {
    seed([snapshot('brands', 'existing', { name: 'Macanudo', country: 'Dominican Republic', metadata: { totalSales: 50 } })])
    const result = await createInventoryProduct({ name: 'Robusto', brand: ' macanudo ' })
    expect(result.success).toBe(true)
    expect(mocks.set).toHaveBeenCalledTimes(2)
    expect(mocks.set.mock.calls[0][1]).toMatchObject({ country: 'Dominican Republic', metadata: { totalSales: 50 } })
    expect(mocks.set.mock.calls[1][1]).toMatchObject({ brand: 'Macanudo', brandId: 'existing' })
  })

  it('returns failure when the atomic commit fails', async () => {
    mocks.run.mockRejectedValueOnce(new Error('permission denied'))
    const result = await createInventoryProduct({ brand: 'New Brand' })
    expect(result.success).toBe(false)
    expect(mocks.audit).not.toHaveBeenCalled()
  })

  it('does not create a duplicate brand if loading existing brands fails', async () => {
    mocks.getDocs.mockRejectedValueOnce(new Error('network error'))
    expect((await createInventoryProduct({ brand: 'Macanudo' })).success).toBe(false)
    expect(mocks.set).not.toHaveBeenCalled()
  })

  it('rejects a blank brand without writing anything', async () => {
    expect((await createInventoryProduct({ brand: '  ' })).success).toBe(false)
    expect(mocks.getDocs).not.toHaveBeenCalled()
    expect(mocks.run).not.toHaveBeenCalled()
  })

  it('creates a new linked brand when editing a cigar with a stale selected brand ID', async () => {
    seed([snapshot('brands', 'old', { name: 'Old' })], [snapshot('cigars', 'cigar-1', { brand: 'Old', brandId: 'old', createdAt: new Date() })])
    const result = await updateInventoryProduct('cigar-1', { name: 'Robusto', brand: ' New  Brand ', brandId: 'old' })
    expect(result.success).toBe(true)
    expect(mocks.set.mock.calls[0][1]).toMatchObject({ name: 'New Brand' })
    expect(mocks.update).toHaveBeenCalledWith(expect.objectContaining({ id: 'cigar-1' }), expect.objectContaining({ brand: 'New Brand', brandId: 'name-new%20brand' }))
    expect(mocks.update.mock.calls[0][1]).not.toHaveProperty('createdAt')
  })

  it('renames linked and legacy cigars but leaves other branded products alone', async () => {
    seed([snapshot('brands', 'brand-1', { name: 'Old Brand', metadata: { totalSales: 20 } })], [
      snapshot('cigars', 'linked', { brandId: 'brand-1', brand: 'Old Brand' }),
      snapshot('cigars', 'legacy', { brand: ' old  brand ' }),
      snapshot('cigars', 'unrelated', { brandId: 'another', brand: 'Old Brand' }),
    ])
    expect((await saveInventoryBrand({ name: 'New Name', description: 'Updated' }, 'brand-1')).success).toBe(true)
    expect(mocks.set.mock.calls[0][1]).toMatchObject({ name: 'New Name', metadata: { totalSales: 20 } })
    expect(mocks.update).toHaveBeenCalledTimes(2)
    for (const [, data] of mocks.update.mock.calls) expect(data).toMatchObject({ brand: 'New Name', brandId: 'brand-1' })
  })

  it('merges duplicate brands and migrates their products when renaming to an existing name', async () => {
    seed([snapshot('brands', 'old', { name: 'Old' }), snapshot('brands', 'target', { name: 'Macanudo' }), snapshot('brands', 'duplicate', { name: ' MACANUDO ' })], [
      snapshot('cigars', 'a', { brandId: 'old', brand: 'Old' }), snapshot('cigars', 'b', { brandId: 'duplicate', brand: ' MACANUDO ' }),
    ])
    const result = await saveInventoryBrand({ name: 'Macanudo' }, 'old')
    expect(result).toMatchObject({ success: true, brandId: 'duplicate', mergedBrands: 2 })
    expect(mocks.delete).toHaveBeenCalledTimes(2)
    expect(mocks.update).toHaveBeenCalledTimes(2)
    for (const [, data] of mocks.update.mock.calls) expect(data).toMatchObject({ brand: 'Macanudo', brandId: 'duplicate' })
  })

  it('reuses the deterministic brand created by a concurrent save', async () => {
    mocks.get.mockImplementation(async (ref: { id: string; collection: string }) => snapshot(ref.collection, ref.id, { name: 'New Brand', description: 'Concurrent brand' }))
    expect((await createInventoryProduct({ brand: 'new brand' })).success).toBe(true)
    expect(mocks.set.mock.calls[0][1]).toMatchObject({ description: 'Concurrent brand' })
    expect(mocks.set.mock.calls[1][1]).toMatchObject({ brandId: 'name-new%20brand', brand: 'New Brand' })
  })

  it('preserves a name-keyed brand ID when renaming', async () => {
    seed([snapshot('brands', 'name-old', { name: 'Old', metadata: { totalSales: 20 } })], [snapshot('cigars', 'linked', { brandId: 'name-old', brand: 'Old' })])
    expect(await saveInventoryBrand({ name: 'New' }, 'name-old')).toMatchObject({ success: true, brandId: 'name-old' })
    expect(mocks.delete).not.toHaveBeenCalled()
    expect(mocks.set.mock.calls[0][1]).toMatchObject({ name: 'New', metadata: { totalSales: 20 } })
    expect(mocks.update).toHaveBeenCalledWith(expect.objectContaining({ id: 'linked' }), expect.objectContaining({ brandId: 'name-old', brand: 'New' }))
  })

  it('never overwrites an unrelated brand occupying a legacy name-keyed document', async () => {
    seed([snapshot('brands', 'name-old', { name: 'Renamed elsewhere' })])
    expect(await createInventoryProduct({ brand: 'Old' })).toMatchObject({ success: true, brandId: 'name-old--1' })
    expect(mocks.set.mock.calls[0][0]).toMatchObject({ id: 'name-old--1' })
  })

  it('reuses the same normalized brand when creating in brand management', async () => {
    seed([snapshot('brands', 'existing', { name: 'New Brand' })])
    expect(await saveInventoryBrand({ name: ' new  brand ', country: 'Cuba' })).toMatchObject({ success: true, brandId: 'existing', brandCreated: false })
    expect(mocks.set).toHaveBeenCalledTimes(1)
    expect(mocks.set.mock.calls[0][1]).toMatchObject({ country: 'Cuba' })
  })

  it('does not create a brand for an edited product that no longer exists', async () => {
    expect((await updateInventoryProduct('missing', { brand: 'New Brand' })).success).toBe(false)
    expect(mocks.set).not.toHaveBeenCalled()
  })
})
