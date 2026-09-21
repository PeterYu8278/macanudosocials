// 功能管理页面
import React, { useState, useEffect } from 'react';
import { useFirestoreDoc } from '../../../hooks/useFirestoreQuery';
import { Card, Switch, Button, Space, Typography, App, Spin, Tabs, Input, Checkbox, Form, Divider, Alert, Select, Modal, Table } from 'antd';
const { TextArea } = Input;
import { SaveOutlined, ReloadOutlined, EyeOutlined, EyeInvisibleOutlined, SearchOutlined, SettingOutlined, CopyOutlined, DownloadOutlined, FileTextOutlined, RocketOutlined, CheckCircleOutlined, LoadingOutlined, DatabaseOutlined } from '@ant-design/icons';
import { useAuthStore } from '../../../store/modules/auth';
import { useTranslation } from 'react-i18next';
import {
  getFeatureVisibilityConfig,
  updateFeatureVisibilityConfig,
  resetFeatureVisibilityConfig,
} from '../../../services/firebase/featureVisibility';
import { FEATURE_DEFINITIONS, type FeatureDefinition } from '../../../config/featureDefinitions';
import type { FeatureVisibilityConfig, AppConfig, ColorThemeConfig } from '../../../types';
import { getAppConfig, updateAppConfig, resetAppConfig } from '../../../services/firebase/appConfig';
import ImageUpload from '../../../components/common/ImageUpload';
import MockAppInterface from '../../../components/admin/MockAppInterface';
import WhapiMessageTester from '../../../components/admin/WhapiMessageTester';
import PaymentTester from '../../../components/admin/PaymentTester';
import CigarDatabase from '../CigarDatabase';

const { Title, Text } = Typography;
const { Search } = Input;

// Firestore 索引预览数据
const FIRESTORE_INDEXES_PREVIEW = [
  { collectionGroup: "visitSessions", fields: "userId (ASC), status (ASC), checkInAt (DESC)" },
  { collectionGroup: "visitSessions", fields: "status (ASC), checkInAt (DESC)" },
  { collectionGroup: "visitSessions", fields: "status (ASC), checkInAt (ASC)" },
  { collectionGroup: "visitSessions", fields: "userId (ASC), checkInAt (DESC)" },
  { collectionGroup: "redemptionRecords", fields: "userId (ASC), dayKey (ASC), redeemedAt (ASC)" },
  { collectionGroup: "redemptionRecords", fields: "userId (ASC), hourKey (ASC), redeemedAt (ASC)" },
  { collectionGroup: "redemptionRecords", fields: "userId (ASC), redeemedAt (ASC)" },
  { collectionGroup: "reloadRecords", fields: "userId (ASC), status (ASC), createdAt (DESC)" },
  { collectionGroup: "membershipFeeRecords", fields: "status (ASC), dueDate (ASC)" },
  { collectionGroup: "pointsRecords", fields: "userId (ASC), createdAt (DESC)" },
];

