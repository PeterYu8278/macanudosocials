import { useEffect, useState } from 'react';
import { Alert, Button, Modal, Space, Table, Tabs, Tag, Typography } from 'antd';
import { useTranslation } from 'react-i18next';
import type { LoungeDebtCustomer, LoungeDebtDetails as Details } from '../../types/loungeReport';
import { loungeRequest } from '../../services/loungeOperations';
import WalletDebtBaselineForm from './WalletDebtBaselineForm';

interface Props { storeId: string; reportId?: string; reportKind?: 'test' | 'formal'; details?: Details; autoOpen?: boolean }
export default function LoungeDebtDetails({ storeId, reportId, reportKind = 'formal', details, autoOpen = false }: Props) {
  const { t, i18n } = useTranslation();
  const [open, setOpen] = useState(autoOpen), [snapshot, setSnapshot] = useState<Details | null>(details || null);
  const [busy, setBusy] = useState(false), [error, setError] = useState('');
  const [group, setGroup] = useState('debt');
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
  const customers = snapshot?.customers || [];
  const groups = {
    debt: customers.filter(row => row.reliable && (row.outstanding || 0) > 0),
    review: customers.filter(row => !row.reliable),
    settled: customers.filter(row => row.reliable && !(row.outstanding! > 0)),
  };
  const activeGroup = groups[group as keyof typeof groups] || groups.debt;
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
        {snapshot.schemaVersion !== 2 && <Alert type="warning" message={label('oldClassification')} />}
      </Space>}
      <Tabs activeKey={group} onChange={setGroup} items={Object.entries(groups).map(([key, rows]) => ({ key, label: `${label(`group.${key}`)} (${rows.length})` }))} />
      <Table<LoungeDebtCustomer> size="small" loading={busy} rowKey="userId" dataSource={activeGroup}
        scroll={{ x: 880 }} pagination={{ pageSize: 10, showSizeChanger: true }} columns={[
          { title: label('customer'), dataIndex: 'name', width: 170, render: (name, row) => <><div>{name || label('unknownCustomer')}</div><Typography.Text type="secondary">{row.memberId || row.userId}</Typography.Text></> },
          { title: label('status'), dataIndex: 'reliable', width: 210, render: (reliable, row) => <>
            <Tag color={reliable ? 'success' : 'warning'}>{label(reliable ? 'reconciled' : 'review')}</Tag>
            {row.reasons.filter(reason => !(reason === 'wallet-mismatch' && row.reasons.includes('missing-checkpoint') && row.expectedBalance == null))
              .map(reason => <div key={reason}>{t(`loungeOperations.debt.reasons.${reason}`)}</div>)}
          </> },
          ...['opening', 'added', 'repaid', 'outstanding', 'walletBalance'].map(key => ({ title: label(key), dataIndex: key,
            render: (value: number | null, row: LoungeDebtCustomer) => key === 'walletBalance' || row.reliable ? number(value) : label('unconfirmed') })),
        ]} expandable={{ expandedRowRender: row => <>
          {row.baseline && <Alert type="info" message={`${label('baseline')}: v${row.baseline.version} · ${time(new Date(row.baseline.at).toISOString())} · ${number(row.baseline.balance)} pts`}
            description={<>{row.baseline.evidenceReference}<br />{row.baseline.note}<br />{label('reviewedBy')}: {row.baseline.reviewedBy}</>} />}
          {!row.baseline && row.reasons.includes('missing-checkpoint') && <Alert type="warning" message={label('noBaseline')} />}
          <Typography.Paragraph>{label('expectedBalance')}: {number(row.expectedBalance ?? null)} · {label('difference')}: {number(row.difference ?? null)}</Typography.Paragraph>
          {row.entryCounts && <Typography.Paragraph>{label('historicalCount')}: {row.entryCounts.historical} · {label('includedCount')}: {row.entryCounts.included} · {label('summaryCount')}: {row.entryCounts.summary} · {label('coveredCount')}: {row.entryCounts.beforeBaseline}</Typography.Paragraph>}
          <WalletDebtBaselineForm storeId={storeId} userId={row.userId} />
          <Typography.Paragraph>{label('ledger')}: {row.entries.length} / {row.entryCount}</Typography.Paragraph>
          <Table size="small" rowKey="id" dataSource={row.entries} pagination={{ pageSize: 5 }} scroll={{ x: 850 }} columns={[
            { title: label('time'), dataIndex: 'at', render: time },
            { title: label('participation'), dataIndex: 'participation', render: value => value ? <Tag color={value === 'included' ? 'success' : 'default'}>{label(`participations.${value}`)}</Tag> : label('oldClassification') },
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
