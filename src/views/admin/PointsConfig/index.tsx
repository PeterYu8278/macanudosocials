// 积分配置管理页面
import React, { useState, useEffect } from 'react';
import { useFirestoreQuery } from '../../../hooks/useFirestoreQuery';
import { Card, Form, InputNumber, Button, Space, Typography, Row, Col, Divider, App, Spin, Tabs, Table, Tag, DatePicker, Select, Modal } from 'antd';
import { SaveOutlined, ReloadOutlined, HistoryOutlined, SettingOutlined, PlusOutlined, DeleteOutlined, PlayCircleOutlined } from '@ant-design/icons';
import { getPointsConfig, updatePointsConfig, getDefaultPointsConfig } from '../../../services/firebase/pointsConfig';
import { getAllPointsRecords } from '../../../services/firebase/pointsRecords';
import { getMembershipFeeConfig, updateMembershipFeeConfig, getDefaultMembershipFeeConfig, getAllMembershipFeeRecords, createMembershipFeeRecord } from '../../../services/firebase/membershipFee';
import { getAllTransactions, getAllOrders, createTransaction, COLLECTIONS, getAllUsers, updateDocument, deleteDocument, getCigars, getAllInboundOrders, getAllOutboundOrders, getAllInventoryMovements, getOutboundOrdersByReferenceNo, getUsers } from '../../../services/firebase/firestore';
import { getAllStores } from '../../../services/firebase/stores';
import type { User, Store } from '../../../types';
import type { MembershipFeeRecord } from '../../../types';
import { processPendingMembershipFees } from '../../../services/firebase/scheduledJobs';
import { useAuthStore } from '../../../store/modules/auth';
import { useTranslation } from 'react-i18next';
import type { PointsConfig, PointsRecord } from '../../../types';
import { ReloadVerification } from '../../../components/admin/ReloadVerification';
import dayjs from 'dayjs';
import { isFeatureVisible } from '../../../services/firebase/featureVisibility';

const { Title, Text } = Typography;

