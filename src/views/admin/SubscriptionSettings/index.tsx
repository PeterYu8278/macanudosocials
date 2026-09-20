import React, { useState, useEffect } from 'react';
import { Card, Form, Switch, Select, DatePicker, Button, message, Spin, Alert, Tabs, Input, InputNumber, Space, Table, Tag } from 'antd';
import { MinusCircleOutlined, PlusOutlined } from '@ant-design/icons';
import { useTranslation } from 'react-i18next';
import dayjs from 'dayjs';
import { getAppConfig, updateAppConfig } from '../../../services/firebase/appConfig';
import { useAuthStore } from '../../../store/modules/auth';
import { collection, query, orderBy, getDocs, doc, updateDoc, where, limit } from 'firebase/firestore';
import { db } from '../../../config/firebase';
import { GLOBAL_COLLECTIONS } from '../../../config/globalCollections';
import type { AppConfig, SubscriptionRequest, User } from '../../../types';
import { getAllStores } from '../../../services/firebase/stores';
import PaymentTester from '../../../components/admin/PaymentTester';
import { useFirestoreQuery } from '../../../hooks/useFirestoreQuery';

const fetchAdmins = async (): Promise<User[]> => {
  const q = query(
    collection(db, 'users'),
    where('role', 'in', ['superAdmin', 'admin']),
    limit(50)
  );
  const snapshot = await getDocs(q);
  const data: User[] = [];
  snapshot.forEach(d => {
    data.push({ id: d.id, ...d.data() } as User);
  });
  return data;
};

const AdminAccountList: React.FC = () => {
  const { t } = useTranslation();
  const { data: admins = [], loading, refresh: refreshAdmins } = useFirestoreQuery(fetchAdmins);
  const { data: stores = [] } = useFirestoreQuery(getAllStores);

  const handleUpdateStore = async (userId: string, storeId: string) => {
    try {
      const userRef = doc(db, 'users', userId);
      await updateDoc(userRef, { storeId });
      message.success(t('subscriptionSettings.userStoreUpdated'));
      refreshAdmins();
    } catch (error) {
      message.error(t('subscriptionSettings.updateStoreFailed'));
    }
  };

  const columns = [
    {
      title: t('subscriptionSettings.colName'),
      dataIndex: 'displayName',
      key: 'displayName',
      render: (text: string, record: User) => (
        <Space>
          <span>{text || t('subscriptionSettings.noName')}</span>
          {record.role === 'superAdmin' && <Tag color="gold">SUPER</Tag>}
          {record.role === 'admin' && <Tag color="blue">{t('users.storeAdmin')}</Tag>}
        </Space>
      )
    },
    {
      title: t('subscriptionSettings.colEmail'),
      dataIndex: 'email',
      key: 'email',
    },
    {
      title: t('subscriptionSettings.assignedStore'),
      dataIndex: 'storeId',
      key: 'storeId',
      render: (storeId: string, record: User) => {
        if (record.role === 'superAdmin') return <span style={{ color: '#888' }}>{t('subscriptionSettings.globalAllStores')}</span>;

        return (
          <Select
            value={storeId}
            style={{ width: 200 }}
            placeholder={t('subscriptionSettings.selectStore')}
            onChange={(val) => handleUpdateStore(record.id, val)}
            dropdownStyle={{ background: '#1a1a1a', border: '1px solid #444' }}
          >
            {stores.map(s => (
              <Option key={s.id} value={s.id}>{s.name}</Option>
            ))}
          </Select>
        );
      }
    }
  ];

  return (
    <Card style={{ background: 'rgba(255,255,255,0.05)', border: '1px solid rgba(255,255,255,0.1)', padding: 0 }}>
      <Table
        dataSource={admins}
        columns={columns}
        rowKey="id"
        loading={loading}
        pagination={false}
        scroll={{ x: 'max-content' }}
        className="custom-table"
      />
    </Card>
  );
};


const { Option } = Select;
const { TabPane } = Tabs;
type SubTabKey = 'settings' | 'records' | 'accounts' | 'payment';

