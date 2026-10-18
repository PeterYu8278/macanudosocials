import { createInstance } from 'i18next';
import { describe, expect, it } from 'vitest';
import en from './locales/en-US.json';
import zh from './locales/zh-CN.json';

describe('shared save success notification', () => {
  it('resolves the lounge and WhatsApp save notification in both languages', async () => {
    const i18n = createInstance();
    await i18n.init({
      lng: 'en-US',
      fallbackLng: false,
      resources: { 'en-US': { translation: en }, 'zh-CN': { translation: zh } },
    });
    expect(i18n.exists('common.saveSuccess')).toBe(true);
    expect(i18n.t('common.saveSuccess')).toBe('Saved successfully');
    await i18n.changeLanguage('zh-CN');
    expect(i18n.exists('common.saveSuccess')).toBe(true);
    expect(i18n.t('common.saveSuccess')).toBe('\u4fdd\u5b58\u6210\u529f');
  });
});
