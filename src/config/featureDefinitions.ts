/**
 * 功能定义配置
 * 定义系统中所有可管理的功能及其属性
 */
import type { FeatureVisibilityConfig } from '../types';

export interface FeatureDefinition {
  key: string;
  name: string;
  nameEn: string;
  description: string;
  descriptionEn: string;
  route: string;
  routeMatch?: boolean;
  category: 'frontend' | 'admin' | 'cigar-database' | 'tools';
  icon: string;
  defaultVisible: boolean;
}

// 功能定义列表
export const FEATURE_DEFINITIONS: FeatureDefinition[] = [
  // 前端功能
  {
    key: 'guest-page',
    name: '访客页面',
    nameEn: 'Guest Page',
    description: '未登录用户看到的品牌访客页面；隐藏时仅显示登录弹窗',
    descriptionEn: 'Public brand page for signed-out visitors; when hidden, only the login modal is shown',
    route: '/',
    routeMatch: false,
    category: 'frontend',
    icon: 'GlobalOutlined',
    defaultVisible: true,
  },
  {
    key: 'home',
    name: '首页',
    nameEn: 'Home',
    description: '系统首页，展示主要内容和功能入口',
    descriptionEn: 'System homepage, displaying main content and feature entries',
    route: '/',
    category: 'frontend',
    icon: 'HomeOutlined',
    defaultVisible: true,
  },
  {
    key: 'events',
    name: '活动',
    nameEn: 'Events',
    description: '查看和参与各类活动',
    descriptionEn: 'View and participate in various events',
    route: '/events',
    category: 'frontend',
    icon: 'CalendarOutlined',
    defaultVisible: true,
  },
  {
    key: 'shop',
    name: '商城',
    nameEn: 'Shop',
    description: '浏览和购买雪茄产品',
    descriptionEn: 'Browse and purchase cigar products',
    route: '/shop',
    category: 'frontend',
    icon: 'ShoppingOutlined',
    defaultVisible: true,
  },
  {
    key: 'profile',
    name: '个人中心',
    nameEn: 'Profile',
    description: '查看和管理个人信息',
    descriptionEn: 'View and manage personal information',
    route: '/profile',
    category: 'frontend',
    icon: 'UserOutlined',
    defaultVisible: true,
  },
  {
    key: 'ai-cigar',
    name: 'AI识茄',
    nameEn: 'AI Cigar Recognition',
    description: '使用AI识别雪茄信息',
    descriptionEn: 'Use AI to recognize cigar information',
    route: '/scanner',
    category: 'frontend',
    icon: 'EyeOutlined',
    defaultVisible: true,
  },
  {
    key: 'ai-cigar-history',
    name: 'AI识茄历史',
    nameEn: 'AI Cigar History',
    description: '查看AI识茄历史记录',
    descriptionEn: 'View AI cigar recognition history',
    route: '/ai-cigar-history',
    category: 'frontend',
    icon: 'DatabaseOutlined',
    defaultVisible: true,
  },
  {
    key: 'rooms-booking',
    name: '房间预订',
    nameEn: 'Rooms Booking',
    description: '浏览和预订会所房间/包厢',
    descriptionEn: 'Browse and book lounge rooms',
    route: '/rooms',
    category: 'frontend',
    icon: 'HomeOutlined',
    defaultVisible: true,
  },
  // 管理后台功能
  {
    key: 'dashboard',
    name: '仪表板',
    nameEn: 'Dashboard',
    description: '管理后台首页，展示系统概览',
    descriptionEn: 'Admin dashboard homepage, displaying system overview',
    route: '/admin',
    category: 'admin',
    icon: 'DashboardOutlined',
    defaultVisible: true,
  },
  {
    key: 'users',
    name: '用户管理',
    nameEn: 'User Management',
    description: '管理系统用户和权限',
    descriptionEn: 'Manage system users and permissions',
    route: '/admin/users',
    category: 'admin',
    icon: 'TeamOutlined',
    defaultVisible: true,
  },
  {
    key: 'events-admin',
    name: '活动管理',
    nameEn: 'Event Management',
    description: '创建和管理活动',
    descriptionEn: 'Create and manage events',
    route: '/admin/events',
    category: 'admin',
    icon: 'CalendarOutlined',
    defaultVisible: true,
  },
  {
    key: 'orders',
    name: '订单管理',
    nameEn: 'Order Management',
    description: '查看和处理订单',
    descriptionEn: 'View and process orders',
    route: '/admin/orders',
    category: 'admin',
    icon: 'ShoppingCartOutlined',
    defaultVisible: true,
  },
  {
    key: 'inventory',
    name: '库存管理',
    nameEn: 'Inventory Management',
    description: '管理产品库存',
    descriptionEn: 'Manage product inventory',
    route: '/admin/inventory',
    category: 'admin',
    icon: 'DatabaseOutlined',
    defaultVisible: true,
  },
  {
    key: 'finance',
    name: '财务管理',
    nameEn: 'Finance Management',
    description: '查看财务数据和报表',
    descriptionEn: 'View financial data and reports',
    route: '/admin/finance',
    category: 'admin',
    icon: 'DollarOutlined',
    defaultVisible: true,
  },
  {
    key: 'reports',
    name: '报表导出',
    nameEn: 'Report Export',
    description: '导出系统各类业务报表',
    descriptionEn: 'Export various business reports of the system',
    route: '/admin/reports',
    category: 'admin',
    icon: 'FileTextOutlined',
    defaultVisible: true,
  },
  {
    key: 'points-config',
    name: '积分配置',
    nameEn: 'Points Configuration',
    description: '配置积分规则和记录',
    descriptionEn: 'Configure points rules and records',
    route: '/admin/points-config',
    category: 'admin',
    icon: 'TrophyOutlined',
    defaultVisible: true,
  },
  {
    key: 'visit-sessions',
    name: '驻店记录',
    nameEn: 'Visit Sessions',
    description: '管理用户驻店记录',
    descriptionEn: 'Manage user visit session records',
    route: '/admin/visit-sessions',
    category: 'admin',
    icon: 'ClockCircleOutlined',
    defaultVisible: true,
  },
  {
    key: 'performance',
    name: '性能监控',
    nameEn: 'Performance Monitor',
    description: '监控系统性能指标',
    descriptionEn: 'Monitor system performance metrics',
    route: '/developer/performance',
    category: 'tools',
    icon: 'ThunderboltOutlined',
    defaultVisible: true,
  },
  // 雪茄数据库管理
  {
    key: 'cigar-database',
    name: '雪茄数据库',
    nameEn: 'Cigar Database',
    description: '管理雪茄品牌和产品信息',
    descriptionEn: 'Manage cigar brands and product information',
    route: '/developer/cigar-database',
    category: 'cigar-database',
    icon: 'DatabaseOutlined',
    defaultVisible: true,
  },
  // 工具功能
  {
    key: 'orphaned-users',
    name: '孤立用户清理',
    nameEn: 'Orphaned User Cleanup',
    description: '清理系统中的孤立用户数据',
    descriptionEn: 'Clean up orphaned user data in the system',
    route: '/developer/orphaned-users',
    category: 'tools',
    icon: 'DeleteOutlined',
    defaultVisible: true,
  },
  {
    key: 'test-data-generator',
    name: '测试数据生成器',
    nameEn: 'Test Data Generator',
    description: '生成测试数据用于开发和测试',
    descriptionEn: 'Generate test data for development and testing',
    route: '/developer/test-data-generator',
    category: 'tools',
    icon: 'SyncOutlined',
    defaultVisible: true,
  },
  {
    key: 'gemini-tester',
    name: 'Gemini 模型测试器',
    nameEn: 'Gemini Model Tester',
    description: '测试和比较 Gemini AI 模型性能',
    descriptionEn: 'Test and compare Gemini AI model performance',
    route: '/developer/gemini-tester',
    category: 'tools',
    icon: 'ExperimentOutlined',
    defaultVisible: true,
  },
  {
    key: 'cloudinary-test',
    name: 'Cloudinary 测试',
    nameEn: 'Cloudinary Test',
    description: '测试 Cloudinary 图片上传和管理功能',
    descriptionEn: 'Test Cloudinary image upload and management features',
    route: '/developer/cloudinary-test',
    category: 'tools',
    icon: 'CloudUploadOutlined',
    defaultVisible: true,
  },
  {
    key: 'debug-orders',
    name: '订单调试',
    nameEn: 'Order Debug',
    description: '调试订单相关问题',
    descriptionEn: 'Debug order-related issues',
    route: '/developer/debug-orders',
    category: 'tools',
    icon: 'BugOutlined',
    defaultVisible: true,
  },
];

// 根据路由获取功能键
export const getFeatureKeyByRoute = (route: string): string | null => {
  const feature = FEATURE_DEFINITIONS.find(f => f.routeMatch !== false && f.route === route);
  return feature?.key || null;
};

// 根据功能键获取功能定义
export const getFeatureByKey = (key: string): FeatureDefinition | undefined => {
  return FEATURE_DEFINITIONS.find(f => f.key === key);
};

// 获取默认功能可见性配置
export const getDefaultFeatureVisibilityConfig = (): Omit<FeatureVisibilityConfig, 'id' | 'updatedAt' | 'updatedBy'> => {
  const features: FeatureVisibilityConfig['features'] = {};
  
  FEATURE_DEFINITIONS.forEach(feature => {
    features[feature.key] = {
      visible: feature.defaultVisible,
      description: feature.description,
      category: feature.category,
      route: feature.route,
      icon: feature.icon,
      updatedAt: new Date(),
      updatedBy: '',
    };
  });
  
  return {
    features,
  };
};

