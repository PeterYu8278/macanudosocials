import { collection, doc, getDocs, runTransaction } from 'firebase/firestore'
import { db } from '../../config/firebase'
import { GLOBAL_COLLECTIONS } from '../../config/globalCollections'
import { sanitizeForFirestore } from './core/sanitize'
import { saveAuditLog } from './auditLog'
import type { Brand, Cigar } from '../../types'

const cleanName = (name: string) => name.normalize('NFKC').trim().replace(/\s+/g, ' ')
const nameKey = (name: string) => cleanName(name).toLowerCase()

// Stable IDs serialize simultaneous creation of the same new brand.
const newBrandId = (name: string) => {
  const id = `name-${encodeURIComponent(nameKey(name))}`
  if (id.length > 1400) throw new Error('Brand name is too long')
  return id
}

const saveInventory = async (input: { product?: Partial<Cigar>; productId?: string; brand?: Partial<Brand>; brandId?: string }) => {
  try {
    const requestedName = cleanName(input.brand?.name || input.product?.brand || '')
    if (!requestedName) throw new Error('Brand name is required')
    const brandsRef = collection(db, GLOBAL_COLLECTIONS.BRANDS)
    const cigarsRef = collection(db, GLOBAL_COLLECTIONS.CIGARS)
    const productRef = input.product ? (input.productId ? doc(db, GLOBAL_COLLECTIONS.CIGARS, input.productId) : doc(cigarsRef)) : null
    const stableRef = doc(db, GLOBAL_COLLECTIONS.BRANDS, newBrandId(requestedName))
    const result = await runTransaction(db, async transaction => {
      const brandList = await getDocs(brandsRef)
      const cigarList = await getDocs(cigarsRef)
      const brandSnapshots = await Promise.all(brandList.docs.map(item => transaction.get(item.ref)))
      const cigarSnapshots = await Promise.all(cigarList.docs.map(item => transaction.get(item.ref)))
      let availableRef = stableRef
      let stable = await transaction.get(availableRef)
      // Renamed brands keep their IDs. Resolve occupied legacy name IDs without overwriting them.
      for (let suffix = 1; stable.exists() && nameKey(String(stable.data()!.name || '')) !== nameKey(requestedName); suffix++) {
        if (suffix > 100) throw new Error('Unable to allocate a unique brand ID')
        availableRef = doc(db, GLOBAL_COLLECTIONS.BRANDS, `${stableRef.id}--${suffix}`)
        stable = await transaction.get(availableRef)
      }
      if (stable.exists() && !brandSnapshots.some(item => item.id === stable.id)) brandSnapshots.push(stable)
      const brands = brandSnapshots.filter(item => item.exists())
      const currentBrand = input.brandId ? brands.find(item => item.id === input.brandId) : undefined
      if (input.brandId && !currentBrand) throw new Error('Brand no longer exists')
      const matches = brands.filter(item => nameKey(String(item.data()!.name || '')) === nameKey(requestedName))
      const preferredId = input.brandId || input.product?.brandId
      const canonical = matches.find(item => item.id === preferredId) || matches.sort((a, b) => a.id.localeCompare(b.id))[0] || currentBrand
      const brandRef = canonical?.ref || availableRef
      const existing = canonical?.data() || currentBrand?.data()
      const name = input.brand ? requestedName : cleanName(String(existing?.name || requestedName))
      const sources = [...new Set([...matches.map(item => item.id), ...(currentBrand ? [currentBrand.id] : [])])]
      const oldNames = new Set(brands.filter(item => sources.includes(item.id)).map(item => nameKey(String(item.data()!.name || ''))))
      oldNames.add(nameKey(requestedName))
      const related = cigarSnapshots.filter(item => {
        if (!item.exists()) return false
        const cigar = item.data()!
        const linked = sources.includes(cigar.brandId) || (!cigar.brandId && oldNames.has(nameKey(String(cigar.brand || ''))))
        return linked && (cigar.brandId !== brandRef.id || cigar.brand !== name)
      })
      const existingProduct = input.productId ? await transaction.get(productRef!) : null
      if (input.productId && !existingProduct?.exists()) throw new Error('Product no longer exists')
      const duplicates = brands.filter(item => sources.includes(item.id) && item.id !== brandRef.id)
      // A rename or merge must not leave partially migrated products.
      if (related.length + duplicates.length + 2 > 500) throw new Error('Too many linked products to synchronize in one save')
      const now = new Date()
      const defaults = { description: '', logo: '', website: '', country: '', status: 'active', metadata: { totalProducts: 0, totalSales: 0, rating: 0, tags: [] }, createdAt: now }
      const brand = sanitizeForFirestore({ ...(existing || defaults), ...input.brand, name, updatedAt: now })
      transaction.set(brandRef, brand)
      for (const item of related) {
        if (item.id !== productRef?.id) transaction.update(item.ref, { brand: name, brandId: brandRef.id, updatedAt: now })
      }
      for (const item of duplicates) transaction.delete(item.ref)
      if (productRef) {
        const product = sanitizeForFirestore({ ...input.product, brand: name, brandId: brandRef.id, updatedAt: now, ...(!input.productId && { createdAt: now }) })
        if (input.productId) transaction.update(productRef, product)
        else transaction.set(productRef, product)
      }
      return { id: productRef?.id || brandRef.id, brandId: brandRef.id, brandCreated: !existing, mergedBrands: duplicates.length, syncedProducts: related.length }
    })
    // Audit logging must not turn a successful commit into a retryable failure.
    try {
      await saveAuditLog({
        module: 'inventory', action: input.productId || input.brandId ? 'update' : 'create', targetId: result.id,
        description: 'Saved inventory brand linkage', details: { ...result, ...input },
      })
    } catch (error) {
      console.error('[createInventoryProduct] Audit log failed:', error)
    }
    return { success: true as const, ...result }
  } catch (error) {
    return { success: false as const, error: error as Error }
  }
}

export const createInventoryProduct = (payload: Partial<Cigar>) => saveInventory({ product: payload })
export const updateInventoryProduct = (id: string, payload: Partial<Cigar>) => saveInventory({ product: payload, productId: id })
export const saveInventoryBrand = (payload: Partial<Brand>, id?: string) => saveInventory({ brand: payload, brandId: id })
