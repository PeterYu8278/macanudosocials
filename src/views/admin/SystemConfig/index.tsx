import React, { useState, useEffect } from 'react'
import {
  Form, InputNumber, Button, Space, Typography, Row, Col,
  Input, Select, Modal, Tag, Spin, DatePicker, message
} from 'antd'
import {
  SaveOutlined, ReloadOutlined, PlusOutlined, DeleteOutlined,
  PlayCircleOutlined, SettingOutlined, ShopOutlined,
  EnvironmentOutlined, PhoneOutlined, MailOutlined,
  CheckCircleOutlined, EditOutlined, CalendarOutlined
} from '@ant-design/icons'
import { useTranslation } from 'react-i18next'
import { useAuthStore } from '../../../store/modules/auth'
import { useFirestoreQuery } from '../../../hooks/useFirestoreQuery'
import { useDetailDrawer } from '../../../hooks/useDetailDrawer'
import { useDeleteConfirm } from '../../../hooks/useDeleteConfirm'
import { getPointsConfig, updatePointsConfig, getDefaultPointsConfig } from '../../../services/firebase/pointsConfig'
import { getMembershipFeeConfig, updateMembershipFeeConfig, getDefaultMembershipFeeConfig } from '../../../services/firebase/membershipFee'
import { processPendingMembershipFees } from '../../../services/firebase/scheduledJobs'
import { isFeatureVisible } from '../../../services/firebase/featureVisibility'
import { getAllStores, createStore, updateStore, deleteStore } from '../../../services/firebase/stores'
import { getAppConfig } from '../../../services/firebase/appConfig'
import { RoomManagement } from '../../../components/admin/RoomManagement'
import type { Store, AppConfig } from '../../../types'
import dayjs from 'dayjs'

const { Text } = Typography
const { Option } = Select

