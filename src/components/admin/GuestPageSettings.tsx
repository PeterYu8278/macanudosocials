import { useEffect, useState } from 'react';
import { Alert, Button, Card, Input, InputNumber, Space, Table, Typography } from 'antd';
import { useTranslation } from 'react-i18next';
import { useAuthStore } from '../../store/modules/auth';
import { guestPageConfig, currentGuestMembership, type GuestPageConfig } from '../../config/guestPage';
import { saveGuestPage } from '../../services/firebase/guestPage';

export default function GuestPageSettings({ value, onSaved }: { value?: GuestPageConfig; onSaved: () => void }) {
  const { t } = useTranslation(), { user } = useAuthStore();
  const [draft, setDraft] = useState(() => structuredClone(guestPageConfig(value)));
  const [busy, setBusy] = useState(false), [feedback, setFeedback] = useState(''), [failed, setFailed] = useState(false);
  const [amount, setAmount] = useState(299), [credit, setCredit] = useState(100), [cigars, setCigars] = useState(25), [date, setDate] = useState('');
  useEffect(() => { setDraft(structuredClone(guestPageConfig(value))); }, [value]);
  const label = (key: string) => t(`guestPublic.${key}`);
  const change = (key: 'loungeName' | 'address' | 'phone' | 'opensAt' | 'closesAt', next: string) => setDraft(v => ({ ...v, [key]: next }));
  const save = async () => {
    if (!user) return;
    setBusy(true); setFeedback('');
    try { const next = await saveGuestPage(draft, user.id); setDraft(next); setFailed(false); setFeedback(t('common.saveSuccess')); onSaved(); }
    catch (e: any) { setFailed(true); setFeedback(t(`guestPublic.errors.${e.message}`, { defaultValue: label('saveError') })); }
    finally { setBusy(false); }
  };
  const append = () => {
    const at = Date.parse(`${date}:00+08:00`);
    if (!Number.isFinite(at) || at <= Date.now()) { setFailed(true); setFeedback(label('futureDate')); return; }
    const template = currentGuestMembership(draft) || draft.membershipVersions[0];
    setDraft(v => ({ ...v, membershipVersions: [...v.membershipVersions, { ...template, id: crypto.randomUUID(),
      effectiveAt: new Date(at).toISOString(), annualPrice: amount, credit, cigarsPerYear: cigars }] }));
    setDate(''); setFeedback('');
  };
  return <Card title={label('settingsTitle')} style={{ marginBottom: 24 }}>
    <Space direction="vertical" style={{ width: '100%' }} size="middle">
      <Alert type="info" showIcon message={label('publicOnly')} />
      {feedback && <Alert type={failed ? 'error' : 'success'} showIcon message={feedback} />}
      {(['loungeName', 'address', 'phone', 'opensAt', 'closesAt'] as const).map(key => <label key={key}>
        {label(key)}<Input aria-label={label(key)} type={key.endsWith('At') ? 'time' : 'text'}
          value={draft[key]} disabled={busy} onChange={e => change(key, e.target.value)} />
      </label>)}
      <Typography.Text>{label('historyHelp')}</Typography.Text>
      <Table size="small" rowKey="id" scroll={{ x: 480 }} pagination={{ pageSize: 5 }} dataSource={draft.membershipVersions}
        columns={[{ title: label('effectiveAt'), dataIndex: 'effectiveAt', render: value => new Intl.DateTimeFormat('en-GB', {
          timeZone: 'Asia/Kuala_Lumpur', dateStyle: 'medium', timeStyle: 'short' }).format(new Date(value)) },
        { title: label('annualFee'), dataIndex: 'annualPrice' }, { title: label('creditAmount'), dataIndex: 'credit' },
        { title: label('cigarCount'), dataIndex: 'cigarsPerYear' }]} />
      <Space wrap>
        <label>{label('annualFee')}<InputNumber aria-label={label('annualFee')} min={0} max={100000} precision={2} value={amount} onChange={v => setAmount(v ?? 0)} /></label>
        <label>{label('creditAmount')}<InputNumber aria-label={label('creditAmount')} min={0} max={100000} precision={2} value={credit} onChange={v => setCredit(v ?? 0)} /></label>
        <label>{label('cigarCount')}<InputNumber aria-label={label('cigarCount')} min={0} max={1000} precision={0} value={cigars} onChange={v => setCigars(v ?? 0)} /></label>
        <label>{label('effectiveAt')}<Input type="datetime-local" value={date} onChange={e => setDate(e.target.value)} /></label>
        <Button htmlType="button" disabled={busy || draft.membershipVersions.length >= 100} onClick={append}>{label('addVersion')}</Button>
      </Space>
      <Button type="primary" htmlType="button" loading={busy} onClick={save}>{t('common.save')}</Button>
    </Space>
  </Card>;
}