const fetchRequests = async (): Promise<SubscriptionRequest[]> => {
  const q = query(collection(db, GLOBAL_COLLECTIONS.SUBSCRIPTION_REQUESTS), orderBy('createdAt', 'desc'), limit(100));
  const snapshot = await getDocs(q);
  const data: SubscriptionRequest[] = [];
  snapshot.forEach(d => {
    data.push({ id: d.id, ...d.data() } as SubscriptionRequest);
  });
  return data;
};

export const SubscriptionSettings: React.FC = () => {
  const { t } = useTranslation();
  const [form] = Form.useForm();
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const { user, isSuperAdmin } = useAuthStore();
  const [appConfig, setAppConfig] = useState<AppConfig | null>(null);
  const [activeTab, setActiveTab] = useState<SubTabKey>('settings');

  const { data: requests = [], loading: loadingRequests, refresh: refreshRequests } = useFirestoreQuery(fetchRequests);
  const [counts, setCounts] = useState({ stores: 0, superAdmins: 0, admins: 0 });

  useEffect(() => {
    loadConfig();
    loadCounts();
  }, []);

  const loadCounts = async () => {
    try {
      const stores = await getAllStores();

      const adminQuery = query(
        collection(db, 'users'),
        where('role', 'in', ['superAdmin', 'admin']),
        limit(50)
      );
      const adminSnapshot = await getDocs(adminQuery);
      let superAdmins = 0;
      let admins = 0;
      adminSnapshot.forEach(doc => {
        const data = doc.data();
        if (data.role === 'superAdmin') superAdmins++;
        else if (data.role === 'admin') admins++;
      });

      setCounts({ stores: stores.length, superAdmins, admins });
    } catch (error) {
      console.error('Failed to load counts:', error);
    }
  };

  const loadConfig = async () => {
    try {
      setLoading(true);
      const config = await getAppConfig();
      if (config) {
        setAppConfig(config);

        // Default plans if none exist
        const defaultPlans = config.subscription?.plans || [
          { id: 'basic', name: 'Basic', fee: 2400, maxMembers: 50, validPeriodMonth: 12, maxStores: 1, maxSuperAdmins: 1, maxAdmins: 3 },
          { id: 'pro', name: 'Pro', fee: 4500, maxMembers: 150, validPeriodMonth: 12, maxStores: 3, maxSuperAdmins: 2, maxAdmins: 10 },
          { id: 'premium', name: 'Premium', fee: 6000, maxMembers: 300, validPeriodMonth: 12, maxStores: 10, maxSuperAdmins: 5, maxAdmins: 30 }
        ];

        form.setFieldsValue({
          isActive: config.subscription?.isActive || false,
          planId: config.subscription?.planId || config.subscription?.plan || 'basic',
          plans: defaultPlans,
          quota: config.subscription?.quota || {
            maxStores: 1,
            maxSuperAdmins: 1,
            maxAdmins: 3
          },
          billplzApiKey: config.paymentPlatform?.billplz?.apiKey,
          billplzXSignatureKey: config.paymentPlatform?.billplz?.xSignatureKey,
          billplzCollectionId: config.paymentPlatform?.billplz?.collectionId,
          billplzIsSandbox: config.paymentPlatform?.billplz?.isSandbox ?? true,
          billplzEnabled: config.paymentPlatform?.billplz?.enabled ?? false,
        });
      }
    } catch (error) {
      message.error(t('subscriptionSettings.loadFailed'));
    } finally {
      setLoading(false);
    }
  };

  const handleSaveConfig = async (values: any) => {
    try {
      setSaving(true);

      // Find selected plan to sync quota
      const selectedPlan = values.plans?.find((p: any) => p.id === values.planId);
      const newQuota = selectedPlan ? {
        maxStores: selectedPlan.maxStores || 1,
        maxSuperAdmins: selectedPlan.maxSuperAdmins || 1,
        maxAdmins: selectedPlan.maxAdmins || 3,
      } : appConfig?.subscription?.quota;

      const updateData: any = {
        subscription: {
          ...appConfig?.subscription,
          isActive: values.isActive,
          planId: values.planId,
          plan: values.planId as 'basic' | 'pro' | 'premium', // Legacy sync
          plans: values.plans,
          quota: newQuota,
          expiryDate: appConfig?.subscription?.expiryDate || new Date()
        },
        paymentPlatform: {
          billplz: {
            apiKey: values.billplzApiKey,
            xSignatureKey: values.billplzXSignatureKey,
            collectionId: values.billplzCollectionId,
            isSandbox: values.billplzIsSandbox,
            enabled: values.billplzEnabled
          }
        }
      };

      await updateAppConfig(updateData, user?.id || 'system');
      message.success(t('subscriptionSettings.saveSuccess'));
      loadConfig(); // Reload to get fresh state
      loadCounts(); // Refresh counts
    } catch (error) {
      message.error(t('subscriptionSettings.saveFailed'));
    } finally {
      setSaving(false);
    }
  };

  const handleApproveRequest = async (request: SubscriptionRequest) => {
    try {
      // Update AppConfig
      const plan = appConfig?.subscription?.plans?.find(p => p.id === request.planId);
      const validMonths = plan?.validPeriodMonth || 12;
      const newExpiry = dayjs().add(validMonths, 'month').toDate();

      // Update request status and save the resulting expiry date
      const requestRef = doc(db, GLOBAL_COLLECTIONS.SUBSCRIPTION_REQUESTS, request.id);
      await updateDoc(requestRef, {
        status: 'approved',
        updatedAt: new Date(),
        verifiedBy: user?.id,
        expiryDate: newExpiry
      });

      const updateData: any = {
        subscription: {
          ...appConfig?.subscription,
          isActive: true,
          planId: request.planId,
          plan: request.planId as 'basic' | 'pro' | 'premium', // Legacy sync
          expiryDate: newExpiry,
          quota: {
            maxStores: plan?.maxStores || appConfig?.subscription?.quota?.maxStores || 1,
            maxSuperAdmins: plan?.maxSuperAdmins || appConfig?.subscription?.quota?.maxSuperAdmins || 1,
            maxAdmins: plan?.maxAdmins || appConfig?.subscription?.quota?.maxAdmins || 3,
          }
        }
      };
      await updateAppConfig(updateData, user?.id || 'system');

      message.success(t('subscriptionSettings.approveSuccess'));
      refreshRequests();
      loadConfig();
    } catch (error) {
      message.error(t('subscriptionSettings.approveFailed'));
    }
  };

  const handleRejectRequest = async (request: SubscriptionRequest) => {
    try {
      const requestRef = doc(db, GLOBAL_COLLECTIONS.SUBSCRIPTION_REQUESTS, request.id);
      await updateDoc(requestRef, {
        status: 'rejected',
        updatedAt: new Date(),
        verifiedBy: user?.id
      });
      message.success(t('subscriptionSettings.rejectSuccess'));
      refreshRequests();
    } catch (error) {
      message.error(t('subscriptionSettings.rejectFailed'));
    }
  };

  const requestColumns = [
    {
      title: t('subscriptionSettings.requestedBy'),
      dataIndex: 'requestedBy',
      key: 'requestedBy',
    },
    {
      title: t('subscriptionSettings.plan'),
      dataIndex: 'planName',
      key: 'planName',
    },
    {
      title: t('subscriptionSettings.validity'),
      dataIndex: 'validPeriodMonth',
      key: 'validPeriodMonth',
      render: (months: number) => months ? t('subscriptionSettings.months', { months }) : '-'
    },
    {
      title: t('subscriptionSettings.date'),
      dataIndex: 'createdAt',
      key: 'createdAt',
      render: (date: any) => date?.toDate ? dayjs(date.toDate()).format('YYYY-MM-DD HH:mm') : '-'
    },
    {
      title: t('subscriptionSettings.status'),
      dataIndex: 'status',
      key: 'status',
      render: (status: string) => {
        const color = status === 'approved' ? 'green' : status === 'rejected' ? 'red' : 'orange';
        return <Tag color={color}>{status.toUpperCase()}</Tag>;
      }
    },
    {
      title: t('subscriptionSettings.billId'),
      dataIndex: 'billplzId',
      key: 'billplzId',
      render: (id: string, record: any) => id ? (
        <span style={{ fontFamily: 'monospace', fontSize: 11, color: '#FDE08D' }}>{id}</span>
      ) : (
        <Tag color="default">{record.paymentMethod === 'online' ? '-' : t('subscriptionSettings.manual')}</Tag>
      )
    },
    {
      title: t('subscriptionSettings.expiryDate'),
      dataIndex: 'expiryDate',
      key: 'expiryDate',
      render: (date: any) => date?.toDate ? dayjs(date.toDate()).format('YYYY-MM-DD') : (date ? dayjs(date).format('YYYY-MM-DD') : '-')
    },
    {
      title: t('subscriptionSettings.actions'),
      key: 'actions',
      render: (_: any, record: SubscriptionRequest) => (
        record.status === 'pending' ? (
          <Space>
            <Button type="primary" size="small" onClick={() => handleApproveRequest(record)}>{t('subscriptionSettings.approve')}</Button>
            <Button danger size="small" onClick={() => handleRejectRequest(record)}>{t('subscriptionSettings.reject')}</Button>
          </Space>
        ) : null
      )
    }
  ];

  if (loading && !appConfig) {
    return (
      <div style={{ display: 'flex', justifyContent: 'center', padding: '50px 0' }}>
        <Spin size="large" />
      </div>
    );
  }

  return (
    <div style={{ padding: '12px 16px', maxWidth: 1200, margin: '0 auto', marginBottom: 100 }}>
      <h1 style={{
        fontSize: 'calc(20px + 1vw)',
        fontWeight: 800,
        marginBottom: 24,
        backgroundImage: 'linear-gradient(to right,#FDE08D,#C48D3A)',
        WebkitBackgroundClip: 'text',
        color: 'transparent'
      }}>
        {t('subscriptionSettings.title')}
      </h1>

      {!isSuperAdmin && (
        <Alert
          message={t('subscriptionSettings.viewOnly')}
          description={t('subscriptionSettings.viewOnlyDesc')}
          type="info"
          showIcon
          style={{ marginBottom: 24, background: 'rgba(0,0,0,0.2)', border: '1px solid rgba(255,255,255,0.1)', color: '#fff' }}
        />
      )}

      {/* Custom Tab Bar */}
      <div style={{ marginBottom: 20 }}>
        <div style={{
          display: 'flex',
          borderBottom: '1px solid rgba(244,175,37,0.2)',
          marginBottom: 16
        }}>
          {([{ key: 'settings', label: t('subscriptionSettings.tabSettings') }, { key: 'payment', label: t('subscriptionSettings.tabPayment') }, { key: 'records', label: t('subscriptionSettings.tabRecords') }, { key: 'accounts', label: t('subscriptionSettings.tabAccounts') }] as { key: SubTabKey; label: string }[]).map(({ key, label }) => {
            const isActive = activeTab === key;
            const baseStyle: React.CSSProperties = {
              flex: 1,
              padding: '12px 0',
              fontWeight: 800,
              fontSize: 13,
              outline: 'none',
              borderBottom: isActive ? '2px solid #f4af25' : '2px solid transparent',
              borderTop: 'none',
              borderLeft: 'none',
              borderRight: 'none',
              cursor: 'pointer',
              background: 'none',
              transition: 'all 0.2s ease',
            };
            const activeStyle: React.CSSProperties = {
              color: 'transparent',
              background: 'linear-gradient(to right,#FDE08D,#C48D3A)',
              WebkitBackgroundClip: 'text',
            };
            const inactiveStyle: React.CSSProperties = {
              color: '#A0A0A0',
            };
            return (
              <button
                key={key}
                style={{ ...baseStyle, ...(isActive ? activeStyle : inactiveStyle) }}
                onClick={() => setActiveTab(key)}
              >
                {label}
              </button>
            );
          })}
        </div>
      </div>

      {/* Tab Content */}
      {activeTab === 'settings' && (
        <Form
          form={form}
          layout="vertical"
          onFinish={handleSaveConfig}
        >
            <div style={{ display: 'flex', flexDirection: window.innerWidth < 768 ? 'column' : 'row', gap: 24 }}>
              {/* Left Column: Status & Quota */}
              <div style={{ flex: 1 }}>
                <Card
                  title={<span style={{ color: '#FDE08D' }}>{t('subscriptionSettings.generalStatus')}</span>}
                  style={{ background: 'rgba(255,255,255,0.05)', border: '1px solid rgba(255,255,255,0.1)', marginBottom: 24 }}
                >
                  <Form.Item
                    name="isActive"
                    label={<span style={{ color: '#ccc' }}>{t('subscriptionSettings.enableSubscriptionMode')}</span>}
                    valuePropName="checked"
                  >
                    <Switch disabled={!isSuperAdmin} />
                  </Form.Item>

                  <Form.Item
                    name="planId"
                    label={<span style={{ color: '#ccc' }}>{t('subscriptionSettings.currentActivePlan')}</span>}
                  >
                    <Select disabled={!isSuperAdmin} style={{ width: '100%' }} dropdownStyle={{ background: '#1a1a1a', border: '1px solid #444' }}>
                      {appConfig?.subscription?.plans?.map((p: any) => (
                        <Option key={p.id} value={p.id}>
                          {p.name} - RM {p.fee}
                        </Option>
                      )) || (
                        <>
                          <Option value="basic">Basic</Option>
                          <Option value="pro">Pro</Option>
                          <Option value="premium">Premium</Option>
                        </>
                      )}
                    </Select>
                  </Form.Item>

                  {appConfig?.subscription?.expiryDate && (() => {
                    let dateStr = '';
                    try {
                      const exp = (appConfig.subscription.expiryDate as any).toDate
                        ? (appConfig.subscription.expiryDate as any).toDate()
                        : new Date(appConfig.subscription.expiryDate as any);
                      if (!isNaN(exp.getTime())) {
                        dateStr = dayjs(exp).format('YYYY-MM-DD');
                      }
                    } catch (e) {
                      console.warn('Invalid expiry date in settings', e);
                    }

                    if (!dateStr) return null;

                    return (
                      <div style={{
                        color: '#FDE08D',
                        fontSize: '14px',
                        padding: '12px',
                        background: 'rgba(253,224,141,0.1)',
                        borderRadius: 8,
                        border: '1px solid rgba(253,224,141,0.2)',
                        marginBottom: 16
                      }}>
                        <span style={{ color: '#aaa', marginRight: 8 }}>{t('subscriptionSettings.currentExpiry')}</span>
                        {dateStr}
                      </div>
                    );
                  })()}
                </Card>

                <Card
                  title={<span style={{ color: '#FDE08D' }}>{t('subscriptionSettings.currentAccountQuotas')}</span>}
                  style={{ background: 'rgba(255,255,255,0.05)', border: '1px solid rgba(255,255,255,0.1)' }}
                >
                  {(() => {
                    // Derive quotas from the active plan definition first, fall back to stored quota field
                    const activePlanDef = appConfig?.subscription?.plans?.find(
                      (p: any) => p.id === (appConfig?.subscription?.planId || appConfig?.subscription?.plan)
                    );
                    const effectiveMaxStores = activePlanDef?.maxStores ?? appConfig?.subscription?.quota?.maxStores ?? 1;
                    const effectiveMaxSuperAdmins = activePlanDef?.maxSuperAdmins ?? appConfig?.subscription?.quota?.maxSuperAdmins ?? 1;
                    const effectiveMaxAdmins = activePlanDef?.maxAdmins ?? appConfig?.subscription?.quota?.maxAdmins ?? 3;
                    return (
                  <div style={{ display: 'flex', flexDirection: 'column', gap: 20 }}>
                    {[
                      { label: t('subscriptionSettings.maxStores'), count: counts.stores, max: effectiveMaxStores },
                      { label: t('subscriptionSettings.maxSuperAdmins'), count: counts.superAdmins, max: effectiveMaxSuperAdmins },
                      { label: t('subscriptionSettings.maxAdmins'), count: counts.admins, max: effectiveMaxAdmins }
                    ].map(item => (
                      <div key={item.label}>
                        <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 8, color: '#ccc' }}>
                          <span style={{ fontSize: 13 }}>{item.label}</span>
                          <span style={{
                            fontWeight: 700,
                            color: item.count >= item.max ? '#ff4d4f' : '#52c41a'
                          }}>
                            {item.count} / {item.max}
                          </span>
                        </div>
                        <div style={{
                          height: 4,
                          background: 'rgba(255,255,255,0.05)',
                          borderRadius: 2,
                          overflow: 'hidden'
                        }}>
                          <div style={{
                            width: `${Math.min(100, (item.count / item.max) * 100)}%`,
                            height: '100%',
                            background: item.count >= item.max ? '#ff4d4f' : 'linear-gradient(to right, #FDE08D, #C48D3A)',
                            borderRadius: 2
                          }} />
                        </div>
                      </div>
                    ))}
                  </div>
                    );
                  })()}
                </Card>
              </div>

              {/* Right Column: Plans Configuration */}
              <div style={{ flex: 2 }}>
                <Card
                  title={<span style={{ color: '#FDE08D' }}>{t('subscriptionSettings.availablePlans')}</span>}
                  style={{ background: 'rgba(255,255,255,0.05)', border: '1px solid rgba(255,255,255,0.1)' }}
                >
                  <Form.List name="plans">
                    {(fields, { add, remove }) => (
                      <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
                        {fields.map(({ key, name, ...restField }) => (
                          <div
                            key={key}
                            style={{
                              padding: 16,
                              background: 'rgba(255,255,255,0.03)',
                              borderRadius: 12,
                              border: '1px solid rgba(255,255,255,0.05)',
                              position: 'relative'
                            }}
                          >
                            <MinusCircleOutlined
                              onClick={() => remove(name)}
                              style={{
                                position: 'absolute',
                                right: 12,
                                top: 12,
                                color: '#ff4d4f',
                                fontSize: 18,
                                zIndex: 1
                              }}
                            />

                            <div style={{
                              display: 'grid',
                              gridTemplateColumns: window.innerWidth < 768 ? '1fr' : 'repeat(auto-fit, minmax(120px, 1fr))',
                              gap: '12px 16px'
                            }}>
                              <Form.Item
                                {...restField}
                                name={[name, 'id']}
                                label={<span style={{ color: '#888', fontSize: 12 }}>ID</span>}
                                rules={[{ required: true, message: t('subscriptionSettings.missingId') }]}
                              >
                                <Input placeholder="basic" disabled={!isSuperAdmin} />
                              </Form.Item>
                              <Form.Item
                                {...restField}
                                name={[name, 'name']}
                                label={<span style={{ color: '#888', fontSize: 12 }}>{t('subscriptionSettings.colName')}</span>}
                                rules={[{ required: true, message: t('subscriptionSettings.missingName') }]}
                              >
                                <Input placeholder="Plan Name" disabled={!isSuperAdmin} />
                              </Form.Item>
                              <Form.Item
                                {...restField}
                                name={[name, 'fee']}
                                label={<span style={{ color: '#888', fontSize: 12 }}>{t('subscriptionSettings.annualFee')}</span>}
                                rules={[{ required: true, message: t('subscriptionSettings.missingFee') }]}
                              >
                                <InputNumber placeholder="0" min={0} controls={false} addonBefore="RM" style={{ width: '100%' }} disabled={!isSuperAdmin} />
                              </Form.Item>
                              <Form.Item
                                {...restField}
                                name={[name, 'validPeriodMonth']}
                                label={<span style={{ color: '#888', fontSize: 12 }}>{t('subscriptionSettings.validityMonths')}</span>}
                                rules={[{ required: true, message: t('subscriptionSettings.missingPeriod') }]}
                              >
                                <InputNumber placeholder="12" min={1} controls={false} addonAfter="Mon" style={{ width: '100%' }} disabled={!isSuperAdmin} />
                              </Form.Item>
                              <Form.Item
                                {...restField}
                                name={[name, 'maxMembers']}
                                label={<span style={{ color: '#888', fontSize: 12 }}>{t('subscriptionSettings.maxMembers')}</span>}
                              >
                                <InputNumber placeholder={t('subscriptionSettings.unlimited')} min={0} controls={false} style={{ width: '100%' }} disabled={!isSuperAdmin} />
                              </Form.Item>
                              <Form.Item
                                {...restField}
                                name={[name, 'maxStores']}
                                label={<span style={{ color: '#888', fontSize: 12 }}>{t('subscriptionSettings.maxStores')}</span>}
                              >
                                <InputNumber placeholder="1" min={1} controls={false} style={{ width: '100%' }} disabled={!isSuperAdmin} />
                              </Form.Item>
                              <Form.Item
                                {...restField}
                                name={[name, 'maxSuperAdmins']}
                                label={<span style={{ color: '#888', fontSize: 12 }}>{t('subscriptionSettings.maxSuperAdmins')}</span>}
                              >
                                <InputNumber placeholder="1" min={1} controls={false} style={{ width: '100%' }} disabled={!isSuperAdmin} />
                              </Form.Item>
                              <Form.Item
                                {...restField}
                                name={[name, 'maxAdmins']}
                                label={<span style={{ color: '#888', fontSize: 12 }}>{t('subscriptionSettings.maxAdmins')}</span>}
                              >
                                <InputNumber placeholder="3" min={0} controls={false} style={{ width: '100%' }} disabled={!isSuperAdmin} />
                              </Form.Item>
                            </div>
                          </div>
                        ))}
                        <Form.Item>
                          <Button
                            type="dashed"
                            onClick={() => add({ validPeriodMonth: 12 })}
                            block
                            icon={<PlusOutlined />}
                            disabled={!isSuperAdmin}
                            style={{
                              color: isSuperAdmin ? '#FDE08D' : '#666',
                              borderColor: isSuperAdmin ? 'rgba(253,224,141,0.3)' : 'rgba(255,255,255,0.05)',
                              background: 'transparent',
                              height: 45,
                              borderRadius: 8
                            }}
                          >
                            {t('subscriptionSettings.addNewPlan')}
                          </Button>
                        </Form.Item>
                      </div>
                    )}
                  </Form.List>
                </Card>
              </div>
            </div>

            {isSuperAdmin && (
              <div style={{
                marginTop: 32,
                textAlign: 'right',
                position: window.innerWidth < 768 ? 'fixed' : 'static',
                bottom: window.innerWidth < 768 ? 80 : 'auto',
                right: window.innerWidth < 768 ? 16 : 'auto',
                left: window.innerWidth < 768 ? 16 : 'auto',
                zIndex: 10
              }}>
                <Button
                  type="primary"
                  htmlType="submit"
                  loading={saving}
                  style={{
                    background: 'linear-gradient(to right,#FDE08D,#C48D3A)',
                    color: '#111',
                    border: 'none',
                    fontWeight: 800,
                    height: 45,
                    padding: '0 32px',
                    borderRadius: 22,
                    boxShadow: '0 4px 15px rgba(196,141,58,0.3)',
                    width: window.innerWidth < 768 ? '100%' : 'auto'
                  }}
                >
                  {t('subscriptionSettings.saveAllSettings')}
                </Button>
              </div>
            )}
          </Form>
      )}

      {activeTab === 'payment' && (
        <Form
          form={form}
          layout="vertical"
          onFinish={handleSaveConfig}
        >
          <Card
            title={<span style={{ color: '#FDE08D' }}>{t('featureManagement.billplzConfigPlatform')}</span>}
            style={{ background: 'rgba(255,255,255,0.05)', border: '1px solid rgba(255,255,255,0.1)', marginBottom: 24 }}
          >
            <div style={{ marginBottom: 24 }}>
              <Alert
                message={t('subscriptionSettings.platformPaymentTitle')}
                description={t('subscriptionSettings.platformPaymentDesc')}
                type="warning"
                showIcon
                style={{ marginBottom: 24, background: 'rgba(255,193,7,0.1)', border: '1px solid rgba(255,193,7,0.3)', color: '#fff' }}
              />
            </div>

            <div style={{ display: 'grid', gridTemplateColumns: window.innerWidth < 768 ? '1fr' : '1fr 1fr', gap: 24 }}>
              <Form.Item
                label={<span style={{ color: '#ccc' }}>{t('featureManagement.apiKey')}</span>}
                name="billplzApiKey"
                rules={[{ required: activeTab === 'payment' }]}
              >
                <Input.Password placeholder="Billplz API Key" disabled={!isSuperAdmin} />
              </Form.Item>

              <Form.Item
                label={<span style={{ color: '#ccc' }}>{t('featureManagement.xSignatureKey')}</span>}
                name="billplzXSignatureKey"
                rules={[{ required: activeTab === 'payment' }]}
              >
                <Input.Password placeholder="X-Signature Key" disabled={!isSuperAdmin} />
              </Form.Item>
            </div>

            <Form.Item
              label={<span style={{ color: '#ccc' }}>{t('featureManagement.collectionId')}</span>}
              name="billplzCollectionId"
              rules={[{ required: activeTab === 'payment' }]}
            >
              <Input placeholder="Collection ID" disabled={!isSuperAdmin} />
            </Form.Item>

            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 24 }}>
              <Form.Item
                label={<span style={{ color: '#ccc' }}>{t('featureManagement.sandboxMode')}</span>}
                name="billplzIsSandbox"
                valuePropName="checked"
              >
                <Switch disabled={!isSuperAdmin} />
              </Form.Item>

              <Form.Item
                label={<span style={{ color: '#ccc' }}>{t('featureManagement.enableBillplz')}</span>}
                name="billplzEnabled"
                valuePropName="checked"
              >
                <Switch disabled={!isSuperAdmin} />
              </Form.Item>
            </div>

            {isSuperAdmin && (
              <div style={{ marginTop: 24, textAlign: 'right' }}>
                <Button
                  type="primary"
                  htmlType="submit"
                  loading={saving}
                  style={{
                    background: 'linear-gradient(to right,#FDE08D,#C48D3A)',
                    color: '#111',
                    border: 'none',
                    fontWeight: 800,
                    borderRadius: 22,
                    padding: '0 32px'
                  }}
                >
                  {t('common.save')}
                </Button>
              </div>
            )}
          </Card>

          {/* 支付功能测试 */}
          <PaymentTester
            paymentConfig={appConfig?.paymentPlatform}
            isPlatform={true}
          />
        </Form>
      )}

      {activeTab === 'records' && (
          <Card style={{ background: 'rgba(255,255,255,0.05)', border: '1px solid rgba(255,255,255,0.1)', padding: 0 }}>
            <Table
              dataSource={requests}
              columns={requestColumns}
              rowKey="id"
              loading={loadingRequests}
              pagination={{ pageSize: 10 }}
              scroll={{ x: 'max-content' }}
              className="custom-table"
              style={{ background: 'transparent' }}
            />
          </Card>
      )}

      {activeTab === 'accounts' && (
          <AdminAccountList />
      )}

      <style dangerouslySetInnerHTML={{ __html: `

        .custom-table .ant-table {
          background: transparent !important;
          color: #fff !important;
        }
        .custom-table .ant-table-thead > tr > th {
          background: rgba(255,255,255,0.05) !important;
          color: #FDE08D !important;
          border-bottom: 1px solid rgba(255,255,255,0.1) !important;
        }
        .custom-table .ant-table-tbody > tr > td {
          border-bottom: 1px solid rgba(255,255,255,0.05) !important;
        }
        .custom-table .ant-table-tbody > tr:hover > td {
          background: rgba(255,255,255,0.02) !important;
        }
        .ant-select-selector, .ant-input, .ant-input-number {
          background: rgba(255,255,255,0.05) !important;
          border: 1px solid rgba(255,255,255,0.1) !important;
          color: #fff !important;
        }
        .ant-input-number-handler-wrap {
          background: rgba(255,255,255,0.1) !important;
        }
        .ant-select-selection-item {
          color: #fff !important;
        }
        .ant-card-head {
          border-bottom: 1px solid rgba(255,255,255,0.1) !important;
        }
        .ant-table-pagination.ant-pagination {
          margin: 16px !important;
        }
        .ant-pagination-item a, .ant-pagination-item-link {
          color: #888 !important;
        }
        .ant-pagination-item-active a {
          color: #f4af25 !important;
        }
      `}} />
    </div>
  );
};
export default SubscriptionSettings;
