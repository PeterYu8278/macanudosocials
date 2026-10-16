import { Select, Space, Typography } from 'antd';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useFirestoreQuery } from '../../hooks/useFirestoreQuery';
import { getAllStores } from '../../services/firebase/stores';
import { LoungeOperations } from './LoungeOperations';

export default function LoungeClosingMonitor() {
  const { t } = useTranslation();
  const { data: stores = [], refresh } = useFirestoreQuery(getAllStores);
  const [id, setId] = useState<string>();
  const selected = stores.find(s => s.id === id);
  return <Space wrap style={{ marginBottom: 16, maxWidth: '100%' }}>
    <Typography.Text strong>{t('loungeOperations.closing')}</Typography.Text>
    <Select value={id} onChange={setId} placeholder={t('storeManagement.storeName')} style={{ width: 230, maxWidth: '100%' }}
      options={stores.map(store => ({ value: store.id, label: store.name }))} />
    {selected && <LoungeOperations store={selected} onSaved={refresh} />}
  </Space>;
}
