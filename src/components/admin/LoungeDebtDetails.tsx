import { useEffect, useState } from 'react';
import { Alert, Button, Drawer, Grid, Input, Modal, Space, Table, Tabs, Tag, Typography } from 'antd';
import { useTranslation } from 'react-i18next';
import type { LoungeDebtCustomer, LoungeDebtDetails as Details } from '../../types/loungeReport';
import { loungeRequest } from '../../services/loungeOperations';
import WalletDebtBaselineForm from './WalletDebtBaselineForm';
import LoungeDebtLedger from './LoungeDebtLedger';
import { useDetailDrawer } from '../../hooks/useDetailDrawer';
import './LoungeDebtDetails.css';

interface Props { storeId: string; reportId?: string; reportKind?: 'test' | 'formal'; details?: Details; autoOpen?: boolean }
export default function LoungeDebtDetails({ storeId, reportId, reportKind = 'formal', details, autoOpen = false }: Props) {
  const { t, i18n } = useTranslation();
  const screens = Grid.useBreakpoint(), compact = !screens.lg;
  const [open, setOpen] = useState(autoOpen), [snapshot, setSnapshot] = useState<Details | null>(details || null);
  const [busy, setBusy] = useState(false), [error, setError] = useState('');
  const [group, setGroup] = useState('debt');
  const [search, setSearch] = useState('');
  const ledger = useDetailDrawer<LoungeDebtCustomer>();
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
  const statusFor = (row: LoungeDebtCustomer, full = false) => <div className={full ? '' : 'lounge-debt-status'}>
    <Tag color={row.reliable ? 'success' : 'warning'}>{label(row.reliable ? 'reconciled' : 'review')}</Tag>
    {row.reasons.filter(reason => !(reason === 'wallet-mismatch' && row.reasons.includes('missing-checkpoint') && row.expectedBalance == null))
      .map(reason => <div key={reason} title={t(`loungeOperations.debt.reasons.${reason}`)}>{t(`loungeOperations.debt.reasons.${reason}`)}</div>)}
  </div>;
  const amountKeys = ['opening', 'added', 'repaid', 'outstanding', 'walletBalance'] as const;
  const customers = snapshot?.customers || [];
  const groups = {
    debt: customers.filter(row => row.reliable && (row.outstanding || 0) > 0),
    review: customers.filter(row => !row.reliable),
    settled: customers.filter(row => row.reliable && !(row.outstanding! > 0)),
  };
  const activeGroup = (groups[group as keyof typeof groups] || groups.debt).filter(row =>
    `${row.name} ${row.memberId} ${row.userId}`.toLocaleLowerCase().includes(search.trim().toLocaleLowerCase()));
  const view = (row: LoungeDebtCustomer) => <Button size="small" onClick={() => ledger.openDrawer(row)}>{label('viewLedger')}</Button>;
  const customerDetails = (row: LoungeDebtCustomer) => <div className="lounge-debt-expanded">
    {statusFor(row, true)}
    {row.baseline && <Alert type="info" message={`${label('baseline')}: v${row.baseline.version} · ${time(new Date(row.baseline.at).toISOString())} · ${number(row.baseline.balance)} pts`}
      description={<>{row.baseline.evidenceReference}<br />{row.baseline.note}<br />{label('reviewedBy')}: {row.baseline.reviewedBy}</>} />}
    {!row.baseline && row.reasons.includes('missing-checkpoint') && <Alert type="warning" message={label('noBaseline')} />}
    <dl className="lounge-debt-metrics">
      {[['walletBalance', row.walletBalance], ['expectedBalance', row.expectedBalance ?? null], ['difference', row.difference ?? null]].map(([key, value]) =>
        <div key={key as string}><dt>{label(key as string)}</dt><dd>{number(value as number | null)}</dd></div>)}
    </dl>
    <details className="lounge-debt-method"><summary>{label('evidenceInfo')}</summary>
      {row.entryCounts && <div className="lounge-debt-counts">{([
        ['historicalCount', row.entryCounts.historical], ['includedCount', row.entryCounts.included],
        ['summaryCount', row.entryCounts.summary], ['coveredCount', row.entryCounts.beforeBaseline],
      ] as const).map(([key, count]) => <span key={key}>{label(key)}: <strong>{count}</strong></span>)}</div>}
      <WalletDebtBaselineForm storeId={storeId} userId={row.userId} />
    </details>
    <Typography.Text>{label('ledger')}: {row.entries.length} / {row.entryCount}</Typography.Text>
    <LoungeDebtLedger key={row.userId} row={row} compact={compact} time={time} />
  </div>;
  return <>
    <Button onClick={() => setOpen(true)}>{label('details')}</Button>
    <Modal open={open} onCancel={() => { ledger.closeDrawer(); setOpen(false); }} footer={null} title={label('details')} width={1440} className="lounge-debt-modal"
      zIndex={2300} style={{ top: 12 }} styles={{ body: { maxHeight: 'calc(100dvh - 100px)', overflowY: 'auto' } }}>
      {error && <Alert type="error" showIcon message={error} />}
      {!busy && !error && !snapshot && <Alert type="info" message={label('legacy')} />}
      {snapshot && <Space direction="vertical" style={{ width: '100%' }}>
        <Typography.Text>{label('period')}: {time(snapshot.from)} — {time(snapshot.to)} (MYT)</Typography.Text>
        {snapshot.historical && <Alert type="warning" showIcon message={label('historical')} />}
        {snapshot.truncated && <Alert type="warning" showIcon message={label('truncated')} />}
        <details className="lounge-debt-method"><summary>{label('snapshotInfo')}</summary>
        <Alert type="info" message={label('notice')} />
        {snapshot.otherReviewCount > 0 && <Typography.Text>{label('otherReview')}: {snapshot.otherReviewCount}</Typography.Text>}
        {snapshot.schemaVersion !== 2 && <Alert type="warning" message={label('oldClassification')} />}
        {snapshot.legacyCorrection && <Alert type="info" message={label('legacyCorrected')} />}
        {snapshot.balanceOrigin === 'zero' && <Alert type="info" message={label('zeroOrigin')} />}
        {snapshot.historyRefresh && <Alert type="info" message={t('loungeOperations.debt.historyRefreshed', { skipped: snapshot.historyRefresh.skippedCustomers })} />}
        </details>
      </Space>}
      <Tabs activeKey={group} onChange={setGroup} items={Object.entries(groups).map(([key, rows]) => ({ key, label: `${label(`group.${key}`)} (${rows.length})` }))} />
      <Input.Search className="lounge-debt-search" allowClear value={search} onChange={event => setSearch(event.target.value)} placeholder={label('searchCustomer')} aria-label={label('searchCustomer')} />
      <Table<LoungeDebtCustomer> key={`${group}:${search}:${compact}`} size="small" loading={busy} rowKey="userId" dataSource={activeGroup}
        tableLayout="fixed" scroll={compact ? undefined : { x: 1150 }} pagination={{ defaultPageSize: compact ? 10 : 20, showSizeChanger: true, pageSizeOptions: [10, 20, 50], size: 'small' }} columns={compact ? [
          { title: label('customer'), render: (_, row) => <>
            <div className="lounge-debt-customer-head"><div><strong>{row.name || label('unknownCustomer')}</strong><div>{row.memberId || row.userId}</div></div>{view(row)}</div>
            {statusFor(row)}
            {!row.reliable && <Typography.Text type="secondary">{label('unconfirmedDebt')}</Typography.Text>}
            <dl className="lounge-debt-metrics lounge-debt-customer-values">{(row.reliable ? amountKeys : ['walletBalance'] as const).map(key => <div key={key}><dt>{label(key)}</dt>
              <dd>{key === 'walletBalance' || row.reliable ? number(row[key]) : label('unconfirmed')}</dd></div>)}</dl>
          </> },
        ] : [
          { title: label('customer'), dataIndex: 'name', width: 170, render: (name, row) => <><div>{name || label('unknownCustomer')}</div><Typography.Text type="secondary">{row.memberId || row.userId}</Typography.Text></> },
          { title: label('status'), width: 220, render: (_, row) => statusFor(row) },
          ...amountKeys.map(key => ({ title: label(key), dataIndex: key, width: 120,
            render: (value: number | null, row: LoungeDebtCustomer) => key === 'walletBalance' || row.reliable ? number(value) : label('unconfirmed') })),
          { title: label('viewLedger'), width: 120, fixed: 'right', render: (_, row) => view(row) },
        ]} />
    </Modal>
    <Drawer open={open && ledger.open} onClose={ledger.closeDrawer} width={compact ? '100%' : 1120} zIndex={2400}
      rootClassName="lounge-debt-ledger-drawer" title={`${label('ledger')} · ${ledger.item?.name || ledger.item?.memberId || ''}`}>
      {ledger.item && customerDetails(ledger.item)}
    </Drawer>
  </>;
}
