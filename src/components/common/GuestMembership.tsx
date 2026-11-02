import { useEffect, useState } from 'react';
import { Button } from 'antd';
import { useTranslation } from 'react-i18next';
import { currentGuestMembership, type GuestPageConfig } from '../../config/guestPage';
import WebsiteTrafficPrivacy from './WebsiteTrafficPrivacy';

export default function GuestMembership({ config, onRegister }: { config: GuestPageConfig; onRegister: () => void }) {
  const { t } = useTranslation();
  const [now, setNow] = useState(Date.now());
  useEffect(() => { const timer = window.setInterval(() => setNow(Date.now()), 30000); return () => clearInterval(timer); }, []);
  const plan = currentGuestMembership(config, now);
  return <section id="trust" style={{ padding: '64px 24px', maxWidth: 1000, margin: 'auto' }}>
    <h2>{t('guestPublic.membership')}</h2>
    {plan ? <>
      <p style={{ fontSize: 30 }}>{t('guestPublic.annualPrice', { amount: plan.annualPrice.toFixed(2) })}</p>
      <ul style={{ lineHeight: 2 }}>
        <li>{t('guestPublic.credit', { amount: plan.credit.toFixed(2) })}</li>
        <li>{t('guestPublic.cigars', { count: plan.cigarsPerYear })}</li>
        {plan.firstVisitFree && <li>{t('guestPublic.firstVisit')}</li>}
        {plan.drinksAndSnacks && <li>{t('guestPublic.drinks')}</li>}
        {plan.referralRewards && <li>{t('guestPublic.referral')}</li>}
        {plan.nonSmokerCompanion && <li>{t('guestPublic.companion')}</li>}
      </ul>
      <Button type="primary" onClick={onRegister}>{t('guestPublic.register')}</Button>
    </> : <p>{t('guestPublic.unavailable')}</p>}
    <p>{t('guestPublic.visitHours', { hours: `${config.opensAt}–${config.closesAt}` })}</p>
    <address>{config.address}</address>
    <p><a href={`tel:+${config.phone}`}>+{config.phone}</a></p>
    <WebsiteTrafficPrivacy />
  </section>;
}
