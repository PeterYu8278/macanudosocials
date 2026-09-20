/**
 * 应用配置服务
 */
import { doc, getDoc, getDocFromCache, setDoc, updateDoc, Timestamp } from 'firebase/firestore';
import { db } from '../../config/firebase';
import { GLOBAL_COLLECTIONS } from '../../config/globalCollections';
import type { AppConfig, ColorThemeConfig } from '../../types';
import type { WhapiConfig, MessageTemplate } from '../../types/whapi';
import { DEFAULT_MESSAGE_TEMPLATES } from '../../types/whapi';
import { saveAuditLog } from './auditLog';

// 默认颜色主题配置
const DEFAULT_COLOR_THEME: ColorThemeConfig = {
  primaryButton: {
    startColor: '#FDE08D',
    endColor: '#C48D3A',
  },
  secondaryButton: {
    backgroundColor: 'rgba(255,255,255,0.1)',
    borderColor: '#444444',
    textColor: '#ffffff',
  },
  warningButton: {
    backgroundColor: '#ff0000',
    borderColor: '#faad14',
    textColor: '#ffffff',
  },
  border: {
    primary: '#333333',
    secondary: '#444444',
  },
  tag: {
    success: {
      backgroundColor: '#f6ffed',
      textColor: '#52c41a',
      borderColor: '#b7eb8f',
    },
    warning: {
      backgroundColor: '#fffbe6',
      textColor: '#faad14',
      borderColor: '#ffe58f',
    },
    error: {
      backgroundColor: '#fff1f0',
      textColor: '#cf1322',
      borderColor: '#ffccc7',
    },
  },
  text: {
    primary: '#f8f8f8',
    secondary: '#c0c0c0',
    tertiary: '#999999',
  },
  icon: {
    primary: '#ffd700',
  },
};

const CONFIG_ID = 'default';

const withTimeout = <T>(promise: Promise<T>, ms: number): Promise<T> =>
  Promise.race([
    promise,
    new Promise<T>((_, reject) =>
      setTimeout(() => reject(new Error(`appConfig timeout after ${ms}ms`)), ms)
    ),
  ]);

/**
 * 获取应用配置
 */
