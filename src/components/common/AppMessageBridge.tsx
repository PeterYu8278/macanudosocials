import { useLayoutEffect } from 'react'
import { App } from 'antd'
import { registerAppMessage } from '../../utils/appMessage'
import './AppMessageBridge.css'

export default function AppMessageBridge() {
  const { message } = App.useApp()
  useLayoutEffect(() => registerAppMessage(message), [message])
  return null
}
