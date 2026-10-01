import type { MessageInstance } from 'antd/es/message/interface'

let instance: MessageInstance | undefined

export const getAppMessage = () => instance

export const registerAppMessage = (message: MessageInstance) => {
  instance = message
  return () => {
    if (instance === message) instance = undefined
  }
}
