import React, { useEffect, useState } from 'react'
import { Alert, App, Button, Input, Select, Space, Table, Typography } from 'antd'
import { DeleteOutlined, ReloadOutlined, SearchOutlined } from '@ant-design/icons'
import { useTranslation } from 'react-i18next'
import { auth } from '../../config/firebase'

interface Preview { token: string; total: number; counts: Record<string, number> }

export const LegacyMigrationMaintenance: React.FC<{
  batchId: string; disabled: boolean; canOverwrite: boolean;
  phones: string[];
  onBusyChange: (busy: boolean) => void;
  onCleaned: (batchId: string, overwrite: boolean) => Promise<void>;
}> = ({ batchId, disabled, canOverwrite, phones, onBusyChange, onCleaned }) => {
  const { t } = useTranslation()
  const { message, modal } = App.useApp()
  const [batches, setBatches] = useState<Array<{ id: string; fileName: string }>>([])
  const [selected, setSelected] = useState(batchId)
  const [preview, setPreview] = useState<Preview | null>(null)
  const [busy, setBusy] = useState(false)
  const [listLoading, setListLoading] = useState(false)
  const [listError, setListError] = useState<string | null>(null)
  const [listRevision, setListRevision] = useState(0)
  const [manualBatch, setManualBatch] = useState('')
  const request = async (data: object) => {
    const token = await auth.currentUser?.getIdToken()
    if (!token) throw new Error(t('usersAdmin.migrationAuthenticationRequired'))
    const response = await fetch('/.netlify/functions/legacy-migration-maintenance', {
      method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
      body: JSON.stringify(data),
    })
    const raw = await response.text()
    let body: Record<string, any>
    try { body = JSON.parse(raw) }
    catch { throw new Error(t('usersAdmin.migrationBackendUnavailable')) }
    if (!body || typeof body !== 'object') throw new Error(t('usersAdmin.migrationBackendUnavailable'))
    if (response.status >= 500) throw new Error(t('usersAdmin.migrationBackendUnavailable'))
    if (!response.ok || !body.success) throw new Error(body.error || t('usersAdmin.migrationStageFailed'))
    return body
  }
  useEffect(() => {
    let cancelled = false
    setListLoading(true); setListError(null)
    void request({ action: 'list' }).then(body => {
      if (!Array.isArray(body.batches)) throw new Error(t('usersAdmin.migrationBatchListFailed'))
      if (!cancelled) setBatches(body.batches)
    })
      .catch(error => { if (!cancelled) { setBatches([]); setListError(error.message) } })
      .finally(() => { if (!cancelled) setListLoading(false) })
    return () => { cancelled = true }
  }, [batchId, listRevision])
  useEffect(() => { setSelected(batchId); setPreview(null); setManualBatch('') }, [batchId])
  const inspect = async () => {
    setBusy(true); setPreview(null)
    try {
      const result = await request({ action: 'preview', batchId: selected })
      if (typeof result.token !== 'string' || !Number.isInteger(result.total) || result.total < 0
        || !result.counts || typeof result.counts !== 'object') throw new Error(t('usersAdmin.migrationStageFailed'))
      setPreview({ token: result.token, total: result.total, counts: result.counts })
    }
    catch (error) { message.error(error instanceof Error ? error.message : t('usersAdmin.migrationStageFailed')) }
    finally { setBusy(false) }
  }
  const confirm = (overwrite: boolean) => {
    if (!preview) return
    const target = selected, checked = preview
    modal.confirm({
      title: t(overwrite ? 'usersAdmin.migrationOverwriteBatch' : 'usersAdmin.migrationDeleteBatch'),
      zIndex: 2110,
      content: t('usersAdmin.migrationCleanupConfirm', { batchId: target, count: checked.total }),
      okText: t('common.confirm'), cancelText: t('common.cancel'), okButtonProps: { danger: true },
      onOk: async () => {
        setBusy(true); onBusyChange(true)
        try {
          const result = await request({ action: 'archive', batchId: target, confirmBatchId: target, previewToken: checked.token,
            ...(overwrite ? { overwrite: true, phones } : {}) })
          setPreview(null)
          message.success(t('usersAdmin.migrationCleanupDone', { count: result.archived, backup: result.backupPath }))
          await onCleaned(target, overwrite)
        } catch (error) {
          setPreview(null)
          message.error(error instanceof Error ? error.message : t('usersAdmin.migrationStageFailed'))
          throw error
        } finally { setBusy(false); onBusyChange(false) }
      },
    })
  }
  return <section style={{ minWidth: 0 }}>
    <Typography.Title level={5}>{t('usersAdmin.migrationBatchMaintenance')}</Typography.Title>
    <Alert type="warning" showIcon message={t('usersAdmin.migrationCleanupWarning')} style={{ marginBottom: 12 }} />
    {listError && <Alert type="error" showIcon message={t('usersAdmin.migrationBatchListFailed')}
      description={listError} style={{ marginBottom: 12 }} action={<Button icon={<ReloadOutlined />}
        disabled={busy || disabled} onClick={() => setListRevision(value => value + 1)}>{t('common.retry')}</Button>} />}
    {!listError && !listLoading && !batches.length && <Alert type="info" showIcon
      message={t('usersAdmin.migrationNoRegisteredBatches')} style={{ marginBottom: 12 }} />}
    <Space wrap style={{ width: '100%' }}>
      <Select aria-label={t('usersAdmin.migrationTargetBatch')} placeholder={t('usersAdmin.migrationTargetBatch')}
        value={selected} loading={listLoading} disabled={busy || disabled} style={{ width: 360, maxWidth: '100%' }}
        onChange={value => { setSelected(value); setPreview(null) }} showSearch optionFilterProp="label"
        options={[...batches, ...(!batches.some(batch => batch.id === batchId) ? [{ id: batchId, fileName: t('usersAdmin.migrationCurrentWorkbook') }] : []),
          ...(selected !== batchId && !batches.some(batch => batch.id === selected) ? [{ id: selected, fileName: t('usersAdmin.migrationManualBatch') }] : [])]
          .map(batch => ({ value: batch.id, label: `${batch.fileName} · ${batch.id}` }))} />
      <Button icon={<SearchOutlined />} onClick={inspect} loading={busy} disabled={disabled}>{t('usersAdmin.migrationPreviewCleanup')}</Button>
      <Button danger icon={<DeleteOutlined />} disabled={busy || disabled || !preview?.total} onClick={() => confirm(false)}>{t('usersAdmin.migrationDeleteBatch')}</Button>
      <Button icon={<ReloadOutlined />} disabled={busy || disabled || !canOverwrite || !preview} onClick={() => confirm(true)}>{t('usersAdmin.migrationOverwriteBatch')}</Button>
    </Space>
    <Input.Search value={manualBatch} onChange={event => setManualBatch(event.target.value)}
      placeholder={t('usersAdmin.migrationManualBatchPlaceholder')} aria-label={t('usersAdmin.migrationManualBatch')}
      disabled={busy || disabled} style={{ marginTop: 12, maxWidth: 520 }}
      onSearch={value => {
        const id = value.trim()
        if (!/^legacy_[a-f0-9]{24}$/.test(id)) { message.error(t('usersAdmin.migrationInvalidBatchId')); return }
        setSelected(id); setPreview(null)
      }} />
    {preview && <Table size="small" pagination={false} rowKey="collection" style={{ marginTop: 12 }}
      dataSource={Object.entries(preview.counts).map(([collection, count]) => ({ collection, count }))}
      columns={[{ title: t('usersAdmin.migrationCollection'), dataIndex: 'collection' }, { title: t('usersAdmin.migrationAffectedRecords'), dataIndex: 'count' }]} />}
  </section>
}
