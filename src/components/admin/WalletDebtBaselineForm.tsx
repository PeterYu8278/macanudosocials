import { useState } from 'react';
import { Alert, Button, Checkbox, Form, Input, InputNumber, Modal } from 'antd';
import { useTranslation } from 'react-i18next';
import { useAuthStore } from '../../store/modules/auth';
import { loungeRequest } from '../../services/loungeOperations';

export default function WalletDebtBaselineForm({ storeId, userId }: { storeId: string; userId: string }) {
  const { t } = useTranslation(), { user } = useAuthStore();
  const [form] = Form.useForm();
  const [open, setOpen] = useState(false), [busy, setBusy] = useState(false), [version, setVersion] = useState(0);
  const [error, setError] = useState(''), [saved, setSaved] = useState(false);
  const [loaded, setLoaded] = useState(false);
  const label = (key: string) => t(`loungeOperations.debt.${key}`);
  if (!['superAdmin', 'developer'].includes(user?.role || '')) return null;
  const start = async () => {
    setOpen(true); setBusy(true); setError(''); setSaved(false); setLoaded(false); form.resetFields();
    try { const result = await loungeRequest('debt-baseline', { storeId, userId }); setVersion(result.baseline?.version || 0); setLoaded(true); }
    catch (e: any) { setError(e.message); }
    finally { setBusy(false); }
  };
  const save = async () => {
    const values = await form.validateFields();
    setBusy(true); setError('');
    try {
      const localTime = values.at.length === 16 ? `${values.at}:00` : values.at;
      await loungeRequest('save-debt-baseline', { storeId, userId, ...values, at: new Date(`${localTime}+08:00`).getTime(), expectedVersion: version });
      setSaved(true);
    } catch (e: any) { setError(e.message); }
    finally { setBusy(false); }
  };
  return <>
    <Button onClick={start}>{label('registerBaseline')}</Button>
    <Modal title={label('registerBaseline')} open={open} onCancel={() => setOpen(false)} zIndex={2500}
      okText={t('common.save')} confirmLoading={busy} onOk={save} okButtonProps={{ disabled: busy || saved || !loaded }}>
      <Alert type="warning" showIcon message={label('baselineWarning')} />
      {error && <Alert type="error" message={error} action={<Button onClick={start}>{t('common.retry')}</Button>} />}
      {saved ? <Alert type="success" message={label('baselineSaved')} /> : <Form form={form} layout="vertical" disabled={busy}>
        <Form.Item name="at" label={label('baselineAt')} rules={[{ required: true }]}><Input type="datetime-local" step={1} /></Form.Item>
        <Form.Item name="balance" label={label('baselineBalance')} rules={[{ required: true }]}><InputNumber precision={2} /></Form.Item>
        <Form.Item name="evidenceReference" label={label('evidenceReference')} rules={[{ required: true, min: 5, max: 500 }]}><Input /></Form.Item>
        <Form.Item name="note" label={label('reviewNote')} rules={[{ required: true, min: 10, max: 1000 }]}><Input.TextArea rows={3} /></Form.Item>
        <Form.Item name="confirm" valuePropName="checked" rules={[{ validator: (_, value) => value === true ? Promise.resolve() : Promise.reject(new Error(label('baselineConfirm'))) }]}>
          <Checkbox>{label('baselineConfirm')}</Checkbox>
        </Form.Item>
      </Form>}
    </Modal>
  </>;
}