const SystemConfig: React.FC = () => {
  const { t } = useTranslation()
  const { user } = useAuthStore()
  const isMobile = typeof window !== 'undefined' ? window.matchMedia('(max-width: 768px)').matches : false
  const [activeTab, setActiveTab] = useState<'pointsConfig' | 'stores'>('pointsConfig')

  // ── Points Config state ──────────────────────────────────────────────
  const [configForm] = Form.useForm()
  const [configLoading, setConfigLoading] = useState(false)
  const [saving, setSaving] = useState(false)
  const [processingFees, setProcessingFees] = useState(false)
  const [eventsAdminFeatureVisible, setEventsAdminFeatureVisible] = useState(true)

  useEffect(() => {
    const check = async () => {
      const visible = user?.role === 'developer' ? true : await isFeatureVisible('events-admin')
      setEventsAdminFeatureVisible(visible)
    }
    if (user?.id) check()
  }, [user?.role, user?.id])

  useEffect(() => {
    loadConfig()
  }, [])

  // Auto-process pending membership fees on page load (silent)
  useEffect(() => {
    if (!user?.id || (user.role !== 'superAdmin' && user.role !== 'developer')) return
    const run = async () => {
      try { await processPendingMembershipFees() } catch {}
    }
    run()
    const interval = setInterval(run, 24 * 60 * 60 * 1000)
    return () => clearInterval(interval)
  }, [user?.id, user?.role])

  const loadConfig = async () => {
    setConfigLoading(true)
    try {
      const pointsConfig = await getPointsConfig()
      const defaultPointsConfig = getDefaultPointsConfig()
      const membershipFeeConfig = await getMembershipFeeConfig()
      const defaultMembershipFeeConfig = getDefaultMembershipFeeConfig()
      configForm.setFieldsValue({
        ...(pointsConfig || defaultPointsConfig),
        membershipFee: {
          annualFees: (membershipFeeConfig?.annualFees || defaultMembershipFeeConfig.annualFees).map(fee => ({
            ...fee,
            startDate: dayjs(fee.startDate),
            endDate: fee.endDate ? dayjs(fee.endDate) : null,
          })),
        },
      })
    } catch {
      message.error(t('pointsConfig.loadFailed'))
    } finally {
      setConfigLoading(false)
    }
  }

  const onConfigFinish = async (values: any) => {
    if (!user?.id) return
    setSaving(true)
    try {
      const { membershipFee, ...pointsConfigValues } = values
      const pointsResult = await updatePointsConfig(pointsConfigValues, user.id)
      if (membershipFee) {
        const membershipFeeResult = await updateMembershipFeeConfig({
          annualFees: (membershipFee.annualFees || []).map((fee: any) => ({
            amount: fee.amount,
            rate: fee.rate,
            startDate: fee.startDate.toDate(),
            endDate: fee.endDate ? fee.endDate.toDate() : undefined,
          })),
          updatedBy: user.id,
        }, user.id)
        if (pointsResult.success && membershipFeeResult.success) {
          message.success(t('pointsConfig.configSaved'))
        } else {
          message.error(pointsResult.error || membershipFeeResult.error || t('pointsConfig.saveFailed'))
        }
      } else {
        if (pointsResult.success) message.success(t('pointsConfig.saveSuccess'))
        else message.error(pointsResult.error || t('pointsConfig.saveFailed'))
      }
    } catch {
      message.error(t('pointsConfig.saveFailed'))
    } finally {
      setSaving(false)
    }
  }

  const handleProcessMembershipFees = async () => {
    setProcessingFees(true)
    try {
      const result = await processPendingMembershipFees()
      if (result.success) {
        message.success(t('pointsConfig.processComplete', { paid: result.paid, failed: result.failed, processed: result.processed }))
      } else {
        message.error(t('pointsConfig.processFailed'))
      }
    } catch (err: any) {
      message.error(err.message || t('pointsConfig.processFailed'))
    } finally {
      setProcessingFees(false)
    }
  }

  const resetToDefault = () => {
    const defaultPointsConfig = getDefaultPointsConfig()
    const defaultMembershipFeeConfig = getDefaultMembershipFeeConfig()
    configForm.setFieldsValue({
      ...defaultPointsConfig,
      membershipFee: {
        annualFees: defaultMembershipFeeConfig.annualFees.map(fee => ({
          ...fee,
          startDate: dayjs(fee.startDate),
          endDate: fee.endDate ? dayjs(fee.endDate) : null,
        })),
      },
    })
    message.info(t('pointsConfig.resetSuccess'))
  }

  // ── Stores state ─────────────────────────────────────────────────────
  const { data: stores = [], loading: storesLoading, refresh: refreshStores } = useFirestoreQuery(getAllStores)
  const [appConfig, setAppConfig] = useState<AppConfig | null>(null)
  const { item: editingStore, open: isStoreModalVisible, openDrawer: openStoreDrawer, closeDrawer: closeStoreDrawer } = useDetailDrawer<Store | null>()
  const { item: selectedStoreId, open: isRoomModalVisible, openDrawer: openRoomDrawer, closeDrawer: closeRoomDrawer } = useDetailDrawer<string>()
  const [storeForm] = Form.useForm()

  useEffect(() => {
    getAppConfig().then(setAppConfig).catch(console.error)
  }, [])

  const { confirmDelete } = useDeleteConfirm(
    async (id: string) => await deleteStore(id),
    { onSuccess: refreshStores }
  )

  const activePlanDef = appConfig?.subscription?.plans?.find(
    (p: any) => p.id === (appConfig?.subscription?.planId || appConfig?.subscription?.plan)
  )
  const maxStores = activePlanDef?.maxStores ?? appConfig?.subscription?.quota?.maxStores ?? 1
  const activeCount = stores.filter(s => s.status === 'active').length

  const handleAddStore = () => {
    if (activeCount >= maxStores) {
      message.error(t('storeManagement.limitReached', { max: maxStores }))
      return
    }
    storeForm.resetFields()
    openStoreDrawer(null)
  }

  const handleEditStore = (store: Store) => {
    storeForm.setFieldsValue(store)
    openStoreDrawer(store)
  }

  const handleDeleteStore = (id: string) => {
    if (id === 'default') { message.error(t('storeManagement.defaultStoreDeleteError')); return }
    confirmDelete(id)
  }

  const handleStoreModalOk = async () => {
    try {
      const values = await storeForm.validateFields()
      if (editingStore) {
        const res = await updateStore(editingStore.id, values)
        if (res.success) { message.success(t('storeManagement.saveSuccess')); closeStoreDrawer(); refreshStores() }
        else message.error(res.error)
      } else {
        const res = await createStore({ ...values, status: 'active' })
        if (res.success) { message.success(t('storeManagement.createSuccess')); closeStoreDrawer(); refreshStores() }
        else message.error(res.error)
      }
    } catch {}
  }

  // ── Shared tab bar ───────────────────────────────────────────────────
  const tabs = [
    { key: 'pointsConfig', label: <><SettingOutlined style={{ marginRight: 4 }} />{t('pointsConfig.tabs.config')}</> },
    { key: 'stores', label: <><ShopOutlined style={{ marginRight: 4 }} />{t('navigation.stores')}</> },
  ] as const

  const sectionBox = (children: React.ReactNode) => (
    <div style={{ background: 'rgba(255,255,255,0.03)', borderRadius: 8, padding: 16, marginBottom: 16, border: '1px solid rgba(255,255,255,0.1)' }}>
      {children}
    </div>
  )

  const sectionTitle = (label: string) => (
    <h3 style={{ fontSize: 16, fontWeight: 700, marginBottom: 16, backgroundImage: 'linear-gradient(to right,#FDE08D,#C48D3A)', WebkitBackgroundClip: 'text', color: 'transparent' }}>
      {label}
    </h3>
  )

  return (
    <div style={{ minHeight: '100vh', color: '#fff', paddingBottom: isMobile ? 100 : 0 }}>
      {/* Page title */}
      <h1 style={{ fontSize: 22, fontWeight: 800, backgroundImage: 'linear-gradient(to right,#FDE08D,#C48D3A)', WebkitBackgroundClip: 'text', color: 'transparent', marginBottom: 4 }}>
        {t('navigation.systemConfig', 'System Config')}
      </h1>
      <Text style={{ color: 'rgba(255,255,255,0.45)', display: 'block', marginBottom: 20 }}>
        {t('systemConfig.subtitle', 'Points rules & store management — superAdmin only')}
      </Text>

      {/* Tab bar */}
      <div style={{ display: 'flex', borderBottom: '1px solid rgba(244,175,37,0.2)', marginBottom: 20 }}>
        {tabs.map(tab => {
          const isActive = activeTab === tab.key
          return (
            <button
              key={tab.key}
              onClick={() => setActiveTab(tab.key)}
              style={{
                flex: 1,
                padding: '10px 0',
                fontWeight: 800,
                fontSize: 12,
                outline: 'none',
                borderBottom: isActive ? '2px solid #f4af25' : '2px solid transparent',
                borderTop: 'none', borderLeft: 'none', borderRight: 'none',
                cursor: 'pointer',
                background: isActive ? 'linear-gradient(to right,#FDE08D,#C48D3A)' : 'none',
                ...(isActive
                  ? { color: 'transparent', WebkitBackgroundClip: 'text' }
                  : { color: '#A0A0A0' }),
              }}
            >
              {tab.label}
            </button>
          )
        })}
      </div>

      {/* ── Points Config Tab ───────────────────────────────────────── */}
      {activeTab === 'pointsConfig' && (
        configLoading ? (
          <div style={{ textAlign: 'center', padding: '80px 0' }}><Spin size="large" /></div>
        ) : (
          <Form form={configForm} layout="vertical" onFinish={onConfigFinish} initialValues={getDefaultPointsConfig()} className="points-config-form">
            {sectionBox(<>
              {sectionTitle(t('pointsConfig.basicRules'))}
              <Row gutter={16}>
                <Col xs={24} sm={6}>
                  <Form.Item label={<span style={{ color: 'rgba(255,255,255,0.85)' }}>{t('pointsConfig.purchase.perRinggit')}</span>} name={['purchase', 'perRinggit']} rules={[{ required: true, message: t('pointsConfig.validation.required') }]}>
                    <InputNumber min={0} max={100} step={0.1} precision={1} style={{ width: '100%' }} addonAfter={t('pointsConfig.units.pointsPerRM')} />
                  </Form.Item>
                </Col>
                <Col xs={24} sm={6}>
                  <Form.Item label={<span style={{ color: 'rgba(255,255,255,0.85)' }}>{t('pointsConfig.reload.referrerFirstReload')}</span>} name={['reload', 'referrerFirstReload']} rules={[{ required: true, message: t('pointsConfig.validation.required') }]}>
                    <InputNumber min={0} max={10000} style={{ width: '100%' }} addonAfter={t('pointsConfig.units.points')} />
                  </Form.Item>
                </Col>
                <Col xs={24} sm={6}>
                  <Form.Item label={<span style={{ color: 'rgba(255,255,255,0.85)' }}>{t('pointsConfig.reload.referredFirstReload')}</span>} name={['reload', 'referredFirstReload']} rules={[{ required: true, message: t('pointsConfig.validation.required') }]}>
                    <InputNumber min={0} max={10000} style={{ width: '100%' }} addonAfter={t('pointsConfig.units.points')} />
                  </Form.Item>
                </Col>
                {eventsAdminFeatureVisible && (
                  <Col xs={24} sm={6}>
                    <Form.Item label={<span style={{ color: 'rgba(255,255,255,0.85)' }}>{t('pointsConfig.event.registration')}</span>} name={['event', 'registration']} rules={[{ required: true, message: t('pointsConfig.validation.required') }]}>
                      <InputNumber min={0} max={1000} style={{ width: '100%' }} addonAfter={t('pointsConfig.units.points')} />
                    </Form.Item>
                  </Col>
                )}
              </Row>
            </>)}

            {sectionBox(<>
              {sectionTitle(t('pointsConfig.dayPass.title'))}
              <Row gutter={16}>
                <Col xs={24} sm={6}>
                  <Form.Item label={<span style={{ color: 'rgba(255,255,255,0.85)' }}>{t('pointsConfig.dayPass.cost')}</span>} name={['dayPass', 'cost']} rules={[{ required: true, message: t('pointsConfig.validation.required') }]}>
                    <InputNumber min={0} max={10000} style={{ width: '100%' }} addonAfter={t('pointsConfig.units.points')} />
                  </Form.Item>
                </Col>
                <Col xs={24} sm={6}>
                  <Form.Item label={<span style={{ color: 'rgba(255,255,255,0.85)' }}>{t('pointsConfig.dayPass.freeHours')}</span>} name={['dayPass', 'freeHours']} rules={[{ required: true, message: t('pointsConfig.validation.required') }]}>
                    <InputNumber min={0} max={24} style={{ width: '100%' }} addonAfter={t('pointsConfig.dayPass.hours')} />
                  </Form.Item>
                </Col>
                <Col xs={24} sm={6}>
                  <Form.Item label={<span style={{ color: 'rgba(255,255,255,0.85)' }}>{t('pointsConfig.dayPass.hourlyRateAfter')}</span>} name={['dayPass', 'hourlyRateAfter']} rules={[{ required: true, message: t('pointsConfig.validation.required') }]}>
                    <InputNumber min={0} max={1000} style={{ width: '100%' }} addonAfter={t('pointsConfig.dayPass.pointsPerHour')} />
                  </Form.Item>
                </Col>
                <Col xs={24} sm={6}>
                  <Form.Item label={<span style={{ color: 'rgba(255,255,255,0.85)' }}>{t('pointsConfig.dayPass.cigarAllowance')}</span>} name={['dayPass', 'cigarAllowance']} rules={[{ required: true, message: t('pointsConfig.validation.required') }]}>
                    <InputNumber min={0} max={10} style={{ width: '100%' }} addonAfter={t('pointsConfig.dayPass.sticks')} />
                  </Form.Item>
                </Col>
              </Row>
            </>)}

            {sectionBox(<>
              {sectionTitle(t('pointsConfig.annualFee.title'))}
              <Form.List name={['membershipFee', 'annualFees']}>
                {(fields, { add, remove }) => (
                  <>
                    {fields.map(({ key, name, ...restField }) => (
                      <div key={key} style={{ marginBottom: isMobile ? 8 : 16 }}>
                        <Row gutter={16}>
                          <Col xs={12} sm={6}>
                            <Form.Item {...restField} name={[name, 'startDate']} label={<span style={{ color: 'rgba(255,255,255,0.85)' }}>{t('pointsConfig.annualFee.startDate')}</span>} rules={[{ required: true, message: t('pointsConfig.annualFee.startDateRequired') }]}>
                              <DatePicker style={{ width: '100%' }} format="YYYY-MM-DD" />
                            </Form.Item>
                          </Col>
                          <Col xs={12} sm={5}>
                            <Form.Item {...restField} name={[name, 'endDate']} label={<span style={{ color: 'rgba(255,255,255,0.85)' }}>{t('pointsConfig.annualFee.endDate')}</span>}>
                              <DatePicker style={{ width: '100%' }} format="YYYY-MM-DD" />
                            </Form.Item>
                          </Col>
                          <Col xs={12} sm={5}>
                            <Form.Item {...restField} name={[name, 'amount']} label={<span style={{ color: 'rgba(255,255,255,0.85)' }}>{t('pointsConfig.annualFee.amount')}</span>} rules={[{ required: true, message: t('pointsConfig.annualFee.amountRequired') }]}>
                              <InputNumber min={0} max={100000} style={{ width: '100%' }} addonAfter={t('pointsConfig.units.points')} />
                            </Form.Item>
                          </Col>
                          <Col xs={12} sm={5}>
                            <Form.Item {...restField} name={[name, 'rate']} label={<span style={{ color: 'rgba(255,255,255,0.85)' }}>{t('pointsConfig.annualFee.rate')}</span>} rules={[{ required: true, message: t('pointsConfig.annualFee.rateRequired') }]}>
                              <InputNumber min={0} max={1000} style={{ width: '100%' }} addonAfter={t('pointsConfig.dayPass.pointsPerHour')} />
                            </Form.Item>
                          </Col>
                        </Row>
                        {fields.length > 1 && (
                          <Form.Item style={{ marginTop: 8, marginBottom: 0 }}>
                            <Button danger icon={<DeleteOutlined />} onClick={() => remove(name)} block style={{ background: 'rgba(255,77,79,0.2)', border: '1px solid rgba(255,77,79,0.5)', color: '#ff4d4f' }}>
                              {t('pointsConfig.annualFee.deleteConfig')}
                            </Button>
                          </Form.Item>
                        )}
                      </div>
                    ))}
                    <Form.Item style={{ marginTop: 8 }}>
                      <Button onClick={() => add()} block icon={<PlusOutlined />} style={{ background: 'linear-gradient(to right,#FDE08D,#C48D3A)', border: 'none', color: '#111', fontWeight: 700, boxShadow: '0 4px 15px rgba(244,175,37,0.35)' }}>
                        {t('pointsConfig.annualFee.addConfig')}
                      </Button>
                    </Form.Item>
                  </>
                )}
              </Form.List>
            </>)}

            <div style={{ textAlign: 'right', marginTop: 24 }}>
              <Space>
                <Button icon={<PlayCircleOutlined />} onClick={handleProcessMembershipFees} loading={processingFees} style={{ background: 'rgba(255,255,255,0.1)', border: '1px solid rgba(255,255,255,0.2)', color: '#fff' }}>
                  {t('pointsConfig.processDeduction')}
                </Button>
                <Button icon={<ReloadOutlined />} onClick={resetToDefault} disabled={saving} style={{ background: 'rgba(255,255,255,0.1)', border: '1px solid rgba(255,255,255,0.2)', color: '#fff' }}>
                  {t('pointsConfig.actions.resetToDefault')}
                </Button>
                <Button icon={<SaveOutlined />} htmlType="submit" loading={saving} style={{ background: 'linear-gradient(to right,#FDE08D,#C48D3A)', border: 'none', color: '#111', fontWeight: 700, boxShadow: '0 4px 15px rgba(244,175,37,0.35)' }}>
                  {t('pointsConfig.actions.saveConfig')}
                </Button>
              </Space>
            </div>
          </Form>
        )
      )}

      {/* ── Stores Tab ──────────────────────────────────────────────── */}
      {activeTab === 'stores' && (
        <div>
          {/* Header */}
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 20 }}>
            <Text style={{ color: 'rgba(255,255,255,0.45)', fontSize: 13 }}>{t('storeManagement.subtitle')}</Text>
            <Button
              type="primary"
              icon={<PlusOutlined />}
              onClick={handleAddStore}
              style={{ background: 'linear-gradient(to right,#FDE08D,#C48D3A)', color: '#111', border: 'none', fontWeight: 800, borderRadius: 20, height: 40, paddingInline: 24, boxShadow: '0 4px 15px rgba(196,141,58,0.3)' }}
            >
              {t('storeManagement.addStore')}
            </Button>
          </div>

          {/* Stats */}
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: isMobile ? 8 : 16, marginBottom: 24 }}>
            {[
              { label: t('storeManagement.total'), value: stores.length, color: '#FDE08D', icon: <ShopOutlined /> },
              { label: t('storeManagement.active'), value: activeCount, color: '#52c41a', icon: <CheckCircleOutlined /> },
              { label: t('storeManagement.quota'), value: `${activeCount}/${maxStores}`, color: activeCount >= maxStores ? '#ff4d4f' : '#C48D3A', icon: <EnvironmentOutlined /> },
            ].map(stat => (
              <div key={stat.label} style={{ background: 'rgba(255,255,255,0.03)', border: '1px solid rgba(255,255,255,0.08)', borderRadius: 14, padding: isMobile ? '14px 12px' : '18px 20px', textAlign: 'center' }}>
                <div style={{ fontSize: isMobile ? 20 : 28, marginBottom: 4, color: stat.color, opacity: 0.7 }}>{stat.icon}</div>
                <div style={{ fontSize: isMobile ? 18 : 24, fontWeight: 800, color: stat.color, lineHeight: 1 }}>{stat.value}</div>
                <div style={{ color: 'rgba(255,255,255,0.45)', fontSize: isMobile ? 10 : 12, marginTop: 4 }}>{stat.label}</div>
              </div>
            ))}
          </div>

          {/* Store cards */}
          {storesLoading ? (
            <div style={{ textAlign: 'center', padding: 60 }}><Spin size="large" /></div>
          ) : stores.length === 0 ? (
            <div style={{ background: 'rgba(255,255,255,0.03)', border: '1px dashed rgba(255,255,255,0.15)', borderRadius: 16, padding: '60px 20px', textAlign: 'center' }}>
              <ShopOutlined style={{ fontSize: 48, color: 'rgba(253,224,141,0.3)', marginBottom: 16 }} />
              <div style={{ color: 'rgba(255,255,255,0.5)', fontSize: 15 }}>{t('storeManagement.noStores')}</div>
            </div>
          ) : (
            <div style={{ display: 'grid', gridTemplateColumns: isMobile ? '1fr' : 'repeat(auto-fill, minmax(340px, 1fr))', gap: 16 }}>
              {stores.map(store => (
                <div key={store.id} className="store-card" style={{ position: 'relative', background: 'rgba(255,255,255,0.03)', border: '1px solid rgba(244,175,37,0.15)', borderRadius: 16, overflow: 'hidden', transition: 'all 0.3s cubic-bezier(0.4,0,0.2,1)' }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '16px 20px 12px', borderBottom: '1px solid rgba(255,255,255,0.05)' }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 10, flex: 1, minWidth: 0 }}>
                      <div style={{ width: 38, height: 38, borderRadius: 10, background: 'linear-gradient(135deg,rgba(253,224,141,0.15),rgba(196,141,58,0.1))', border: '1px solid rgba(253,224,141,0.2)', display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>
                        <ShopOutlined style={{ color: '#FDE08D', fontSize: 18 }} />
                      </div>
                      <div style={{ minWidth: 0, flex: 1 }}>
                        <div style={{ color: '#fff', fontSize: 16, fontWeight: 700, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{store.name}</div>
                        <Tag color={store.status === 'active' ? 'success' : 'default'} style={{ fontSize: 10, borderRadius: 4, border: 'none', marginTop: 2, padding: '0 6px', fontWeight: 600 }}>
                          {store.status === 'active' ? `● ${t('storeManagement.active').toUpperCase()}` : `○ ${t('storeManagement.inactive').toUpperCase()}`}
                        </Tag>
                      </div>
                    </div>
                    <Space size={0}>
                      <Button type="text" size="small" icon={<EditOutlined />} onClick={() => handleEditStore(store)} style={{ color: '#FDE08D' }} />
                      <Button type="text" size="small" danger icon={<DeleteOutlined />} onClick={() => handleDeleteStore(store.id)} disabled={store.id === 'default'} />
                    </Space>
                  </div>
                  <div style={{ padding: '14px 20px 16px' }}>
                    <div style={{ display: 'flex', gap: 8, marginBottom: 10, alignItems: 'flex-start' }}>
                      <EnvironmentOutlined style={{ color: 'rgba(253,224,141,0.5)', fontSize: 13, marginTop: 3, flexShrink: 0 }} />
                      <Text style={{ color: 'rgba(255,255,255,0.6)', fontSize: 13, display: '-webkit-box', WebkitLineClamp: 2, WebkitBoxOrient: 'vertical' as any, overflow: 'hidden' }}>{store.address || '-'}</Text>
                    </div>
                    <div style={{ display: 'flex', flexWrap: 'wrap', gap: '6px 16px' }}>
                      {store.phone && <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}><PhoneOutlined style={{ color: 'rgba(253,224,141,0.4)', fontSize: 12 }} /><Text style={{ color: 'rgba(255,255,255,0.5)', fontSize: 12 }}>{store.phone}</Text></div>}
                      {store.email && <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}><MailOutlined style={{ color: 'rgba(253,224,141,0.4)', fontSize: 12 }} /><Text style={{ color: 'rgba(255,255,255,0.5)', fontSize: 12 }}>{store.email}</Text></div>}
                    </div>
                  </div>
                  <div style={{ padding: '12px 20px', borderTop: '1px solid rgba(255,255,255,0.05)', display: 'flex', justifyContent: 'flex-end', background: 'rgba(255,255,255,0.01)' }}>
                    <Button type="link" size="small" icon={<CalendarOutlined />} onClick={() => openRoomDrawer(store.id)} style={{ color: '#FDE08D', padding: 0, height: 'auto', display: 'flex', alignItems: 'center', gap: 4 }}>
                      {t('roomManagement.roomConfigTitle', 'Room Management')}
                    </Button>
                  </div>
                  <div style={{ position: 'absolute', left: 0, top: 0, bottom: 0, width: 3, background: store.status === 'active' ? 'linear-gradient(to bottom,#FDE08D,#C48D3A)' : 'rgba(255,255,255,0.1)', borderRadius: '16px 0 0 16px' }} />
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {/* Store create/edit modal */}
      <Modal
        title={<span style={{ color: '#FDE08D', fontSize: 18, fontWeight: 700 }}>{editingStore ? t('storeManagement.editStore') : t('storeManagement.addStore')}</span>}
        open={isStoreModalVisible}
        onOk={handleStoreModalOk}
        onCancel={closeStoreDrawer}
        okText={editingStore ? t('common.save') : t('common.add')}
        className="dark-modal"
        width={520}
        okButtonProps={{ style: { background: 'linear-gradient(to right,#FDE08D,#C48D3A)', color: '#111', border: 'none', fontWeight: 700, borderRadius: 8 } }}
        cancelButtonProps={{ style: { background: 'rgba(255,255,255,0.05)', border: '1px solid rgba(255,255,255,0.15)', color: '#fff', borderRadius: 8 } }}
        styles={{ mask: { backdropFilter: 'blur(6px)' }, content: { background: '#1a1a1a', color: '#fff', borderRadius: 16, border: '1px solid rgba(244,175,37,0.15)' } }}
      >
        <Form form={storeForm} layout="vertical" initialValues={{ status: 'active' }}>
          <Form.Item name="name" label={<span style={{ color: '#ccc' }}>{t('storeManagement.storeName')}</span>} rules={[{ required: true, message: t('common.required') }]}>
            <Input placeholder="E.g., KL Main Branch" />
          </Form.Item>
          <Form.Item name="address" label={<span style={{ color: '#ccc' }}>{t('storeManagement.address')}</span>} rules={[{ required: true, message: t('common.required') }]}>
            <Input.TextArea rows={3} placeholder="Full address" />
          </Form.Item>
          <Row gutter={16}>
            <Col span={12}>
              <Form.Item name="phone" label={<span style={{ color: '#ccc' }}>{t('storeManagement.phone')}</span>} rules={[{ required: true, message: t('common.required') }]}>
                <Input placeholder="Contact number" />
              </Form.Item>
            </Col>
            <Col span={12}>
              <Form.Item name="status" label={<span style={{ color: '#ccc' }}>{t('storeManagement.status')}</span>}>
                <Select dropdownStyle={{ background: '#1a1a1a' }}>
                  <Option value="active">{t('storeManagement.active')}</Option>
                  <Option value="inactive">{t('storeManagement.inactive')}</Option>
                </Select>
              </Form.Item>
            </Col>
          </Row>
          <Form.Item name="email" label={<span style={{ color: '#ccc' }}>{t('storeManagement.email')}</span>} rules={[{ required: true, message: t('common.required') }, { type: 'email', message: t('auth.emailInvalid') }]}>
            <Input placeholder="Store email" />
          </Form.Item>
        </Form>
      </Modal>

      {/* Room management modal */}
      <Modal
        title={<span style={{ color: '#FDE08D', fontSize: 18, fontWeight: 700 }}>{t('roomManagement.roomConfigTitle', 'Room Management')} - {stores.find(s => s.id === selectedStoreId)?.name}</span>}
        open={isRoomModalVisible}
        onCancel={closeRoomDrawer}
        footer={null}
        width={1000}
        className="dark-modal"
        styles={{ content: { background: 'linear-gradient(180deg,#221c10 0%,#181611 100%)', border: '1px solid rgba(244,175,37,0.6)' }, header: { background: 'transparent', borderBottom: '1px solid rgba(244,175,37,0.6)' }, body: { background: 'transparent', paddingTop: 16 } }}
      >
        {selectedStoreId && <RoomManagement filterStoreId={selectedStoreId} hideViewBookings={true} />}
      </Modal>

      <style dangerouslySetInnerHTML={{ __html: `.store-card:hover{border-color:rgba(253,224,141,0.4)!important;background:rgba(253,224,141,0.03)!important;box-shadow:0 8px 32px rgba(0,0,0,0.3),0 0 0 1px rgba(253,224,141,0.1);transform:translateY(-2px)}` }} />
    </div>
  )
}

export default SystemConfig
