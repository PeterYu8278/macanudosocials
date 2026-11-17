import { Alert, Button, Select, Space, Typography } from 'antd';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useFirestoreQuery } from '../../hooks/useFirestoreQuery';
import { getAllStores } from '../../services/firebase/stores';
import { LoungeOperations } from './LoungeOperations';
import { useAuthStore } from '../../store/modules/auth';
import { canManageLounge, managedLoungeIds } from '../../utils/loungeAccess';

export default function LoungeClosingMonitor() {
  const { t } = useTranslation();
  const { user } = useAuthStore();
  const allowedRole = !!user && ['admin', 'storeAdmin', 'superAdmin', 'developer'].includes(user.role);
  const { data: stores = [], refresh, loading, error } = useFirestoreQuery(
    () => getAllStores({ ensureDefault: false }),
    [user?.id, user?.role, JSON.stringify(managedLoungeIds(user))],
    { immediate: allowedRole },
  );
  const [id, setId] = useState<string>();
  const available = stores.filter(store => canManageLounge(user, store.id));
  const selected = available.find(s => s.id === id) || available.find(s => s.id === user?.storeId) || available[0];
  if (!allowedRole) return null;
  return <Space wrap style={{ marginBottom: 16, maxWidth: '100%' }}>
    <Typography.Text strong>{t('loungeOperations.closing')}</Typography.Text>
    <Select aria-label={t('storeManagement.storeName')} value={selected?.id} onChange={setId}
      loading={loading} disabled={loading && !available.length} placeholder={t('storeManagement.storeName')}
      notFoundContent={t('loungeOperations.noAccessibleLounges')} style={{ width: 280, maxWidth: '100%' }}
      options={available.map(store => ({ value: store.id, label: store.name?.trim() || store.id }))} />
    <Button loading={loading} onClick={refresh}>{t('common.refresh')}</Button>
    {error && <Alert type="error" showIcon message={t('loungeOperations.loungesLoadFailed')} />}
    {!loading && !error && !available.length && <Alert type="warning" showIcon message={t('loungeOperations.noAccessibleLounges')} />}
    {selected && <LoungeOperations key={selected.id} store={selected} onSaved={refresh} />}
  </Space>;
}
