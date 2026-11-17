import { useEffect, useState } from 'react';
import { Button } from 'antd';
import { useTranslation } from 'react-i18next';
import { currentGuestMembership, type GuestPageConfig } from '../../config/guestPage';

export default function GuestMembership({ config, onRegister }: { config: GuestPageConfig; onRegister: () => void }) {
  const { t } = useTranslation();
  const [now, setNow] = useState(Date.now());
  useEffect(() => { const timer = window.setInterval(() => setNow(Date.now()), 30000); return () => clearInterval(timer); }, []);
  const plan = currentGuestMembership(config, now);
  return <section id="trust" className="guest-membership">
    <div className="guest-membership-heading"><h2>{t('guestPublic.membership')}</h2>
      {plan && <p className="guest-membership-price">{t('guestPublic.annualPrice', { amount: plan.annualPrice.toFixed(2) })}</p>}
    </div>
    {plan ? <div className="guest-membership-copy">
      <ul>
        <li>{t('guestPublic.credit', { amount: plan.credit.toFixed(2) })}</li>
        <li>{t('guestPublic.cigars', { count: plan.cigarsPerYear })}</li>
        {plan.firstVisitFree && <li>{t('guestPublic.firstVisit')}</li>}
        {plan.drinksAndSnacks && <li>{t('guestPublic.drinks')}</li>}
        {plan.referralRewards && <li>{t('guestPublic.referral')}</li>}
        {plan.nonSmokerCompanion && <li>{t('guestPublic.companion')}</li>}
      </ul>
      <Button type="primary" onClick={onRegister}>{t('guestPublic.register')}</Button>
    </div> : <p>{t('guestPublic.unavailable')}</p>}
  </section>;
}
