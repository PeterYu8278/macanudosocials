/**
 * 品牌相关 API
 */

import { apiCall, ApiConfig } from './base'
import * as firestoreService from '../firebase/firestore'
import { saveInventoryBrand } from '../firebase/inventoryProduct'
import type { Brand } from '../../types'

/**
 * 获取品牌列表
 */
export const getBrandList = (config?: ApiConfig) => {
  return apiCall(
    () => firestoreService.getBrands(),
    config
  )
}

/**
 * 获取品牌详情
 */
export const getBrandById = (brandId: string, config?: ApiConfig) => {
  return apiCall(
    () => firestoreService.getBrandById(brandId),
    config
  )
}

/**
 * 创建品牌
 */
export const createBrand = (brandData: Omit<Brand, 'id'>, config?: ApiConfig) => {
  return apiCall(
    () => saveInventoryBrand(brandData),
    {
      showSuccess: true,
      successMessage: '品牌创建成功',
      ...config
    }
  )
}

/**
 * 更新品牌
 */
export const updateBrand = (brandId: string, brandData: Partial<Brand>, config?: ApiConfig) => {
  return apiCall(
    async () => {
      const current = await firestoreService.getBrandById(brandId)
      if (!current) return { success: false, error: new Error('Brand no longer exists') }
      return saveInventoryBrand({ ...brandData, name: brandData.name ?? current.name }, brandId)
    },
    {
      showSuccess: true,
      successMessage: '品牌更新成功',
      ...config
    }
  )
}

/**
 * 删除品牌
 */
export const deleteBrand = (brandId: string, config?: ApiConfig) => {
  return apiCall(
    () => firestoreService.deleteDocument(firestoreService.COLLECTIONS.BRANDS, brandId),
    {
      showSuccess: true,
      successMessage: '品牌删除成功',
      ...config
    }
  )
}

/**
 * 批量删除品牌
 */
export const batchDeleteBrands = (brandIds: string[], config?: ApiConfig) => {
  return apiCall(
    async () => {
      const results = await Promise.all(
        brandIds.map(id => firestoreService.deleteDocument(firestoreService.COLLECTIONS.BRANDS, id))
      )
      return results
    },
    {
      showSuccess: true,
      successMessage: `成功删除 ${brandIds.length} 个品牌`,
      ...config
    }
  )
}

/**
 * 搜索品牌
 */
export const searchBrands = (keyword: string, config?: ApiConfig) => {
  return apiCall(
    async () => {
      const brands = await firestoreService.getBrands()
      
      if (!keyword) return brands

      const lowerKeyword = keyword.toLowerCase()
      return brands.filter((brand: Brand) =>
        brand.name?.toLowerCase().includes(lowerKeyword) ||
        brand.description?.toLowerCase().includes(lowerKeyword) ||
        brand.country?.toLowerCase().includes(lowerKeyword)
      )
    },
    config
  )
}

