import { useEffect, useState } from 'react';
import { Alert, Button, Checkbox, Input, Modal, Select, Space, Switch, Table, Tabs, Typography, message } from 'antd';
import { ClockCircleOutlined, PlusOutlined, DeleteOutlined, ReloadOutlined, EyeOutlined } from '@ant-design/icons';
import { useTranslation } from 'react-i18next';
import type { Store } from '../../types';
import { emptyLoungeOperations, validateLoungeOperations, type LoungeOperations as Operations } from '../../utils/loungeOperations';
import { loungeRequest } from '../../services/loungeOperations';
import LoungeTestReport from './LoungeTestReport';
import LoungeDebtDetails from './LoungeDebtDetails';

export function LoungeOperations({ store, onSaved }: { store: Store; onSaved?: () => void }) {
  const { t } = useTranslation();
  const [open, setOpen] = useState(false), [busy, setBusy] = useState(false);
  const [value, setValue] = useState<Operations>(store.operations || emptyLoungeOperations());
  const [status, setStatus] = useState<any>(null), [error, setError] = useState(''), [preview, setPreview] = useState<any>(null);
  useEffect(() => { if (!open) setValue(store.operations || emptyLoungeOperations()); }, [store.operations, open]);
  const load = async () => {
    try { setStatus(await loungeRequest('status', { storeId: store.id })); setError(''); }
    catch (e: any) { setError(e.message || t('loungeOperations.error')); }
  };
  const run = async (action: () => Promise<void>) => {
    setBusy(true);
    try { await action(); } catch (e: any) { message.error(e.message || t('loungeOperations.error')); }
    finally { setBusy(false); }
  };
  const save = () => run(async () => {
    try { validateLoungeOperations(value); } catch { throw new Error(t('loungeOperations.errors.invalid-hours')); }
    await loungeRequest('save-hours', { storeId: store.id, operations: value });
    message.success(t('common.saveSuccess')); onSaved?.(); await load();
  });
  return <>
    <Button type="link" size="small" icon={<ClockCircleOutlined />} onClick={() => { setOpen(true); void load(); }}>{t('loungeOperations.title')}</Button>
    <Modal title={`${store.name} - ${t('loungeOperations.title')}`} open={open} onCancel={() => setOpen(false)} footer={null}
      width={960} zIndex={2100} style={{ top: 24 }} styles={{ body: { maxHeight: '75vh', overflowY: 'auto' } }}>
      {error && <Alert type="error" showIcon message={error} action={<Button onClick={load} icon={<ReloadOutlined />} />} />}
      {status && !status.enabled && <Alert type="warning" showIcon message={t('loungeOperations.disabled')} />}
      <Tabs items={[
        { key: 'hours', label: t('loungeOperations.hours'), children: <Space direction="vertical" style={{ width: '100%' }} size="middle">
          <Space wrap><Typography.Text>{t('loungeOperations.enabled')}</Typography.Text>
            <Switch checked={value.enabled} onChange={enabled => setValue({ ...value, enabled })} disabled={status?.enabled !== true} />
            <Typography.Text type="secondary">Asia/Kuala_Lumpur · 23:00</Typography.Text></Space>
          <Alert type="warning" showIcon message={t('loungeOperations.negativeWarning')} />
          {value.week.map((day, i) => <div key={i} style={{ display: 'grid', gridTemplateColumns: 'minmax(100px, 1fr) 64px minmax(110px, 160px)', alignItems: 'center', gap: 12 }}>
            <span>{t(`loungeOperations.days.${i}`)}</span>
            <Switch checked={day.open} aria-label={t(`loungeOperations.days.${i}`)} onChange={openDay => setValue({ ...value, week: value.week.map((d, n) => n === i ? { ...d, open: openDay } : d) })} />
            <Input type="time" value={day.startsAt} disabled={!day.open} max="22:59" aria-label={t('loungeOperations.opensAt')}
              onChange={e => setValue({ ...value, week: value.week.map((d, n) => n === i ? { ...d, startsAt: e.target.value } : d) })} />
          </div>)}
          <Typography.Text strong>{t('loungeOperations.exceptions')}</Typography.Text>
          {value.exceptions.map((day, i) => <Space key={i} wrap>
            <Input type="date" value={day.date} aria-label={t('loungeOperations.date')} onChange={e => setValue({ ...value, exceptions: value.exceptions.map((d, n) => n === i ? { ...d, date: e.target.value } : d) })} />
            <Checkbox checked={day.open} onChange={e => setValue({ ...value, exceptions: value.exceptions.map((d, n) => n === i ? { ...d, open: e.target.checked } : d) })}>{t('loungeOperations.open')}</Checkbox>
            <Input type="time" disabled={!day.open} value={day.startsAt} aria-label={t('loungeOperations.opensAt')}
              onChange={e => setValue({ ...value, exceptions: value.exceptions.map((d, n) => n === i ? { ...d, startsAt: e.target.value } : d) })} />
            <Button icon={<DeleteOutlined />} title={t('common.delete')} onClick={() => setValue({ ...value, exceptions: value.exceptions.filter((_, n) => n !== i) })} />
          </Space>)}
          <Button icon={<PlusOutlined />} disabled={value.exceptions.length >= 100} onClick={() => setValue({ ...value, exceptions: [...value.exceptions, { date: '', open: false, startsAt: '' }] })}>{t('loungeOperations.exceptions')}</Button>
          <Checkbox checked={value.dailyReportEnabled} onChange={e => setValue({ ...value, dailyReportEnabled: e.target.checked })}>{t('loungeOperations.reportEnabled')}</Checkbox>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(min(100%, 220px), 1fr))', gap: 12 }}>
            <div><Typography.Text>{t('loungeOperations.reportProvider')}</Typography.Text>
              <Select style={{ width: '100%' }} aria-label={t('loungeOperations.reportProvider')} value={value.reportDelivery?.provider || 'whapi'}
                options={[{ value: 'whapi', label: 'Whapi' }, { value: 'whatsmeow', label: 'Whatsmeow' }]}
                onChange={provider => setValue({ ...value, dailyReportEnabled: false, reportDelivery: { provider, channelId: '', recipient: '' } })} /></div>
            <div><Typography.Text>{t('loungeOperations.channel')}</Typography.Text>
              <Input value={value.reportDelivery?.channelId ?? value.whapiChannelId} maxLength={200} aria-label={t('loungeOperations.channel')}
                onChange={e => setValue(value.reportDelivery ? { ...value, reportDelivery: { ...value.reportDelivery, channelId: e.target.value.trim() } }
                  : { ...value, whapiChannelId: e.target.value.trim() })} /></div>
            <div><Typography.Text>{t('loungeOperations.reportRecipient')}</Typography.Text>
              <Input value={value.reportDelivery?.recipient || ''} maxLength={16} aria-label={t('loungeOperations.reportRecipient')}
                placeholder={value.reportDelivery ? '+60123456789' : t('loungeOperations.legacyRecipient')}
                onChange={e => setValue({ ...value, reportDelivery: { provider: value.reportDelivery?.provider || 'whapi',
                  channelId: value.reportDelivery?.channelId ?? value.whapiChannelId, recipient: e.target.value.trim() } })} /></div>
          </div>
          <Button type="primary" loading={busy} onClick={save}>{t('common.save')}</Button>
        </Space> },
        { key: 'batches', label: t('loungeOperations.closing'), children: <>
          <Space wrap style={{ marginBottom: 12 }}>
            <Button icon={<EyeOutlined />} loading={busy} onClick={() => run(async () => setPreview(await loungeRequest('preview', { storeId: store.id })))}>{t('loungeOperations.preview')}</Button>
            <Button icon={<ReloadOutlined />} onClick={load}>{t('common.refresh')}</Button>
          </Space>
          <Table size="small" rowKey="id" dataSource={status?.batches || []} scroll={{ x: 700 }} pagination={{ pageSize: 7 }} columns={[
            { title: t('loungeOperations.date'), dataIndex: 'businessDate' },
            { title: t('common.status'), dataIndex: 'status', render: (s, row: any) => <>
              {String(t(`loungeOperations.status.${s}`, String(s)))}
              {row.lastError && <div><Typography.Text type="danger">{t('loungeOperations.processingError')}</Typography.Text></div>}
            </> },
            { title: t('loungeOperations.remaining'), dataIndex: 'remaining' },
            { title: t('loungeOperations.debt.details'), render: (_, row: any) => <LoungeDebtDetails storeId={store.id}
              reportId={`${store.id}_${row.businessDate}_v${row.revision || 1}`} /> },
            { title: t('loungeOperations.delivery'), dataIndex: 'reportStatus', render: s => String(t(`loungeOperations.status.${s || 'not-sent'}`, String(s || '-'))) },
            { title: t('loungeOperations.preview'), render: (_, row: any) => <Button size="small" disabled={!row.reportText} icon={<EyeOutlined />} onClick={() => Modal.info({
              title: t('loungeOperations.reportEnabled'), zIndex: 2200, width: 640, content: <pre style={{ whiteSpace: 'pre-wrap', overflowWrap: 'anywhere', maxHeight: '65vh', overflowY: 'auto' }}>{row.reportText}</pre>,
            })} /> },
            { title: t('common.actions'), render: (_, row: any) => <Button size="small" loading={busy} onClick={() => Modal.confirm({
              title: t('loungeOperations.retryConfirm'), zIndex: 2200, onOk: () => run(async () => {
                await loungeRequest('retry', { storeId: store.id, businessDate: row.businessDate }); message.success(t('loungeOperations.queued')); await load();
              }),
            })}>{t('loungeOperations.retry')}</Button> },
          ]} />
          {preview && <><Typography.Paragraph>{t('loungeOperations.previewTotal', { total: preview.total })}</Typography.Paragraph>
            <Table size="small" rowKey="sessionId" dataSource={preview.rows} pagination={false} scroll={{ x: 600 }} columns={[
              { title: t('loungeOperations.session'), dataIndex: 'sessionId', ellipsis: true },
              { title: t('common.status'), dataIndex: 'status' },
              { title: t('loungeOperations.fee'), dataIndex: 'pointsDeducted' },
              { title: t('loungeOperations.balance'), dataIndex: 'balance' },
            ]} /></>}
        </> },
        { key: 'test-report', label: t('loungeOperations.test.title'), children: <LoungeTestReport key={store.id} storeId={store.id} /> },
      ]} />
    </Modal>
  </>;
}
