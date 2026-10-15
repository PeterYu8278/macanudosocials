// 雪茄客黑金主题配置
import type { ThemeConfig } from 'antd'

export const cigarTheme: ThemeConfig = {
  token: {
    // 主色系 - 金色
    colorPrimary: '#ffd700',
    colorPrimaryHover: '#ffed4e',
    colorPrimaryActive: '#e6b800',
    
    // 背景色系 - 黑色渐变
    colorBgBase: '#0a0a0a',
    colorBgContainer: '#1a1a1a',
    colorBgElevated: '#2d2d2d',
    colorBgLayout: '#0f0f0f',
    
    // 文字色系
    colorText: '#f8f8f8',
    colorTextSecondary: '#c0c0c0',
    colorTextTertiary: '#999999',
    colorTextQuaternary: '#666666',
    
    // 边框色系
    colorBorder: '#333333',
    colorBorderSecondary: '#444444',
    
    // 成功、警告、错误色系
    colorSuccess: '#52c41a',
    colorWarning: '#faad14',
    colorError: '#ff4d4f',
    colorInfo: '#ffd700',
    
    // 字体
    fontFamily: '"Inter", "PingFang SC", "Hiragino Sans GB", "Microsoft YaHei", "Helvetica Neue", Arial, sans-serif',
    fontSize: 14,
    fontSizeHeading1: 38,
    fontSizeHeading2: 30,
    fontSizeHeading3: 24,
    fontSizeHeading4: 20,
    fontSizeHeading5: 16,
    
    // 圆角
    borderRadius: 8,
    borderRadiusLG: 12,
    borderRadiusSM: 6,
    
    // 阴影
    boxShadow: '0 6px 16px 0 rgba(0, 0, 0, 0.08), 0 3px 6px -4px rgba(0, 0, 0, 0.12), 0 9px 28px 8px rgba(0, 0, 0, 0.05)',
    boxShadowSecondary: '0 6px 16px 0 rgba(255, 215, 0, 0.12), 0 3px 6px -4px rgba(255, 215, 0, 0.12)',
    
    // 间距
    padding: 16,
    paddingLG: 24,
    paddingSM: 12,
    paddingXS: 8,
    
    // 高度
    controlHeight: 40,
    controlHeightLG: 48,
    controlHeightSM: 32,
  },
  components: {
    Layout: {
      bodyBg: '#0a0a0a',
      headerBg: '#1a1a1a',
      siderBg: '#1a1a1a',
      footerBg: '#0f0f0f',
    },
    Menu: {
      itemBg: 'transparent',
      itemSelectedBg: 'rgba(255, 215, 0, 0.1)',
      itemSelectedColor: '#ffd700',
      itemHoverBg: 'rgba(255, 215, 0, 0.05)',
      itemHoverColor: '#ffed4e',
      itemColor: '#c0c0c0',
      subMenuItemBg: 'transparent',
      darkItemBg: '#1a1a1a',
      darkItemSelectedBg: 'rgba(255, 215, 0, 0.1)',
      darkItemSelectedColor: '#ffd700',
      darkItemHoverBg: 'rgba(255, 215, 0, 0.05)',
      darkItemHoverColor: '#ffed4e',
      darkItemColor: '#c0c0c0',
    },
    Button: {
      colorPrimary: '#C48D3A',
      colorPrimaryHover: '#D4A050',
      colorPrimaryActive: '#B17C30',
      primaryShadow: '0 2px 0 rgba(255, 215, 0, 0.1)',
      defaultShadow: '0 2px 0 rgba(0, 0, 0, 0.02)',
      dangerShadow: '0 2px 0 rgba(255, 77, 79, 0.1)',
      primaryColor: '#000000',
    },
    Checkbox: {
      colorPrimary: '#C48D3A',
      colorPrimaryHover: '#D4A050',
      colorPrimaryBorder: '#C48D3A',
    },
    Card: {
      colorBgContainer: '#1a1a1a',
      colorBorderSecondary: '#333333',
    },
    Input: {
      colorBgContainer: '#2d2d2d',
      colorBorder: '#444444',
      colorText: '#f8f8f8',
      colorTextPlaceholder: '#666666',
      addonBg: '#1a1a1a',
      hoverBorderColor: '#ffd700',
      activeBorderColor: '#ffd700',
      activeShadow: '0 0 0 2px rgba(255, 215, 0, 0.2)',
    },
    InputNumber: {
      colorBgContainer: '#2d2d2d',
      colorBorder: '#444444',
      colorText: '#f8f8f8',
      colorTextPlaceholder: '#666666',
      addonBg: '#1a1a1a',
      hoverBorderColor: '#ffd700',
      activeBorderColor: '#ffd700',
      activeShadow: '0 0 0 2px rgba(255, 215, 0, 0.2)',
    },
    Select: {
      colorBgContainer: '#2d2d2d',
      colorBorder: '#444444',
      colorText: '#f8f8f8',
      colorTextPlaceholder: '#666666',
    },
    Table: {
      colorBgContainer: '#1a1a1a',
      colorTextHeading: '#f8f8f8',
      colorText: '#c0c0c0',
      rowHoverBg: 'rgba(255, 215, 0, 0.05)',
      borderColor: '#333333',
    },
    Form: {
      labelColor: '#f8f8f8',
      labelRequiredMarkColor: '#ffd700',
    },
    Typography: {
      colorText: '#f8f8f8',
      colorTextSecondary: '#c0c0c0',
      colorTextTertiary: '#999999',
      colorTextQuaternary: '#666666',
    },
    Divider: {
      colorSplit: '#333333',
    },
    Avatar: {
      colorBgContainer: '#2d2d2d',
      colorText: '#f8f8f8',
    },
    Dropdown: {
      colorBgElevated: '#1a1a1a',
      colorText: '#f8f8f8',
    },
    Modal: {
      colorBgElevated: '#1a1a1a',
      contentBg: '#1a1a1a',
      headerBg: 'transparent',
      titleColor: '#FFFFFF',
      titleFontSize: 18,
      fontWeightStrong: 700,
    },
    Drawer: {
      colorBgElevated: '#1a1a1a',
    },
    Tabs: {
      colorText: '#c0c0c0',
      colorTextSecondary: '#ffd700',
      colorBorderSecondary: '#333333',
      inkBarColor: '#ffd700',
    },
    Descriptions: {
      labelBg: 'transparent',
      labelColor: 'rgba(255, 255, 255, 0.7)',
      titleColor: '#FFFFFF',
      contentColor: '#FFFFFF',
      extraColor: '#FFFFFF',
    },
    Breadcrumb: {
      colorText: '#c0c0c0',
      colorTextDescription: '#999999',
      linkColor: '#ffd700',
      linkHoverColor: '#ffed4e',
    },
    Pagination: {
      colorText: '#c0c0c0',
      colorPrimary: '#ffd700',
      colorPrimaryHover: '#ffed4e',
    },
    Steps: {
      colorText: '#c0c0c0',
      colorPrimary: '#ffd700',
      colorTextDescription: '#999999',
    },
    Timeline: {
      colorText: '#c0c0c0',
      colorTextDescription: '#999999',
    },
    Tooltip: {
      colorBgSpotlight: '#1a1a1a',
      colorText: '#f8f8f8',
    },
    Popover: {
      colorBgElevated: '#1a1a1a',
      colorText: '#f8f8f8',
    },
    Alert: {
      colorInfoBg: 'rgba(255, 215, 0, 0.1)',
      colorInfoBorder: '#ffd700',
      colorSuccessBg: 'rgba(82, 196, 26, 0.1)',
      colorSuccessBorder: '#52c41a',
      colorWarningBg: 'rgba(250, 173, 20, 0.1)',
      colorWarningBorder: '#faad14',
      colorErrorBg: 'rgba(255, 77, 79, 0.1)',
      colorErrorBorder: '#ff4d4f',
    },
    Progress: {
      colorInfo: '#ffd700',
      colorSuccess: '#52c41a',
      colorWarning: '#faad14',
      colorError: '#ff4d4f',
      remainingColor: '#d9d9d9',
      circleTextColor: '#FFFFFF',
    },
    Badge: {
      colorBgContainer: '#ffd700',
      colorText: '#0a0a0a',
    },
    Tag: {
      colorBgContainer: '#2d2d2d',
      colorText: '#f8f8f8',
      colorBorder: '#444444',
    },
    Switch: {
      colorPrimary: '#C48D3A',
      colorPrimaryHover: '#ffed4e',
      handleBg: '#FFFFFF',
    },
    Slider: {
      colorPrimary: '#ffd700',
      colorPrimaryBorder: '#ffd700',
      trackBg: '#333333',
      railBg: '#444444',
    },
    Rate: {
      colorFillContent: '#ffd700',
    },
    Upload: {
      colorBorder: '#444444',
      colorBgContainer: '#2d2d2d',
    },
    Skeleton: {
      colorFill: '#333333',
      colorFillContent: '#444444',
    },
    Spin: {
      colorPrimary: '#ffd700',
    },
    Anchor: {
      colorText: '#c0c0c0',
      colorPrimary: '#ffd700',
    },
    BackTop: {
      colorBgTextHover: '#ffd700',
    },
    Affix: {
      colorBgContainer: '#1a1a1a',
    },
    Calendar: {
      colorBgContainer: '#1a1a1a',
      colorText: '#f8f8f8',
      colorTextSecondary: '#c0c0c0',
      colorPrimary: '#ffd700',
    },
  },
}

// 导出主题配置
export default cigarTheme
