import { Select, Space, Typography } from 'antd';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useFirestoreQuery } from '../../hooks/useFirestoreQuery';
import { getAllStores } from '../../services/firebase/stores';
import { LoungeOperations } from './LoungeOperations';
import { useAuthStore } from '../../store/modules/auth';
import { canManageLounge } from '../../utils/loungeAccess';

export default function LoungeClosingMonitor() {
  const { t } = useTranslation();
  const { user } = useAuthStore();
  const { data: stores = [], refresh } = useFirestoreQuery(getAllStores);
  const [id, setId] = useState<string>();
  const available = stores.filter(store => canManageLounge(user, store.id));
  const selected = available.find(s => s.id === id);
  if (!available.length) return null;
  return <Space wrap style={{ marginBottom: 16, maxWidth: '100%' }}>
    <Typography.Text strong>{t('loungeOperations.closing')}</Typography.Text>
    <Select value={id} onChange={setId} placeholder={t('storeManagement.storeName')} style={{ width: 230, maxWidth: '100%' }}
      options={available.map(store => ({ value: store.id, label: store.name }))} />
    {selected && <LoungeOperations store={selected} onSaved={refresh} />}
  </Space>;
}
