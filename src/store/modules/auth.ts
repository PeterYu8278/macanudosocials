// 认证状态管理
import { create } from 'zustand'
import { onAuthStateChange, getUserData, convertFirestoreTimestamps, findUserByEmail, createMissingUserDocument } from '../../services/firebase/auth'
import type { User, UserRole, Permission } from '../../types'
import { hasPermission } from '../../config/permissions'
import { doc, onSnapshot, Unsubscribe } from 'firebase/firestore'
import { db } from '../../config/firebase'

interface AuthState {
  user: User | null
  firebaseUser: any | null
  loading: boolean
  error: string | null
  isAdmin: boolean
  isSuperAdmin: boolean
  isDeveloper: boolean
  initialized: boolean
  
  // 策略1: 内存缓存
  cachedUserData: User | null
  cacheTimestamp: number
  cacheValidDuration: number // 缓存有效期（毫秒），默认5分钟
  
  // Actions
  setUser: (user: User | null) => void
  setFirebaseUser: (user: any | null) => void
  setLoading: (loading: boolean) => void
  setError: (error: string | null) => void
  initializeAuth: () => void
  logout: () => void
  hasPermission: (permission: keyof Permission) => boolean
}

// 全局变量：防止重复初始化
let authUnsubscribe: (() => void) | null = null
let userDocUnsubscribe: Unsubscribe | null = null

// 策略2: sessionStorage 缓存键名
const SESSION_STORAGE_KEYS = {
  FIRESTORE_USER_ID: 'firestoreUserId',
  USER_DATA: 'auth_userData',
  CACHE_TIMESTAMP: 'auth_cacheTimestamp',
} as const;

// 缓存有效期：5分钟
const CACHE_VALID_DURATION = 5 * 60 * 1000;

const waitForNewUserDocument = async (firebaseUser: any): Promise<User | null> => {
  const creationTime = Date.parse(firebaseUser.metadata?.creationTime || '');
  const isRecentlyCreated = Number.isFinite(creationTime) && Date.now() - creationTime < 30_000;
  if (!isRecentlyCreated) return null;

  // Firebase Auth notifies listeners before registerUser finishes its Firestore write.
  for (let attempt = 1; attempt <= 5; attempt += 1) {
    await new Promise(resolve => setTimeout(resolve, attempt * 200));
    const userData = await getUserData(firebaseUser.uid, false);
    if (userData) return userData;
  }

  return null;
};

// 策略1: 从 sessionStorage 读取缓存的用户数据
const getCachedUserDataFromStorage = (): { userData: User; timestamp: number } | null => {
  try {
    const cachedData = sessionStorage.getItem(SESSION_STORAGE_KEYS.USER_DATA);
    const cachedTimestamp = sessionStorage.getItem(SESSION_STORAGE_KEYS.CACHE_TIMESTAMP);
    
    if (cachedData && cachedTimestamp) {
      const userData = JSON.parse(cachedData) as User;
      const timestamp = parseInt(cachedTimestamp, 10);
      const now = Date.now();
      
      // 检查缓存是否有效（5分钟内）
      if (now - timestamp < CACHE_VALID_DURATION) {
        return { userData, timestamp };
      } else {
        // 缓存过期，清除
        sessionStorage.removeItem(SESSION_STORAGE_KEYS.USER_DATA);
        sessionStorage.removeItem(SESSION_STORAGE_KEYS.CACHE_TIMESTAMP);
      }
    }
  } catch (error) {
    console.warn('[Auth Store] 读取 sessionStorage 缓存失败:', error);
  }
  return null;
};

// 策略1: 保存用户数据到 sessionStorage
const saveUserDataToStorage = (userData: User) => {
  try {
    sessionStorage.setItem(SESSION_STORAGE_KEYS.USER_DATA, JSON.stringify(userData));
    sessionStorage.setItem(SESSION_STORAGE_KEYS.CACHE_TIMESTAMP, Date.now().toString());
  } catch (error) {
    console.warn('[Auth Store] 保存 sessionStorage 缓存失败:', error);
  }
};

// 策略1: 检查内存缓存是否有效
const isMemoryCacheValid = (cachedUser: User | null, cacheTimestamp: number, firebaseUid: string): boolean => {
  if (!cachedUser || !cacheTimestamp) return false;
  
  const now = Date.now();
  const isExpired = now - cacheTimestamp >= CACHE_VALID_DURATION;
  
  // 检查缓存是否过期，以及是否匹配当前用户
  return !isExpired && cachedUser.id === firebaseUid;
};

