import { createInstance } from 'i18next';
import { describe, expect, it } from 'vitest';
import en from './locales/en-US.json';
import zh from './locales/zh-CN.json';

describe('visit session insufficient-points messages', () => {
  it('switches checkout language and retains all amounts', async () => {
    const i18n = createInstance();
    await i18n.init({ lng: 'en-US', resources: { 'en-US': { translation: en }, 'zh-CN': { translation: zh } } });
    const values = { currentPoints: 20, pointsDue: 45, shortfall: 25, minimumReload: 200 };
    expect(i18n.t('visitSessions.insufficientPointsCheckout', values)).toBe(
      'Insufficient points to check out. Current balance: 20 points; amount due: 45 points; shortfall: 25 points (minimum reload: RM 200).'
    );
    await i18n.changeLanguage('zh-CN');
    expect(i18n.t('visitSessions.insufficientPointsCheckout', values)).toBe(
      '积分不足，无法 Check-out。当前 20 分，需扣 45 分，还需充值 25 分（最低充值 RM 200）'
    );
  });

  it('translates check-in messages without losing fractional points or zero balance', async () => {
    const i18n = createInstance();
    await i18n.init({ lng: 'en-US', resources: { 'en-US': { translation: en }, 'zh-CN': { translation: zh } } });
    const values = { currentPoints: 0, pointsDue: 12.5, shortfall: 12.5, minimumReload: 200 };
    expect(i18n.t('visitSessions.insufficientPointsCheckin', values)).toBe(
      'Insufficient points to check in. Current balance: 0 points; first-hour charge: 12.5 points; shortfall: 12.5 points (minimum reload: RM 200).'
    );
    await i18n.changeLanguage('zh-CN');
    expect(i18n.t('visitSessions.insufficientPointsCheckin', values)).toBe(
      '积分不足，无法 Check-in。当前 0 分，首小时需 12.5 分，还需充值 12.5 分（最低充值 RM 200）'
    );
  });
});
