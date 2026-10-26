import { useEffect, useState } from 'react';
import { Alert, Button, Modal, Space, Table, Tag, Typography } from 'antd';
import { useTranslation } from 'react-i18next';
import type { LoungeDebtCustomer, LoungeDebtDetails as Details } from '../../types/loungeReport';
import { loungeRequest } from '../../services/loungeOperations';

interface Props { storeId: string; reportId?: string; reportKind?: 'test' | 'formal'; details?: Details; autoOpen?: boolean }
export default function LoungeDebtDetails({ storeId, reportId, reportKind = 'formal', details, autoOpen = false }: Props) {
  const { t, i18n } = useTranslation();
  const [open, setOpen] = useState(autoOpen), [snapshot, setSnapshot] = useState<Details | null>(details || null);
  const [busy, setBusy] = useState(false), [error, setError] = useState('');
  useEffect(() => {
    if (!open) return;
    let active = true;
    setError(''); setSnapshot(details || null);
    if (details || !reportId) return;
    setBusy(true);
    loungeRequest('report-details', { storeId, reportId, reportKind }).then(result => {
      if (active) setSnapshot(result.debtDetails);
    }).catch(e => { if (active) setError(e.message); }).finally(() => { if (active) setBusy(false); });
    return () => { active = false; };
  }, [open, details, reportId, reportKind, storeId]);
  const number = (n: number | null) => n === null ? '—' : n.toFixed(2);
  const time = (value: string | null) => value ? new Intl.DateTimeFormat(i18n?.language || 'en-US', {
    timeZone: 'Asia/Kuala_Lumpur', dateStyle: 'medium', timeStyle: 'short',
  }).format(new Date(value)) : '—';
  const label = (key: string) => t(`loungeOperations.debt.${key}`);
  return <>
    <Button onClick={() => setOpen(true)}>{label('details')}</Button>
    <Modal open={open} onCancel={() => setOpen(false)} footer={null} title={label('details')} width={1100}
      zIndex={2300} style={{ top: 24 }} styles={{ body: { maxHeight: '78vh', overflowY: 'auto' } }}>
      {error && <Alert type="error" showIcon message={error} />}
      {!busy && !error && !snapshot && <Alert type="info" message={label('legacy')} />}
      {snapshot && <Space direction="vertical" style={{ width: '100%' }}>
        <Typography.Text>{label('period')}: {time(snapshot.from)} — {time(snapshot.to)} (MYT)</Typography.Text>
        {snapshot.historical && <Alert type="warning" showIcon message={label('historical')} />}
        <Alert type="info" message={label('notice')} />
        {snapshot.otherReviewCount > 0 && <Typography.Text>{label('otherReview')}: {snapshot.otherReviewCount}</Typography.Text>}
        {snapshot.truncated && <Alert type="warning" showIcon message={label('truncated')} />}
      </Space>}
      <Table<LoungeDebtCustomer> size="small" loading={busy} rowKey="userId" dataSource={snapshot?.customers || []}
        scroll={{ x: 880 }} pagination={{ pageSize: 10, showSizeChanger: true }} columns={[
          { title: label('customer'), dataIndex: 'name', width: 170, render: (name, row) => <><div>{name || label('unknownCustomer')}</div><Typography.Text type="secondary">{row.memberId || row.userId}</Typography.Text></> },
          { title: label('status'), dataIndex: 'reliable', width: 210, render: (reliable, row) => <>
            <Tag color={reliable ? 'success' : 'warning'}>{label(reliable ? 'reconciled' : 'review')}</Tag>
            {row.reasons.map(reason => <div key={reason}>{t(`loungeOperations.debt.reasons.${reason}`)}</div>)}
          </> },
          ...['opening', 'added', 'repaid', 'outstanding', 'walletBalance'].map(key => ({ title: label(key), dataIndex: key, render: number })),
        ]} expandable={{ expandedRowRender: row => <>
          <Typography.Paragraph>{label('ledger')}: {row.entries.length} / {row.entryCount}</Typography.Paragraph>
          <Table size="small" rowKey="id" dataSource={row.entries} pagination={{ pageSize: 5 }} scroll={{ x: 850 }} columns={[
            { title: label('time'), dataIndex: 'at', render: time },
            { title: label('entry'), dataIndex: 'id', render: (id, entry) => <>
              <div>{entry.description || (entry.local ? entry.source : label('sharedWallet'))}</div>
              <Typography.Text copyable>{id}</Typography.Text>
              {entry.relatedId && <div>{label('reference')}: <Typography.Text copyable>{entry.relatedId}</Typography.Text></div>}
            </> },
            ...['amount', 'before', 'after'].map(key => ({ title: label(key), dataIndex: key, render: number })),
          ]} />
        </> }} />
    </Modal>
  </>;
}
