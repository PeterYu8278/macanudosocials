import { useEffect, useState } from 'react';
import { Alert, Button, Input, Select, Space, Statistic, Table, Typography } from 'antd';
import { ReloadOutlined, DatabaseOutlined } from '@ant-design/icons';
import { useTranslation } from 'react-i18next';
import { getAuth } from 'firebase/auth';
import type { MetricRow } from '@/services/firebase/monitoringQueue';

type Row = MetricRow & { id: string; date: string; source: 'frontend' | 'backend' };
export default function SystemMonitoring() {
  const { t } = useTranslation();
  const [days, setDays] = useState(1);
  const [source, setSource] = useState('all');
  const [search, setSearch] = useState('');
  const [rows, setRows] = useState<Row[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(false);
  const [truncated, setTruncated] = useState(false);
  const [revision, refresh] = useState(0);
  useEffect(() => {
    const controller = new AbortController();
    setLoading(true); setError(false);
    void (async () => {
      try {
        const token = await getAuth().currentUser?.getIdToken();
        if (!token) throw new Error('AUTH_REQUIRED');
        const response = await fetch(`/.netlify/functions/firestore-monitoring?days=${days}`, {
          headers: { Authorization: `Bearer ${token}` }, signal: controller.signal,
        });
        if (!response.ok) throw new Error('LOAD_FAILED');
        const result = await response.json();
        if (!controller.signal.aborted) { setRows(result.rows); setTruncated(result.truncated); }
      } catch { if (!controller.signal.aborted) { setError(true); setRows([]); } }
      finally { if (!controller.signal.aborted) setLoading(false); }
    })();
    return () => controller.abort();
  }, [days, revision]);
  const filtered = rows.filter(row => (source === 'all' || source === row.source) &&
    `${row.collection} ${row.feature}`.toLowerCase().includes(search.toLowerCase()));
  const totals = filtered.reduce((sum, row) => ({ reads: sum.reads + row.reads, writes: sum.writes + row.writes,
    deletes: sum.deletes + row.deletes, failures: sum.failures + row.failures }), { reads: 0, writes: 0, deletes: 0, failures: 0 });
  return <div className="system-monitoring-page">
    <Typography.Title level={4}>{t('systemMonitoring.title')}</Typography.Title>
    <Alert type="info" showIcon message={t('systemMonitoring.observed')} description={t('systemMonitoring.observedNote')} style={{ marginBottom: 20 }} />
    <Space wrap style={{ marginBottom: 20 }}>
      <Select value={days} onChange={setDays} style={{ width: 150 }} aria-label={t('systemMonitoring.range')}
        options={[1, 7, 30].map(value => ({ value, label: t('systemMonitoring.days', { count: value }) }))} />
      <Select value={source} onChange={setSource} style={{ width: 150 }} aria-label={t('systemMonitoring.source')}
        options={['all', 'frontend', 'backend'].map(value => ({ value, label: t(`systemMonitoring.${value}Source`) }))} />
      <Input.Search value={search} onChange={event => setSearch(event.target.value)} placeholder={t('systemMonitoring.search')} allowClear style={{ width: 230 }} />
      <Button icon={<ReloadOutlined />} loading={loading} onClick={() => refresh(value => value + 1)}>{t('systemMonitoring.refresh')}</Button>
    </Space>
    {error && <Alert type="error" showIcon message={t('systemMonitoring.loadError')} style={{ marginBottom: 16 }} />}
    {truncated && <Alert type="warning" showIcon message={t('systemMonitoring.truncated')} style={{ marginBottom: 16 }} />}
    <Space wrap size={40} style={{ marginBottom: 20 }}>
      {Object.entries(totals).map(([key, value]) => <Statistic key={key} title={t(`systemMonitoring.${key}`)} value={value} />)}
    </Space>
    <Table<Row> rowKey="id" size="small" loading={loading} dataSource={filtered} scroll={{ x: 980 }}
      locale={{ emptyText: t('systemMonitoring.empty') }} pagination={{ pageSize: 20, showSizeChanger: true }}
      columns={[
        { title: t('systemMonitoring.date'), dataIndex: 'date' },
        { title: t('systemMonitoring.collection'), dataIndex: 'collection' },
        { title: t('systemMonitoring.feature'), dataIndex: 'feature' },
        { title: t('systemMonitoring.source'), dataIndex: 'source', render: value => t(`systemMonitoring.${value}Source`) },
        ...(['reads', 'writes', 'deletes', 'failures', 'cacheReads'] as const).map(key => ({
          title: t(`systemMonitoring.${key}`), dataIndex: key, sorter: (a: Row, b: Row) => a[key] - b[key],
        })),
      ]} />
    <Button style={{ marginTop: 20 }} icon={<DatabaseOutlined />} href="https://console.firebase.google.com/project/macanudosocial/firestore/usage" target="_blank" rel="noreferrer">{t('systemMonitoring.openFirebaseUsage')}</Button>
  </div>;
}
