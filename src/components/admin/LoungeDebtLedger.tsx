import { useState } from 'react';
import { Pagination, Table, Tag, Typography } from 'antd';
import { useTranslation } from 'react-i18next';
import type { PointsRecord } from '../../types';
import type { LoungeDebtCustomer } from '../../types/loungeReport';
import { formatPointsRecordDescription } from '../../utils/pointsRecordDisplay';

type Entry = LoungeDebtCustomer['entries'][number];
export default function LoungeDebtLedger({ row, compact, time }: {
  row: LoungeDebtCustomer; compact: boolean; time: (value: string | null) => string;
}) {
  const { t, i18n } = useTranslation();
  const [page, setPage] = useState(1);
  const label = (key: string) => t(`loungeOperations.debt.${key}`);
  const number = (value: number | null | undefined) => value == null ? '—' : value.toFixed(2);
  const description = (entry: Entry) => entry.description ? formatPointsRecordDescription({
    id: entry.id, userId: row.userId, source: entry.source as PointsRecord['source'],
    type: (entry.amount || 0) < 0 ? 'spend' : 'earn', amount: Math.abs(entry.amount || 0),
    description: entry.description, createdAt: new Date(entry.at || 0),
    createdBy: entry.historical || entry.participation?.startsWith('historical') ? 'legacy_migration' : undefined,
  }, i18n.getFixedT('en-US')).replace(/(\d+\.\d{3,}) h\b/g, value => `${Number.parseFloat(value).toFixed(2)} h`)
    : entry.local ? entry.source : label('sharedWallet');
  const treatment = (entry: Entry) => entry.participation ? <Tag
    title={label(`participations.${entry.participation}`)}
    color={['included', 'historical-included'].includes(entry.participation) ? 'success' : 'default'}>
    {label(`shortParticipation.${entry.participation}`)}</Tag> : <Tag>{label('oldClassification')}</Tag>;
  const balance = (entry: Entry, side: 'before' | 'after') => {
    const recorded = entry[side], calculated = side === 'before' ? entry.calculatedBefore : entry.calculatedAfter;
    return <>{number(recorded ?? calculated)}{recorded == null && calculated != null
      && <div className="lounge-debt-calculated">{label('calculated')}</div>}</>;
  };
  const references = (entry: Entry) => <details className="lounge-debt-references">
    <summary>{label('reference')}</summary>
    <div><Typography.Text copyable>{entry.id}</Typography.Text></div>
    {entry.relatedId && <div><Typography.Text copyable>{entry.relatedId}</Typography.Text></div>}
  </details>;
  if (compact) return <div className="lounge-debt-transactions">
    {row.entries.slice((page - 1) * 5, page * 5).map(entry => <article key={entry.id} className="lounge-debt-transaction">
      <div className="lounge-debt-transaction-head"><span>{time(entry.at)}</span>{treatment(entry)}</div>
      <div className="lounge-debt-description">{description(entry)}</div>
      <dl className="lounge-debt-amounts">
        <div><dt>{label('amount')}</dt><dd>{number(entry.amount)}</dd></div>
        <div><dt>{label('before')}</dt><dd>{balance(entry, 'before')}</dd></div>
        <div><dt>{label('after')}</dt><dd>{balance(entry, 'after')}</dd></div>
      </dl>
      {references(entry)}
    </article>)}
    {row.entries.length === 0 && <Typography.Text type="secondary">{t('common.noData')}</Typography.Text>}
    {row.entries.length > 5 && <Pagination simple current={page} pageSize={5} total={row.entries.length} onChange={setPage} />}
  </div>;
  return <Table<Entry> size="small" rowKey="id" tableLayout="fixed" dataSource={row.entries}
    pagination={{ pageSize: 10, showSizeChanger: false }} scroll={{ x: 850 }} columns={[
      { title: label('time'), dataIndex: 'at', width: 135, render: time },
      { title: label('participation'), width: 150, render: (_, entry) => treatment(entry) },
      { title: label('entry'), width: 280, render: (_, entry) => <>
        <div className="lounge-debt-description">{description(entry)}</div>{references(entry)}</> },
      { title: label('amount'), dataIndex: 'amount', width: 90, align: 'right', render: number },
      { title: label('before'), width: 100, align: 'right', render: (_, entry) => balance(entry, 'before') },
      { title: label('after'), width: 100, align: 'right', render: (_, entry) => balance(entry, 'after') },
    ]} />;
}
