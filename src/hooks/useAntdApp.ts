import { App } from 'antd';

/**
 * 返回 antd App 上下文中的 message / notification / modal 实例。
 *
 * 为什么不直接用静态 message：
 * antd v5 的静态函数（message.success 等）无法继承 ConfigProvider 的主题/语言，
 * 会产生 "[antd: message] Static function can not consume context" 警告。
 * 此 hook 必须在 <App>（src/main.tsx 中的 AntdApp）树内使用。
 *
 * 用法：
 *   const { message, notification, modal } = useAntdApp();
 *   message.success('完成');
 *
 * 注意：非 React 组件（services、工具函数）无法使用 hook，
 * 这些场景可以继续使用静态 message，或使用后端日志替代 UI 提示。
 */
export function useAntdApp() {
  return App.useApp();
}