export const getAppConfig = async (): Promise<AppConfig | null> => {
  try {
    const docRef = doc(db, GLOBAL_COLLECTIONS.APP_CONFIG, CONFIG_ID);
    let docSnap = await withTimeout(getDoc(docRef), 3000);

    // 如果文档不存在，尝试从缓存读取（可能是离线状态）
    if (!docSnap.exists()) {
      try {
        docSnap = await getDocFromCache(docRef);
        if (docSnap.exists()) {
          console.log('[getAppConfig] 使用缓存数据（离线模式）');
        }
      } catch (cacheError) {
        // 缓存中也没有数据，继续使用默认配置逻辑
        // 静默处理，不输出警告
      }
    }

    if (!docSnap.exists()) {
      // 如果不存在，创建默认配置
      const defaultConfig: AppConfig = {
        id: CONFIG_ID,
        logoUrl: 'https://res.cloudinary.com/dy2zb1n41/image/upload/jep-cigar/brands/JEP_Logo_White_1763310931359_s1pkcz8y617',
        appName: 'Cigar Club',
        hideFooter: true,
        colorTheme: DEFAULT_COLOR_THEME,
        auth: {
          disableGoogleLogin: true,
          disableEmailLogin: true,
        },
        updatedAt: new Date(),
        updatedBy: '',
      };

      await setDoc(docRef, {
        ...defaultConfig,
        updatedAt: Timestamp.fromDate(defaultConfig.updatedAt),
      });

      return defaultConfig;
    }

    const data = docSnap.data();

    // 处理 whapi 配置
    const whapiConfig: WhapiConfig | undefined = data.whapi ? {
      apiToken: data.whapi.apiToken,
      channelId: data.whapi.channelId,
      baseUrl: data.whapi.baseUrl,
      enabled: data.whapi.enabled ?? false,
    } : undefined;

    // 处理消息模板
    const whapiTemplates: MessageTemplate[] = data.whapiTemplates
      ? data.whapiTemplates.map((t: any) => ({
        id: t.id || '',
        name: t.name,
        type: t.type,
        template: t.template,
        variables: t.variables || [],
        enabled: t.enabled ?? true,
        createdAt: t.createdAt?.toDate?.() || new Date(t.createdAt),
        updatedAt: t.updatedAt?.toDate?.() || new Date(t.updatedAt),
      }))
      : DEFAULT_MESSAGE_TEMPLATES.map((t, index) => ({
        id: `default_${index}`,
        ...t,
        createdAt: new Date(),
        updatedAt: new Date(),
      }));

    return {
      id: docSnap.id,
      logoUrl: data.logoUrl || undefined,
      appName: data.appName || undefined,
      hideFooter: data.hideFooter ?? false,
      colorTheme: data.colorTheme ? {
        primaryButton: data.colorTheme.primaryButton || DEFAULT_COLOR_THEME.primaryButton,
        secondaryButton: data.colorTheme.secondaryButton || DEFAULT_COLOR_THEME.secondaryButton,
        warningButton: data.colorTheme.warningButton || DEFAULT_COLOR_THEME.warningButton,
        border: data.colorTheme.border || DEFAULT_COLOR_THEME.border,
        tag: data.colorTheme.tag || DEFAULT_COLOR_THEME.tag,
        text: data.colorTheme.text || DEFAULT_COLOR_THEME.text,
        icon: data.colorTheme.icon || DEFAULT_COLOR_THEME.icon,
      } : DEFAULT_COLOR_THEME,
      invoice: data.invoice ? {
        sellerName: data.invoice.sellerName || undefined,
        sellerRegNo: data.invoice.sellerRegNo || undefined,
        sellerAddressLines: Array.isArray(data.invoice.sellerAddressLines) ? data.invoice.sellerAddressLines : undefined,
        sellerPhone: data.invoice.sellerPhone || undefined,
        sellerFax: data.invoice.sellerFax || undefined,
        bankName: data.invoice.bankName || undefined,
        bankAccountNo: data.invoice.bankAccountNo || undefined,
        notes: Array.isArray(data.invoice.notes) ? data.invoice.notes : undefined,
      } : undefined,
      invoiceTemplate: data.invoiceTemplate ?? undefined,
      whapi: whapiConfig,
      whapiTemplates,
      auth: data.auth ? {
        disableGoogleLogin: data.auth.disableGoogleLogin ?? true,
        disableEmailLogin: data.auth.disableEmailLogin ?? true,
      } : {
        disableGoogleLogin: true,
        disableEmailLogin: true,
      },
      gemini: data.gemini ? {
        models: data.gemini.models || [],
      } : undefined,
      aiCigar: data.aiCigar ? {
        enableDataStorage: data.aiCigar.enableDataStorage ?? true,
        enableImageSearch: data.aiCigar.enableImageSearch ?? true,
        imageSearchOrder: data.aiCigar.imageSearchOrder || 'google-first',
      } : undefined,
      subscription: data.subscription ? {
        isActive: data.subscription.isActive ?? false,
        plan: data.subscription.plan || 'basic',
        expiryDate: data.subscription.expiryDate?.toDate?.() || new Date(data.subscription.expiryDate),
        plans: data.subscription.plans || []
      } : undefined,
      payment: data.payment ? {
        billplz: data.payment.billplz ? {
          apiKey: data.payment.billplz.apiKey,
          xSignatureKey: data.payment.billplz.xSignatureKey,
          collectionId: data.payment.billplz.collectionId,
          isSandbox: data.payment.billplz.isSandbox ?? true,
          enabled: data.payment.billplz.enabled ?? false,
        } : undefined
      } : undefined,
      paymentPlatform: data.paymentPlatform ? {
        billplz: data.paymentPlatform.billplz ? {
          apiKey: data.paymentPlatform.billplz.apiKey,
          xSignatureKey: data.paymentPlatform.billplz.xSignatureKey,
          collectionId: data.paymentPlatform.billplz.collectionId,
          isSandbox: data.paymentPlatform.billplz.isSandbox ?? true,
          enabled: data.paymentPlatform.billplz.enabled ?? false,
        } : undefined
      } : undefined,
      updatedAt: data.updatedAt?.toDate?.() || new Date(data.updatedAt),
      updatedBy: data.updatedBy || '',
    };
  } catch (error: any) {
    // 如果是离线错误，尝试从缓存读取
    if (error?.code === 'unavailable' || error?.message?.includes('offline')) {
      try {
        const docRef = doc(db, GLOBAL_COLLECTIONS.APP_CONFIG, CONFIG_ID);
        const docSnap = await getDocFromCache(docRef);

        if (docSnap.exists()) {
          console.log('[getAppConfig] 使用缓存数据（离线模式）');
          const data = docSnap.data();

          // 处理配置数据（复用现有逻辑）
          const whapiConfig: WhapiConfig | undefined = data.whapi ? {
            apiToken: data.whapi.apiToken,
            channelId: data.whapi.channelId,
            baseUrl: data.whapi.baseUrl,
            enabled: data.whapi.enabled ?? false,
          } : undefined;

          const whapiTemplates: MessageTemplate[] = data.whapiTemplates
            ? data.whapiTemplates.map((t: any) => ({
              id: t.id || '',
              name: t.name,
              type: t.type,
              template: t.template,
              variables: t.variables || [],
              enabled: t.enabled ?? true,
              createdAt: t.createdAt?.toDate?.() || new Date(t.createdAt),
              updatedAt: t.updatedAt?.toDate?.() || new Date(t.updatedAt),
            }))
            : DEFAULT_MESSAGE_TEMPLATES.map((t, index) => ({
              id: `default_${index}`,
              ...t,
              createdAt: new Date(),
              updatedAt: new Date(),
            }));

          return {
            id: docSnap.id,
            logoUrl: data.logoUrl || undefined,
            appName: data.appName || undefined,
            hideFooter: data.hideFooter ?? false,
            colorTheme: data.colorTheme ? {
              primaryButton: data.colorTheme.primaryButton || DEFAULT_COLOR_THEME.primaryButton,
              secondaryButton: data.colorTheme.secondaryButton || DEFAULT_COLOR_THEME.secondaryButton,
              warningButton: data.colorTheme.warningButton || DEFAULT_COLOR_THEME.warningButton,
              border: data.colorTheme.border || DEFAULT_COLOR_THEME.border,
              tag: data.colorTheme.tag || DEFAULT_COLOR_THEME.tag,
              text: data.colorTheme.text || DEFAULT_COLOR_THEME.text,
              icon: data.colorTheme.icon || DEFAULT_COLOR_THEME.icon,
            } : DEFAULT_COLOR_THEME,
            invoice: data.invoice ? {
              sellerName: data.invoice.sellerName || undefined,
              sellerRegNo: data.invoice.sellerRegNo || undefined,
              sellerAddressLines: Array.isArray(data.invoice.sellerAddressLines) ? data.invoice.sellerAddressLines : undefined,
              sellerPhone: data.invoice.sellerPhone || undefined,
              sellerFax: data.invoice.sellerFax || undefined,
              bankName: data.invoice.bankName || undefined,
              bankAccountNo: data.invoice.bankAccountNo || undefined,
              notes: Array.isArray(data.invoice.notes) ? data.invoice.notes : undefined,
            } : undefined,
            invoiceTemplate: data.invoiceTemplate ?? undefined,
            whapi: whapiConfig,
            whapiTemplates,
            auth: data.auth ? {
              disableGoogleLogin: data.auth.disableGoogleLogin ?? true,
              disableEmailLogin: data.auth.disableEmailLogin ?? true,
            } : {
              disableGoogleLogin: true,
              disableEmailLogin: true,
            },
            gemini: data.gemini ? {
              models: data.gemini.models || [],
            } : undefined,
            aiCigar: data.aiCigar ? {
              enableDataStorage: data.aiCigar.enableDataStorage ?? true,
              enableImageSearch: data.aiCigar.enableImageSearch ?? true,
              imageSearchOrder: data.aiCigar.imageSearchOrder || 'google-first',
            } : undefined,
            subscription: data.subscription ? {
              isActive: data.subscription.isActive ?? false,
              plan: data.subscription.plan || 'basic',
              expiryDate: data.subscription.expiryDate?.toDate?.() || new Date(data.subscription.expiryDate),
              plans: data.subscription.plans || []
            } : undefined,
            payment: data.payment ? {
              billplz: data.payment.billplz ? {
                apiKey: data.payment.billplz.apiKey,
                xSignatureKey: data.payment.billplz.xSignatureKey,
                collectionId: data.payment.billplz.collectionId,
                isSandbox: data.payment.billplz.isSandbox ?? true,
                enabled: data.payment.billplz.enabled ?? false,
              } : undefined
            } : undefined,
            updatedAt: data.updatedAt?.toDate?.() || new Date(data.updatedAt),
            updatedBy: data.updatedBy || '',
          };
        }
      } catch (cacheError) {
        console.warn('[getAppConfig] 缓存读取也失败:', cacheError);
      }
    } else {
      console.error('[getAppConfig] 获取配置失败:', error);
    }
    return null;
  }
};

