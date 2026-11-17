import { useState } from 'react';
import { Checkbox } from 'antd';
import { useTranslation } from 'react-i18next';
import { setWebsiteTrafficOptOut, websiteTrafficOptedOut } from '../../services/websiteTraffic';

export default function WebsiteTrafficPrivacy() {
  const { t } = useTranslation();
  const [off, setOff] = useState(websiteTrafficOptedOut);
  return <details style={{ marginTop: 16 }}>
    <summary>{t('websiteTraffic.privacyTitle')}</summary>
    <p>{t('websiteTraffic.privacyText')}</p>
    <Checkbox checked={off} disabled={navigator.doNotTrack === '1'} onChange={e => {
      setOff(e.target.checked); setWebsiteTrafficOptOut(e.target.checked);
    }}>{t('websiteTraffic.optOut')}</Checkbox>
  </details>;
}
