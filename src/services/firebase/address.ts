/**
 * 地址管理服务
 */

import { 
  doc, 
  getDoc, 
  updateDoc, 
  Timestamp 
} from '@/services/firebase/monitoredFirestore'
import { db } from '../../config/firebase'
import { GLOBAL_COLLECTIONS } from '../../config/globalCollections'
import type { Address, User } from '../../types'

/**
 * 生成地址ID
 */
const generateAddressId = (): string => {
  return `addr_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`
}

/**
 * 获取用户地址列表
 */
export const getUserAddresses = async (userId: string): Promise<Address[]> => {
  try {
    const userDoc = await getDoc(doc(db, GLOBAL_COLLECTIONS.USERS, userId))
    if (!userDoc.exists()) {
      return []
    }
    
    const userData = userDoc.data() as User
    return userData.addresses || []
  } catch (error) {
    console.error('获取用户地址失败:', error)
    return []
  }
}

/**
 * 添加地址
 */
export const addAddress = async (
  userId: string, 
  addressData: Omit<Address, 'id' | 'createdAt' | 'updatedAt'>
): Promise<{ success: boolean; addressId?: string; error?: Error }> => {
  try {
    const userRef = doc(db, GLOBAL_COLLECTIONS.USERS, userId)
    const userDoc = await getDoc(userRef)
    
    if (!userDoc.exists()) {
      return { success: false, error: new Error('用户不存在') }
    }
    
    const userData = userDoc.data() as User
    const existingAddresses = userData.addresses || []
    
    // 如果这是第一个地址，自动设为默认地址
    const isDefault = existingAddresses.length === 0 || addressData.isDefault
    
    // 如果设为默认地址，取消其他地址的默认状态
    if (isDefault) {
      existingAddresses.forEach(addr => {
        addr.isDefault = false
      })
    }
    
    const newAddress: Address = {
      ...addressData,
      id: generateAddressId(),
      isDefault,
      createdAt: new Date(),
      updatedAt: new Date()
    }
    
    const updatedAddresses = [...existingAddresses, newAddress]
    
    await updateDoc(userRef, {
      addresses: updatedAddresses,
      updatedAt: Timestamp.now()
    })
    
    return { success: true, addressId: newAddress.id }
  } catch (error) {
    console.error('添加地址失败:', error)
    return { success: false, error: error as Error }
  }
}

/**
 * 更新地址
 */
export const updateAddress = async (
  userId: string,
  addressId: string,
  addressData: Partial<Omit<Address, 'id' | 'createdAt' | 'updatedAt'>>
): Promise<{ success: boolean; error?: Error }> => {
  try {
    const userRef = doc(db, GLOBAL_COLLECTIONS.USERS, userId)
    const userDoc = await getDoc(userRef)
    
    if (!userDoc.exists()) {
      return { success: false, error: new Error('用户不存在') }
    }
    
    const userData = userDoc.data() as User
    const addresses = userData.addresses || []
    const addressIndex = addresses.findIndex(addr => addr.id === addressId)
    
    if (addressIndex === -1) {
      return { success: false, error: new Error('地址不存在') }
    }
    
    // 如果设为默认地址，取消其他地址的默认状态
    if (addressData.isDefault) {
      addresses.forEach((addr, index) => {
        if (index !== addressIndex) {
          addr.isDefault = false
        }
      })
    }
    
    addresses[addressIndex] = {
      ...addresses[addressIndex],
      ...addressData,
      updatedAt: new Date()
    }
    
    await updateDoc(userRef, {
      addresses,
      updatedAt: Timestamp.now()
    })
    
    return { success: true }
  } catch (error) {
    console.error('更新地址失败:', error)
    return { success: false, error: error as Error }
  }
}

/**
 * 删除地址
 */
export const deleteAddress = async (
  userId: string,
  addressId: string
): Promise<{ success: boolean; error?: Error }> => {
  try {
    const userRef = doc(db, GLOBAL_COLLECTIONS.USERS, userId)
    const userDoc = await getDoc(userRef)
    
    if (!userDoc.exists()) {
      return { success: false, error: new Error('用户不存在') }
    }
    
    const userData = userDoc.data() as User
    const addresses = userData.addresses || []
    const filteredAddresses = addresses.filter(addr => addr.id !== addressId)
    
    // 如果删除的是默认地址，且还有其他地址，将第一个设为默认
    const deletedAddress = addresses.find(addr => addr.id === addressId)
    if (deletedAddress?.isDefault && filteredAddresses.length > 0) {
      filteredAddresses[0].isDefault = true
    }
    
    await updateDoc(userRef, {
      addresses: filteredAddresses,
      updatedAt: Timestamp.now()
    })
    
    return { success: true }
  } catch (error) {
    console.error('删除地址失败:', error)
    return { success: false, error: error as Error }
  }
}

/**
 * 设置默认地址
 */
export const setDefaultAddress = async (
  userId: string,
  addressId: string
): Promise<{ success: boolean; error?: Error }> => {
  try {
    const userRef = doc(db, GLOBAL_COLLECTIONS.USERS, userId)
    const userDoc = await getDoc(userRef)
    
    if (!userDoc.exists()) {
      return { success: false, error: new Error('用户不存在') }
    }
    
    const userData = userDoc.data() as User
    const addresses = userData.addresses || []
    
    // 取消所有地址的默认状态
    addresses.forEach(addr => {
      addr.isDefault = addr.id === addressId
    })
    
    await updateDoc(userRef, {
      addresses,
      updatedAt: Timestamp.now()
    })
    
    return { success: true }
  } catch (error) {
    console.error('设置默认地址失败:', error)
    return { success: false, error: error as Error }
  }
}