const PointsConfigPage: React.FC = () => {
  const { user, isSuperAdmin } = useAuthStore();
  const { message } = App.useApp();
  const [form] = Form.useForm();
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [activeTab, setActiveTab] = useState<'records' | 'reload' | 'membershipFees'>('reload');
  const [processingFees, setProcessingFees] = useState(false);
  const [membershipFeeStatusFilter, setMembershipFeeStatusFilter] = useState<'all' | 'pending' | 'paid' | 'failed' | 'cancelled'>('all');
  const [creatingFeeRecord, setCreatingFeeRecord] = useState(false);
  const [feeRecordForm] = Form.useForm();

  const { data: pointsRecords = [], loading: loadingRecords, refresh: refreshPointsRecords } = useFirestoreQuery(
    () => getAllPointsRecords(200),
    [activeTab]
  );

  const { data: membershipFeeRecords = [], loading: loadingMembershipFeeRecords, refresh: refreshMembershipFeeRecords } = useFirestoreQuery(
    () => getAllMembershipFeeRecords(membershipFeeStatusFilter === 'all' ? undefined : membershipFeeStatusFilter),
    [activeTab, membershipFeeStatusFilter]
  );

  const { data: users = [] } = useFirestoreQuery(
    () => creatingFeeRecord ? getUsers({ limit: 300 }) : Promise.resolve([]),
    [creatingFeeRecord]
  );

  const { data: stores = [] } = useFirestoreQuery(getAllStores);
  const { t, i18n } = useTranslation();
  const isMobile = typeof window !== 'undefined' ? window.matchMedia('(max-width: 768px)').matches : false;
  const [eventsAdminFeatureVisible, setEventsAdminFeatureVisible] = useState<boolean>(true);

  // 检查活动管理功能是否可见（developer 不受限制）
  useEffect(() => {
    const checkFeatureVisibility = async () => {
      const visible = user?.role === 'developer' ? true : await isFeatureVisible('events-admin');
      setEventsAdminFeatureVisible(visible);
    };
    if (user?.id) {
      checkFeatureVisibility();
    }
  }, [user?.role, user?.id]);

  // 加载积分配置
  useEffect(() => {
    loadConfig();
  }, []);

  // 自动执行扣除年费（管理员访问页面时自动执行，无需手动点击）
  useEffect(() => {
    if (!user?.id || user.role !== 'superAdmin') {
      return;
    }

    // 页面加载时执行一次
    const executeAutoDeduction = async () => {
      try {
        const result = await processPendingMembershipFees();
        if (result.success && result.processed > 0) {
          // 静默执行，不显示消息（避免打扰管理员）
        }
      } catch (error: any) {
        console.error('[PointsConfigPage] 自动扣除年费失败:', error);
        // 静默失败，不显示错误消息
      }
    };

    // 立即执行一次
    executeAutoDeduction();

    // 设置定期检查（每天执行一次）
    const interval = setInterval(() => {
      executeAutoDeduction();
    }, 24 * 60 * 60 * 1000); // 24小时 = 24 * 60分钟 * 60秒 * 1000毫秒

    return () => {
      clearInterval(interval);
    };
  }, [user?.id, user?.role]);

  const loadConfig = async () => {
    setLoading(true);
    try {
      // 加载积分配置
      const pointsConfig = await getPointsConfig();
      const defaultPointsConfig = getDefaultPointsConfig();
      
      // 加载会员年费配置
      const membershipFeeConfig = await getMembershipFeeConfig();
      const defaultMembershipFeeConfig = getDefaultMembershipFeeConfig();
      
      // 合并配置到表单
      const formValues: any = {
        ...(pointsConfig || defaultPointsConfig),
        // 会员年费配置
        membershipFee: {
          annualFees: (membershipFeeConfig?.annualFees || defaultMembershipFeeConfig.annualFees).map(fee => ({
            ...fee,
            startDate: dayjs(fee.startDate),
            endDate: fee.endDate ? dayjs(fee.endDate) : null
          }))
        }
      };
      
      form.setFieldsValue(formValues);
    } catch (error) {
      console.error('[PointsConfigPage] 加载配置失败:', error);
      message.error(t('pointsConfig.loadFailed'));
    } finally {
      setLoading(false);
    }
  };

  // 保存配置
  const onFinish = async (values: any) => {
    if (!user?.id) {
      message.error(t('pointsConfig.userNotFound'));
      return;
    }

    setSaving(true);
    try {
      // 分离积分配置和会员年费配置
      const { membershipFee, ...pointsConfigValues } = values;
      
      // 保存积分配置
      const pointsResult = await updatePointsConfig(pointsConfigValues, user.id);
      
      // 保存会员年费配置
      if (membershipFee) {
        const membershipFeeConfigData = {
          annualFees: (membershipFee.annualFees || []).map((fee: any) => ({
            amount: fee.amount,
            rate: fee.rate,
            startDate: fee.startDate.toDate(),
            endDate: fee.endDate ? fee.endDate.toDate() : undefined
          }))
        };
        
        const membershipFeeResult = await updateMembershipFeeConfig({
          ...membershipFeeConfigData,
          updatedBy: user.id
        }, user.id);
        
        if (pointsResult.success && membershipFeeResult.success) {
          message.success(t('pointsConfig.configSaved'));
        } else {
          message.error(pointsResult.error || membershipFeeResult.error || t('pointsConfig.saveFailed'));
        }
      } else {
        if (pointsResult.success) {
          message.success(t('pointsConfig.saveSuccess'));
        } else {
          message.error(pointsResult.error || t('pointsConfig.saveFailed'));
        }
      }
    } catch (error) {
      message.error(t('pointsConfig.saveFailed'));
    } finally {
      setSaving(false);
    }
  };

  // 手动触发自动扣除会员费
  const handleProcessMembershipFees = async () => {
    if (!user?.id) {
      message.error(t('pointsConfig.pleaseLogin'));
      return;
    }

    setProcessingFees(true);
    try {
      const result = await processPendingMembershipFees();
      if (result.success) {
        message.success(
          t('pointsConfig.processComplete', { paid: result.paid, failed: result.failed, processed: result.processed })
        );
        if (result.errors.length > 0) {
          console.error('处理过程中的错误:', result.errors);
        }
      } else {
        message.error(t('pointsConfig.processFailed'));
      }
    } catch (error: any) {
      console.error('处理会员费失败:', error);
      message.error(error.message || t('pointsConfig.processFailed'));
    } finally {
      setProcessingFees(false);
    }
  };

  // 重置为默认值
  const resetToDefault = () => {
    const defaultPointsConfig = getDefaultPointsConfig();
    const defaultMembershipFeeConfig = getDefaultMembershipFeeConfig();
    
    const formValues: any = {
      ...defaultPointsConfig,
      membershipFee: {
        annualFees: defaultMembershipFeeConfig.annualFees.map(fee => ({
          ...fee,
          startDate: dayjs(fee.startDate),
          endDate: fee.endDate ? dayjs(fee.endDate) : null
        }))
      }
    };
    
    form.setFieldsValue(formValues);
    message.info(t('pointsConfig.resetSuccess'));
  };

  // 创建年费记录
  const handleCreateFeeRecord = async (values: { userId: string; dueDate: dayjs.Dayjs; storeId: string }) => {
    if (!user?.id) {
      message.error(t('pointsConfig.pleaseLogin'));
      return;
    }

    try {
      const dueDate = values.dueDate.toDate();
      const result = await createMembershipFeeRecord(
        values.userId,
        dueDate,
        'initial',
        undefined,
        undefined,
        values.storeId
      );

      if (result.success) {
        message.success(t('pointsConfig.membershipFee.createSuccess'));
        setCreatingFeeRecord(false);
        feeRecordForm.resetFields();
        refreshMembershipFeeRecords();
      } else {
        message.error(result.error || t('pointsConfig.membershipFee.createFailed'));
      }
    } catch (error: any) {
      message.error(error.message || t('pointsConfig.membershipFee.createFailed'));
    }
  };

  if (loading) {
    return (
      <div style={{ textAlign: 'center', padding: '100px 0' }}>
        <Spin size="large" />
      </div>
    );
  }

  // 积分记录表格列定义
  const columns = [
    {
      title: t('pointsConfig.records.time'),
      dataIndex: 'createdAt',
      key: 'createdAt',
      width: 180,
      render: (date: Date) => {
        const d = date instanceof Date ? date : (date as any)?.toDate ? (date as any).toDate() : new Date(date);
        return dayjs(d).isValid() ? dayjs(d).format(i18n.language === 'en-US' ? 'D MMM, YYYY HH:mm' : 'YYYY-MM-DD HH:mm') : '-';
      }
    },
    {
      title: t('pointsConfig.records.user'),
      dataIndex: 'userName',
      key: 'userName',
      width: 150,
      render: (name: string, record: PointsRecord) => name || record.userId
    },
    {
      title: t('pointsConfig.records.type'),
      dataIndex: 'type',
      key: 'type',
      width: 100,
      render: (type: string) => (
        <Tag color={type === 'earn' ? 'green' : 'red'}>
          {type === 'earn' ? t('pointsConfig.records.earn') : t('pointsConfig.records.spend')}
        </Tag>
      )
    },
    {
      title: t('pointsConfig.records.amount'),
      dataIndex: 'amount',
      key: 'amount',
      width: 120,
      render: (amount: number, record: PointsRecord) => (
        <Text strong style={{ color: record.type === 'earn' ? '#52c41a' : '#ff4d4f' }}>
          {record.type === 'earn' ? '+' : '-'}{amount}
        </Text>
      )
    },
    {
      title: t('pointsConfig.records.source'),
      dataIndex: 'source',
      key: 'source',
      width: 120,
      render: (source: string) => {
        const sourceKey = `pointsConfig.records.sources.${source}`;
        const translated = t(sourceKey);
        return translated !== sourceKey ? translated : source;
      }
    },
    {
      title: t('pointsConfig.records.description'),
      dataIndex: 'description',
      key: 'description',
      ellipsis: true
    },
    {
      title: t('pointsConfig.records.balance'),
      dataIndex: 'balance',
      key: 'balance',
      width: 120,
      render: (balance: number) => balance || '-'
    }
  ];

  return (
    <div style={{ minHeight: '100vh', color: '#FFFFFF', paddingBottom: isMobile ? '100px' : '0' }}>
      {/* 标题 */}
      <h1 style={{ 
        fontSize: 22, 
        fontWeight: 800, 
        backgroundImage: 'linear-gradient(to right,#FDE08D,#C48D3A)', 
        WebkitBackgroundClip: 'text', 
        color: 'transparent', 
        marginBottom: 12 
      }}>
        {t('pointsConfig.title')}
      </h1>
      <Text style={{ color: 'rgba(255, 255, 255, 0.6)', display: 'block', marginBottom: 24 }}>
        {t('pointsConfig.description')}
      </Text>

      {/* 标签页 */}
      <div style={{ marginBottom: 16 }}>
        <div style={{
          display: 'flex',
          borderBottom: '1px solid rgba(244,175,37,0.2)',
          marginBottom: 16
        }}>
          {(['records', 'reload', 'membershipFees'] as const).map((tabKey) => {
            const isActive = activeTab === tabKey
            const baseStyle: React.CSSProperties = {
              flex: 1,
              padding: '10px 0',
              fontWeight: 800,
              fontSize: 12,
              outline: 'none',
              borderBottom: isActive ? '2px solid #f4af25' : '2px solid transparent',
              borderTop: 'none',
              borderLeft: 'none',
              borderRight: 'none',
              cursor: 'pointer',
              background: 'none',
            }
            const activeStyle: React.CSSProperties = {
              color: 'transparent',
              background: 'linear-gradient(to right,#FDE08D,#C48D3A)',
              WebkitBackgroundClip: 'text',
            }
            const inactiveStyle: React.CSSProperties = {
              color: '#A0A0A0',
            }

            const getTabLabel = (key: string) => {
              switch (key) {
                case 'records': return <><HistoryOutlined style={{ marginRight: 4 }} />{t('pointsConfig.tabs.records')}</>
                case 'reload': return <><HistoryOutlined style={{ marginRight: 4 }} />{t('pointsConfig.tabs.reload')}</>
                case 'membershipFees': return <><HistoryOutlined style={{ marginRight: 4 }} />{t('pointsConfig.tabs.membershipFees')}</>
                default: return ''
              }
            }

            return (
              <button
                key={tabKey}
                style={{
                  ...baseStyle,
                  ...(isActive ? activeStyle : inactiveStyle),
                }}
                onClick={() => setActiveTab(tabKey)}
              >
                {getTabLabel(tabKey)}
              </button>
            )
          })}
        </div>
          </div>

      {/* 标签页内容 */}
      <div>
        {false && (
          <div>
                  <Form
                    form={form}
                    layout="vertical"
                    onFinish={onFinish}
                    initialValues={getDefaultPointsConfig()}
              className="points-config-form"
            >
            {/* 购买相关积分 */}
            {/* 基础积分规则 */}
            <div style={{
              background: 'rgba(255, 255, 255, 0.03)',
              borderRadius: 8,
              padding: 16,
              marginBottom: 16,
              border: '1px solid rgba(255, 255, 255, 0.1)'
            }}>
              <h3 style={{ 
                fontSize: 16, 
                fontWeight: 700, 
                marginBottom: 16,
                backgroundImage: 'linear-gradient(to right,#FDE08D,#C48D3A)',
                WebkitBackgroundClip: 'text',
                color: 'transparent'
              }}>
                {t('pointsConfig.basicRules')}
              </h3>
              <Row gutter={16}>
                <Col xs={24} sm={6}>
                  <Form.Item
                    label={<span style={{ color: 'rgba(255, 255, 255, 0.85)' }}>{t('pointsConfig.purchase.perRinggit')}</span>}
                    name={['purchase', 'perRinggit']}
                    rules={[{ required: true, message: t('pointsConfig.validation.required') }]}
                  >
                    <InputNumber
                      min={0}
                      max={100}
                      step={0.1}
                      precision={1}
                      style={{ width: '100%' }}
                      addonAfter={t('pointsConfig.units.pointsPerRM')}
                    />
                  </Form.Item>
                </Col>
                <Col xs={24} sm={6}>
                  <Form.Item
                    label={<span style={{ color: 'rgba(255, 255, 255, 0.85)' }}>{t('pointsConfig.reload.referrerFirstReload')}</span>}
                    name={['reload', 'referrerFirstReload']}
                    rules={[{ required: true, message: t('pointsConfig.validation.required') }]}
                  >
                    <InputNumber
                      min={0}
                      max={10000}
                      style={{ width: '100%' }}
                      addonAfter={t('pointsConfig.units.points')}
                    />
                  </Form.Item>
                </Col>
                <Col xs={24} sm={6}>
                  <Form.Item
                    label={<span style={{ color: 'rgba(255, 255, 255, 0.85)' }}>{t('pointsConfig.reload.referredFirstReload')}</span>}
                    name={['reload', 'referredFirstReload']}
                    rules={[{ required: true, message: t('pointsConfig.validation.required') }]}
                  >
                    <InputNumber
                      min={0}
                      max={10000}
                      style={{ width: '100%' }}
                      addonAfter={t('pointsConfig.units.points')}
                    />
                  </Form.Item>
                </Col>
                {eventsAdminFeatureVisible && (
                  <Col xs={24} sm={6}>
                    <Form.Item
                      label={<span style={{ color: 'rgba(255, 255, 255, 0.85)' }}>{t('pointsConfig.event.registration')}</span>}
                      name={['event', 'registration']}
                      rules={[{ required: true, message: t('pointsConfig.validation.required') }]}
                    >
                      <InputNumber
                        min={0}
                        max={1000}
                        style={{ width: '100%' }}
                        addonAfter={t('pointsConfig.units.points')}
                      />
                    </Form.Item>
                  </Col>
                )}
              </Row>
            </div>
 
            {/* Day Pass 配置 */}
            <div style={{
              background: 'rgba(255, 255, 255, 0.03)',
              borderRadius: 8,
              padding: 16,
              marginBottom: 16,
              border: '1px solid rgba(255, 255, 255, 0.1)'
            }}>
              <h3 style={{ 
                fontSize: 16, 
                fontWeight: 700, 
                marginBottom: 16,
                backgroundImage: 'linear-gradient(to right,#FDE08D,#C48D3A)',
                WebkitBackgroundClip: 'text',
                color: 'transparent'
              }}>
                {t('pointsConfig.dayPass.title')}
              </h3>
              <Row gutter={16}>
                <Col xs={24} sm={6}>
                  <Form.Item
                    label={<span style={{ color: 'rgba(255, 255, 255, 0.85)' }}>{t('pointsConfig.dayPass.cost')}</span>}
                    name={['dayPass', 'cost']}
                    rules={[{ required: true, message: t('pointsConfig.validation.required') }]}
                  >
                    <InputNumber
                      min={0}
                      max={10000}
                      style={{ width: '100%' }}
                      addonAfter={t('pointsConfig.units.points')}
                    />
                  </Form.Item>
                </Col>
                <Col xs={24} sm={6}>
                  <Form.Item
                    label={<span style={{ color: 'rgba(255, 255, 255, 0.85)' }}>{t('pointsConfig.dayPass.freeHours')}</span>}
                    name={['dayPass', 'freeHours']}
                    rules={[{ required: true, message: t('pointsConfig.validation.required') }]}
                  >
                    <InputNumber
                      min={0}
                      max={24}
                      style={{ width: '100%' }}
                      addonAfter={t('pointsConfig.dayPass.hours')}
                    />
                  </Form.Item>
                </Col>
                <Col xs={24} sm={6}>
                  <Form.Item
                    label={<span style={{ color: 'rgba(255, 255, 255, 0.85)' }}>{t('pointsConfig.dayPass.hourlyRateAfter')}</span>}
                    name={['dayPass', 'hourlyRateAfter']}
                    rules={[{ required: true, message: t('pointsConfig.validation.required') }]}
                  >
                    <InputNumber
                      min={0}
                      max={1000}
                      style={{ width: '100%' }}
                      addonAfter={t('pointsConfig.dayPass.pointsPerHour')}
                    />
                  </Form.Item>
                </Col>
                <Col xs={24} sm={6}>
                  <Form.Item
                    label={<span style={{ color: 'rgba(255, 255, 255, 0.85)' }}>{t('pointsConfig.dayPass.cigarAllowance')}</span>}
                    name={['dayPass', 'cigarAllowance']}
                    rules={[{ required: true, message: t('pointsConfig.validation.required') }]}
                  >
                    <InputNumber
                      min={0}
                      max={10}
                      style={{ width: '100%' }}
                      addonAfter={t('pointsConfig.dayPass.sticks')}
                    />
                  </Form.Item>
                </Col>
              </Row>
            </div>

            {/* 年费配置（按日期范围） */}
            <div style={{
              background: 'rgba(255, 255, 255, 0.03)',
              borderRadius: 8,
              padding: 16,
              marginBottom: 16,
              border: '1px solid rgba(255, 255, 255, 0.1)'
            }}>
              <h3 style={{ 
                fontSize: 16, 
                fontWeight: 700, 
                marginBottom: 16,
                backgroundImage: 'linear-gradient(to right,#FDE08D,#C48D3A)',
                WebkitBackgroundClip: 'text',
                color: 'transparent'
              }}>
                {t('pointsConfig.annualFee.title')}
              </h3>
              
              <Form.List name={['membershipFee', 'annualFees']}>
                {(fields, { add, remove }) => (
                  <>
                    {fields.map(({ key, name, ...restField }) => (
                      <div key={key} style={{ marginBottom: isMobile ? 8 : 16 }}>
                        <Row gutter={16}>
                          <Col xs={12} sm={6}>
                            <Form.Item
                              {...restField}
                              name={[name, 'startDate']}
                              label={<span style={{ color: 'rgba(255, 255, 255, 0.85)' }}>{t('pointsConfig.annualFee.startDate')}</span>}
                              rules={[{ required: true, message: t('pointsConfig.annualFee.startDateRequired') }]}
                            >
                              <DatePicker style={{ width: '100%' }} format="YYYY-MM-DD" />
                            </Form.Item>
                          </Col>
                          <Col xs={12} sm={5}>
                            <Form.Item
                              {...restField}
                              name={[name, 'endDate']}
                              label={<span style={{ color: 'rgba(255, 255, 255, 0.85)' }}>{t('pointsConfig.annualFee.endDate')}</span>}
                            >
                              <DatePicker style={{ width: '100%' }} format="YYYY-MM-DD" />
                            </Form.Item>
                          </Col>
                          <Col xs={12} sm={5}>
                            <Form.Item
                              {...restField}
                              name={[name, 'amount']}
                              label={<span style={{ color: 'rgba(255, 255, 255, 0.85)' }}>{t('pointsConfig.annualFee.amount')}</span>}
                              rules={[{ required: true, message: t('pointsConfig.annualFee.amountRequired') }]}
                            >
                              <InputNumber
                                min={0}
                                max={100000}
                                style={{ width: '100%' }}
                                addonAfter={t('pointsConfig.units.points')}
                              />
                            </Form.Item>
                          </Col>
                          <Col xs={12} sm={5}>
                            <Form.Item
                              {...restField}
                              name={[name, 'rate']}
                              label={<span style={{ color: 'rgba(255, 255, 255, 0.85)' }}>{t('pointsConfig.annualFee.rate')}</span>}
                              rules={[{ required: true, message: t('pointsConfig.annualFee.rateRequired') }]}
                            >
                              <InputNumber
                                min={0}
                                max={1000}
                                style={{ width: '100%' }}
                                addonAfter={t('pointsConfig.dayPass.pointsPerHour')}
                              />
                            </Form.Item>
                          </Col>
                        </Row>
                        {fields.length > 1 && (
                          <Form.Item style={{ marginTop: 8, marginBottom: 0 }}>
                            <Button
                              danger
                              icon={<DeleteOutlined />}
                              onClick={() => remove(name)}
                              block
                              style={{
                                background: 'rgba(255, 77, 79, 0.2)',
                                border: '1px solid rgba(255, 77, 79, 0.5)',
                                color: '#ff4d4f'
                              }}
                            >
                              {t('pointsConfig.annualFee.deleteConfig')}
                            </Button>
                          </Form.Item>
                        )}
                      </div>
                    ))}
                    <Form.Item style={{ marginTop: 8 }}>
                      <Button 
                        onClick={() => add()} 
                        block 
                        icon={<PlusOutlined />}
                        style={{
                          background: 'linear-gradient(to right, #FDE08D, #C48D3A)',
                          border: 'none',
                          color: '#111',
                          fontWeight: 700,
                          boxShadow: '0 4px 15px rgba(244,175,37,0.35)'
                        }}
                      >
                        {t('pointsConfig.annualFee.addConfig')}
                      </Button>
                    </Form.Item>
                  </>
                )}
              </Form.List>
            </div>

                    {/* 操作按钮 */}
            <div style={{ textAlign: 'right', marginTop: 24 }}>
                      <Space>
                        <Button
                          icon={<PlayCircleOutlined />}
                          onClick={handleProcessMembershipFees}
                          loading={processingFees}
                          title={t('pointsConfig.processDeductionHint')}
                  style={{
                    background: 'rgba(255, 255, 255, 0.1)',
                    border: '1px solid rgba(255, 255, 255, 0.2)',
                    color: '#FFFFFF'
                  }}
                        >
                          {t('pointsConfig.processDeduction')}
                        </Button>
                        <Button
                          icon={<ReloadOutlined />}
                          onClick={resetToDefault}
                          disabled={saving}
                  style={{
                    background: 'rgba(255, 255, 255, 0.1)',
                    border: '1px solid rgba(255, 255, 255, 0.2)',
                    color: '#FFFFFF'
                  }}
                        >
                          {t('pointsConfig.actions.resetToDefault')}
                        </Button>
                        <Button
                          icon={<SaveOutlined />}
                          htmlType="submit"
                          loading={saving}
                  style={{
                    background: 'linear-gradient(to right, #FDE08D, #C48D3A)',
                    border: 'none',
                    color: '#111',
                    fontWeight: 700,
                    boxShadow: '0 4px 15px rgba(244,175,37,0.35)'
                  }}
                        >
                          {t('pointsConfig.actions.saveConfig')}
                        </Button>
                      </Space>
                    </div>
                  </Form>
          </div>
        )}

        {activeTab === 'records' && (
          <div>
                    <div style={{ marginBottom: 16, textAlign: 'right' }}>
                      <Button
                        icon={<ReloadOutlined />}
                        onClick={refreshPointsRecords}
                        loading={loadingRecords}
                style={{
                  background: 'rgba(255, 255, 255, 0.1)',
                  border: '1px solid rgba(255, 255, 255, 0.2)',
                  color: '#FFFFFF'
                }}
                      >
                        {t('common.refresh')}
                      </Button>
                    </div>
            {!isMobile ? (
              <div className="points-config-form">
                    <Table
                      columns={columns}
                      dataSource={pointsRecords}
                      rowKey="id"
                      loading={loadingRecords}
                      pagination={{
                        pageSize: 20,
                        showSizeChanger: true,
                        showTotal: (total) => t('common.paginationTotal', {
                          start: 1,
                          end: Math.min(20, total),
                          total
                        })
                      }}
                      locale={{
                        emptyText: t('pointsConfig.records.noRecords')
                      }}
                  style={{
                    background: 'transparent'
                      }}
                    />
                  </div>
            ) : (
              <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
                {loadingRecords ? (
                  <div style={{ textAlign: 'center', padding: '40px 20px', color: 'rgba(255, 255, 255, 0.6)' }}>
                    <Spin />
                  </div>
                ) : pointsRecords.length === 0 ? (
                  <div style={{ color: 'rgba(255, 255, 255, 0.6)', textAlign: 'center', padding: '24px 0' }}>
                    {t('pointsConfig.records.noRecords')}
                  </div>
                ) : (
                  pointsRecords.map((record) => {
                    const getSourceText = (source: string) => {
                      const sourceKey = `pointsConfig.records.sources.${source}`;
                      const translated = t(sourceKey);
                      return translated !== sourceKey ? translated : source;
                    };

                    const recordDate = record.createdAt instanceof Date
                      ? record.createdAt
                      : (record.createdAt as any)?.toDate
                        ? (record.createdAt as any).toDate()
                        : new Date(record.createdAt);

                    return (
                      <div
                        key={record.id}
                        style={{
                          border: '1px solid rgba(244,175,37,0.2)',
                          borderRadius: 12,
                          padding: 12,
                          background: 'rgba(34,28,16,0.5)',
                          backdropFilter: 'blur(10px)'
                        }}
                      >
                        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 8 }}>
                          <div style={{ flex: 1 }}>
                            <div style={{ display: 'flex', alignItems: 'center', gap: 6, minWidth: 0, fontSize: 12, color: 'rgba(255,255,255,0.6)', marginBottom: 4 }}>
                              <span style={{ whiteSpace: 'nowrap' }}>
                                {dayjs(recordDate).isValid() ? dayjs(recordDate).format(i18n.language === 'en-US' ? 'D MMM, YYYY HH:mm' : 'YYYY-MM-DD HH:mm') : '-'}
                              </span>
                              <span aria-hidden="true">•</span>
                              <span style={{ color: '#f4cf72', fontWeight: 600, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                                {record.userName || record.userId.slice(0, 12)}
                              </span>
                            </div>
                            <div style={{ fontSize: 14, color: 'rgba(255,255,255,0.85)', marginBottom: 4 }}>
                              {record.description || '-'}
                            </div>
                            <div style={{ fontSize: 12, color: 'rgba(255,255,255,0.5)' }}>
                              {getSourceText(record.source)}
                            </div>
                          </div>
                          <div style={{ textAlign: 'right', marginLeft: 12 }}>
                            <div style={{
                              fontSize: 18,
                              fontWeight: 700,
                              color: record.type === 'earn' ? '#52c41a' : '#ff4d4f',
                              marginBottom: 4
                            }}>
                              {record.type === 'earn' ? '+' : '-'}{record.amount}
                            </div>
                            {record.balance && (
                              <div style={{ fontSize: 11, color: 'rgba(255,255,255,0.5)' }}>
                              {t('pointsConfig.records.balance')}: {record.balance}
                              </div>
                            )}
                          </div>
                        </div>
                      </div>
                    );
                  })
                )}
              </div>
            )}
          </div>
        )}

        {activeTab === 'reload' && (
          <div>
            <ReloadVerification onRefresh={refreshPointsRecords} />
          </div>
        )}

        {activeTab === 'membershipFees' && (
          <div>
            <div style={{ marginBottom: 16, display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
              <Select
                value={membershipFeeStatusFilter}
                onChange={(value: 'all' | 'pending' | 'paid' | 'failed' | 'cancelled') => setMembershipFeeStatusFilter(value)}
                style={{ width: 150 }}
                options={[
                  { label: t('pointsConfig.membershipFee.all'), value: 'all' },
                  { label: t('pointsConfig.membershipFee.pending'), value: 'pending' },
                  { label: t('pointsConfig.membershipFee.paid'), value: 'paid' },
                  { label: t('pointsConfig.membershipFee.failed'), value: 'failed' },
                  { label: t('pointsConfig.membershipFee.cancelled'), value: 'cancelled' }
                ]}
                className="points-config-form"
              />
              <Button
                  onClick={refreshMembershipFeeRecords}
                  loading={loadingMembershipFeeRecords}
                  style={{
                    background: 'rgba(255, 255, 255, 0.1)',
                    border: '1px solid rgba(255, 255, 255, 0.2)',
                    color: '#FFFFFF'
                  }}
                >
                {t('common.refresh')}
                </Button>
            </div>
            {!isMobile ? (
              <div className="points-config-form">
                    <Table
                      columns={[
                        {
                          title: t('pointsConfig.membershipFee.user'),
                          dataIndex: 'userName',
                          key: 'userName',
                          width: 150,
                          render: (name: string, record: MembershipFeeRecord) => name || record.userId
                        },
                        {
                          title: t('pointsConfig.membershipFee.store'),
                          dataIndex: 'storeId',
                          key: 'storeId',
                          width: 150,
                          render: (storeId: string) => {
                            const store = stores.find(s => s.id === storeId);
                            return store?.name || '-';
                          }
                        },
                        {
                          title: t('pointsConfig.membershipFee.type'),
                          dataIndex: 'renewalType',
                          key: 'renewalType',
                          width: 100,
                          render: (type: string) => (
                            <Tag color={type === 'initial' ? 'blue' : 'green'}>
                              {type === 'initial' ? t('pointsConfig.membershipFee.initial') : t('pointsConfig.membershipFee.renewal')}
                            </Tag>
                          )
                        },
                        {
                          title: t('pointsConfig.membershipFee.amount'),
                          dataIndex: 'amount',
                          key: 'amount',
                          width: 120,
                          render: (amount: number) => (
                            <Text strong style={{ color: '#ff4d4f' }}>
                              -{amount} {t('pointsConfig.units.points')}
                            </Text>
                          )
                        },
                        {
                          title: t('pointsConfig.membershipFee.dueDate'),
                          dataIndex: 'dueDate',
                          key: 'dueDate',
                          width: 180,
                          render: (date: Date) => dayjs(date).format(i18n.language === 'en-US' ? 'D MMM, YYYY HH:mm' : 'YYYY-MM-DD HH:mm')
                        },
                        {
                          title: t('pointsConfig.membershipFee.deductedAt'),
                          dataIndex: 'deductedAt',
                          key: 'deductedAt',
                          width: 180,
                          render: (date: Date | undefined) => date ? dayjs(date).format(i18n.language === 'en-US' ? 'D MMM, YYYY HH:mm' : 'YYYY-MM-DD HH:mm') : '-'
                        },
                        {
                          title: t('pointsConfig.membershipFee.status'),
                          dataIndex: 'status',
                          key: 'status',
                          width: 100,
                          render: (status: string) => {
                            const statusMap: Record<string, { color: string; text: string }> = {
                              pending: { color: 'orange', text: t('pointsConfig.membershipFee.pending') },
                              paid: { color: 'green', text: t('pointsConfig.membershipFee.paid') },
                              failed: { color: 'red', text: t('pointsConfig.membershipFee.failed') },
                              cancelled: { color: 'default', text: t('pointsConfig.membershipFee.cancelled') }
                            };
                            const statusInfo = statusMap[status] || { color: 'default', text: status };
                            return <Tag color={statusInfo.color}>{statusInfo.text}</Tag>;
                          }
                        },
                        {
                          title: t('pointsConfig.membershipFee.createdAt'),
                          dataIndex: 'createdAt',
                          key: 'createdAt',
                          width: 180,
                          render: (date: Date) => dayjs(date).format(i18n.language === 'en-US' ? 'D MMM, YYYY HH:mm' : 'YYYY-MM-DD HH:mm')
                        }
                      ]}
                      dataSource={membershipFeeRecords}
                      rowKey="id"
                      loading={loadingMembershipFeeRecords}
                      pagination={{
                        pageSize: 20,
                        showSizeChanger: true,
                        showTotal: (total) => t('pointsConfig.membershipFee.totalRecords', { total })
                      }}
                      locale={{
                        emptyText: t('pointsConfig.membershipFee.noRecords')
                      }}
                  style={{
                    background: 'transparent'
                      }}
                    />
                  </div>
            ) : (
              <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
                {loadingMembershipFeeRecords ? (
                  <div style={{ textAlign: 'center', padding: '40px 20px', color: 'rgba(255, 255, 255, 0.6)' }}>
                    <Spin />
                  </div>
                ) : membershipFeeRecords.length === 0 ? (
                  <div style={{ color: 'rgba(255, 255, 255, 0.6)', textAlign: 'center', padding: '24px 0' }}>
                    {t('pointsConfig.membershipFee.noRecords')}
                  </div>
                ) : (
                  membershipFeeRecords.map((record) => {
                    const statusMap: Record<string, { color: string; text: string }> = {
                      pending: { color: '#fb923c', text: t('pointsConfig.membershipFee.pending') },
                      paid: { color: '#34d399', text: t('pointsConfig.membershipFee.paid') },
                      failed: { color: '#f87171', text: t('pointsConfig.membershipFee.failed') },
                      cancelled: { color: '#9ca3af', text: t('pointsConfig.membershipFee.cancelled') }
                    };
                    const statusInfo = statusMap[record.status] || { color: '#9ca3af', text: record.status };

                    const dueDate = record.dueDate instanceof Date
                      ? record.dueDate
                      : (record.dueDate as any)?.toDate
                        ? (record.dueDate as any).toDate()
                        : new Date(record.dueDate);

                    const deductedDate = record.deductedAt instanceof Date
                      ? record.deductedAt
                      : (record.deductedAt as any)?.toDate
                        ? (record.deductedAt as any).toDate()
                        : record.deductedAt
                          ? new Date(record.deductedAt)
                          : null;

                    const createdDate = record.createdAt instanceof Date
                      ? record.createdAt
                      : (record.createdAt as any)?.toDate
                        ? (record.createdAt as any).toDate()
                        : new Date(record.createdAt);

                    return (
                      <div
                        key={record.id}
                        style={{
                          border: '1px solid rgba(244,175,37,0.2)',
                          borderRadius: 12,
                          padding: 12,
                          background: 'rgba(34,28,16,0.5)',
                          backdropFilter: 'blur(10px)'
                        }}
                      >
                        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 8 }}>
                          <div style={{ flex: 1 }}>
                            <div style={{ fontSize: 13, fontWeight: 600, color: 'rgba(255,255,255,0.85)', marginBottom: 4 }}>
                              {record.userName || record.userId.substring(0, 20)}
                            </div>
                            <div style={{ fontSize: 12, color: 'rgba(255,255,255,0.6)', marginBottom: 4 }}>
                              {t('pointsConfig.membershipFee.due')}: {dayjs(dueDate).format(i18n.language === 'en-US' ? 'D MMM, YYYY HH:mm' : 'YYYY-MM-DD HH:mm')}
                            </div>
                            {deductedDate && (
                              <div style={{ fontSize: 12, color: 'rgba(255,255,255,0.6)', marginBottom: 4 }}>
                                {t('pointsConfig.membershipFee.deducted')}: {dayjs(deductedDate).format(i18n.language === 'en-US' ? 'D MMM, YYYY HH:mm' : 'YYYY-MM-DD HH:mm')}
                              </div>
                            )}
                            <div style={{ fontSize: 11, color: 'rgba(255,255,255,0.5)' }}>
                              {t('pointsConfig.membershipFee.created')}: {dayjs(createdDate).format(i18n.language === 'en-US' ? 'D MMM, YYYY HH:mm' : 'YYYY-MM-DD HH:mm')}
                            </div>
                          </div>
                          <div style={{ textAlign: 'right', marginLeft: 12 }}>
                            <div style={{
                              fontSize: 18,
                              fontWeight: 700,
                              color: '#ff4d4f',
                              marginBottom: 4
                            }}>
                              -{record.amount} {t('pointsConfig.units.points')}
                            </div>
                            <span style={{
                              fontSize: 11,
                              padding: '2px 8px',
                              borderRadius: 4,
                              background: statusInfo.color === '#fb923c' ? 'rgba(251,146,60,0.2)' :
                                statusInfo.color === '#34d399' ? 'rgba(52,211,153,0.2)' :
                                statusInfo.color === '#f87171' ? 'rgba(248,113,113,0.2)' :
                                'rgba(156,163,175,0.2)',
                              color: statusInfo.color,
                              fontWeight: 600
                            }}>
                              {statusInfo.text}
                            </span>
                            <div style={{ fontSize: 11, color: 'rgba(255,255,255,0.5)', marginTop: 4 }}>
                              {record.renewalType === 'initial' ? t('pointsConfig.membershipFee.initial') : t('pointsConfig.membershipFee.renewal')}
                            </div>
                          </div>
                        </div>
                      </div>
                    );
                  })
                )}
              </div>
            )}
          </div>
        )}
      </div>

      {/* 创建年费记录Modal */}
      <Modal
        title={<span style={{ color: '#FFFFFF' }}>{t('pointsConfig.membershipFee.createRecord')}</span>}
        open={creatingFeeRecord}
        onCancel={() => {
          setCreatingFeeRecord(false);
          feeRecordForm.resetFields();
        }}
        onOk={() => feeRecordForm.submit()}
        okText={t('pointsConfig.membershipFee.create')}
        cancelText={t('pointsConfig.membershipFee.cancel')}
        okButtonProps={{
          style: {
            background: 'linear-gradient(to right, #FDE08D, #C48D3A)',
            border: 'none',
            color: '#111',
            fontWeight: 700
          }
        }}
        cancelButtonProps={{
          style: {
            background: 'rgba(255, 255, 255, 0.1)',
            border: '1px solid rgba(255, 255, 255, 0.2)',
            color: '#FFFFFF'
          }
        }}
        styles={{
          content: {
            background: 'linear-gradient(180deg, #221c10 0%, #181611 100%)',
            border: '1px solid rgba(244, 175, 37, 0.6)'
          },
          header: {
            background: 'transparent',
            borderBottom: '1px solid rgba(244, 175, 37, 0.6)'
          },
          body: {
            background: 'transparent'
          },
          footer: {
            background: 'transparent',
            borderTop: '1px solid rgba(244, 175, 37, 0.6)'
          }
        }}
      >
        <Form
          form={feeRecordForm}
          layout="vertical"
          onFinish={handleCreateFeeRecord}
          initialValues={{
            dueDate: dayjs().add(1, 'year')
          }}
        >
          <Form.Item
            label={t('pointsConfig.membershipFee.selectUser')}
            name="userId"
            rules={[{ required: true, message: t('pointsConfig.membershipFee.selectUserRequired') }]}
          >
            <Select
              showSearch
              placeholder={t('pointsConfig.membershipFee.searchUserPlaceholder')}
              filterOption={(input, option) => {
                const kw = (input || '').toLowerCase();
                const uid = option?.value as string;
                const u = users.find(x => x.id === uid);
                const name = (u?.displayName || '').toLowerCase();
                const email = (u?.email || '').toLowerCase();
                const phone = ((u as any)?.profile?.phone || '').toLowerCase();
                return !!kw && (name.includes(kw) || email.includes(kw) || phone.includes(kw));
              }}
              options={users
                .sort((a, b) => {
                  const nameA = (a.displayName || a.email || a.id).toLowerCase();
                  const nameB = (b.displayName || b.email || b.id).toLowerCase();
                  return nameA.localeCompare(nameB);
                })
                .map(u => ({
                  key: u.id,
                  value: u.id,
                  label: `${u.displayName || u.email || u.id} ${((u as any)?.profile?.phone ? `(${(u as any).profile.phone})` : '')}`
                }))}
            />
          </Form.Item>

          <Form.Item
            label={<span style={{ color: 'rgba(255, 255, 255, 0.85)' }}>{t('pointsConfig.membershipFee.dueDate')}</span>}
            name="dueDate"
            rules={[{ required: true, message: t('pointsConfig.membershipFee.dueDateRequired') }]}
          >
            <DatePicker
              style={{ width: '100%' }}
              format="YYYY-MM-DD"
              disabledDate={(current) => current && current < dayjs().startOf('day')}
            />
          </Form.Item>

          <Form.Item
            label={<span style={{ color: 'rgba(255, 255, 255, 0.85)' }}>{t('pointsConfig.membershipFee.store')}</span>}
            name="storeId"
            rules={[{ required: true, message: t('pointsConfig.membershipFee.selectStoreRequired') }]}
          >
            <Select
              placeholder={t('pointsConfig.membershipFee.selectStorePlaceholder')}
              options={stores
                .filter(s => s.status === 'active')
                .map(s => ({ value: s.id, label: s.name }))
              }
            />
          </Form.Item>

          <Form.Item>
            <Text style={{ color: 'rgba(255, 255, 255, 0.6)' }}>
              {t('pointsConfig.membershipFee.autoDeductHint')}
            </Text>
          </Form.Item>
        </Form>
      </Modal>
    </div>
  );
};

export default PointsConfigPage;

