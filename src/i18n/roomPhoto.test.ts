import { describe, expect, it } from 'vitest'
import { createInstance } from 'i18next'
import enUS from './locales/en-US.json'
import zhCN from './locales/zh-CN.json'

describe('room photo translations', () => {
  it.each([['en-US', 'Room Photo'], ['zh-CN', '房间照片']])('resolves the room photo label in %s', async (language, expected) => {
    const instance = createInstance()
    await instance.init({ lng: language, fallbackLng: 'en-US', resources: {
      'en-US': { translation: enUS }, 'zh-CN': { translation: zhCN },
    } })
    expect(instance.t('roomManagement.roomPhoto')).toBe(expected)
  })
})