// 默认颜色主题配置（与 appConfig.ts 中的 DEFAULT_COLOR_THEME 保持一致）
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
    backgroundColor: '#faad14',
    borderColor: '#faad14',
    textColor: '#ffffff',
  },
  border: {
    primary: '#333333',
    secondary: '#444444',
  },
  tag: {
    success: {
      backgroundColor: '#52c41a',
      textColor: '#ffffff',
      borderColor: '#52c41a',
    },
    warning: {
      backgroundColor: '#faad14',
      textColor: '#ffffff',
      borderColor: '#faad14',
    },
    error: {
      backgroundColor: '#ff4d4f',
      textColor: '#ffffff',
      borderColor: '#ff4d4f',
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

const FeatureManagement: React.FC = () => {
  const { user } = useAuthStore();
  const { t, i18n } = useTranslation();
  const { message } = App.useApp();
  const { data: config, loading, refresh: refreshConfig } = useFirestoreDoc(getFeatureVisibilityConfig);
  const { data: rawAppConfig, refresh: refreshAppConfig } = useFirestoreDoc(getAppConfig);
  const [saving, setSaving] = useState(false);
  const [searchText, setSearchText] = useState('');
  const [activeTab, setActiveTab] = useState<'frontend' | 'admin' | 'cigar-database' | 'tools' | 'app' | 'whapi' | 'payment' | 'env'>('frontend');
  const [whapiForm] = Form.useForm();
  const [paymentForm] = Form.useForm();
  const [envForm] = Form.useForm();
  const [localFeatures, setLocalFeatures] = useState<Record<string, boolean>>({});
  const [appConfig, setAppConfig] = useState<AppConfig | null>(null);
  const [appConfigForm] = Form.useForm();
  const [savingAppConfig, setSavingAppConfig] = useState(false);
  const [aiCigarStorageEnabled, setAiCigarStorageEnabled] = useState<boolean>(true);
  const [aiCigarImageSearchEnabled, setAiCigarImageSearchEnabled] = useState<boolean>(true);
  const [aiCigarImageSearchOrder, setAiCigarImageSearchOrder] = useState<'google-first' | 'gemini-first'>('google-first');
  const [pendingColorChanges, setPendingColorChanges] = useState<Partial<ColorThemeConfig>>({});
  const [showSecrets, setShowSecrets] = useState<Record<string, boolean>>({});
  const [generatedEnv, setGeneratedEnv] = useState<string>('');
  const [deploying, setDeploying] = useState(false);
  const [deployStatus, setDeployStatus] = useState<{
    state: 'idle' | 'updating' | 'deploying' | 'success' | 'error';
    message: string;
    deployId?: string;
    deployUrl?: string;
  }>({ state: 'idle', message: '' });
  const [indexDeploying, setIndexDeploying] = useState(false);
  const [indexDeployStatus, setIndexDeployStatus] = useState<{
    state: 'idle' | 'deploying' | 'success' | 'error';
    message: string;
    links?: string[];
    summary?: {
      total: number;
      succeeded: number;
      failed: number;
      skipped: number;
    };
    results?: Array<{
      index: any;
      success: boolean;
      message: string;
      operationName?: string;
      error?: string;
    }>;
    consoleUrl?: string;
  }>({ state: 'idle', message: '' });
  const [firebaseConfigCode, setFirebaseConfigCode] = useState<string>('');
  const [isIndexModalVisible, setIsIndexModalVisible] = useState(false);

  // 检查是否为开发者
  useEffect(() => {
    if (user?.role !== 'developer') {
      message.error(t('featureManagement.developerOnly'));
      // 可以重定向到首页
    }
  }, [user]);

  // 当 config 加载完成时，初始化 localFeatures
  useEffect(() => {
    if (config) {
      const visibility: Record<string, boolean> = {};
      FEATURE_DEFINITIONS.forEach(feature => {
        visibility[feature.key] = config.features[feature.key]?.visible ?? feature.defaultVisible;
      });
      setLocalFeatures(visibility);
    }
  }, [config]);

  // 当 rawAppConfig 加载完成时，应用 colorTheme 默认值并更新本地状态
  useEffect(() => {
    if (rawAppConfig) {
      const configWithTheme = {
        ...rawAppConfig,
        colorTheme: rawAppConfig.colorTheme || {
          primaryButton: { startColor: '#FDE08D', endColor: '#C48D3A' },
          secondaryButton: { backgroundColor: 'rgba(255,255,255,0.1)', borderColor: '#444444', textColor: '#ffffff' },
          warningButton: { backgroundColor: '#faad14', borderColor: '#faad14', textColor: '#ffffff' },
          border: { primary: '#333333', secondary: '#444444' },
          tag: {
            success: { backgroundColor: '#52c41a', textColor: '#ffffff' },
            warning: { backgroundColor: '#faad14', textColor: '#ffffff' },
            error: { backgroundColor: '#ff4d4f', textColor: '#ffffff' },
          },
          text: { primary: '#f8f8f8', secondary: '#c0c0c0', tertiary: '#999999' },
          icon: { primary: '#ffd700' },
        },
      };
      setAppConfig(configWithTheme as AppConfig);
    }
  }, [rawAppConfig]);

  // 当 appConfig 加载完成且切换到应用配置标签页时，设置表单值
  useEffect(() => {
    if (activeTab === 'app' && appConfig) {
      try {
        appConfigForm.setFieldsValue({
          logoUrl: appConfig.logoUrl,
          appName: appConfig.appName,
          hideFooter: appConfig.hideFooter ?? false,
          disableGoogleLogin: appConfig.auth?.disableGoogleLogin ?? false,
          disableEmailLogin: appConfig.auth?.disableEmailLogin ?? false,
          geminiModels: appConfig.gemini?.models || [],
        });
      } catch (err) {
        // Form 可能还未渲染，忽略错误
      }
    }
  }, [activeTab, appConfig, appConfigForm]);

  // 加载 AI识茄 配置
  useEffect(() => {
    if (appConfig) {
      setAiCigarStorageEnabled(appConfig.aiCigar?.enableDataStorage ?? true);
      setAiCigarImageSearchEnabled(appConfig.aiCigar?.enableImageSearch ?? true);
      setAiCigarImageSearchOrder(appConfig.aiCigar?.imageSearchOrder ?? 'google-first');
    }
  }, [appConfig]);

  // 当切换到 whapi 标签页时，设置表单值
  useEffect(() => {
    if (activeTab === 'whapi' && appConfig) {
      whapiForm.setFieldsValue({
        whapiApiToken: appConfig.whapi?.apiToken || '',
        whapiChannelId: appConfig.whapi?.channelId || '',
        whapiBaseUrl: appConfig.whapi?.baseUrl || 'https://gate.whapi.cloud',
        whapiEnabled: appConfig.whapi?.enabled ?? false,
        whapiEventReminder: appConfig.whapi?.features?.eventReminder ?? true,
        whapiVipExpiry: appConfig.whapi?.features?.vipExpiry ?? true,
        whapiPasswordReset: appConfig.whapi?.features?.passwordReset ?? true,
      });
    }
  }, [activeTab, appConfig, whapiForm]);

  // 当切换到 payment 标签页时，设置表单值
  useEffect(() => {
    if (activeTab === 'payment' && appConfig) {
      paymentForm.setFieldsValue({
        billplzApiKey: appConfig.payment?.billplz?.apiKey || '',
        billplzXSignatureKey: appConfig.payment?.billplz?.xSignatureKey || '',
        billplzCollectionId: appConfig.payment?.billplz?.collectionId || '',
        billplzIsSandbox: appConfig.payment?.billplz?.isSandbox ?? true,
        billplzEnabled: appConfig.payment?.billplz?.enabled ?? false,
      });
    }
  }, [activeTab, appConfig, paymentForm]);

  // 切换功能可见性
  const handleToggleFeature = (featureKey: string, visible: boolean) => {
    setLocalFeatures(prev => ({
      ...prev,
      [featureKey]: visible,
    }));
  };

  // 批量操作：全部显示
  const handleShowAll = () => {
    const newFeatures: Record<string, boolean> = {};
    getFilteredFeatures().forEach(feature => {
      newFeatures[feature.key] = true;
    });
    setLocalFeatures(prev => ({ ...prev, ...newFeatures }));
  };

  // 批量操作：全部隐藏
  const handleHideAll = () => {
    const newFeatures: Record<string, boolean> = {};
    getFilteredFeatures().forEach(feature => {
      newFeatures[feature.key] = false;
    });
    setLocalFeatures(prev => ({ ...prev, ...newFeatures }));
  };

  // 保存更改
  const handleSave = async () => {
    if (!user?.id) {
      message.error(t('auth.notLoggedIn'));
      return;
    }

    setSaving(true);
    try {
      // 计算需要更新的功能
      const updates: Partial<FeatureVisibilityConfig['features']> = {};

      Object.entries(localFeatures).forEach(([key, visible]) => {
        const currentVisible = config?.features[key]?.visible ?? FEATURE_DEFINITIONS.find(f => f.key === key)?.defaultVisible ?? true;
        if (currentVisible !== visible) {
          const feature = FEATURE_DEFINITIONS.find(f => f.key === key);
          if (feature) {
            updates[key] = {
              visible,
              description: feature.description,
              category: feature.category,
              route: feature.route,
              icon: feature.icon,
              updatedAt: new Date(),
              updatedBy: user.id,
            };
          }
        }
      });

      if (Object.keys(updates).length === 0) {
        message.info(t('common.noChangesToSave'));
        return;
      }

      const result = await updateFeatureVisibilityConfig(updates, user.id);
      if (result.success) {
        message.success(t('common.savedSuccess'));
        refreshConfig();
      } else {
        message.error(result.error || t('common.saveFailed'));
      }
    } catch (error) {
      message.error(t('common.saveFailed'));
    } finally {
      setSaving(false);
    }
  };

  // 重置为默认
  const handleReset = async () => {
    if (!user?.id) {
      message.error(t('auth.notLoggedIn'));
      return;
    }

    try {
      const result = await resetFeatureVisibilityConfig(user.id);
      if (result.success) {
        message.success(t('featureManagement.resetSuccess'));
        refreshConfig();
      } else {
        message.error(result.error || t('featureManagement.resetFailed'));
      }
    } catch (error) {
      message.error(t('featureManagement.resetFailed'));
    }
  };

  // 保存应用配置
  const handleSaveAppConfig = async () => {
    if (!user?.id) {
      message.error(t('auth.notLoggedIn'));
      return;
    }

    setSavingAppConfig(true);
    try {
      const values = await appConfigForm.validateFields();
      // 合并待保存的颜色更改
      const finalColorTheme = appConfig?.colorTheme
        ? {
          ...appConfig.colorTheme,
          ...pendingColorChanges,
        }
        : undefined;

      const authConfig = {
        disableGoogleLogin: Boolean(values.disableGoogleLogin),
        disableEmailLogin: Boolean(values.disableEmailLogin),
      };

      const geminiConfig = values.geminiModels && values.geminiModels.length > 0
        ? { models: values.geminiModels }
        : undefined;

      const result = await updateAppConfig(
        {
          logoUrl: values.logoUrl,
          appName: values.appName,
          hideFooter: values.hideFooter ?? false,
          colorTheme: finalColorTheme, // 使用合并后的颜色主题
          auth: authConfig,
          gemini: geminiConfig,
        },
        user.id
      );

      if (result.success) {
        message.success(t('featureManagement.appConfigSaved'));
        setPendingColorChanges({}); // 清空待保存的更改

        // 直接更新本地 appConfig 状态，保留其他字段（如 aiCigar、whapi）
        if (appConfig) {
          setAppConfig({
            ...appConfig,
            logoUrl: values.logoUrl,
            appName: values.appName,
            hideFooter: values.hideFooter ?? false,
            colorTheme: finalColorTheme,
            auth: authConfig,
            gemini: geminiConfig,
          });
        }
      } else {
        message.error(result.error || t('common.saveFailed'));
      }
    } catch (error) {
      message.error(t('common.saveFailed'));
    } finally {
      setSavingAppConfig(false);
    }
  };

  // 重置应用配置
  const handleResetAppConfig = async () => {
    if (!user?.id) {
      message.error(t('auth.notLoggedIn'));
      return;
    }

    try {
      const result = await resetAppConfig(user.id);
      if (result.success) {
        message.success(t('featureManagement.resetSuccess'));
        setPendingColorChanges({}); // 清空待保存的颜色更改

        // 重新加载配置（重置操作需要完整重载）
        refreshAppConfig();
      } else {
        message.error(result.error || t('featureManagement.resetFailed'));
      }
    } catch (error) {
      message.error(t('featureManagement.resetFailed'));
    }
  };

  // 保存支付配置
  const handleSavePaymentConfig = async () => {
    if (!user?.id) {
      message.error(t('auth.notLoggedIn'));
      return;
    }

    setSavingAppConfig(true);
    try {
      const values = await paymentForm.validateFields();
      const paymentConfig = {
        billplz: {
          apiKey: values.billplzApiKey,
          xSignatureKey: values.billplzXSignatureKey,
          collectionId: values.billplzCollectionId,
          isSandbox: Boolean(values.billplzIsSandbox),
          enabled: Boolean(values.billplzEnabled),
        }
      };

      const result = await updateAppConfig(
        {
          payment: paymentConfig,
        },
        user.id
      );

      if (result.success) {
        message.success(t('featureManagement.paymentConfigSaved'));
        if (appConfig) {
          setAppConfig({
            ...appConfig,
            payment: paymentConfig,
          });
        }
      } else {
        message.error(result.error || t('common.saveFailed'));
      }
    } catch (error) {
      message.error(t('common.saveFailed'));
    } finally {
      setSavingAppConfig(false);
    }
  };

  // 解析 Firebase 配置代码
  const parseFirebaseConfig = (code: string): Partial<{
    firebaseApiKey: string;
    firebaseAuthDomain: string;
    firebaseProjectId: string;
    firebaseStorageBucket: string;
    firebaseMessagingSenderId: string;
    firebaseAppId: string;
    firebaseMeasurementId: string;
  }> => {
    const config: any = {};

    // 提取 apiKey
    const apiKeyMatch = code.match(/apiKey:\s*["']([^"']+)["']/);
    if (apiKeyMatch) config.firebaseApiKey = apiKeyMatch[1];

    // 提取 authDomain
    const authDomainMatch = code.match(/authDomain:\s*["']([^"']+)["']/);
    if (authDomainMatch) config.firebaseAuthDomain = authDomainMatch[1];

    // 提取 projectId
    const projectIdMatch = code.match(/projectId:\s*["']([^"']+)["']/);
    if (projectIdMatch) config.firebaseProjectId = projectIdMatch[1];

    // 提取 storageBucket
    const storageBucketMatch = code.match(/storageBucket:\s*["']([^"']+)["']/);
    if (storageBucketMatch) config.firebaseStorageBucket = storageBucketMatch[1];

    // 提取 messagingSenderId
    const messagingSenderIdMatch = code.match(/messagingSenderId:\s*["']([^"']+)["']/);
    if (messagingSenderIdMatch) config.firebaseMessagingSenderId = messagingSenderIdMatch[1];

    // 提取 appId
    const appIdMatch = code.match(/appId:\s*["']([^"']+)["']/);
    if (appIdMatch) config.firebaseAppId = appIdMatch[1];

    // 提取 measurementId（可选）
    const measurementIdMatch = code.match(/measurementId:\s*["']([^"']+)["']/);
    if (measurementIdMatch) config.firebaseMeasurementId = measurementIdMatch[1];

    return config;
  };

  // 处理 Firebase 配置代码粘贴
  const handlePasteFirebaseConfig = (code: string) => {
    try {
      const config = parseFirebaseConfig(code);
      const extractedKeys = Object.keys(config);

      if (extractedKeys.length === 0) {
        message.error(t('featureManagement.parseConfigNoResult'));
        return;
      }

      // 填充表单字段
      envForm.setFieldsValue(config);
      message.success(t('featureManagement.autoFilled', { count: extractedKeys.length }));
    } catch (error) {
      message.error(t('featureManagement.parseConfigFailed'));
    }
  };

  // 生成 .env 文件内容
  const generateEnvFile = (values: {
    firebaseApiKey: string;
    firebaseAuthDomain: string;
    firebaseProjectId: string;
    firebaseStorageBucket: string;
    firebaseMessagingSenderId: string;
    firebaseAppId: string;
    firebaseMeasurementId?: string;
    firebaseServiceAccount?: string;
    cloudinaryCloudName: string;
    cloudinaryApiKey: string;
    cloudinaryApiSecret: string;
    cloudinaryUploadPreset: string;
    cloudinaryBaseFolder: string;
    appName: string;
    fcmVapidKey?: string;
    geminiApiKey?: string;
  }): string => {
    const measurementIdLine = values.firebaseMeasurementId
      ? `VITE_FIREBASE_MEASUREMENT_ID=${values.firebaseMeasurementId}\n`
      : '';

    const fcmVapidKeyLine = values.fcmVapidKey
      ? `# FCM 配置\nVITE_FCM_VAPID_KEY=${values.fcmVapidKey}`
      : '';

    const geminiApiKeyLine = values.geminiApiKey
      ? `\n# Gemini API 配置\nVITE_GEMINI_API_KEY=${values.geminiApiKey}`
      : '';

    // FIREBASE_SERVICE_ACCOUNT 是服务器端环境变量，需要单独处理（JSON 格式）
    const serviceAccountLine = values.firebaseServiceAccount
      ? (() => {
        try {
          // 尝试解析并压缩 JSON
          const parsed = JSON.parse(values.firebaseServiceAccount.trim());
          const compressed = JSON.stringify(parsed);
          return `\n# Firebase Service Account (用于 Netlify Functions)\n# 注意：这是服务器端环境变量，不会自动部署到 Netlify\n# 需要在 Netlify 控制台的 Environment variables 中手动设置 FIREBASE_SERVICE_ACCOUNT\n# 值为以下 JSON 内容（已压缩为单行）：\nFIREBASE_SERVICE_ACCOUNT=${compressed}`;
        } catch {
          // 如果解析失败，使用原始值（压缩空格和换行）
          const compressed = values.firebaseServiceAccount.trim().replace(/\s+/g, ' ').replace(/\n/g, '');
          return `\n# Firebase Service Account (用于 Netlify Functions)\n# 注意：这是服务器端环境变量，不会自动部署到 Netlify\n# 需要在 Netlify 控制台的 Environment variables 中手动设置 FIREBASE_SERVICE_ACCOUNT\n# 值为以下 JSON 内容（已压缩为单行）：\nFIREBASE_SERVICE_ACCOUNT=${compressed}`;
        }
      })()
      : '';

    return `# Firebase配置
VITE_FIREBASE_API_KEY=${values.firebaseApiKey}
VITE_FIREBASE_AUTH_DOMAIN=${values.firebaseAuthDomain}
VITE_FIREBASE_PROJECT_ID=${values.firebaseProjectId}
VITE_FIREBASE_STORAGE_BUCKET=${values.firebaseStorageBucket}
VITE_FIREBASE_MESSAGING_SENDER_ID=${values.firebaseMessagingSenderId}
VITE_FIREBASE_APP_ID=${values.firebaseAppId}${measurementIdLine ? '\n' + measurementIdLine : ''}${serviceAccountLine}
# Cloudinary配置
VITE_CLOUDINARY_CLOUD_NAME=${values.cloudinaryCloudName}
VITE_CLOUDINARY_API_KEY=${values.cloudinaryApiKey}
VITE_CLOUDINARY_API_SECRET=${values.cloudinaryApiSecret}
VITE_CLOUDINARY_UPLOAD_PRESET=${values.cloudinaryUploadPreset}
VITE_CLOUDINARY_BASE_FOLDER=${values.cloudinaryBaseFolder}

# 应用配置
VITE_APP_NAME=${values.appName}${fcmVapidKeyLine ? '\n\n' + fcmVapidKeyLine : ''}${geminiApiKeyLine}`;
  };

  // 部署到 Netlify
  const handleDeployToNetlify = async () => {
    try {
      const values = await envForm.validateFields();
      const { netlifyAccessToken, netlifySiteId } = values;

      if (!netlifyAccessToken || !netlifySiteId) {
        message.error(t('featureManagement.netlifyConfigRequired'));
        return;
      }

      setDeploying(true);
      setDeployStatus({ state: 'updating', message: t('featureManagement.updatingEnvVars') });

      // 构建环境变量数组
      const envVars = [
        { key: 'VITE_FIREBASE_API_KEY', value: values.firebaseApiKey, scopes: ['all'] },
        { key: 'VITE_FIREBASE_AUTH_DOMAIN', value: values.firebaseAuthDomain, scopes: ['all'] },
        { key: 'VITE_FIREBASE_PROJECT_ID', value: values.firebaseProjectId, scopes: ['all'] },
        { key: 'VITE_FIREBASE_STORAGE_BUCKET', value: values.firebaseStorageBucket, scopes: ['all'] },
        { key: 'VITE_FIREBASE_MESSAGING_SENDER_ID', value: values.firebaseMessagingSenderId, scopes: ['all'] },
        { key: 'VITE_FIREBASE_APP_ID', value: values.firebaseAppId, scopes: ['all'] },
        { key: 'VITE_CLOUDINARY_CLOUD_NAME', value: values.cloudinaryCloudName, scopes: ['all'] },
        { key: 'VITE_CLOUDINARY_API_KEY', value: values.cloudinaryApiKey, scopes: ['all'] },
        { key: 'VITE_CLOUDINARY_API_SECRET', value: values.cloudinaryApiSecret, scopes: ['all'] },
        { key: 'VITE_CLOUDINARY_UPLOAD_PRESET', value: values.cloudinaryUploadPreset, scopes: ['all'] },
        { key: 'VITE_CLOUDINARY_BASE_FOLDER', value: values.cloudinaryBaseFolder, scopes: ['all'] },
        { key: 'VITE_APP_NAME', value: values.appName, scopes: ['all'] },
      ];

      // 如果提供了 Measurement ID，添加到环境变量数组
      if (values.firebaseMeasurementId) {
        envVars.push({ key: 'VITE_FIREBASE_MEASUREMENT_ID', value: values.firebaseMeasurementId, scopes: ['all'] });
      }

      // 如果提供了 FCM VAPID Key，添加到环境变量数组
      if (values.fcmVapidKey) {
        envVars.push({ key: 'VITE_FCM_VAPID_KEY', value: values.fcmVapidKey, scopes: ['all'] });
      }

      // 如果提供了 Gemini API Key，添加到环境变量数组
      if (values.geminiApiKey) {
        envVars.push({ key: 'VITE_GEMINI_API_KEY', value: values.geminiApiKey, scopes: ['all'] });
      }

      // 如果提供了 Firebase Service Account，添加到环境变量数组（服务器端变量，不使用 VITE_ 前缀）
      if (values.firebaseServiceAccount) {
        // Service Account JSON 需要压缩为单行（移除所有换行和多余空格）
        try {
          // 先尝试解析 JSON 以确保格式正确
          const parsed = JSON.parse(values.firebaseServiceAccount.trim());
          // 压缩为单行 JSON
          const serviceAccountJson = JSON.stringify(parsed);
          envVars.push({ key: 'FIREBASE_SERVICE_ACCOUNT', value: serviceAccountJson, scopes: ['functions'] });
        } catch (error) {
          message.warning(t('featureManagement.serviceAccountJsonInvalid'));
          // 如果解析失败，使用压缩后的原始值
          const serviceAccountJson = values.firebaseServiceAccount.trim().replace(/\s+/g, ' ').replace(/\n/g, '');
          envVars.push({ key: 'FIREBASE_SERVICE_ACCOUNT', value: serviceAccountJson, scopes: ['functions'] });
        }
      }

      // 调用 Netlify Function
      const response = await fetch('/.netlify/functions/update-netlify-env', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          accessToken: netlifyAccessToken,
          siteId: netlifySiteId,
          envVars,
          triggerDeploy: true,
          clearCache: true,
        }),
      });

      const result = await response.json();

      if (!response.ok) {
        throw new Error(result.error || t('featureManagement.deployFailed'));
      }

      if (result.success) {
        setDeployStatus({
          state: 'deploying',
          message: t('featureManagement.envUpdatedDeploying'),
          deployId: result.deploy?.id,
          deployUrl: result.deploy?.url,
        });

        message.success(t('featureManagement.envVarsUpdated'));

        // 轮询部署状态
        if (result.deploy?.id) {
          pollDeployStatus(netlifyAccessToken, netlifySiteId, result.deploy.id);
        } else {
          setDeployStatus({
            state: 'success',
            message: t('featureManagement.deployTriggered'),
          });
          setDeploying(false);
        }
      }
    } catch (error: any) {
      console.error('[Deploy to Netlify] Error:', error);
      setDeployStatus({
        state: 'error',
        message: error.message || t('featureManagement.deployFailedCheckConfig'),
      });
      message.error(error.message || t('featureManagement.deployFailed'));
      setDeploying(false);
    }
  };

  // 部署 Firebase 索引
  const handleDeployFirestoreIndexes = async () => {
    try {
      // 使用 getFieldsValue 获取值，避免验证错误
      const values = envForm.getFieldsValue(['firebaseProjectId']);
      const { firebaseProjectId } = values;

      if (!firebaseProjectId) {
        message.error(t('featureManagement.firebaseProjectIdRequired'));
        return;
      }

      setIndexDeploying(true);
      setIndexDeployStatus({ state: 'deploying', message: t('featureManagement.deployingIndexes') });

      // 调用 Netlify Function 部署索引（Function 会读取 firestore.indexes.json）
      const deployResponse = await fetch(`/.netlify/functions/deploy-firestore-indexes`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          projectId: firebaseProjectId,
        }),
      });

      if (!deployResponse.ok) {
        const errorData = await deployResponse.json();
        throw new Error(errorData.error || t('featureManagement.deployFailed'));
      }

      const result = await deployResponse.json();

      // 即使部分失败，也显示结果
      if (result.success || (result.summary && result.summary.succeeded > 0)) {
        setIndexDeployStatus({
          state: result.success ? 'success' : 'error',
          message: result.message || (result.success ? t('featureManagement.indexesDeployedSuccess') : t('featureManagement.indexesPartialFail')),
          links: result.links,
          summary: result.summary,
          results: result.results,
          consoleUrl: result.consoleUrl,
        });
        if (result.success) {
          message.success(result.message || t('featureManagement.indexesDeployedSuccess'));
        } else {
          message.warning(result.message || t('featureManagement.indexesPartialFail'));
        }
      } else {
        setIndexDeployStatus({
          state: 'error',
          message: result.message || t('featureManagement.deployFailed'),
          summary: result.summary,
          results: result.results,
          consoleUrl: result.consoleUrl,
        });
        message.error(result.message || t('featureManagement.deployFailed'));
      }
    } catch (error: any) {
      console.error('[handleDeployFirestoreIndexes] Error:', error);
      setIndexDeployStatus({
        state: 'error',
        message: error.message || t('featureManagement.deployFailedCheckConfig'),
      });
      message.error(error.message || t('featureManagement.deployFailed'));
    } finally {
      setIndexDeploying(false);
    }
  };

  // 轮询部署状态
  const pollDeployStatus = async (accessToken: string, siteId: string, deployId: string) => {
    const maxAttempts = 60; // 最多轮询 60 次（5分钟）
    let attempts = 0;

    const poll = async () => {
      try {
        const response = await fetch(`/.netlify/functions/update-netlify-env`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({
            accessToken,
            siteId,
            action: 'getDeployStatus',
            deployId,
          }),
        });

        if (!response.ok) {
          throw new Error('Failed to get deploy status');
        }

        const result = await response.json();

        if (!result.success || !result.deploy) {
          throw new Error('Invalid response from server');
        }

        const deployState = result.deploy.state;

        if (deployState === 'ready') {
          setDeployStatus({
            state: 'success',
            message: t('featureManagement.deploySuccess'),
            deployId: result.deploy.id,
            deployUrl: result.deploy.url,
          });
          message.success(t('featureManagement.deploySuccess'));
          setDeploying(false);
          return;
        } else if (deployState === 'error' || deployState === 'failed') {
          setDeployStatus({
            state: 'error',
            message: t('featureManagement.deployFailed'),
            deployId: result.deploy.id,
            deployUrl: result.deploy.url,
          });
          message.error(t('featureManagement.deployFailed'));
          setDeploying(false);
          return;
        } else if (deployState === 'building' || deployState === 'new' || deployState === 'enqueued') {
          // 继续轮询
          setDeployStatus({
            state: 'deploying',
            message: `部署中... (状态: ${deployState})`,
            deployId: result.deploy.id,
            deployUrl: result.deploy.url,
          });
        }

        attempts++;
        if (attempts < maxAttempts) {
          setTimeout(poll, 5000); // 每 5 秒轮询一次
        } else {
          setDeployStatus({
            state: 'success',
            message: t('featureManagement.deployTriggered'),
            deployId,
          });
          setDeploying(false);
        }
      } catch (error) {
        console.error('[Poll Deploy Status] Error:', error);
        setDeployStatus({
          state: 'error',
          message: t('featureManagement.deployStatusFailed'),
        });
        setDeploying(false);
      }
    };

    poll();
  };

  // 处理颜色更改（暂存，不立即保存）
  const handleColorChange = (colors: Partial<ColorThemeConfig>) => {
    setPendingColorChanges(prev => ({
      ...prev,
      ...colors,
    }));

    // 实时更新本地状态以预览效果
    if (appConfig?.colorTheme) {
      setAppConfig({
        ...appConfig,
        colorTheme: {
          ...appConfig.colorTheme,
          ...colors,
        },
      });
    }
  };

  // 保存颜色更改
  const handleSaveColorTheme = async () => {
    if (!user?.id || !appConfig || !appConfig.colorTheme) {
      message.error(t('featureManagement.notLoggedInOrConfigNotLoaded'));
      return;
    }

    if (Object.keys(pendingColorChanges).length === 0) {
      message.info(t('common.noChangesToSave'));
      return;
    }

    setSavingAppConfig(true);
    try {
      const updatedColorTheme: ColorThemeConfig = {
        ...appConfig.colorTheme,
        ...pendingColorChanges,
      };

      const result = await updateAppConfig(
        {
          colorTheme: updatedColorTheme,
        },
        user.id
      );

      if (result.success) {
        message.success(t('featureManagement.colorConfigSaved'));
        setPendingColorChanges({});
        refreshAppConfig();
      } else {
        message.error(result.error || t('common.saveFailed'));
      }
    } catch (error) {
      message.error(t('common.saveFailed'));
    } finally {
      setSavingAppConfig(false);
    }
  };

  // 重置颜色配置
  const handleResetColorTheme = async () => {
    if (!user?.id) {
      message.error(t('auth.notLoggedIn'));
      return;
    }

    try {
      const result = await resetAppConfig(user.id);
      if (result.success) {
        message.success(t('featureManagement.resetSuccess'));
        setPendingColorChanges({});
        refreshAppConfig();
      } else {
        message.error(result.error || t('featureManagement.resetFailed'));
      }
    } catch (error) {
      message.error(t('featureManagement.resetFailed'));
    }
  };

  // 获取过滤后的功能列表
  const getFilteredFeatures = (): FeatureDefinition[] => {
    let features = FEATURE_DEFINITIONS.filter(f => f.category === activeTab);

    if (searchText) {
      const searchLower = searchText.toLowerCase();
      features = features.filter(f => {
        const name = i18n.language === 'zh-CN' ? f.name : f.nameEn;
        const desc = i18n.language === 'zh-CN' ? f.description : f.descriptionEn;
        return name.toLowerCase().includes(searchLower) || desc.toLowerCase().includes(searchLower);
      });
    }

    return features;
  };

  // 获取功能名称（根据语言）
  const getFeatureName = (feature: FeatureDefinition): string => {
    return i18n.language === 'zh-CN' ? feature.name : feature.nameEn;
  };

  // 获取功能描述（根据语言）
  const getFeatureDescription = (feature: FeatureDefinition): string => {
    return i18n.language === 'zh-CN' ? feature.description : feature.descriptionEn;
  };

  if (loading) {
    return (
      <div style={{ textAlign: 'center', padding: '40px' }}>
        <Spin size="large" />
      </div>
    );
  }

  const filteredFeatures = getFilteredFeatures();
  const isMobile = typeof window !== 'undefined' && window.matchMedia('(max-width: 768px)').matches;

  return (
    <div style={{ paddingBottom: isMobile ? '100px' : '0' }}>
      <Title level={2} style={{
        marginBottom: 8,
        background: 'linear-gradient(to right,#FDE08D,#C48D3A)',
        WebkitBackgroundClip: 'text',
        WebkitTextFillColor: 'transparent',
        backgroundClip: 'text',
        fontWeight: 700,
      }}>
        {t('featureManagement.title', { defaultValue: '功能管理' })}
      </Title>
      <Text style={{ color: '#c0c0c0', fontSize: '14px', display: 'block', marginBottom: 24 }}>
        {t('featureManagement.description', { defaultValue: '配置系统中各个功能的显示/隐藏状态' })}
      </Text>

      {/* 标签页 */}
      <div style={{ marginBottom: 16 }}>
        <div style={{
          display: 'flex',
          borderBottom: '1px solid rgba(244,175,37,0.2)',
          marginBottom: 16
        }}>
          {(['frontend', 'admin', 'cigar-database', 'tools', 'app', 'whapi', 'payment', 'env'] as const).map((tabKey) => {
            const isActive = activeTab === tabKey;
            const baseStyle: React.CSSProperties = {
              flex: 1,
              padding: '10px 0',
              fontWeight: 800,
              fontSize: 12,
              outline: 'none',
              borderBottom: isActive ? '2px solid #f4af25' : '2px solid transparent',
              borderTop: 'none',
              borderLeft: 'none',
              borderRight: 'none',
              cursor: 'pointer',
              background: 'none',
            };
            const activeStyle: React.CSSProperties = {
              color: 'transparent',
              background: 'linear-gradient(to right,#FDE08D,#C48D3A)',
              WebkitBackgroundClip: 'text',
            };
            const inactiveStyle: React.CSSProperties = {
              color: '#A0A0A0',
            };

            return (
              <button
                key={tabKey}
                style={{
                  ...baseStyle,
                  ...(isActive ? activeStyle : inactiveStyle),
                }}
                onClick={() => setActiveTab(tabKey)}
              >
                {tabKey === 'frontend'
                  ? t('featureManagement.frontendFeatures', { defaultValue: '前端功能' })
                  : tabKey === 'admin'
                    ? t('featureManagement.adminFeatures', { defaultValue: '管理后台功能' })
                    : tabKey === 'cigar-database'
                      ? t('featureManagement.cigarDatabase', { defaultValue: '雪茄数据库' })
                      : tabKey === 'tools'
                        ? t('featureManagement.tools', { defaultValue: '工具' })
                        : tabKey === 'app'
                          ? t('featureManagement.appSettings', { defaultValue: '应用配置' })
                          : tabKey === 'whapi'
                            ? t('featureManagement.whapiSettings', { defaultValue: 'WhatsApp 管理' })
                            : tabKey === 'payment'
                              ? t('featureManagement.paymentSettings', { defaultValue: '支付网关' })
                              : t('featureManagement.envSettings', { defaultValue: '环境配置' })}
              </button>
            );
          })}
        </div>
      </div>

      {/* 搜索和批量操作（仅功能标签页显示） */}
      {activeTab !== 'app' && activeTab !== 'whapi' && activeTab !== 'payment' && activeTab !== 'env' && activeTab !== 'cigar-database' && (
        <div style={{ marginBottom: 16, display: 'flex', gap: 12, alignItems: 'center' }}>
          <Search
            placeholder={t('featureManagement.searchPlaceholder', { defaultValue: '搜索功能...' })}
            value={searchText}
            onChange={(e) => setSearchText(e.target.value)}
            style={{ flex: 1, maxWidth: 300 }}
            prefix={<SearchOutlined />}
          />
          <Space>
            <Button
              icon={<EyeOutlined />}
              onClick={handleShowAll}
              size="small"
            >
              {t('featureManagement.showAll', { defaultValue: '全部显示' })}
            </Button>
            <Button
              icon={<EyeInvisibleOutlined />}
              onClick={handleHideAll}
              size="small"
            >
              {t('featureManagement.hideAll', { defaultValue: '全部隐藏' })}
            </Button>
          </Space>
        </div>
      )}

      {/* 功能列表或应用配置 */}
      {activeTab === 'app' ? (
        <Card style={{
          background: 'rgba(255, 255, 255, 0.05)',
          borderRadius: 12,
          border: '1px solid rgba(244, 175, 37, 0.6)',
          backdropFilter: 'blur(10px)'
        }}>
          <Form
            form={appConfigForm}
            layout="vertical"
            onFinish={handleSaveAppConfig}
          >
            <Form.Item
              label={<span style={{ color: '#f8f8f8', fontSize: '16px', fontWeight: 600 }}>{t('featureManagement.appLogo')}</span>}
              name="logoUrl"
              rules={[{ required: true, message: t('featureManagement.appLogoRequired') }]}
            >
              <ImageUpload
                folder="app-config"
                maxSize={2 * 1024 * 1024} // 2MB
                width="auto"
                height="auto"
                showPreview={false}
                enableCrop={true}
                accept="image/png,image/jpeg,image/jpg,image/webp"
              />
            </Form.Item>

            <Form.Item
              label={<span style={{ color: '#f8f8f8', fontSize: '16px', fontWeight: 600 }}>{t('featureManagement.appName')}</span>}
              name="appName"
              rules={[{ required: true, message: t('featureManagement.appNameRequired') }]}
            >
              <Input
                placeholder="例如：Cigar Club"
                style={{
                  background: 'rgba(255, 255, 255, 0.05)',
                  border: '1px solid rgba(255, 255, 255, 0.1)',
                  color: '#f8f8f8',
                }}
              />
            </Form.Item>

            <Form.Item
              label={<span style={{ color: '#f8f8f8', fontSize: '16px', fontWeight: 600 }}>{t('featureManagement.hideFooter')}</span>}
              name="hideFooter"
              valuePropName="checked"
            >
              <Switch
                checkedChildren={<span style={{ color: '#000' }}>{t('featureManagement.hidden')}</span>}
                unCheckedChildren={<span style={{ color: '#000' }}>{t('featureManagement.visible')}</span>}
                style={{
                  background: appConfigForm.getFieldValue('hideFooter') ? 'linear-gradient(to right,#FDE08D,#C48D3A)' : undefined,
                }}
              />
            </Form.Item>

            <Divider style={{ borderColor: 'rgba(244, 175, 37, 0.2)', margin: '24px 0' }} />

            <div style={{ marginBottom: 16 }}>
              <Text style={{ color: '#f8f8f8', fontSize: '16px', fontWeight: 600 }}>
                {t('featureManagement.loginMethodConfig')}
              </Text>
            </div>

            <Form.Item
              label={<span style={{ color: '#f8f8f8', fontSize: '16px' }}>{t('featureManagement.disableGoogleLogin')}</span>}
              name="disableGoogleLogin"
              valuePropName="checked"
              getValueFromEvent={(checked) => checked}
              style={{ marginBottom: 16 }}
            >
              <Switch
                checkedChildren={<span style={{ color: '#000' }}>{t('featureManagement.disable')}</span>}
                unCheckedChildren={<span style={{ color: '#000' }}>{t('featureManagement.enable')}</span>}
              />
            </Form.Item>

            <Form.Item
              label={<span style={{ color: '#f8f8f8', fontSize: '16px' }}>{t('featureManagement.disableEmailLogin')}</span>}
              name="disableEmailLogin"
              valuePropName="checked"
              getValueFromEvent={(checked) => checked}
              style={{ marginBottom: 16 }}
            >
              <Switch
                checkedChildren={<span style={{ color: '#000' }}>{t('featureManagement.disable')}</span>}
                unCheckedChildren={<span style={{ color: '#000' }}>{t('featureManagement.enable')}</span>}
              />
            </Form.Item>

            <Divider style={{ borderColor: 'rgba(244, 175, 37, 0.2)', margin: '24px 0' }} />

            {/* Gemini API 模型设定 */}
            <div style={{ marginBottom: 24 }}>
              <Text style={{ color: '#f8f8f8', fontSize: '16px', fontWeight: 600 }}>
                {t('featureManagement.geminiModelSettings')}
              </Text>
              <Text style={{ color: '#c0c0c0', fontSize: '12px', display: 'block', marginTop: 8, marginBottom: 16 }}>
                {t('featureManagement.geminiModelDesc')}
              </Text>

              <Form.Item
                label={<span style={{ color: '#f8f8f8', fontSize: '16px' }}>{t('featureManagement.availableModels')}</span>}
                name="geminiModels"
                extra={
                  <Text style={{ color: '#999', fontSize: '12px' }}>
                    基于实测结果 (2025-12-04): 测试了27个模型，仅15个可用。
                    推荐使用星级标注的模型。按住 Ctrl/Cmd 键可多选。
                  </Text>
                }
              >
                <Select
                  mode="multiple"
                  placeholder={t('featureManagement.selectGeminiModelsPlaceholder')}
                  allowClear
                  popupClassName="gemini-models-dropdown"
                  style={{
                    width: '100%',
                  }}
                  options={[
                    // 🥇 最佳选择（100%成功率, 极快 1.8-2.2s）
                    {
                      label: 'gemini-flash-lite-latest (1.8s, 最佳推荐)',
                      value: 'gemini-flash-lite-latest'
                    },
                    {
                      label: 'gemini-2.5-flash-lite-preview-09-2025 (2.2s)',
                      value: 'gemini-2.5-flash-lite-preview-09-2025'
                    },

                    // 🥈 优秀选择（100%成功率, 快速 3.5-9.7s）
                    {
                      label: 'gemini-2.0-flash-001 (3.5s)',
                      value: 'gemini-2.0-flash-001'
                    },
                    {
                      label: 'gemini-2.0-flash (3.9s)',
                      value: 'gemini-2.0-flash'
                    },
                    {
                      label: 'gemini-2.5-flash (9.7s)',
                      value: 'gemini-2.5-flash'
                    },

                    // 🥉 稳定选择（100%成功率, 较慢 15-17s）
                    {
                      label: 'gemini-pro-latest (15.5s)',
                      value: 'gemini-pro-latest'
                    },
                    {
                      label: 'gemini-robotics-er-1.5-preview (16.7s)',
                      value: 'gemini-robotics-er-1.5-preview'
                    },

                    // 备选方案（60-80%成功率）
                    {
                      label: 'gemini-2.5-flash-lite (60%成功率)',
                      value: 'gemini-2.5-flash-lite'
                    },
                    {
                      label: 'gemini-flash-latest (80%成功率)',
                      value: 'gemini-flash-latest'
                    },
                    {
                      label: 'gemini-2.0-flash-lite (60%成功率)',
                      value: 'gemini-2.0-flash-lite'
                    },
                    {
                      label: 'gemini-2.0-flash-lite-001 (40%成功率, 52.8s)',
                      value: 'gemini-2.0-flash-lite-001'
                    },
                    {
                      label: 'gemini-2.0-flash-lite-preview (60%成功率)',
                      value: 'gemini-2.0-flash-lite-preview'
                    },
                    {
                      label: 'gemini-2.5-pro (60%成功率, 每分钟限2次)',
                      value: 'gemini-2.5-pro'
                    },
                    {
                      label: 'gemini-2.5-flash-preview-09-2025 (60%成功率)',
                      value: 'gemini-2.5-flash-preview-09-2025'
                    },
                    {
                      label: 'gemini-2.0-flash-lite-preview-02-05 (80%成功率)',
                      value: 'gemini-2.0-flash-lite-preview-02-05'
                    },
                  ]}
                  dropdownStyle={{
                    background: 'rgba(26, 26, 26, 0.95)',
                    border: '1px solid rgba(255, 255, 255, 0.1)',
                  }}
                />
              </Form.Item>

              {/* 应用推荐配置按钮 */}
              <div style={{ marginTop: 16, marginBottom: 16 }}>
                <Button
                  type="dashed"
                  onClick={() => {
                    const recommendedModels = [
                      'gemini-flash-lite-latest',
                      'gemini-2.5-flash-lite-preview-09-2025',
                      'gemini-2.0-flash-001',
                      'gemini-2.0-flash',
                      'gemini-2.5-flash'
                    ];
                    appConfigForm.setFieldsValue({ geminiModels: recommendedModels });
                    message.success(t('featureManagement.appliedRecommendedModels'));
                  }}
                  style={{
                    borderColor: 'rgba(244, 175, 37, 0.5)',
                    color: '#f4af25'
                  }}
                >
                  {t('featureManagement.applyRecommendedModels')}
                </Button>
                <Text style={{ color: '#999', fontSize: '12px', marginLeft: 12 }}>
                  {t('featureManagement.recommendedModelsHint')}
                </Text>
              </div>
            </div>

            {/* 颜色主题管理 */}
            <div style={{ marginTop: 32 }}>
              <div style={{
                marginBottom: 16,
                paddingBottom: 12,
                borderBottom: '1px solid rgba(244, 175, 37, 0.2)'
              }}>
                <Text style={{ color: '#f8f8f8', fontSize: '16px', fontWeight: 600 }}>
                  {t('featureManagement.colorThemeManagement')}
                </Text>
              </div>

              <MockAppInterface
                colorTheme={appConfig?.colorTheme || DEFAULT_COLOR_THEME}
                onColorChange={handleColorChange}
                onSave={handleSaveColorTheme}
                onReset={handleResetColorTheme}
                saving={savingAppConfig}
              />
            </div>

            <div style={{ marginTop: 24, display: 'flex', justifyContent: 'flex-end', gap: 12 }}>
              <Button
                icon={<ReloadOutlined />}
                onClick={handleResetAppConfig}
                disabled={savingAppConfig}
              >
                {t('featureManagement.resetToDefault', { defaultValue: '重置为默认' })}
              </Button>
              <Button
                type="primary"
                icon={<SaveOutlined />}
                htmlType="submit"
                loading={savingAppConfig}
                style={{
                  background: 'linear-gradient(to right,#FDE08D,#C48D3A)',
                  border: 'none',
                }}
              >
                {t('featureManagement.saveChanges', { defaultValue: '保存更改' })}
              </Button>
            </div>
          </Form>
        </Card>
      ) : null}

      {/* WhatsApp 管理标签页 */}
      {activeTab === 'whapi' ? (
        <>
          <Card style={{
            background: 'rgba(255, 255, 255, 0.05)',
            borderRadius: 12,
            border: '1px solid rgba(244, 175, 37, 0.6)',
            backdropFilter: 'blur(10px)',
            marginBottom: 16,
          }}>
            <Form
              form={whapiForm}
              layout="vertical"
              onFinish={async () => {
                if (!user?.id) {
                  message.error(t('auth.notLoggedIn'));
                  return;
                }

                setSavingAppConfig(true);
                try {
                  const values = await whapiForm.validateFields();
                  const whapiConfig = {
                    apiToken: values.whapiApiToken,
                    channelId: values.whapiChannelId,
                    baseUrl: values.whapiBaseUrl || 'https://gate.whapi.cloud',
                    enabled: values.whapiEnabled ?? false,
                    features: {
                      eventReminder: values.whapiEventReminder ?? true,
                      vipExpiry: values.whapiVipExpiry ?? true,
                      passwordReset: values.whapiPasswordReset ?? true,
                    },
                  };

                  const result = await updateAppConfig(
                    { whapi: whapiConfig },
                    user.id
                  );

                  if (result.success) {
                    message.success(t('featureManagement.whapiConfigSaved'));

                    // 直接更新本地 appConfig 状态，避免重新加载导致其他字段被重置
                    if (appConfig) {
                      setAppConfig({
                        ...appConfig,
                        whapi: whapiConfig,
                      });
                    }

                    // 重新初始化 Whapi 客户端
                    const { initWhapiClient } = await import('../../../services/whapi');
                    await initWhapiClient(whapiConfig);
                  } else {
                    message.error(result.error || t('common.saveFailed'));
                  }
                } catch (error) {
                  message.error(t('common.saveFailed'));
                } finally {
                  setSavingAppConfig(false);
                }
              }}
            >
              <Form.Item
                name="whapiEnabled"
                valuePropName="checked"
              >
                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                  <span style={{ color: '#f8f8f8', fontSize: '16px', fontWeight: 600 }}>{t('featureManagement.enableWhatsapp')}</span>
                  <Switch
                    checkedChildren={<span style={{ color: '#000' }}>{t('featureManagement.enable')}</span>}
                    unCheckedChildren={<span style={{ color: '#000' }}>{t('featureManagement.disable')}</span>}
                  />
                </div>
              </Form.Item>

              <Form.Item
                label={<span style={{ color: '#f8f8f8', fontSize: '16px', fontWeight: 600 }}>{t('featureManagement.apiConfig')}</span>}
              >
                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 16 }}>
                  <Form.Item
                    label={<span style={{ color: '#f8f8f8', fontSize: '14px', fontWeight: 600 }}>API Token</span>}
                    name="whapiApiToken"
                    rules={[{ required: true, message: t('featureManagement.apiTokenRequired') }]}
                    style={{ marginBottom: 0 }}
                  >
                    <Input.Password
                      placeholder={t('featureManagement.whapiApiTokenPlaceholder')}
                      style={{
                        background: 'rgba(255, 255, 255, 0.05)',
                        border: '1px solid rgba(255, 255, 255, 0.1)',
                        color: '#f8f8f8',
                      }}
                    />
                  </Form.Item>

                  <Form.Item
                    label={<span style={{ color: '#f8f8f8', fontSize: '14px', fontWeight: 600 }}>Channel ID</span>}
                    name="whapiChannelId"
                    style={{ marginBottom: 0 }}
                  >
                    <Input
                      placeholder={t('featureManagement.channelIdPlaceholder')}
                      style={{
                        background: 'rgba(255, 255, 255, 0.05)',
                        border: '1px solid rgba(255, 255, 255, 0.1)',
                        color: '#f8f8f8',
                      }}
                    />
                  </Form.Item>

                  <Form.Item
                    label={<span style={{ color: '#f8f8f8', fontSize: '14px', fontWeight: 600 }}>Base URL</span>}
                    name="whapiBaseUrl"
                    style={{ marginBottom: 0 }}
                  >
                    <Input
                      placeholder="https://gate.whapi.cloud"
                      style={{
                        background: 'rgba(255, 255, 255, 0.05)',
                        border: '1px solid rgba(255, 255, 255, 0.1)',
                        color: '#f8f8f8',
                      }}
                    />
                  </Form.Item>
                </div>
              </Form.Item>

              <Divider style={{ margin: '24px 0', borderColor: 'rgba(255, 255, 255, 0.1)' }} />

              <div style={{ marginBottom: 16 }}>
                <Text style={{ color: '#f8f8f8', fontSize: '16px', fontWeight: 600, display: 'block', marginBottom: 16 }}>
                  {t('featureManagement.featureToggles')}
                </Text>
                <Text style={{ color: '#c0c0c0', fontSize: '14px', display: 'block', marginBottom: 16 }}>
                  {t('featureManagement.featureTogglesDesc')}
                </Text>
              </div>

              <Form.Item
                label={<span style={{ color: '#f8f8f8', fontSize: '16px', fontWeight: 600 }}>{t('featureManagement.featureToggles')}</span>}
              >
                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 16 }}>
                  <Form.Item
                    label={<span style={{ color: '#f8f8f8', fontSize: '14px', fontWeight: 600 }}>{t('featureManagement.eventReminder')}</span>}
                    name="whapiEventReminder"
                    valuePropName="checked"
                    style={{ marginBottom: 0 }}
                  >
                    <Switch
                      checkedChildren={<span style={{ color: '#000' }}>{t('featureManagement.enable')}</span>}
                      unCheckedChildren={<span style={{ color: '#000' }}>{t('featureManagement.disable')}</span>}
                    />
                  </Form.Item>

                  <Form.Item
                    label={<span style={{ color: '#f8f8f8', fontSize: '14px', fontWeight: 600 }}>{t('featureManagement.vipExpiryReminder')}</span>}
                    name="whapiVipExpiry"
                    valuePropName="checked"
                    style={{ marginBottom: 0 }}
                  >
                    <Switch
                      checkedChildren={<span style={{ color: '#000' }}>{t('featureManagement.enable')}</span>}
                      unCheckedChildren={<span style={{ color: '#000' }}>{t('featureManagement.disable')}</span>}
                    />
                  </Form.Item>

                  <Form.Item
                    label={<span style={{ color: '#f8f8f8', fontSize: '14px', fontWeight: 600 }}>{t('common.resetPassword')}</span>}
                    name="whapiPasswordReset"
                    valuePropName="checked"
                    style={{ marginBottom: 0 }}
                  >
                    <Switch
                      checkedChildren={<span style={{ color: '#000' }}>{t('featureManagement.enable')}</span>}
                      unCheckedChildren={<span style={{ color: '#000' }}>{t('featureManagement.disable')}</span>}
                    />
                  </Form.Item>
                </div>
              </Form.Item>

              <Form.Item>
                <div style={{ display: 'flex', justifyContent: 'flex-end' }}>
                  <Button
                    type="primary"
                    icon={<SaveOutlined />}
                    htmlType="submit"
                    loading={savingAppConfig}
                    style={{
                      background: 'linear-gradient(to right,#FDE08D,#C48D3A)',
                      border: 'none',
                      color: '#000',
                    }}
                  >
                    {t('featureManagement.saveChanges', { defaultValue: '保存配置' })}
                  </Button>
                </div>
              </Form.Item>
            </Form>
          </Card>

          {/* 消息发送测试 */}
          <WhapiMessageTester whapiConfig={appConfig?.whapi} />
        </>
      ) : null}

      {/* 支付网关标签页 */}
      {activeTab === 'payment' ? (
        <Card style={{
          background: 'rgba(255, 255, 255, 0.05)',
          borderRadius: 12,
          border: '1px solid rgba(244, 175, 37, 0.6)',
          backdropFilter: 'blur(10px)',
          marginBottom: 16,
        }}>
          <Form
            form={paymentForm}
            layout="vertical"
            onFinish={handleSavePaymentConfig}
          >
            <div style={{ marginBottom: 24 }}>
              <Text style={{ color: '#f8f8f8', fontSize: '16px', fontWeight: 600, display: 'block', marginBottom: 8 }}>
                {t('featureManagement.billplzConfig', { defaultValue: 'Billplz 配置' })}
              </Text>
              <Text style={{ color: '#c0c0c0', fontSize: '14px', display: 'block', marginBottom: 16 }}>
                {t('featureManagement.billplzDescription', { defaultValue: '配置 Billplz 支付网关参数以支持在线支付和自动对账。可在 Billplz API 文档查看详情。' })}
                <a href="https://www.billplz.com/api" target="_blank" rel="noopener noreferrer" style={{ color: '#ffd700', marginLeft: 4 }}>
                  {t('featureManagement.viewDocs', { defaultValue: '查看文档' })}
                </a>
              </Text>
            </div>

            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 24 }}>
              <Form.Item
                label={<span style={{ color: '#f8f8f8', fontSize: '14px', fontWeight: 600 }}>{t('featureManagement.apiKey', { defaultValue: 'API Key' })}</span>}
                name="billplzApiKey"
                rules={[{ required: true, message: t('featureManagement.apiKeyRequired', { defaultValue: '请输入 Billplz API Key' }) }]}
              >
                <Input.Password
                  placeholder={t('featureManagement.apiKeyPlaceholder', { defaultValue: '请输入 Billplz API Key' })}
                  style={{
                    background: 'rgba(255, 255, 255, 0.05)',
                    border: '1px solid rgba(255, 255, 255, 0.1)',
                    color: '#f8f8f8',
                  }}
                />
              </Form.Item>

              <Form.Item
                label={<span style={{ color: '#f8f8f8', fontSize: '14px', fontWeight: 600 }}>{t('featureManagement.xSignatureKey', { defaultValue: 'X-Signature Key' })}</span>}
                name="billplzXSignatureKey"
                rules={[{ required: true, message: t('featureManagement.xSignatureKeyRequired', { defaultValue: '请输入 X-Signature Key' }) }]}
              >
                <Input.Password
                  placeholder={t('featureManagement.xSignatureKeyPlaceholder', { defaultValue: '请输入 X-Signature Key' })}
                  style={{
                    background: 'rgba(255, 255, 255, 0.05)',
                    border: '1px solid rgba(255, 255, 255, 0.1)',
                    color: '#f8f8f8',
                  }}
                />
              </Form.Item>
            </div>

            <Form.Item
              label={<span style={{ color: '#f8f8f8', fontSize: '14px', fontWeight: 600 }}>{t('featureManagement.collectionId', { defaultValue: 'Collection ID' })}</span>}
              name="billplzCollectionId"
              rules={[{ required: true, message: t('featureManagement.collectionIdRequired', { defaultValue: '请输入 Collection ID' }) }]}
            >
              <Input
                placeholder={t('featureManagement.collectionIdPlaceholder', { defaultValue: '请输入 Billplz Collection ID' })}
                style={{
                  background: 'rgba(255, 255, 255, 0.05)',
                  border: '1px solid rgba(255, 255, 255, 0.1)',
                  color: '#f8f8f8',
                }}
              />
            </Form.Item>

            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 24 }}>
              <Form.Item
                label={<span style={{ color: '#f8f8f8', fontSize: '14px', fontWeight: 600 }}>{t('featureManagement.sandboxMode', { defaultValue: '沙盒模式' })}</span>}
                name="billplzIsSandbox"
                valuePropName="checked"
              >
                <Switch
                  checkedChildren={<span style={{ color: '#000' }}>{t('featureManagement.sandbox', { defaultValue: '沙盒' })}</span>}
                  unCheckedChildren={<span style={{ color: '#000' }}>{t('featureManagement.production', { defaultValue: '正式' })}</span>}
                />
              </Form.Item>

              <Form.Item
                label={<span style={{ color: '#f8f8f8', fontSize: '14px', fontWeight: 600 }}>{t('featureManagement.enableBillplz', { defaultValue: '启用 Billplz' })}</span>}
                name="billplzEnabled"
                valuePropName="checked"
              >
                <Switch
                  checkedChildren={<span style={{ color: '#000' }}>{t('featureManagement.enable', { defaultValue: '启用' })}</span>}
                  unCheckedChildren={<span style={{ color: '#000' }}>{t('featureManagement.disable', { defaultValue: '禁用' })}</span>}
                />
              </Form.Item>
            </div>

            <Form.Item>
              <div style={{ display: 'flex', justifyContent: 'flex-end' }}>
                <Button
                  type="primary"
                  icon={<SaveOutlined />}
                  htmlType="submit"
                  loading={savingAppConfig}
                  style={{
                    background: 'linear-gradient(to right,#FDE08D,#C48D3A)',
                    border: 'none',
                    color: '#000',
                  }}
                >
                  {t('featureManagement.saveChanges', { defaultValue: '保存配置' })}
                </Button>
              </div>
            </Form.Item>
          </Form>

          {/* 支付功能测试 */}
          <PaymentTester paymentConfig={appConfig?.payment} />
        </Card>
      ) : null}

      {/* 环境配置标签页 */}
      {activeTab === 'env' ? (
        <Card style={{
          background: 'rgba(255, 255, 255, 0.05)',
          borderRadius: 12,
          border: '1px solid rgba(244, 175, 37, 0.6)',
          backdropFilter: 'blur(10px)',
          marginBottom: 16,
        }}>
          <Alert
            message={t('featureManagement.importantNote')}
            description={t('featureManagement.envConfigNotice')}
            type="warning"
            showIcon
            style={{
              marginBottom: 24,
              background: 'rgba(255, 193, 7, 0.1)',
              border: '1px solid rgba(255, 193, 7, 0.3)',
            }}
          />

          <Form
            form={envForm}
            layout="horizontal"
            labelCol={{ span: 6 }}
            wrapperCol={{ span: 18 }}
            onFinish={(values) => {
              const envContent = generateEnvFile(values);
              setGeneratedEnv(envContent);
            }}
          >
            {/* Firebase 配置 */}
            <div style={{ marginBottom: 24 }}>
              <Text style={{ color: '#f8f8f8', fontSize: '16px', fontWeight: 600, display: 'block', marginBottom: 16 }}>
                Firebase 配置
              </Text>
              <Text style={{ color: '#c0c0c0', fontSize: '12px', display: 'block', marginBottom: 16 }}>
                {t('featureManagement.firebaseSetupDesc')}
              </Text>

              {/* Firebase 配置代码粘贴区域 */}
              <div style={{ marginBottom: 16 }}>
                <Text style={{ color: '#c0c0c0', fontSize: '12px', display: 'block', marginBottom: 8 }}>
                  {t('featureManagement.quickFillHint')}
                </Text>
                <TextArea
                  placeholder="粘贴 Firebase 配置代码，例如：const firebaseConfig = { apiKey: '...', authDomain: '...', ... }"
                  rows={4}
                  value={firebaseConfigCode}
                  onChange={(e) => setFirebaseConfigCode(e.target.value)}
                  style={{
                    background: 'rgba(255, 255, 255, 0.05)',
                    border: '1px solid rgba(255, 255, 255, 0.1)',
                    color: '#f8f8f8',
                    fontFamily: 'monospace',
                    fontSize: '12px',
                    marginBottom: 8,
                  }}
                />
                <div style={{ display: 'flex', justifyContent: 'flex-end' }}>
                  <Button
                    type="primary"
                    onClick={() => {
                      if (firebaseConfigCode.trim()) {
                        handlePasteFirebaseConfig(firebaseConfigCode);
                        setFirebaseConfigCode('');
                      } else {
                        message.warning(t('featureManagement.pasteFirebaseConfigFirst'));
                      }
                    }}
                    style={{
                      background: 'linear-gradient(to right,#FDE08D,#C48D3A)',
                      border: 'none',
                      color: '#000',
                    }}
                  >
                    {t('featureManagement.parseAndFill')}
                  </Button>
                </div>
              </div>

              <Form.Item
                label={<span style={{ color: '#c0c0c0' }}>API Key</span>}
                name="firebaseApiKey"
                rules={[{ required: true, message: t('featureManagement.firebaseApiKeyRequired') }]}
              >
                <Input
                  type={showSecrets.firebaseApiKey ? 'text' : 'password'}
                  placeholder="AIzaSy..."
                  suffix={
                    <Button
                      type="text"
                      icon={showSecrets.firebaseApiKey ? <EyeOutlined style={{ color: '#ffd700' }} /> : <EyeInvisibleOutlined style={{ color: '#ffd700' }} />}
                      onClick={() => setShowSecrets(prev => ({ ...prev, firebaseApiKey: !prev.firebaseApiKey }))}
                      style={{ border: 'none', color: '#ffd700' }}
                    />
                  }
                  style={{
                    background: 'rgba(255, 255, 255, 0.05)',
                    border: '1px solid rgba(255, 255, 255, 0.1)',
                    color: '#f8f8f8',
                  }}
                />
              </Form.Item>

              <Form.Item
                label={<span style={{ color: '#c0c0c0' }}>Auth Domain</span>}
                name="firebaseAuthDomain"
                rules={[{ required: true, message: t('featureManagement.firebaseAuthDomainRequired') }]}
              >
                <Input
                  placeholder="project.firebaseapp.com"
                  style={{
                    background: 'rgba(255, 255, 255, 0.05)',
                    border: '1px solid rgba(255, 255, 255, 0.1)',
                    color: '#f8f8f8',
                  }}
                />
              </Form.Item>

              <Form.Item
                label={<span style={{ color: '#c0c0c0' }}>Project ID</span>}
                name="firebaseProjectId"
                rules={[{ required: true, message: t('featureManagement.firebaseProjectIdRequired') }]}
                extra={
                  <Text style={{ color: '#999', fontSize: '12px' }}>
                    用于部署 Firestore 索引。需要配置 FIREBASE_SERVICE_ACCOUNT 环境变量，并确保 Service Account 具有 'Cloud Datastore Index Admin' 权限。
                  </Text>
                }
              >
                <Input
                  placeholder="your-project-id"
                  style={{
                    background: 'rgba(255, 255, 255, 0.05)',
                    border: '1px solid rgba(255, 255, 255, 0.1)',
                    color: '#f8f8f8',
                  }}
                />
              </Form.Item>

              <Form.Item
                label={<span style={{ color: '#c0c0c0' }}>Storage Bucket</span>}
                name="firebaseStorageBucket"
                rules={[{ required: true, message: t('featureManagement.firebaseStorageBucketRequired') }]}
              >
                <Input
                  placeholder="project.firebasestorage.app"
                  style={{
                    background: 'rgba(255, 255, 255, 0.05)',
                    border: '1px solid rgba(255, 255, 255, 0.1)',
                    color: '#f8f8f8',
                  }}
                />
              </Form.Item>

              <Form.Item
                label={<span style={{ color: '#c0c0c0' }}>Messaging Sender ID</span>}
                name="firebaseMessagingSenderId"
                rules={[{ required: true, message: t('featureManagement.firebaseMessagingSenderIdRequired') }]}
              >
                <Input
                  placeholder="123456789012"
                  style={{
                    background: 'rgba(255, 255, 255, 0.05)',
                    border: '1px solid rgba(255, 255, 255, 0.1)',
                    color: '#f8f8f8',
                  }}
                />
              </Form.Item>

              <Form.Item
                label={<span style={{ color: '#c0c0c0' }}>App ID</span>}
                name="firebaseAppId"
                rules={[{ required: true, message: t('featureManagement.firebaseAppIdRequired') }]}
              >
                <Input
                  placeholder="1:123456789012:web:abc123"
                  style={{
                    background: 'rgba(255, 255, 255, 0.05)',
                    border: '1px solid rgba(255, 255, 255, 0.1)',
                    color: '#f8f8f8',
                  }}
                />
              </Form.Item>

              <Form.Item
                label={<span style={{ color: '#c0c0c0' }}>Measurement ID</span>}
                name="firebaseMeasurementId"
                rules={[{ required: false, message: '请输入 Firebase Measurement ID' }]}
              >
                <Input
                  placeholder="G-XXXXXXXXXX"
                  style={{
                    background: 'rgba(255, 255, 255, 0.05)',
                    border: '1px solid rgba(255, 255, 255, 0.1)',
                    color: '#f8f8f8',
                  }}
                />
              </Form.Item>

              <Form.Item
                label={<span style={{ color: '#c0c0c0' }}>Service Account</span>}
                name="firebaseServiceAccount"
                rules={[{ required: false, message: '请输入 Firebase Service Account JSON' }]}
                extra={
                  <Text style={{ color: '#999', fontSize: '12px' }}>
                    {t('featureManagement.netlifyFunctionsDesc')}
                  </Text>
                }
              >
                <div style={{ position: 'relative' }}>
                  <Input.TextArea
                    placeholder='{"type":"service_account","project_id":"...","private_key_id":"...","private_key":"...",...}'
                    rows={6}
                    style={{
                      background: 'rgba(255, 255, 255, 0.05)',
                      border: '1px solid rgba(255, 255, 255, 0.1)',
                      color: '#f8f8f8',
                      fontFamily: 'monospace',
                      fontSize: '12px',
                      paddingRight: '40px',
                    }}
                  />
                  <Button
                    type="text"
                    icon={showSecrets.firebaseServiceAccount ? <EyeOutlined style={{ color: '#ffd700' }} /> : <EyeInvisibleOutlined style={{ color: '#ffd700' }} />}
                    onClick={() => setShowSecrets(prev => ({ ...prev, firebaseServiceAccount: !prev.firebaseServiceAccount }))}
                    style={{
                      position: 'absolute',
                      right: 8,
                      top: 8,
                      border: 'none',
                      color: '#ffd700',
                      zIndex: 1
                    }}
                  />
                </div>
              </Form.Item>
            </div>

            <Divider style={{ borderColor: 'rgba(244, 175, 37, 0.2)', margin: '24px 0' }} />

            {/* Cloudinary 配置 */}
            <div style={{ marginBottom: 24 }}>
              <Text style={{ color: '#f8f8f8', fontSize: '16px', fontWeight: 600, display: 'block', marginBottom: 16 }}>
                {t('featureManagement.cloudinaryConfig')}
              </Text>
              <Text style={{ color: '#c0c0c0', fontSize: '12px', display: 'block', marginBottom: 16 }}>
                {t('featureManagement.cloudinarySetupDesc')}
              </Text>

              <Form.Item
                label={<span style={{ color: '#c0c0c0' }}>Cloud Name</span>}
                name="cloudinaryCloudName"
                rules={[{ required: true, message: t('featureManagement.cloudinaryCloudNameRequired') }]}
              >
                <Input
                  placeholder="your-cloud-name"
                  style={{
                    background: 'rgba(255, 255, 255, 0.05)',
                    border: '1px solid rgba(255, 255, 255, 0.1)',
                    color: '#f8f8f8',
                  }}
                />
              </Form.Item>

              <Form.Item
                label={<span style={{ color: '#c0c0c0' }}>API Key</span>}
                name="cloudinaryApiKey"
                rules={[{ required: true, message: t('featureManagement.cloudinaryApiKeyRequired') }]}
              >
                <Input
                  type={showSecrets.cloudinaryApiKey ? 'text' : 'password'}
                  placeholder="123456789012345"
                  suffix={
                    <Button
                      type="text"
                      icon={showSecrets.cloudinaryApiKey ? <EyeOutlined style={{ color: '#ffd700' }} /> : <EyeInvisibleOutlined style={{ color: '#ffd700' }} />}
                      onClick={() => setShowSecrets(prev => ({ ...prev, cloudinaryApiKey: !prev.cloudinaryApiKey }))}
                      style={{ border: 'none', color: '#ffd700' }}
                    />
                  }
                  style={{
                    background: 'rgba(255, 255, 255, 0.05)',
                    border: '1px solid rgba(255, 255, 255, 0.1)',
                    color: '#f8f8f8',
                  }}
                />
              </Form.Item>

              <Form.Item
                label={<span style={{ color: '#c0c0c0' }}>API Secret</span>}
                name="cloudinaryApiSecret"
                rules={[{ required: true, message: t('featureManagement.cloudinaryApiSecretRequired') }]}
              >
                <Input
                  type={showSecrets.cloudinaryApiSecret ? 'text' : 'password'}
                  placeholder="your-api-secret"
                  suffix={
                    <Button
                      type="text"
                      icon={showSecrets.cloudinaryApiSecret ? <EyeOutlined style={{ color: '#ffd700' }} /> : <EyeInvisibleOutlined style={{ color: '#ffd700' }} />}
                      onClick={() => setShowSecrets(prev => ({ ...prev, cloudinaryApiSecret: !prev.cloudinaryApiSecret }))}
                      style={{ border: 'none', color: '#ffd700' }}
                    />
                  }
                  style={{
                    background: 'rgba(255, 255, 255, 0.05)',
                    border: '1px solid rgba(255, 255, 255, 0.1)',
                    color: '#f8f8f8',
                  }}
                />
              </Form.Item>

              <Form.Item
                label={<span style={{ color: '#c0c0c0' }}>Upload Preset</span>}
                name="cloudinaryUploadPreset"
                rules={[{ required: true, message: t('featureManagement.cloudinaryUploadPresetRequired') }]}
              >
                <Input
                  placeholder="jep-cigar"
                  style={{
                    background: 'rgba(255, 255, 255, 0.05)',
                    border: '1px solid rgba(255, 255, 255, 0.1)',
                    color: '#f8f8f8',
                  }}
                />
              </Form.Item>

              <Form.Item
                label={<span style={{ color: '#c0c0c0' }}>Base Folder</span>}
                name="cloudinaryBaseFolder"
                rules={[{ required: true, message: t('featureManagement.cloudinaryBaseFolderRequired') }]}
              >
                <Input
                  placeholder="jep-cigar"
                  style={{
                    background: 'rgba(255, 255, 255, 0.05)',
                    border: '1px solid rgba(255, 255, 255, 0.1)',
                    color: '#f8f8f8',
                  }}
                />
              </Form.Item>
            </div>

            <Divider style={{ borderColor: 'rgba(244, 175, 37, 0.2)', margin: '24px 0' }} />

            {/* 应用配置 */}
            <div style={{ marginBottom: 24 }}>
              <Text style={{ color: '#f8f8f8', fontSize: '16px', fontWeight: 600, display: 'block', marginBottom: 16 }}>
                {t('featureManagement.appSettings')}
              </Text>

              <Form.Item
                label={<span style={{ color: '#c0c0c0' }}>App Name</span>}
                name="appName"
                rules={[{ required: true, message: t('featureManagement.appNameRequired') }]}
              >
                <Input
                  placeholder="Cigar Club管理平台"
                  style={{
                    background: 'rgba(255, 255, 255, 0.05)',
                    border: '1px solid rgba(255, 255, 255, 0.1)',
                    color: '#f8f8f8',
                  }}
                />
              </Form.Item>
            </div>

            <Divider style={{ borderColor: 'rgba(244, 175, 37, 0.2)', margin: '24px 0' }} />

            {/* FCM 配置 */}
            <div style={{ marginBottom: 24 }}>
              <Text style={{ color: '#f8f8f8', fontSize: '16px', fontWeight: 600, display: 'block', marginBottom: 16 }}>
                {t('featureManagement.fcmConfig')}
              </Text>
              <Text style={{ color: '#c0c0c0', fontSize: '12px', display: 'block', marginBottom: 16 }}>
                {t('featureManagement.vapidKeyDesc')}
              </Text>

              <Form.Item
                label={<span style={{ color: '#c0c0c0' }}>VAPID Key</span>}
                name="fcmVapidKey"
                rules={[{ required: false, message: '请输入 FCM VAPID Key' }]}
              >
                <Input
                  type={showSecrets.fcmVapidKey ? 'text' : 'password'}
                  placeholder="your_vapid_key_here"
                  suffix={
                    <Button
                      type="text"
                      icon={showSecrets.fcmVapidKey ? <EyeOutlined style={{ color: '#ffd700' }} /> : <EyeInvisibleOutlined style={{ color: '#ffd700' }} />}
                      onClick={() => setShowSecrets(prev => ({ ...prev, fcmVapidKey: !prev.fcmVapidKey }))}
                      style={{ border: 'none', color: '#ffd700' }}
                    />
                  }
                  style={{
                    background: 'rgba(255, 255, 255, 0.05)',
                    border: '1px solid rgba(255, 255, 255, 0.1)',
                    color: '#f8f8f8',
                  }}
                />
              </Form.Item>
            </div>

            <Divider style={{ borderColor: 'rgba(244, 175, 37, 0.2)', margin: '24px 0' }} />

            {/* Gemini 配置 */}
            <div style={{ marginBottom: 24 }}>
              <Text style={{ color: '#f8f8f8', fontSize: '16px', fontWeight: 600, display: 'block', marginBottom: 16 }}>
                {t('featureManagement.geminiApiConfig')}
              </Text>
              <Text style={{ color: '#c0c0c0', fontSize: '12px', display: 'block', marginBottom: 16 }}>
                {t('featureManagement.geminiKeyDesc')}
              </Text>

              <Form.Item
                label={<span style={{ color: '#c0c0c0' }}>API Key</span>}
                name="geminiApiKey"
                rules={[{ required: false, message: '请输入 Gemini API Key' }]}
              >
                <Input
                  type={showSecrets.geminiApiKey ? 'text' : 'password'}
                  placeholder="AIzaSy..."
                  suffix={
                    <Button
                      type="text"
                      icon={showSecrets.geminiApiKey ? <EyeOutlined style={{ color: '#ffd700' }} /> : <EyeInvisibleOutlined style={{ color: '#ffd700' }} />}
                      onClick={() => setShowSecrets(prev => ({ ...prev, geminiApiKey: !prev.geminiApiKey }))}
                      style={{ border: 'none', color: '#ffd700' }}
                    />
                  }
                  style={{
                    background: 'rgba(255, 255, 255, 0.05)',
                    border: '1px solid rgba(255, 255, 255, 0.1)',
                    color: '#f8f8f8',
                  }}
                />
              </Form.Item>
            </div>

            <Divider style={{ borderColor: 'rgba(244, 175, 37, 0.2)', margin: '24px 0' }} />

            {/* Netlify 配置 */}
            <div style={{ marginBottom: 24 }}>
              <Text style={{ color: '#f8f8f8', fontSize: '16px', fontWeight: 600, display: 'block', marginBottom: 16 }}>
                {t('featureManagement.netlifyConfig')}
              </Text>
              <Text style={{ color: '#c0c0c0', fontSize: '12px', display: 'block', marginBottom: 16 }}>
                {t('featureManagement.netlifyDeployDesc')}
              </Text>

              <Form.Item
                label={<span style={{ color: '#c0c0c0' }}>Access Token</span>}
                name="netlifyAccessToken"
                rules={[{ required: false, message: '请输入 Netlify Access Token' }]}
              >
                <Input
                  type={showSecrets.netlifyAccessToken ? 'text' : 'password'}
                  placeholder="your_netlify_access_token"
                  suffix={
                    <Button
                      type="text"
                      icon={showSecrets.netlifyAccessToken ? <EyeOutlined style={{ color: '#ffd700' }} /> : <EyeInvisibleOutlined style={{ color: '#ffd700' }} />}
                      onClick={() => setShowSecrets(prev => ({ ...prev, netlifyAccessToken: !prev.netlifyAccessToken }))}
                      style={{ border: 'none', color: '#ffd700' }}
                    />
                  }
                  style={{
                    background: 'rgba(255, 255, 255, 0.05)',
                    border: '1px solid rgba(255, 255, 255, 0.1)',
                    color: '#f8f8f8',
                  }}
                />
              </Form.Item>

              <Form.Item
                label={<span style={{ color: '#c0c0c0' }}>Site ID</span>}
                name="netlifySiteId"
                rules={[{ required: false, message: '请输入 Netlify Site ID' }]}
              >
                <Input
                  placeholder="your-site-id"
                  style={{
                    background: 'rgba(255, 255, 255, 0.05)',
                    border: '1px solid rgba(255, 255, 255, 0.1)',
                    color: '#f8f8f8',
                  }}
                />
              </Form.Item>
            </div>

            {/* 部署状态显示 */}
            {deployStatus.state !== 'idle' && (
              <div style={{ marginBottom: 24 }}>
                <Alert
                  message={
                    <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                      {deployStatus.state === 'updating' || deployStatus.state === 'deploying' ? (
                        <LoadingOutlined style={{ color: '#1890ff' }} />
                      ) : deployStatus.state === 'success' ? (
                        <CheckCircleOutlined style={{ color: '#52c41a' }} />
                      ) : (
                        <span style={{ color: '#ff4d4f' }}>✕</span>
                      )}
                      <span>{deployStatus.message}</span>
                    </div>
                  }
                  type={
                    deployStatus.state === 'success' ? 'success' :
                      deployStatus.state === 'error' ? 'error' : 'info'
                  }
                  showIcon={false}
                  style={{
                    marginBottom: 16,
                    background: deployStatus.state === 'success' ? 'rgba(82, 196, 26, 0.1)' :
                      deployStatus.state === 'error' ? 'rgba(255, 77, 79, 0.1)' :
                        'rgba(24, 144, 255, 0.1)',
                    border: deployStatus.state === 'success' ? '1px solid rgba(82, 196, 26, 0.3)' :
                      deployStatus.state === 'error' ? '1px solid rgba(255, 77, 79, 0.3)' :
                        '1px solid rgba(24, 144, 255, 0.3)',
                  }}
                  description={
                    deployStatus.deployUrl ? (
                      <div style={{ marginTop: 8 }}>
                        <a
                          href={deployStatus.deployUrl}
                          target="_blank"
                          rel="noopener noreferrer"
                          style={{ color: '#ffd700' }}
                        >
                          {t('featureManagement.viewDeployDetails')}
                        </a>
                      </div>
                    ) : null
                  }
                />
              </div>
            )}

            {/* 生成的配置文件预览 */}
            {generatedEnv && (
              <div style={{ marginBottom: 24 }}>
                <Text style={{ color: '#f8f8f8', fontSize: '16px', fontWeight: 600, display: 'block', marginBottom: 16 }}>
                  {t('featureManagement.generatedConfigFile')}
                </Text>
                <div style={{
                  background: 'rgba(0, 0, 0, 0.3)',
                  border: '1px solid rgba(255, 255, 255, 0.1)',
                  borderRadius: '8px',
                  padding: '16px',
                  maxHeight: '300px',
                  overflow: 'auto',
                }}>
                  <pre style={{
                    color: '#c0c0c0',
                    fontSize: '12px',
                    fontFamily: 'monospace',
                    margin: 0,
                    whiteSpace: 'pre-wrap',
                    wordBreak: 'break-all',
                  }}>
                    {generatedEnv}
                  </pre>
                </div>
              </div>
            )}

            {/* 操作按钮 */}
            <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 12, flexWrap: 'wrap' }}>
              <Button
                icon={<ReloadOutlined />}
                onClick={() => {
                  envForm.resetFields();
                  setGeneratedEnv('');
                  setDeployStatus({ state: 'idle', message: '' });
                }}
                disabled={deploying}
              >
                {t('featureManagement.clearForm')}
              </Button>
              <Button
                icon={<FileTextOutlined />}
                onClick={async () => {
                  try {
                    const values = await envForm.validateFields();
                    const envContent = generateEnvFile(values);
                    setGeneratedEnv(envContent);
                    message.success(t('featureManagement.configGenerated'));
                  } catch (error) {
                    message.error(t('common.fillAllRequired'));
                  }
                }}
                disabled={deploying}
              >
                {t('featureManagement.generateConfigFile')}
              </Button>
              {generatedEnv && (
                <>
                  <Button
                    icon={<CopyOutlined />}
                    onClick={async () => {
                      try {
                        await navigator.clipboard.writeText(generatedEnv);
                        message.success(t('common.copiedToClipboard'));
                      } catch (error) {
                        message.error(t('common.copyFailed'));
                      }
                    }}
                    disabled={deploying}
                  >
                    {t('featureManagement.copyToClipboard')}
                  </Button>
                  <Button
                    type="primary"
                    icon={<DownloadOutlined />}
                    onClick={() => {
                      const blob = new Blob([generatedEnv], { type: 'text/plain' });
                      const url = URL.createObjectURL(blob);
                      const a = document.createElement('a');
                      a.href = url;
                      a.download = '.env';
                      a.click();
                      URL.revokeObjectURL(url);
                      message.success(t('featureManagement.fileDownloaded'));
                    }}
                    disabled={deploying}
                    style={{
                      background: 'linear-gradient(to right,#FDE08D,#C48D3A)',
                      border: 'none',
                    }}
                  >
                    {t('featureManagement.downloadEnv')}
                  </Button>
                </>
              )}
              <Button
                type="primary"
                icon={<RocketOutlined />}
                onClick={handleDeployToNetlify}
                loading={deploying}
                disabled={deploying}
                style={{
                  background: 'linear-gradient(to right,#1890ff,#096dd9)',
                  border: 'none',
                }}
              >
                {deploying ? t('featureManagement.deploying') : t('featureManagement.deployToNetlify')}
              </Button>
              <Button
                type="primary"
                icon={<DatabaseOutlined />}
                onClick={() => setIsIndexModalVisible(true)}
                loading={indexDeploying}
                disabled={indexDeploying}
                style={{
                  background: 'linear-gradient(to right,#52c41a,#389e0d)',
                  border: 'none',
                }}
              >
                {indexDeploying ? t('featureManagement.deploying') : t('featureManagement.deployFirestoreIndexes')}
              </Button>
            </div>

            {/* Firestore 索引部署状态 */}
            {indexDeployStatus.state !== 'idle' && (
              <div style={{ marginTop: 16 }}>
                <Alert
                  message={
                    <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                      {indexDeployStatus.state === 'deploying' ? (
                        <LoadingOutlined style={{ color: '#1890ff' }} />
                      ) : indexDeployStatus.state === 'success' ? (
                        <CheckCircleOutlined style={{ color: '#52c41a' }} />
                      ) : (
                        <span style={{ color: '#ff4d4f' }}>✕</span>
                      )}
                      <span>{indexDeployStatus.message}</span>
                    </div>
                  }
                  type={
                    indexDeployStatus.state === 'success' ? 'success' :
                      indexDeployStatus.state === 'error' ? 'error' : 'info'
                  }
                  showIcon={false}
                  style={{
                    marginBottom: 16,
                    background: indexDeployStatus.state === 'success' ? 'rgba(82, 196, 26, 0.1)' :
                      indexDeployStatus.state === 'error' ? 'rgba(255, 77, 79, 0.1)' :
                        'rgba(24, 144, 255, 0.1)',
                    border: indexDeployStatus.state === 'success' ? '1px solid rgba(82, 196, 26, 0.3)' :
                      indexDeployStatus.state === 'error' ? '1px solid rgba(255, 77, 79, 0.3)' :
                        '1px solid rgba(24, 144, 255, 0.3)',
                  }}
                  description={
                    <div style={{ marginTop: 8 }}>
                      {/* 部署摘要 */}
                      {indexDeployStatus.summary && (
                        <div style={{ marginBottom: 12 }}>
                          <Text style={{ color: '#c0c0c0', fontSize: '12px', display: 'block', marginBottom: 4 }}>
                            {t('featureManagement.deploySummary')}
                          </Text>
                          <div style={{
                            display: 'flex',
                            gap: 16,
                            flexWrap: 'wrap',
                            fontSize: '12px',
                            color: '#c0c0c0'
                          }}>
                            <span>{t('common.total')}: <strong style={{ color: '#f8f8f8' }}>{indexDeployStatus.summary.total}</strong></span>
                            <span style={{ color: '#52c41a' }}>
                              {t('common.success')}: <strong>{indexDeployStatus.summary.succeeded}</strong>
                            </span>
                            {indexDeployStatus.summary.failed > 0 && (
                              <span style={{ color: '#ff4d4f' }}>
                                {t('common.failed')}: <strong>{indexDeployStatus.summary.failed}</strong>
                              </span>
                            )}
                            {indexDeployStatus.summary.skipped > 0 && (
                              <span style={{ color: '#faad14' }}>
                                {t('common.skipped')}: <strong>{indexDeployStatus.summary.skipped}</strong>
                              </span>
                            )}
                          </div>
                        </div>
                      )}

                      {/* 详细结果 */}
                      {indexDeployStatus.results && indexDeployStatus.results.length > 0 && (
                        <div style={{ marginBottom: 12 }}>
                          <Text style={{ color: '#c0c0c0', fontSize: '12px', display: 'block', marginBottom: 8 }}>
                            {t('featureManagement.deployDetailedResults')}
                          </Text>
                          <div style={{
                            maxHeight: '200px',
                            overflowY: 'auto',
                            background: 'rgba(0, 0, 0, 0.2)',
                            padding: '8px',
                            borderRadius: '4px',
                            fontSize: '11px'
                          }}>
                            {indexDeployStatus.results.map((result, idx) => (
                              <div
                                key={idx}
                                style={{
                                  marginBottom: 4,
                                  padding: '4px 8px',
                                  borderRadius: '4px',
                                  background: result.success
                                    ? 'rgba(82, 196, 26, 0.1)'
                                    : 'rgba(255, 77, 79, 0.1)',
                                  border: `1px solid ${result.success ? 'rgba(82, 196, 26, 0.3)' : 'rgba(255, 77, 79, 0.3)'}`
                                }}
                              >
                                <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                                  {result.success ? (
                                    <CheckCircleOutlined style={{ color: '#52c41a', fontSize: '12px' }} />
                                  ) : (
                                    <span style={{ color: '#ff4d4f' }}>✕</span>
                                  )}
                                  <span style={{ color: '#f8f8f8', fontWeight: 500 }}>
                                    {result.index.collectionGroup}
                                  </span>
                                  <span style={{ color: '#c0c0c0' }}>
                                    ({result.index.fields.map((f: any) => `${f.fieldPath}(${f.order})`).join(', ')})
                                  </span>
                                  <span style={{
                                    color: result.success ? '#52c41a' : '#ff4d4f',
                                    marginLeft: 'auto',
                                    fontSize: '10px'
                                  }}>
                                    {result.message}
                                  </span>
                                </div>
                                {result.error && (
                                  <div style={{
                                    color: '#ff4d4f',
                                    fontSize: '10px',
                                    marginTop: 4,
                                    marginLeft: 20
                                  }}>
                                    错误: {result.error}
                                  </div>
                                )}
                              </div>
                            ))}
                          </div>
                        </div>
                      )}

                      {/* Firebase Console 链接 */}
                      {indexDeployStatus.consoleUrl && (
                        <div>
                          <a
                            href={indexDeployStatus.consoleUrl}
                            target="_blank"
                            rel="noopener noreferrer"
                            style={{ color: '#ffd700', fontSize: '12px' }}
                          >
                            {t('featureManagement.viewFirebaseConsole')}
                          </a>
                        </div>
                      )}

                      {/* 备用链接（如果没有 consoleUrl） */}
                      {indexDeployStatus.links && indexDeployStatus.links.length > 0 && !indexDeployStatus.consoleUrl && (
                        <div style={{ marginTop: 8 }}>
                          <Text style={{ color: '#c0c0c0', fontSize: '12px', display: 'block', marginBottom: 8 }}>
                            {t('featureManagement.createIndexViaLinks')}
                          </Text>
                          {indexDeployStatus.links.map((link, idx) => (
                            <div key={idx} style={{ marginTop: 4 }}>
                              <a
                                href={link}
                                target="_blank"
                                rel="noopener noreferrer"
                                style={{ color: '#ffd700' }}
                              >
                                {link}
                              </a>
                            </div>
                          ))}
                        </div>
                      )}
                    </div>
                  }
                />
              </div>
            )}

            {/* 部署 Firestore 索引预览 Modal */}
            <Modal
              title={t('featureManagement.firestoreIndexPreview')}
              open={isIndexModalVisible}
              onCancel={() => setIsIndexModalVisible(false)}
              onOk={() => {
                setIsIndexModalVisible(false);
                handleDeployFirestoreIndexes();
              }}
              okText={t('featureManagement.confirmDeploy')}
              cancelText={t('common.cancel')}
              width={800}
            >
              <Alert
                message={t('featureManagement.firestoreIndexDeployNotice')}
                type="info" 
                showIcon 
                style={{ marginBottom: 16 }} 
              />
              <Table 
                dataSource={FIRESTORE_INDEXES_PREVIEW} 
                pagination={false}
                size="small"
                rowKey={(record, idx) => String(idx)}
                columns={[
                  {
                    title: 'Collection Group',
                    dataIndex: 'collectionGroup',
                    key: 'collectionGroup',
                    width: 200,
                  },
                  {
                    title: 'Fields & Order',
                    dataIndex: 'fields',
                    key: 'fields',
                  }
                ]}
              />
            </Modal>
          </Form>
        </Card>
      ) : null}

      {/* 雪茄数据库标签页：直接显示 CigarDatabase 组件 */}
      {activeTab === 'cigar-database' ? (
        <CigarDatabase />
      ) : null}

      {activeTab !== 'app' && activeTab !== 'whapi' && activeTab !== 'env' && activeTab !== 'cigar-database' && (
        <>
          <Card style={{
            background: 'rgba(255, 255, 255, 0.05)',
            borderRadius: 12,
            border: '1px solid rgba(244, 175, 37, 0.6)',
            backdropFilter: 'blur(10px)'
          }}>
            {filteredFeatures.length === 0 ? (
              <div style={{ textAlign: 'center', padding: '40px', color: '#999' }}>
                {t('featureManagement.noResults', { defaultValue: '没有找到匹配的功能' })}
              </div>
            ) : (
              <Space direction="vertical" size="middle" style={{ width: '100%' }}>
                {filteredFeatures.map(feature => {
                  const isVisible = localFeatures[feature.key] ?? feature.defaultVisible;

                  return (
                    <div
                      key={feature.key}
                      style={{
                        padding: '16px',
                        background: 'rgba(255, 255, 255, 0.03)',
                        borderRadius: 8,
                        border: '1px solid rgba(255, 255, 255, 0.1)',
                      }}
                    >
                      <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
                        <Checkbox
                          checked={isVisible}
                          onChange={(e) => handleToggleFeature(feature.key, e.target.checked)}
                          style={{
                            color: isVisible ? '#ffd700' : '#999',
                          }}
                        />
                        <div style={{ flex: 1 }}>
                          <div style={{
                            color: '#f8f8f8',
                            fontSize: '16px',
                            fontWeight: 600,
                            marginBottom: '4px',
                          }}>
                            {getFeatureName(feature)}
                          </div>
                          <div style={{
                            color: '#c0c0c0',
                            fontSize: '13px',
                            marginBottom: '4px',
                          }}>
                            {getFeatureDescription(feature)}
                          </div>
                          <div style={{
                            color: '#999',
                            fontSize: '12px',
                            fontFamily: 'monospace',
                          }}>
                            {feature.route}
                          </div>
                          {/* AI识茄功能的存储数据开关 */}
                          {feature.key === 'ai-cigar' && activeTab === 'frontend' && (
                            <div style={{ marginTop: '8px', paddingTop: '8px', borderTop: '1px solid rgba(255, 255, 255, 0.1)' }}>
                              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                                <Text style={{ color: '#c0c0c0', fontSize: '13px' }}>
                                  {t('featureManagement.enableAiDataStorage')}
                                </Text>
                                <Switch
                                  checked={aiCigarStorageEnabled}
                                  onChange={async (checked) => {
                                    const previousValue = aiCigarStorageEnabled;
                                    setAiCigarStorageEnabled(checked);
                                    // 立即保存配置
                                    if (user?.id) {
                                      try {
                                        const result = await updateAppConfig(
                                          {
                                            aiCigar: {
                                              enableDataStorage: checked,
                                              enableImageSearch: aiCigarImageSearchEnabled,
                                              imageSearchOrder: aiCigarImageSearchOrder,
                                            },
                                          },
                                          user.id
                                        );
                                        if (result.success) {
                                          message.success(t('common.savedSuccess'));
                                          // 直接更新本地 appConfig 状态，不重新加载避免状态回退
                                          if (appConfig) {
                                            setAppConfig({
                                              ...appConfig,
                                              aiCigar: {
                                                ...appConfig.aiCigar,
                                                enableDataStorage: checked,
                                                enableImageSearch: aiCigarImageSearchEnabled,
                                                imageSearchOrder: aiCigarImageSearchOrder,
                                              },
                                            });
                                          }
                                        } else {
                                          message.error(result.error || t('common.saveFailed'));
                                          setAiCigarStorageEnabled(previousValue); // 恢复原值
                                        }
                                      } catch (error) {
                                        message.error(t('common.saveFailed'));
                                        setAiCigarStorageEnabled(previousValue); // 恢复原值
                                      }
                                    } else {
                                      // 如果没有用户ID，恢复原值
                                      setAiCigarStorageEnabled(previousValue);
                                    }
                                  }}
                                  checkedChildren={t('featureManagement.enable')}
                                  unCheckedChildren={t('featureManagement.disable')}
                                  size="small"
                                />
                              </div>
                              <Text style={{ color: '#999', fontSize: '12px', display: 'block', marginTop: '4px' }}>
                                {t('featureManagement.aiDataStorageDesc')}
                              </Text>
                            </div>
                          )}
                          {/* AI识茄功能的图片URL搜索开关 */}
                          {feature.key === 'ai-cigar' && activeTab === 'frontend' && (
                            <div style={{ marginTop: '8px', paddingTop: '8px', borderTop: '1px solid rgba(255, 255, 255, 0.1)' }}>
                              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                                <Text style={{ color: '#c0c0c0', fontSize: '13px' }}>
                                  {t('featureManagement.enableAiImageSearch')}
                                </Text>
                                <Switch
                                  checked={aiCigarImageSearchEnabled}
                                  onChange={async (checked) => {
                                    const previousValue = aiCigarImageSearchEnabled;
                                    setAiCigarImageSearchEnabled(checked);
                                    // 立即保存配置
                                    if (user?.id) {
                                      try {
                                        const result = await updateAppConfig(
                                          {
                                            aiCigar: {
                                              enableDataStorage: aiCigarStorageEnabled,
                                              enableImageSearch: checked,
                                              imageSearchOrder: aiCigarImageSearchOrder,
                                            },
                                          },
                                          user.id
                                        );
                                        if (result.success) {
                                          message.success(t('common.savedSuccess'));
                                          // 直接更新本地 appConfig 状态，不重新加载避免状态回退
                                          if (appConfig) {
                                            setAppConfig({
                                              ...appConfig,
                                              aiCigar: {
                                                ...appConfig.aiCigar,
                                                enableDataStorage: aiCigarStorageEnabled,
                                                enableImageSearch: checked,
                                                imageSearchOrder: aiCigarImageSearchOrder,
                                              },
                                            });
                                          }
                                        } else {
                                          message.error(result.error || t('common.saveFailed'));
                                          setAiCigarImageSearchEnabled(previousValue);
                                        }
                                      } catch (error) {
                                        message.error(t('common.saveFailed'));
                                        setAiCigarImageSearchEnabled(previousValue);
                                      }
                                    } else {
                                      setAiCigarImageSearchEnabled(previousValue);
                                    }
                                  }}
                                  checkedChildren={t('featureManagement.enable')}
                                  unCheckedChildren={t('featureManagement.disable')}
                                  size="small"
                                />
                              </div>
                              <Text style={{ color: '#999', fontSize: '12px', display: 'block', marginTop: '4px' }}>
                                {t('featureManagement.aiImageSearchDesc')}
                              </Text>

                              {/* 搜索引擎顺序选择器（仅在启用图片搜索时显示） */}
                              {aiCigarImageSearchEnabled && (
                                <div style={{ marginTop: '8px' }}>
                                  <Text style={{ color: '#c0c0c0', fontSize: '13px', display: 'block', marginBottom: '4px' }}>
                                    {t('featureManagement.imageSearchOrder')}
                                  </Text>
                                  <Select
                                    value={aiCigarImageSearchOrder}
                                    onChange={async (value: 'google-first' | 'gemini-first') => {
                                      const previousValue = aiCigarImageSearchOrder;
                                      setAiCigarImageSearchOrder(value);

                                      // 立即保存配置
                                      if (user?.id) {
                                        try {
                                          const result = await updateAppConfig(
                                            {
                                              aiCigar: {
                                                enableDataStorage: aiCigarStorageEnabled,
                                                enableImageSearch: aiCigarImageSearchEnabled,
                                                imageSearchOrder: value,
                                              },
                                            },
                                            user.id
                                          );
                                          if (result.success) {
                                            message.success(t('common.savedSuccess'));
                                            // 直接更新本地 appConfig 状态
                                            if (appConfig) {
                                              setAppConfig({
                                                ...appConfig,
                                                aiCigar: {
                                                  ...appConfig.aiCigar,
                                                  enableDataStorage: aiCigarStorageEnabled,
                                                  enableImageSearch: aiCigarImageSearchEnabled,
                                                  imageSearchOrder: value,
                                                },
                                              });
                                            }
                                          } else {
                                            message.error(result.error || t('common.saveFailed'));
                                            setAiCigarImageSearchOrder(previousValue);
                                          }
                                        } catch (error) {
                                          message.error(t('common.saveFailed'));
                                          setAiCigarImageSearchOrder(previousValue);
                                        }
                                      } else {
                                        setAiCigarImageSearchOrder(previousValue);
                                      }
                                    }}
                                    style={{ width: '100%' }}
                                    size="small"
                                  >
                                    <Select.Option value="google-first">
                                      <span>{t('featureManagement.googleFirstOption')}</span>
                                    </Select.Option>
                                    <Select.Option value="gemini-first">
                                      <span>{t('featureManagement.geminiFirstOption')}</span>
                                    </Select.Option>
                                  </Select>
                                  <Text style={{ color: '#999', fontSize: '11px', display: 'block', marginTop: '4px' }}>
                                    {aiCigarImageSearchOrder === 'google-first'
                                      ? t('featureManagement.googleFirstDesc')
                                      : t('featureManagement.geminiFirstDesc')}
                                  </Text>
                                </div>
                              )}
                            </div>
                          )}
                        </div>
                        <Space>
                          <Button
                            type={isVisible ? 'primary' : 'default'}
                            icon={isVisible ? <EyeOutlined /> : <EyeInvisibleOutlined />}
                            onClick={() => handleToggleFeature(feature.key, !isVisible)}
                            size="small"
                            style={{
                              background: isVisible ? 'linear-gradient(to right,#FDE08D,#C48D3A)' : undefined,
                              borderColor: isVisible ? undefined : '#444',
                            }}
                          >
                            {isVisible
                              ? t('featureManagement.visible', { defaultValue: '显示' })
                              : t('featureManagement.hidden', { defaultValue: '隐藏' })}
                          </Button>
                        </Space>
                      </div>
                    </div>
                  );
                })}
              </Space>
            )}
          </Card>

          {/* 操作按钮 */}
          <div style={{ marginTop: 24, display: 'flex', justifyContent: 'flex-end', gap: 12 }}>
            <Button
              icon={<ReloadOutlined />}
              onClick={handleReset}
              disabled={saving}
            >
              {t('featureManagement.resetToDefault', { defaultValue: '重置为默认' })}
            </Button>
            <Button
              type="primary"
              icon={<SaveOutlined />}
              onClick={handleSave}
              loading={saving}
              style={{
                background: 'linear-gradient(to right,#FDE08D,#C48D3A)',
                border: 'none',
              }}
            >
              {t('featureManagement.saveChanges', { defaultValue: '保存更改' })}
            </Button>
          </div>
        </>
      )}
    </div>
  );
};

export default FeatureManagement;
