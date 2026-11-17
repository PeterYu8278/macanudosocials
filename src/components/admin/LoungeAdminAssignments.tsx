import { useEffect, useState } from 'react';
import { Alert, Button, Input, Space, Switch, Table, Typography } from 'antd';
import { useTranslation } from 'react-i18next';
import { loungeRequest } from '../../services/loungeOperations';

interface Admin { id: string; name: string; role: 'admin' | 'storeAdmin'; storeIds: string[] }
export default function LoungeAdminAssignments({ storeId }: { storeId: string }) {
  const { t } = useTranslation();
  const [admins, setAdmins] = useState<Admin[]>([]), [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false), [error, setError] = useState(''), [search, setSearch] = useState('');
  const load = async () => {
    setLoading(true); setError('');
    try { const result = await loungeRequest('list-lounge-admins', { storeId }); setAdmins(result.admins); }
    catch (e: any) { setError(e.message || t('loungeOperations.error')); }
    finally { setLoading(false); }
  };
  useEffect(() => { void load(); }, [storeId]);
  const assign = async (admin: Admin, assigned: boolean) => {
    setBusy(true); setError('');
    try {
      const result = await loungeRequest('assign-lounge-admin', { storeId, userId: admin.id, assigned, expectedStoreIds: admin.storeIds });
      setAdmins(rows => rows.map(row => row.id === admin.id ? { ...row, storeIds: result.storeIds } : row));
    } catch (e: any) { setError(e.message || t('loungeOperations.error')); }
    finally { setBusy(false); }
  };
  return <Space direction="vertical" style={{ width: '100%' }}>
    <Typography.Paragraph>{t('loungeOperations.adminAssignmentsHelp')}</Typography.Paragraph>
    {error && <Alert type="error" showIcon message={error} />}
    <Space wrap><Input value={search} onChange={e => setSearch(e.target.value)} placeholder={t('loungeOperations.searchAdmin')}
      aria-label={t('loungeOperations.searchAdmin')} />
      <Button onClick={load} disabled={busy} loading={loading}>{t('common.refresh')}</Button></Space>
    <Table<Admin> size="small" rowKey="id" loading={loading} scroll={{ x: 460 }} pagination={{ pageSize: 10 }}
      dataSource={admins.filter(admin => `${admin.name} ${admin.id}`.toLowerCase().includes(search.trim().toLowerCase()))}
      columns={[
        { title: t('loungeOperations.adminName'), dataIndex: 'name' },
        { title: t('loungeOperations.adminRole'), dataIndex: 'role', render: role => t(`auth.${role}`) },
        { title: t('loungeOperations.assignedHere'), render: (_, admin) => <Switch checked={admin.storeIds.includes(storeId)}
          disabled={busy || loading} aria-label={t('loungeOperations.assignAdmin', { name: admin.name })}
          onChange={assigned => void assign(admin, assigned)} /> },
        { title: t('loungeOperations.assignedLounges'), render: (_, admin) => admin.storeIds.length },
      ]} />
  </Space>;
}
