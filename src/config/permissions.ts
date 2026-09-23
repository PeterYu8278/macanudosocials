// 权限配置
import type { UserRole, Permission } from '../types';

// 角色权限配置
export const ROLE_PERMISSIONS: Record<UserRole, Permission> = {
  guest: {
    canViewEvents: true,
    canRegisterEvent: true,
    canPurchase: false,
    canViewProfile: false,
    canCreateEvent: false,
    canManageInventory: false,
    canManageUsers: false,
    canManageOrders: false,
    canViewFinance: false,
    canSwitchToAdmin: false,
  },
  member: {
    canViewEvents: true,
    canRegisterEvent: true,
    canPurchase: true,
    canViewProfile: true,
    canCreateEvent: false,
    canManageInventory: false,
    canManageUsers: false,
    canManageOrders: false,
    canViewFinance: false,
    canSwitchToAdmin: false,
  },
  vip: {
    canViewEvents: true,
    canRegisterEvent: true,
    canPurchase: true,
    canViewProfile: true,
    canCreateEvent: false,
    canManageInventory: false,
    canManageUsers: false,
    canManageOrders: false,
    canViewFinance: false,
    canSwitchToAdmin: false,
  },
  storeAdmin: {
    canViewEvents: true,
    canRegisterEvent: true,
    canPurchase: true,
    canViewProfile: true,
    canCreateEvent: true,
    canManageInventory: true,
    canManageUsers: true,
    canManageOrders: true,
    canViewFinance: false,
    canSwitchToAdmin: true,
    canManageFeatures: false,
  },
  admin: {
    canViewEvents: true,
    canRegisterEvent: true,
    canPurchase: true,
    canViewProfile: true,
    canCreateEvent: true,
    canManageInventory: true,
    canManageUsers: true,
    canManageOrders: true,
    canViewFinance: false, // 门店管理员禁止查看财务
    canSwitchToAdmin: true,
    canManageFeatures: false,
  },
  superAdmin: {
    canViewEvents: true,
    canRegisterEvent: true,
    canPurchase: true,
    canViewProfile: true,
    canCreateEvent: true,
    canManageInventory: true,
    canManageUsers: true,
    canManageOrders: true,
    canViewFinance: true,
    canSwitchToAdmin: true,
    canManageFeatures: false,
  },
  developer: {
    canViewEvents: true,
    canRegisterEvent: true,
    canPurchase: true,
    canViewProfile: true,
    canCreateEvent: true,
    canManageInventory: true,
    canManageUsers: true,
    canManageOrders: true,
    canViewFinance: true,
    canSwitchToAdmin: true,
    canManageFeatures: true, // 开发者独有的权限
  }
};

// 路由权限配置
export const ROUTE_PERMISSIONS = {
  '/': ['guest', 'member', 'vip', 'storeAdmin', 'admin', 'superAdmin', 'developer'],
  '/events': ['guest', 'member', 'vip', 'storeAdmin', 'admin', 'superAdmin', 'developer'],
  '/shop': ['guest', 'member', 'vip', 'storeAdmin', 'admin', 'superAdmin', 'developer'],
  '/profile': ['guest', 'member', 'vip', 'storeAdmin', 'admin', 'superAdmin', 'developer'],
  '/ai-cigar-history': ['member', 'vip', 'storeAdmin', 'admin', 'superAdmin', 'developer'], // AI识茄历史记录页面权限
  '/reload': ['guest', 'member', 'vip', 'storeAdmin', 'admin', 'superAdmin', 'developer'], // 充值页面权限
  '/brand': ['member', 'vip', 'storeAdmin', 'admin', 'superAdmin', 'developer'], // brand list
  '/admin': ['storeAdmin', 'admin', 'superAdmin', 'developer'],
  '/admin/users': ['storeAdmin', 'admin', 'superAdmin', 'developer'],
  '/admin/inventory': ['storeAdmin', 'admin', 'superAdmin', 'developer'],
  '/admin/events': ['storeAdmin', 'admin', 'superAdmin', 'developer'],
  '/admin/orders': ['storeAdmin', 'admin', 'superAdmin', 'developer'],
  '/admin/visit-sessions': ['storeAdmin', 'admin', 'superAdmin', 'developer'],
  '/admin/finance': ['superAdmin', 'developer'], // 财务仅限超级管理员和开发者
  '/admin/points-config': ['storeAdmin', 'admin', 'superAdmin', 'developer'], // 积分配置支持管理员验证充值
  '/admin/notifications': ['admin', 'superAdmin', 'developer'],
  
  // Developer 专属路由
  '/developer/feature-management': ['developer'],
  '/developer/invoice-template': ['superAdmin', 'developer'],
  '/developer/cigar-database': ['developer'],
  '/developer/performance': ['developer'],
  '/developer/gemini-tester': ['developer'],
  '/developer/cloudinary-test': ['developer'],
  '/developer/orphaned-users': ['developer'],
  '/developer/debug-orders': ['developer'],
  '/developer/test-data-generator': ['developer'],
  '/developer/subscription': ['superAdmin', 'developer'], // 超级管理员可管理订阅
};

// 权限检查函数
export const hasPermission = (userRole: UserRole, permission: keyof Permission): boolean => {
  return ROLE_PERMISSIONS[userRole]?.[permission] ?? false;
};

// 路由权限检查函数
export const canAccessRoute = (userRole: UserRole, path: string): boolean => {
  // 直接匹配
  const allowedRoles = ROUTE_PERMISSIONS[path as keyof typeof ROUTE_PERMISSIONS];
  if (allowedRoles) {
    return allowedRoles.includes(userRole);
  }
  
  // 动态路由匹配
  if (path.startsWith('/brand/')) {
    return ['member', 'vip', 'admin', 'superAdmin', 'developer'].includes(userRole);
  }
  
  if (path.startsWith('/admin/')) {
    // 检查子路径权限
    const subPaths = Object.keys(ROUTE_PERMISSIONS).filter(p => p.startsWith('/admin/'));
    const matchedPath = subPaths.find(p => path.startsWith(p));
    if (matchedPath) {
      return ROUTE_PERMISSIONS[matchedPath as keyof typeof ROUTE_PERMISSIONS].includes(userRole);
    }
    return ['admin', 'superAdmin', 'developer'].includes(userRole);
  }
  
  // 默认拒绝访问
  return false;
};
