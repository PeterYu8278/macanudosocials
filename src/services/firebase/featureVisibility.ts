/**
 * 功能可见性配置服务
 */
import { doc, getDoc, getDocFromCache, setDoc, updateDoc, Timestamp } from '@/services/firebase/monitoredFirestore';
import { db } from '../../config/firebase';
import { GLOBAL_COLLECTIONS } from '../../config/globalCollections';
import type { FeatureVisibilityConfig } from '../../types';
import { getDefaultFeatureVisibilityConfig, FEATURE_DEFINITIONS } from '../../config/featureDefinitions';

const CONFIG_ID = 'default';
const FIRESTORE_READ_TIMEOUT_MS = 3000;
const FIRESTORE_WRITE_TIMEOUT_MS = 10000;

const withTimeout = async <T>(promise: Promise<T>, timeoutMs: number, label: string): Promise<T> => {
  let timeoutId: ReturnType<typeof setTimeout> | undefined;

  try {
    return await Promise.race([
      promise,
      new Promise<T>((_, reject) => {
        timeoutId = setTimeout(() => {
          reject(new Error(`${label} timed out after ${timeoutMs}ms`));
        }, timeoutMs);
      }),
    ]);
  } finally {
    if (timeoutId) clearTimeout(timeoutId);
  }
};

const createDefaultConfig = (): FeatureVisibilityConfig => ({
  id: CONFIG_ID,
  ...getDefaultFeatureVisibilityConfig(),
  updatedAt: new Date(),
  updatedBy: '',
});

const serializeConfigForFirestore = (config: FeatureVisibilityConfig) => ({
  ...config,
  features: Object.fromEntries(
    Object.entries(config.features).map(([key, value]) => [
      key,
      {
        ...value,
        updatedAt: Timestamp.fromDate(value.updatedAt),
      }
    ])
  ),
  updatedAt: Timestamp.fromDate(config.updatedAt),
});

const parseFeatureVisibilityConfig = (id: string, data: any): FeatureVisibilityConfig => {
  const features: FeatureVisibilityConfig['features'] = {};

  Object.entries(data.features || {}).forEach(([key, value]: [string, any]) => {
    features[key] = {
      ...value,
      updatedAt: value.updatedAt?.toDate?.() || new Date(value.updatedAt),
    };
  });

  return {
    id,
    features,
    updatedAt: data.updatedAt?.toDate?.() || new Date(data.updatedAt),
    updatedBy: data.updatedBy || '',
  };
};

/**
 * 获取功能可见性配置
 */
export const getFeatureVisibilityConfig = async (): Promise<FeatureVisibilityConfig | null> => {
  try {
    const docRef = doc(db, GLOBAL_COLLECTIONS.FEATURE_VISIBILITY, CONFIG_ID);
    let docSnap;

    try {
      docSnap = await withTimeout(getDoc(docRef), FIRESTORE_READ_TIMEOUT_MS, 'Feature visibility read');
    } catch (readError) {
      try {
        const cachedSnap = await withTimeout(getDocFromCache(docRef), 3000, 'Feature visibility cache read');
        if (cachedSnap.exists()) {
          console.warn('[getFeatureVisibilityConfig] using cached config after read failure:', readError);
          return parseFeatureVisibilityConfig(cachedSnap.id, cachedSnap.data());
        }
      } catch (cacheError) {
        console.warn('[getFeatureVisibilityConfig] cache read failed after read failure:', cacheError);
      }

      console.warn('[getFeatureVisibilityConfig] using default config after read failure:', readError);
      return createDefaultConfig();
    }
    
    if (!docSnap.exists()) {
      // 如果不存在，创建默认配置并异步写入（不阻塞返回）
      const newConfig = createDefaultConfig();
      setDoc(docRef, serializeConfigForFirestore(newConfig)).catch(writeError => {
        console.warn('[getFeatureVisibilityConfig] default config write failed:', writeError);
      });
      return newConfig;
    }
    
    const data = docSnap.data();
    const features: FeatureVisibilityConfig['features'] = {};
    
    // 转换 features 对象
    Object.entries(data.features || {}).forEach(([key, value]: [string, any]) => {
      features[key] = {
        ...value,
        updatedAt: value.updatedAt?.toDate?.() || new Date(value.updatedAt),
      };
    });
    
    return {
      id: docSnap.id,
      features,
      updatedAt: data.updatedAt?.toDate?.() || new Date(data.updatedAt),
      updatedBy: data.updatedBy || '',
    };
  } catch (error) {
    console.error('[getFeatureVisibilityConfig] 获取配置失败:', error);
    return createDefaultConfig();
  }
};

/**
 * 更新功能可见性配置
 */
