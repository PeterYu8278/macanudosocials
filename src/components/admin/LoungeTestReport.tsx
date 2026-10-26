import { useState } from 'react';
import { Alert, Button, Input, Modal, Space, Typography } from 'antd';
import { EyeOutlined, ReloadOutlined, SendOutlined } from '@ant-design/icons';
import { useTranslation } from 'react-i18next';
import { localBusinessDate } from '../../utils/loungeOperations';
import { loungeRequest } from '../../services/loungeOperations';
import LoungeDebtDetails from './LoungeDebtDetails';
import type { LoungeDebtDetails as DebtDetails } from '../../types/loungeReport';

interface Draft { draftId: string; text: string; recipient: string; channelId: string; expiresAt: string; provider?: 'whapi' | 'whatsmeow'; debtDetails?: DebtDetails }
export default function LoungeTestReport({ storeId }: { storeId: string }) {
  const { t } = useTranslation();
  const [date, setDate] = useState(() => localBusinessDate(new Date()));
  const [draft, setDraft] = useState<Draft | null>(null), [result, setResult] = useState<string | null>(null);
  const [busy, setBusy] = useState(false), [error, setError] = useState('');
  const run = async (work: () => Promise<void>) => {
    setBusy(true); setError('');
    try { await work(); } catch (e: any) { setError(e.message || t('loungeOperations.error')); }
    finally { setBusy(false); }
  };
  const preview = () => run(async () => {
    setDraft(null); setResult(null);
    setDraft(await loungeRequest('test-report-preview', { storeId, businessDate: date }));
  });
  const refresh = () => draft && run(async () => {
    const response = await loungeRequest('test-report-status', { storeId, draftId: draft.draftId });
    setResult(response.status);
  });
  const confirmSend = () => {
    if (!draft || busy || result && result !== 'not-sent') return;
    const snapshot = draft;
    Modal.confirm({
      title: t('loungeOperations.test.confirmTitle'), zIndex: 2200,
      content: t('loungeOperations.test.confirmBody', { recipient: snapshot.recipient, channel: snapshot.channelId,
        provider: snapshot.provider === 'whatsmeow' ? 'Whatsmeow' : 'Whapi' }),
      okText: t('loungeOperations.test.send'),
      onOk: () => run(async () => {
        // A request may have reached the server even if its response is lost.
        setResult('unknown');
        const response = await loungeRequest('test-report-send', { storeId, draftId: snapshot.draftId, confirm: true });
        setResult(response.status);
      }),
    });
  };
  return <Space direction="vertical" size="middle" style={{ width: '100%' }}>
    <Alert type="info" showIcon message={t('loungeOperations.test.notice')} />
    {error && <Alert type="error" showIcon message={error} />}
    <Space wrap>
      <label htmlFor={`report-date-${storeId}`}>{t('loungeOperations.date')}</label>
      <Input id={`report-date-${storeId}`} type="date" value={date} max={localBusinessDate(new Date())} disabled={busy}
        onChange={e => { setDate(e.target.value); setDraft(null); setResult(null); }} />
      <Button icon={<EyeOutlined />} loading={busy} disabled={!date} onClick={preview}>{t('loungeOperations.test.preview')}</Button>
    </Space>
    {draft && <>
      <Typography.Text>{t('loungeOperations.test.target', { recipient: draft.recipient, channel: draft.channelId,
        provider: draft.provider === 'whatsmeow' ? 'Whatsmeow' : 'Whapi' })}</Typography.Text>
      <pre style={{ margin: 0, padding: 12, border: '1px solid var(--cigar-border-primary)', borderRadius: 6,
        whiteSpace: 'pre-wrap', overflowWrap: 'anywhere', maxHeight: '40vh', overflowY: 'auto', fontSize: 13 }}>{draft.text}</pre>
      <Space wrap>
        <LoungeDebtDetails storeId={storeId} reportId={draft.draftId} reportKind="test" details={draft.debtDetails} />
        <Button type="primary" icon={<SendOutlined />} loading={busy} disabled={result !== null && result !== 'not-sent'} onClick={confirmSend}>{t('loungeOperations.test.send')}</Button>
        <Button icon={<ReloadOutlined />} disabled={busy} onClick={refresh}>{t('loungeOperations.test.checkStatus')}</Button>
      </Space>
      {result && <Alert showIcon type={result === 'failed' ? 'error' : result === 'unknown' ? 'warning' : 'info'}
        message={t(`loungeOperations.status.${result}`, { defaultValue: result })} />}
    </>}
  </Space>;
}
