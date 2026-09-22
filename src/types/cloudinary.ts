// Cloudinary 相关类型定义
export interface CloudinaryFolder {
  name: string;
  description: string;
  maxSize: number;
  formats: string[];
  dimensions: string;
  usage: string;
}

export const CLOUDINARY_FOLDERS: Record<string, CloudinaryFolder> = {
  brands: {
    name: 'brands',
    description: '品牌Logo图片',
    maxSize: 2 * 1024 * 1024, // 2MB
    formats: ['jpg', 'jpeg', 'png', 'webp'],
    dimensions: '120x120',
    usage: '品牌管理表单'
  },
  products: {
    name: 'products',
    description: '产品图片',
    maxSize: 5 * 1024 * 1024, // 5MB
    formats: ['jpg', 'jpeg', 'png', 'webp'],
    dimensions: '400x400',
    usage: '库存管理表单'
  },
  events: {
    name: 'events',
    description: '活动封面图片',
    maxSize: 5 * 1024 * 1024, // 5MB
    formats: ['jpg', 'jpeg', 'png', 'webp'],
    dimensions: '800x600',
    usage: '活动管理表单'
  },
  announcements: {
    name: 'announcements',
    description: '公告封面图片',
    maxSize: 5 * 1024 * 1024,
    formats: ['jpg', 'jpeg', 'png', 'webp'],
    dimensions: '1200x675',
    usage: '公告管理表单'
  },
  users: {
    name: 'users',
    description: '用户头像',
    maxSize: 2 * 1024 * 1024, // 2MB
    formats: ['jpg', 'jpeg', 'png', 'webp'],
    dimensions: '200x200',
    usage: '用户档案页面'
  },
  temp: {
    name: 'temp',
    description: '临时文件',
    maxSize: 10 * 1024 * 1024, // 10MB
    formats: ['jpg', 'jpeg', 'png', 'webp'],
    dimensions: '任意',
    usage: '临时存储'
  },
  'app-config': {
    name: 'app-config',
    description: '应用配置图片（Logo等）',
    maxSize: 2 * 1024 * 1024, // 2MB
    formats: ['jpg', 'jpeg', 'png', 'webp'],
    dimensions: '200x200',
    usage: '应用配置管理'
  }
} as const;

export type CloudinaryFolderName = keyof typeof CLOUDINARY_FOLDERS;

// 获取文件夹配置的辅助函数
export function getFolderConfig(folderName: CloudinaryFolderName): CloudinaryFolder {
  return CLOUDINARY_FOLDERS[folderName];
}

// 验证文件是否符合文件夹要求
export function validateFileForFolder(
  file: File, 
  folderName: CloudinaryFolderName
): { valid: boolean; error?: string } {
  const config = getFolderConfig(folderName);
  
  // 检查文件大小
  if (file.size > config.maxSize) {
    return {
      valid: false,
      error: `文件大小不能超过 ${config.maxSize / 1024 / 1024}MB`
    };
  }
  
  // 检查文件格式
  const fileExtension = file.name.split('.').pop()?.toLowerCase();
  if (!fileExtension || !config.formats.includes(fileExtension)) {
    return {
      valid: false,
      error: `不支持的文件格式。支持的格式: ${config.formats.join(', ')}`
    };
  }
  
  return { valid: true };
}