/**
 * 更新应用配置
 */
export const updateAppConfig = async (
  updates: Partial<Pick<AppConfig, 'logoUrl' | 'appName' | 'hideFooter' | 'colorTheme' | 'invoice' | 'invoiceTemplate' | 'whapi' | 'whapiTemplates' | 'auth' | 'gemini' | 'aiCigar' | 'subscription' | 'payment' | 'paymentPlatform'>>,
  updatedBy: string
): Promise<{ success: boolean; error?: string }> => {
  try {
    const docRef = doc(db, GLOBAL_COLLECTIONS.APP_CONFIG, CONFIG_ID);
    const docSnap = await getDoc(docRef);

    // 构建更新数据，确保嵌套对象（如 aiCigar）被正确保存
    const updateData: any = {
      updatedAt: Timestamp.fromDate(new Date()),
      updatedBy,
    };

    // Firestore 不允许 undefined：递归移除嵌套对象中的 undefined
    const stripUndefinedDeep = (input: any): any => {
      if (input === undefined) return undefined
      if (input === null) return null
      // 保持 Date 和 Timestamp 对象不变
      if (input instanceof Date || input instanceof Timestamp) return input
      if (Array.isArray(input)) {
        const arr = input
          .map(v => stripUndefinedDeep(v))
          .filter(v => v !== undefined)
        return arr
      }
      if (typeof input === 'object') {
        const out: any = {}
        Object.keys(input).forEach(k => {
          const v = stripUndefinedDeep(input[k])
          if (v !== undefined) out[k] = v
        })
        return out
      }
      return input
    }

    // 处理所有更新字段
    Object.keys(updates).forEach(key => {
      let value = stripUndefinedDeep((updates as any)[key]);

      // 强制将订阅到期时间转换为 Firestore Timestamp，避免存为普通 Map
      if (key === 'subscription' && value?.expiryDate instanceof Date) {
        value.expiryDate = Timestamp.fromDate(value.expiryDate);
      }

      if (value !== undefined) {
        updateData[key] = value;
      }
    });

    if (docSnap.exists()) {
      // 使用 updateDoc 更新，Firestore 会自动合并嵌套对象
      await updateDoc(docRef, updateData);
    } else {
      // 如果不存在，创建新文档
      await setDoc(docRef, {
        id: CONFIG_ID,
        logoUrl: updates.logoUrl || 'https://res.cloudinary.com/dy2zb1n41/image/upload/jep-cigar/brands/JEP_Logo_White_1763310931359_s1pkcz8y617',
        appName: updates.appName || 'Cigar Club',
        hideFooter: updates.hideFooter ?? false,
        colorTheme: updates.colorTheme || DEFAULT_COLOR_THEME,
        ...updateData,
      });
    }

    // 记录审计日志
    await saveAuditLog({
      module: 'system',
      action: 'update',
      targetId: CONFIG_ID,
      description: `更新系统配置: ${Object.keys(updates).join(', ')}`,
      details: updates
    });

    return { success: true };
  } catch (error) {
    console.error('[updateAppConfig] 更新配置失败:', error);
    return {
      success: false,
      error: error instanceof Error ? error.message : '更新配置失败'
    };
  }
};

/**
 * 重置应用配置为默认值
 */
export const resetAppConfig = async (
  updatedBy: string
): Promise<{ success: boolean; error?: string }> => {
  try {
    const defaultConfig: Partial<Pick<AppConfig, 'logoUrl' | 'appName' | 'hideFooter' | 'colorTheme'>> = {
      logoUrl: 'https://res.cloudinary.com/dy2zb1n41/image/upload/jep-cigar/brands/JEP_Logo_White_1763310931359_s1pkcz8y617',
      appName: 'Cigar Club',
      hideFooter: false,
      colorTheme: DEFAULT_COLOR_THEME,
    };

    return await updateAppConfig(defaultConfig, updatedBy);
  } catch (error) {
    console.error('[resetAppConfig] 重置配置失败:', error);
    return {
      success: false,
      error: error instanceof Error ? error.message : '重置配置失败'
    };
  }
};

