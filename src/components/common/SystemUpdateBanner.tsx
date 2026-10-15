import { useState } from 'react';
import { Alert, Button } from 'antd';
import { ReloadOutlined } from '@ant-design/icons';
import { useTranslation } from 'react-i18next';
import { applySystemUpdate, useSystemUpdate } from '../../utils/pwa';

export default function SystemUpdateBanner() {
  const available = useSystemUpdate();
  const { t } = useTranslation();
  const [updating, setUpdating] = useState(false);
  const [failed, setFailed] = useState(false);
  if (!available) return null;

  const update = async () => {
    if (updating) return;
    setUpdating(true);
    setFailed(false);
    try {
      if (await applySystemUpdate()) window.location.reload();
      else setFailed(true);
    } catch { setFailed(true); }
    finally { setUpdating(false); }
  };

  return <Alert
    style={{ marginBottom: 16 }}
    type={failed ? 'warning' : 'info'}
    showIcon
    message={t('systemUpdate.available')}
    description={<div style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: 12 }}>
      <span style={{ flex: '1 1 180px', overflowWrap: 'anywhere' }}>{t(failed ? 'systemUpdate.failed' : 'systemUpdate.description')}</span>
      <Button type="primary" icon={<ReloadOutlined />} loading={updating} onClick={() => { void update(); }}>
        {t('systemUpdate.updateNow')}
      </Button>
    </div>}
  />;
}