export const updateFeatureVisibilityConfig = async (
  features: Partial<FeatureVisibilityConfig['features']>,
  updatedBy: string
): Promise<{ success: boolean; error?: string }> => {
  try {
    const docRef = doc(db, GLOBAL_COLLECTIONS.FEATURE_VISIBILITY, CONFIG_ID);
    const docSnap = await getDoc(docRef);
    
    const now = new Date();
    
    if (!docSnap.exists()) {
      // 如果不存在，创建新配置
      const defaultConfig = getDefaultFeatureVisibilityConfig();
      const newFeatures: FeatureVisibilityConfig['features'] = {} as FeatureVisibilityConfig['features']
      Object.keys(defaultConfig.features).forEach(key => {
        newFeatures[key] = defaultConfig.features[key]
      })
      Object.keys(features).forEach(key => {
        if (features[key]) {
          newFeatures[key] = {
            ...newFeatures[key],
            ...features[key],
            updatedAt: now,
            updatedBy: updatedBy
          }!
        }
      })
      
      await setDoc(docRef, {
        id: CONFIG_ID,
        features: Object.fromEntries(
          Object.entries(newFeatures).map(([key, value]) => [
            key,
            {
              ...value,
              updatedAt: Timestamp.fromDate(value.updatedAt),
            }
          ])
        ),
        updatedAt: Timestamp.fromDate(now),
        updatedBy,
      });
    } else {
      // 更新现有配置
      const currentData = docSnap.data();
      const currentFeatures = currentData.features || {};
      
      // 合并更新
      const updatedFeatures = { ...currentFeatures };
      Object.entries(features).forEach(([key, value]) => {
        if (value) {
          updatedFeatures[key] = {
            ...currentFeatures[key],
            ...value,
            updatedAt: Timestamp.fromDate(now),
            updatedBy,
          };
        }
      });
      
      await updateDoc(docRef, {
        features: updatedFeatures,
        updatedAt: Timestamp.fromDate(now),
        updatedBy,
      });
    }
    
    return { success: true };
  } catch (error: any) {
    console.error('[updateFeatureVisibilityConfig] 更新配置失败:', error);
    return { success: false, error: error.message || '更新配置失败' };
  }
};

/**
 * 检查功能是否可见
 */
export const isFeatureVisible = async (featureKey: string): Promise<boolean> => {
  try {
    const config = await getFeatureVisibilityConfig();
    if (!config) {
      // 如果配置不存在，返回默认可见性
      const feature = FEATURE_DEFINITIONS.find(f => f.key === featureKey);
      return feature?.defaultVisible ?? true;
    }
    
    return config.features[featureKey]?.visible ?? true;
  } catch (error) {
    console.error('[isFeatureVisible] 检查功能可见性失败:', error);
    // 出错时默认可见
    return true;
  }
};

/**
 * 批量检查多个功能的可见性
 */
export const getFeaturesVisibility = async (): Promise<Record<string, boolean>> => {
  try {
    const config = await getFeatureVisibilityConfig();
    if (!config) {
      // 如果配置不存在，返回默认可见性
      const result: Record<string, boolean> = {};
      FEATURE_DEFINITIONS.forEach(feature => {
        result[feature.key] = feature.defaultVisible;
      });
      return result;
    }
    
    const result: Record<string, boolean> = {};
    FEATURE_DEFINITIONS.forEach(feature => {
      result[feature.key] = config.features[feature.key]?.visible ?? feature.defaultVisible;
    });
    
    return result;
  } catch (error) {
    console.error('[getFeaturesVisibility] 获取功能可见性失败:', error);
    // 出错时返回默认可见性
    const result: Record<string, boolean> = {};
    FEATURE_DEFINITIONS.forEach(feature => {
      result[feature.key] = feature.defaultVisible;
    });
    return result;
  }
};

/**
 * 重置为默认配置
 */
export const resetFeatureVisibilityConfig = async (
  updatedBy: string
): Promise<{ success: boolean; error?: string }> => {
  try {
    const defaultConfig = getDefaultFeatureVisibilityConfig();
    const now = new Date();
    
    const features: FeatureVisibilityConfig['features'] = {};
    Object.entries(defaultConfig.features).forEach(([key, value]) => {
      features[key] = {
        ...value,
        updatedAt: now,
        updatedBy,
      };
    });
    
    const docRef = doc(db, GLOBAL_COLLECTIONS.FEATURE_VISIBILITY, CONFIG_ID);
    await setDoc(docRef, {
      id: CONFIG_ID,
      features: Object.fromEntries(
        Object.entries(features).map(([key, value]) => [
          key,
          {
            ...value,
            updatedAt: Timestamp.fromDate(value.updatedAt),
          }
        ])
      ),
      updatedAt: Timestamp.fromDate(now),
      updatedBy,
    });
    
    return { success: true };
  } catch (error: any) {
    console.error('[resetFeatureVisibilityConfig] 重置配置失败:', error);
    return { success: false, error: error.message || '重置配置失败' };
  }
};