export const useAuthStore = create<AuthState>((set, get) => ({
  user: null,
  firebaseUser: null,
  loading: true,
  error: null,
  isAdmin: false,
  isSuperAdmin: false,
  isDeveloper: false,
  initialized: false,
  
  // 策略1: 内存缓存
  cachedUserData: null,
  cacheTimestamp: 0,
  cacheValidDuration: CACHE_VALID_DURATION,

  setUser: (user) => {
    set({ user });
    // 策略1: 同时更新内存缓存
    if (user) {
      set({ 
        cachedUserData: user,
        cacheTimestamp: Date.now()
      });
      // 策略2: 同时保存到 sessionStorage
      saveUserDataToStorage(user);
    } else {
      set({ 
        cachedUserData: null,
        cacheTimestamp: 0
      });
      // 清除 sessionStorage 缓存
      sessionStorage.removeItem(SESSION_STORAGE_KEYS.USER_DATA);
      sessionStorage.removeItem(SESSION_STORAGE_KEYS.CACHE_TIMESTAMP);
    }
  },
  
  setFirebaseUser: (firebaseUser) => set({ firebaseUser }),
  
  setLoading: (loading) => set({ loading }),
  
  setError: (error) => set({ error }),

  initializeAuth: () => {
    const { initialized } = get()
    
    // 如果已经初始化，直接返回
    if (initialized) {
      return
    }
    
    const { setLoading, setUser, setFirebaseUser } = get()
    
    // 如果已有订阅，先取消
    if (authUnsubscribe) {
      authUnsubscribe()
    }
    
    // 创建新订阅
    authUnsubscribe = onAuthStateChange(async (firebaseUser) => {
      setLoading(true)
      
      // 取消之前的用户文档监听
      if (userDocUnsubscribe) {
        userDocUnsubscribe()
        userDocUnsubscribe = null
      }
      
      if (firebaseUser) {
        try {
          const { cachedUserData, cacheTimestamp } = get();
          let firestoreUserId: string | null = null;
          let userData: User | null = null;

          // 策略1: 检查内存缓存
          if (cachedUserData && isMemoryCacheValid(cachedUserData, cacheTimestamp, firebaseUser.uid)) {
            console.info('[Auth Store] ✅ 使用内存缓存数据');
            userData = cachedUserData;
            firestoreUserId = cachedUserData.id;
          } else {
            // 策略2: 检查 sessionStorage 缓存
            const storageCache = getCachedUserDataFromStorage();
            if (storageCache && storageCache.userData.id === firebaseUser.uid) {
              console.info('[Auth Store] ✅ 使用 sessionStorage 缓存数据');
              userData = storageCache.userData;
              firestoreUserId = storageCache.userData.id;
              // 更新内存缓存
              set({ 
                cachedUserData: userData,
                cacheTimestamp: storageCache.timestamp
              });
            } else {
              // 缓存无效，需要从 Firestore 读取
              // 策略4: 优先使用 sessionStorage 中的 firestoreUserId
              firestoreUserId = sessionStorage.getItem(SESSION_STORAGE_KEYS.FIRESTORE_USER_ID);
              
              if (firestoreUserId) {
                // 场景 1: 有 sessionStorage 中的 ID（Google 登录）
                userData = await getUserData(firestoreUserId, true); // 使用缓存
              } else {
                // 策略4: 优化查询路径 - 优先使用 Firebase UID（减少查询）
                // 大多数情况下，Firestore 文档 ID 就是 Firebase UID
                firestoreUserId = firebaseUser.uid;
                userData = await getUserData(firestoreUserId, true); // 使用缓存

                if (!userData) {
                  // 新注册时 Auth 回调可能先于 users/{uid} 写入完成。
                  userData = await waitForNewUserDocument(firebaseUser);
                }

                if (!userData) {
                  // 如果使用 UID 找不到，再尝试通过邮箱查找（兼容旧数据）
                  const normalizedEmail = firebaseUser.email?.toLowerCase().trim();
                  if (normalizedEmail) {
                    const existingUser = await findUserByEmail(normalizedEmail);
                    if (existingUser) {
                      firestoreUserId = existingUser.id;
                      userData = existingUser.data;
                    }
                  }
                }
                
                // 补救: Firebase Auth 存在但 Firestore 文档缺失，自动创建
                if (!userData) {
                  console.warn('[Auth Store] ⚠️ 检测到孤立 Auth 用户，尝试补救创建 Firestore 文档');
                  userData = await createMissingUserDocument(firebaseUser);
                  if (userData) {
                    firestoreUserId = userData.id;
                  }
                }

                // 保存 firestoreUserId 到 sessionStorage
                if (firestoreUserId) {
                  sessionStorage.setItem(SESSION_STORAGE_KEYS.FIRESTORE_USER_ID, firestoreUserId);
                }
              }
            }
          }

          if (userData) {
            setUser(userData)
            setFirebaseUser(firebaseUser)
            set({ 
              isAdmin: ['storeAdmin', 'superAdmin', 'admin', 'developer'].includes(userData.role),
              isSuperAdmin: ['superAdmin', 'developer'].includes(userData.role),
              isDeveloper: userData.role === 'developer'
            })

            // 策略3: 开始实时监听用户文档变化（自动更新用户状态和会员状态）
            // 仅在成功获取用户数据后启用监听
            if (firestoreUserId && userData) {
              const userDocRef = doc(db, 'users', firestoreUserId);
              userDocUnsubscribe = onSnapshot(
                userDocRef,
                (userDocSnap) => {
                  if (userDocSnap.exists()) {
                    // 转换 Firestore 时间戳
                    const rawData = userDocSnap.data();
                    const data = convertFirestoreTimestamps(rawData);
                    const updatedUser = { id: firestoreUserId, ...data } as User;
                    setUser(updatedUser);
                    set({
                      isAdmin: ['storeAdmin', 'superAdmin', 'admin', 'developer'].includes(updatedUser.role),
                      isSuperAdmin: ['superAdmin', 'developer'].includes(updatedUser.role),
                      isDeveloper: updatedUser.role === 'developer'
                    });
                  }
                },
                (error: any) => {
                  // 策略2: 错误处理与降级
                  if (error?.code === 'resource-exhausted') {
                    console.warn('[Auth] ⚠️ Firestore 配额超限，禁用实时监听');
                    // 取消监听，使用缓存数据
                    if (userDocUnsubscribe) {
                      userDocUnsubscribe();
                      userDocUnsubscribe = null;
                    }
                    // 显示友好提示（可选）
                    console.info('[Auth] 使用缓存数据，实时更新已禁用');
                  } else {
                    console.warn('[Auth] User document snapshot error:', error);
                  }
                }
              );
            }
          }
        } catch (error: any) {
          // 策略2: 错误处理与降级
          if (error?.code === 'resource-exhausted') {
            console.warn('[Auth Store] ⚠️ Firestore 配额超限，尝试使用缓存数据');
            
            // 尝试使用缓存数据作为降级方案
            const { cachedUserData } = get();
            const storageCache = getCachedUserDataFromStorage();
            
            if (cachedUserData) {
              console.info('[Auth Store] ✅ 使用内存缓存作为降级方案');
              setUser(cachedUserData);
              setFirebaseUser(firebaseUser);
              set({ 
                isAdmin: ['storeAdmin', 'superAdmin', 'admin', 'developer'].includes(cachedUserData.role),
                isSuperAdmin: ['superAdmin', 'developer'].includes(cachedUserData.role),
                isDeveloper: cachedUserData.role === 'developer',
                error: '网络繁忙，使用缓存数据'
              });
            } else if (storageCache) {
              console.info('[Auth Store] ✅ 使用 sessionStorage 缓存作为降级方案');
              setUser(storageCache.userData);
              setFirebaseUser(firebaseUser);
              set({
                isAdmin: ['storeAdmin', 'superAdmin', 'admin', 'developer'].includes(storageCache.userData.role),
                isSuperAdmin: ['superAdmin', 'developer'].includes(storageCache.userData.role),
                isDeveloper: storageCache.userData.role === 'developer',
                error: '网络繁忙，使用缓存数据'
              });
            } else {
              console.error('[Auth Store] ❌ 无可用缓存数据');
              set({ error: '获取用户数据失败，请稍后重试' });
            }
          } else {
            console.error('[Auth Store] ❌ 获取用户数据失败:', error);
            set({ error: '获取用户数据失败' });
          }
        }
      } else {
        setUser(null);
        setFirebaseUser(null);
        set({ 
          isAdmin: false, 
          isDeveloper: false,
          cachedUserData: null,
          cacheTimestamp: 0
        });
        // 清除 sessionStorage 缓存
        sessionStorage.removeItem(SESSION_STORAGE_KEYS.FIRESTORE_USER_ID);
        sessionStorage.removeItem(SESSION_STORAGE_KEYS.USER_DATA);
        sessionStorage.removeItem(SESSION_STORAGE_KEYS.CACHE_TIMESTAMP);
      }
      
      setLoading(false)
    })
    
    // 标记为已初始化
    set({ initialized: true })
  },

  logout: () => {
    // 取消用户文档监听
    if (userDocUnsubscribe) {
      userDocUnsubscribe();
      userDocUnsubscribe = null;
    }
    set({ 
      user: null, 
      firebaseUser: null, 
      isAdmin: false, 
      isDeveloper: false,
      cachedUserData: null,
      cacheTimestamp: 0
    });
    // 清除 sessionStorage 缓存
    sessionStorage.removeItem(SESSION_STORAGE_KEYS.FIRESTORE_USER_ID);
    sessionStorage.removeItem(SESSION_STORAGE_KEYS.USER_DATA);
    sessionStorage.removeItem(SESSION_STORAGE_KEYS.CACHE_TIMESTAMP);
  },

  hasPermission: (permission: keyof Permission) => {
    const { user } = get()
    if (!user) return false
    return hasPermission(user.role, permission)
  },
}))
