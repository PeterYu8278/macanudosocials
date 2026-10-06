import React, { useState, useEffect } from 'react';
import { App, Button, Switch, Space, Typography } from 'antd';
import { SaveOutlined } from '@ant-design/icons';
import { useTranslation } from 'react-i18next';
import { doc, onSnapshot } from 'firebase/firestore';
import { db } from '../../../config/firebase';
import { GLOBAL_COLLECTIONS } from '../../../config/globalCollections';
import { requestDayPass } from '../../../services/dayPass';
import { useAuthStore } from '../../../store/modules/auth';

export default function DayPassControl() {
  const { t } = useTranslation();
  const { message } = App.useApp();
  const user = useAuthStore(state => state.user);
  const [saved, setSaved] = useState<boolean | null>(null);
  const [enabled, setEnabled] = useState(false);
  const [saving, setSaving] = useState(false);
  const canEdit = ['superAdmin', 'developer'].includes(user?.role || '');
  useEffect(() => onSnapshot(doc(db, GLOBAL_COLLECTIONS.CONFIG, 'points'), snapshot => {
    const next = snapshot.data()?.dayPass?.enabled !== false;
    setSaved(next);
    setEnabled(next);
  }, () => { setSaved(null); }), []);
  return <div style={{ marginTop: 12, paddingTop: 12, borderTop: '1px solid rgba(255,255,255,0.1)' }}>
    <Space wrap style={{ width: '100%', justifyContent: 'space-between' }}>
      <Typography.Text>{t('dayPassControl.title')}</Typography.Text>
      <Space>
        <Switch aria-label={t('dayPassControl.title')} checked={enabled} onChange={setEnabled}
          disabled={!canEdit || saved === null || saving} />
        <Button icon={<SaveOutlined />} loading={saving} disabled={!canEdit || saved === null || enabled === saved}
          onClick={async () => {
            setSaving(true);
            try {
              const result = await requestDayPass({ action: 'set-enabled', enabled });
              if (result.success) { setSaved(enabled); message.success(t('common.savedSuccess')); }
              else message.error(result.error);
            } finally { setSaving(false); }
          }}>{t('common.save')}</Button>
      </Space>
    </Space>
  </div>;
}
