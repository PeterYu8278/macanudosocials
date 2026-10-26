import { useEffect, useState } from 'react';
import { Alert, Button, Grid, Modal, Space, Table, Tabs, Tag, Typography } from 'antd';
import { useTranslation } from 'react-i18next';
import type { LoungeDebtCustomer, LoungeDebtDetails as Details } from '../../types/loungeReport';
import { loungeRequest } from '../../services/loungeOperations';
import WalletDebtBaselineForm from './WalletDebtBaselineForm';
import LoungeDebtLedger from './LoungeDebtLedger';
import './LoungeDebtDetails.css';

interface Props { storeId: string; reportId?: string; reportKind?: 'test' | 'formal'; details?: Details; autoOpen?: boolean }
export default function LoungeDebtDetails({ storeId, reportId, reportKind = 'formal', details, autoOpen = false }: Props) {
  const { t, i18n } = useTranslation();
  const screens = Grid.useBreakpoint(), compact = !screens.lg;
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
  const statusFor = (row: LoungeDebtCustomer) => <>
    <Tag color={row.reliable ? 'success' : 'warning'}>{label(row.reliable ? 'reconciled' : 'review')}</Tag>
    {row.reasons.filter(reason => !(reason === 'wallet-mismatch' && row.reasons.includes('missing-checkpoint') && row.expectedBalance == null))
      .map(reason => <div key={reason}>{t(`loungeOperations.debt.reasons.${reason}`)}</div>)}
  </>;
  const amountKeys = ['opening', 'added', 'repaid', 'outstanding', 'walletBalance'] as const;
  const customers = snapshot?.customers || [];
  const groups = {
    debt: customers.filter(row => row.reliable && (row.outstanding || 0) > 0),
    review: customers.filter(row => !row.reliable),
    settled: customers.filter(row => row.reliable && !(row.outstanding! > 0)),
  };
  const activeGroup = groups[group as keyof typeof groups] || groups.debt;
  return <>
    <Button onClick={() => setOpen(true)}>{label('details')}</Button>
    <Modal open={open} onCancel={() => setOpen(false)} footer={null} title={label('details')} width={1240} className="lounge-debt-modal"
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
        {snapshot.legacyCorrection && <Alert type="info" message={label('legacyCorrected')} />}
        {snapshot.balanceOrigin === 'zero' && <Alert type="info" message={label('zeroOrigin')} />}
        {snapshot.historyRefresh && <Alert type="info" message={t('loungeOperations.debt.historyRefreshed', { skipped: snapshot.historyRefresh.skippedCustomers })} />}
      </Space>}
      <Tabs activeKey={group} onChange={setGroup} items={Object.entries(groups).map(([key, rows]) => ({ key, label: `${label(`group.${key}`)} (${rows.length})` }))} />
      <Table<LoungeDebtCustomer> size="small" loading={busy} rowKey="userId" dataSource={activeGroup}
        tableLayout="fixed" scroll={compact ? undefined : { x: 1050 }} pagination={{ pageSize: 10, showSizeChanger: true }} columns={compact ? [
          { title: label('customer'), render: (_, row) => <>
            <div className="lounge-debt-customer-head"><div><strong>{row.name || label('unknownCustomer')}</strong><div>{row.memberId || row.userId}</div></div></div>
            {statusFor(row)}
            <dl className="lounge-debt-metrics lounge-debt-customer-values">{amountKeys.map(key => <div key={key}><dt>{label(key)}</dt>
              <dd>{key === 'walletBalance' || row.reliable ? number(row[key]) : label('unconfirmed')}</dd></div>)}</dl>
          </> },
        ] : [
          { title: label('customer'), dataIndex: 'name', width: 170, render: (name, row) => <><div>{name || label('unknownCustomer')}</div><Typography.Text type="secondary">{row.memberId || row.userId}</Typography.Text></> },
          { title: label('status'), width: 230, render: (_, row) => statusFor(row) },
          ...amountKeys.map(key => ({ title: label(key), dataIndex: key, width: 120,
            render: (value: number | null, row: LoungeDebtCustomer) => key === 'walletBalance' || row.reliable ? number(value) : label('unconfirmed') })),
        ]} expandable={{ expandedRowRender: row => <div className="lounge-debt-expanded">
          {row.baseline && <Alert type="info" message={`${label('baseline')}: v${row.baseline.version} · ${time(new Date(row.baseline.at).toISOString())} · ${number(row.baseline.balance)} pts`}
            description={<>{row.baseline.evidenceReference}<br />{row.baseline.note}<br />{label('reviewedBy')}: {row.baseline.reviewedBy}</>} />}
          {!row.baseline && row.reasons.includes('missing-checkpoint') && <Alert type="warning" message={label('noBaseline')} />}
          <dl className="lounge-debt-metrics">
            {[['walletBalance', row.walletBalance], ['expectedBalance', row.expectedBalance ?? null], ['difference', row.difference ?? null]].map(([key, value]) =>
              <div key={key as string}><dt>{label(key as string)}</dt><dd>{number(value as number | null)}</dd></div>)}
          </dl>
          {row.entryCounts && <div className="lounge-debt-counts">{([
            ['historicalCount', row.entryCounts.historical], ['includedCount', row.entryCounts.included],
            ['summaryCount', row.entryCounts.summary], ['coveredCount', row.entryCounts.beforeBaseline],
          ] as const).map(([key, count]) => <span key={key}>{label(key)}: <strong>{count}</strong></span>)}</div>}
          <div className="lounge-debt-reference-bar"><Typography.Text>{label('ledger')}: {row.entries.length} / {row.entryCount}</Typography.Text>
            <WalletDebtBaselineForm storeId={storeId} userId={row.userId} /></div>
          <LoungeDebtLedger key={row.userId} row={row} compact={compact} time={time} />
        </div> }} />
    </Modal>
  </>;
}
