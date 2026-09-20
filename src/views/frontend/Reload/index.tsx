// 用户充值页面
import React, { useState, useEffect } from 'react';
import { Card, Button, Typography, Space, message, Spin, Tag, Modal, App, Select } from 'antd';
import { WalletOutlined, ReloadOutlined, ClockCircleOutlined, CloseCircleOutlined } from '@ant-design/icons';
import { useAuthStore } from '../../../store/modules/auth';
import { createReloadRecord, getUserReloadRecords, getUserPendingReloadRecord, cancelReloadRecord } from '../../../services/firebase/reload';
import { getAllStores } from '../../../services/firebase/stores';
import { getAppConfig } from '../../../services/firebase/appConfig';
import { createBill } from '../../../services/billplz';
import { useNavigate } from 'react-router-dom';
import type { ReloadRecord, Store, AppConfig } from '../../../types';
import dayjs from 'dayjs';
import { useFirestoreQuery, useFirestoreDoc } from '../../../hooks/useFirestoreQuery';
import { useTranslation } from 'react-i18next';

const { Title, Text } = Typography;

const ReloadPage: React.FC = () => {
  const { t } = useTranslation();
  const { user } = useAuthStore();
  const navigate = useNavigate();
  const { modal } = App.useApp(); // 使用 App.useApp() 获取 modal 实例以支持 React 19
  const [loading, setLoading] = useState(false);
  const [selectedAmount, setSelectedAmount] = useState<number | null>(null);
  const [selectedStoreId, setSelectedStoreId] = useState<string>('');

  const amountOptions = [100, 200, 300, 500, 1000];

  // stores
  const { data: allStores } = useFirestoreQuery(getAllStores);
  const stores = allStores.filter(s => s.status === 'active');

  // 初始化默认选中第一家门店
  useEffect(() => {
    if (stores.length > 0 && !selectedStoreId) {
      setSelectedStoreId(stores[0].id);
    }
  }, [stores, selectedStoreId]);

  // 支付配置
  const { data: appConfig } = useFirestoreDoc(getAppConfig);
  const paymentConfig = appConfig?.payment ?? null;

  // 检查是否有未验证的充值记录
  const { data: pendingRecord, loading: checkingPending, refresh: refreshPendingRecord } = useFirestoreDoc(
    async () => {
      if (!user?.id) return null;
      try {
        return await getUserPendingReloadRecord(user.id);
      } catch (error) {
        console.error('[ReloadPage] 检查充值记录失败:', error);
        try {
          const records = await getUserReloadRecords(user.id, 10);
          return records.find(r => r.status === 'pending') ?? null;
        } catch (fallbackError) {
          console.error('[ReloadPage] 备用查询也失败:', fallbackError);
          return null;
        }
      }
    },
    [user?.id]
  );

  const handleReload = async (amount: number) => {
    if (!user?.id) {
      message.warning(t('auth.pleaseLogin'));
      navigate('/');
      return;
    }

    // 如果有未验证的充值记录，不允许再次提交
    if (pendingRecord) {
      message.warning(t('reload.pendingReloadExists'));
      return;
    }

    if (!selectedStoreId) {
      message.warning(t('reload.pleaseSelectStore'));
      return;
    }

    setLoading(true);
    try {
      // 检查是否开启了 Billplz 支付
      if (paymentConfig?.billplz?.enabled) {
        const billResponse = await createBill(
          amount,
          `Reload ${amount} RM for ${user.displayName || 'Member'}`,
          user.displayName || 'Member',
          user.email || '',
          user.phone || ''
        );

        if (billResponse.success && billResponse.data?.url) {
          // 先创建一个 pending 记录，备注 Billplz ID
          await createReloadRecord(
            user.id, 
            amount, 
            user.displayName, 
            selectedStoreId, 
            billResponse.data.id
          );
          
          message.loading(t('common.redirectingToPayment'), 2);
          setTimeout(() => {
            window.location.href = billResponse.data!.url;
          }, 1000);
          return;
        } else {
          message.error(billResponse.error || t('common.paymentInitFailed'));
          setLoading(false);
          return;
        }
      }

      // 传统模式：提交请求等待管理员验证
      const result = await createReloadRecord(user.id, amount, user.displayName, selectedStoreId);
      if (result.success) {
        message.success(t('reload.reloadRequestSubmitted', { amount }));
        setSelectedAmount(null);
        refreshPendingRecord();
        navigate('/');
      } else {
        message.error(result.error || t('reload.submitReloadFailed'));
      }
    } catch (error: any) {
      message.error(error.message || t('reload.submitReloadFailed'));
    } finally {
      setLoading(false);
    }
  };

  const handleCancelReload = () => {
    if (!pendingRecord || !user?.id) {
      console.warn('[ReloadPage] 无法撤销：pendingRecord 或 user.id 不存在', { pendingRecord, userId: user?.id });
      return;
    }

    modal.confirm({
      title: t('reload.confirmCancelTitle'),
      content: t('reload.confirmCancelContent', { pendingRecord }),
      okText: t('reload.confirmCancel'),
      cancelText: t('common.cancel'),
      okButtonProps: {
        danger: true
      },
      onOk: async () => {
        setLoading(true);
        try {
          const result = await cancelReloadRecord(pendingRecord.id, user.id);
          if (result.success) {
            message.success(t('reload.reloadCancelled'));
            refreshPendingRecord();
          } else {
            message.error(result.error || t('reload.cancelReloadFailed'));
          }
        } catch (error: any) {
          console.error('[ReloadPage] 撤销失败:', error);
          message.error(error.message || t('reload.cancelReloadFailed'));
        } finally {
          setLoading(false);
        }
      }
    });
  };

  if (!user) {
    return (
      <div style={{ 
        padding: '24px', 
        textAlign: 'center',
        minHeight: 'calc(100vh - 200px)',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center'
      }}>
        <Text style={{ color: '#c0c0c0', fontSize: 16 }}>{t('auth.pleaseLogin')}</Text>
      </div>
    );
  }

  const currentPoints = user.membership?.points || 0;

  // 如果正在检查，显示加载状态
  if (checkingPending) {
    return (
      <div style={{ 
        padding: '24px', 
        maxWidth: 600, 
        margin: '0 auto',
        minHeight: 'calc(100vh - 200px)',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center'
      }}>
        <Spin size="large" />
      </div>
    );
  }

  return (
    <div style={{ 
      padding: '24px', 
      maxWidth: 600, 
      margin: '0 auto',
      minHeight: 'calc(100vh - 200px)'
    }}>
      <Card
        style={{
          background: 'linear-gradient(135deg, rgba(26, 26, 26, 0.95) 0%, rgba(45, 45, 45, 0.95) 100%)',
          borderRadius: 12,
          border: '1px solid rgba(255, 215, 0, 0.3)',
          boxShadow: '0 8px 32px rgba(0, 0, 0, 0.5), 0 0 20px rgba(255, 215, 0, 0.1)'
        }}
        bodyStyle={{ padding: 24 }}
      >
        <Space direction="vertical" size="large" style={{ width: '100%' }}>
          {/* 标题 */}
          <div style={{ textAlign: 'center' }}>
            <Title level={2} style={{ 
              margin: 0, 
              color: '#FFD700',
              fontWeight: 700,
              textShadow: '0 2px 8px rgba(255, 215, 0, 0.3)'
            }}>
              <WalletOutlined style={{ marginRight: 8 }} /> RELOAD
            </Title>
            <Text style={{
              fontSize: 14,
              display: 'block',
              marginTop: 12,
              color: '#c0c0c0'
            }}>
              {t('reload.currentBalance')} <Text strong style={{
                color: '#FFD700',
                fontSize: 18,
                fontWeight: 700,
                textShadow: '0 2px 4px rgba(255, 215, 0, 0.3)'
              }}>
                {currentPoints} {t('visitTimer.points')}
              </Text>
            </Text>
          </div>

          {/* 如果有待验证的充值记录，显示记录信息 */}
          {pendingRecord ? (
            <div style={{
              background: 'rgba(255, 215, 0, 0.1)',
              border: '1px solid rgba(255, 215, 0, 0.3)',
              borderRadius: 8,
              padding: 20,
              textAlign: 'center'
            }}>
              <ClockCircleOutlined style={{ 
                fontSize: 48, 
                color: '#FFD700',
                marginBottom: 16
              }} />
              <Title level={4} style={{ 
                color: '#FFD700',
                marginBottom: 12
              }}>
                {t('reload.pendingReloadTitle')}
              </Title>
              <div style={{ marginBottom: 16 }}>
                <Text style={{ color: '#c0c0c0', fontSize: 16, display: 'block', marginBottom: 8 }}>
                  {t('reload.reloadAmount')} <Text strong style={{ color: '#FFD700', fontSize: 20 }}>
                    {pendingRecord.requestedAmount} RM
                  </Text>
                </Text>
                <Text style={{ color: '#c0c0c0', fontSize: 14, display: 'block', marginBottom: 8 }}>
                  {t('reload.estimatedPoints')} <Text strong style={{ color: '#FFD700' }}>
                    {pendingRecord.pointsEquivalent} {t('visitTimer.points')}
                  </Text>
                </Text>
                <Text style={{ color: '#999999', fontSize: 12, display: 'block' }}>
                  {t('reload.submittedAt')} {dayjs(pendingRecord.createdAt).format('YYYY-MM-DD HH:mm:ss')}
                </Text>
              </div>
              <Tag color="orange" style={{ 
                fontSize: 14,
                padding: '4px 12px',
                borderRadius: 4,
                margin: 0,
                display: 'inline-block'
              }}>
                {t('reload.waitingAdminVerification')}
              </Tag>
              <div style={{ marginTop: 20 }}>
                <Button
                  type="default"
                  danger
                  size="large"
                  icon={<CloseCircleOutlined />}
                  onClick={handleCancelReload}
                  loading={loading}
                  style={{
                    height: 40,
                    fontSize: 14,
                    fontWeight: 600,
                    borderColor: '#ff4d4f',
                    color: '#ff4d4f'
                  }}
                >
                  {t('reload.cancelReloadBtn')}
                </Button>
              </div>
              <div style={{ marginTop: 16 }}>
                <Text style={{ 
                  fontSize: 12,
                  color: '#999999',
                  display: 'block'
                }}>
                  {t('reload.verificationNote1')}
                </Text>
                <Text style={{ 
                  fontSize: 12,
                  color: '#999999',
                  display: 'block',
                  marginTop: 4
                }}>
                  {t('reload.verificationNote2')}
                </Text>
              </div>
            </div>
          ) : (
            <>
              {/* 门店选择 */}
              <div style={{ marginBottom: 24 }}>
                <Text style={{ color: '#c0c0c0', display: 'block', marginBottom: 8, fontSize: 14 }}>
                  {t('reload.selectStore')}
                </Text>
                <Select
                  value={selectedStoreId}
                  onChange={setSelectedStoreId}
                  style={{ width: '100%', height: 44 }}
                  disabled={loading}
                  options={stores.map(s => ({ value: s.id, label: s.name }))}
                />
              </div>

              {/* 金额选择按钮 */}
              <Space direction="vertical" size="middle" style={{ width: '100%' }}>
                {amountOptions.map((amount) => (
                  <Button
                    key={amount}
                    type={selectedAmount === amount ? 'primary' : 'default'}
                    size="large"
                    block
                    onClick={() => setSelectedAmount(amount)}
                    disabled={loading}
                    style={{
                      height: 60,
                      fontSize: 18,
                      fontWeight: 600,
                      background: selectedAmount === amount
                        ? 'linear-gradient(135deg, #FDE08D 0%, #C48D3A 100%)'
                        : 'rgba(45, 45, 45, 0.8)',
                      border: selectedAmount === amount 
                        ? 'none' 
                        : '1px solid rgba(255, 215, 0, 0.3)',
                      color: selectedAmount === amount ? '#111' : '#FFD700',
                      transition: 'all 0.3s ease',
                      boxShadow: selectedAmount === amount
                        ? '0 4px 16px rgba(255, 215, 0, 0.3)'
                        : 'none'
                    }}
                    onMouseEnter={(e) => {
                      if (selectedAmount !== amount && !loading) {
                        e.currentTarget.style.borderColor = 'rgba(255, 215, 0, 0.5)';
                        e.currentTarget.style.boxShadow = '0 2px 8px rgba(255, 215, 0, 0.2)';
                      }
                    }}
                    onMouseLeave={(e) => {
                      if (selectedAmount !== amount) {
                        e.currentTarget.style.borderColor = 'rgba(255, 215, 0, 0.3)';
                        e.currentTarget.style.boxShadow = 'none';
                      }
                    }}
                  >
                    {amount} RM
                    {selectedAmount === amount && (
                      <Text style={{ marginLeft: 8, fontSize: 14, color: '#111' }}>
                        = {amount} {t('visitTimer.points')}
                      </Text>
                    )}
                  </Button>
                ))}
              </Space>

              {/* 确认按钮 */}
              {selectedAmount && (
                <Button
                  type="primary"
                  size="large"
                  block
                  icon={<ReloadOutlined />}
                  onClick={() => handleReload(selectedAmount)}
                  loading={loading}
                  style={{
                    height: 50,
                    fontSize: 16,
                    fontWeight: 600,
                    background: 'linear-gradient(135deg, #FDE08D 0%, #C48D3A 100%)',
                    border: 'none',
                    color: '#111',
                    boxShadow: '0 4px 16px rgba(255, 215, 0, 0.4)',
                    transition: 'all 0.3s ease'
                  }}
                  onMouseEnter={(e) => {
                    if (!loading) {
                      e.currentTarget.style.boxShadow = '0 6px 20px rgba(255, 215, 0, 0.5)';
                      e.currentTarget.style.transform = 'translateY(-2px)';
                    }
                  }}
                  onMouseLeave={(e) => {
                    e.currentTarget.style.boxShadow = '0 4px 16px rgba(255, 215, 0, 0.4)';
                    e.currentTarget.style.transform = 'translateY(0)';
                  }}
                >
                  {t('reload.confirmReloadBtn', { amount: selectedAmount })} {paymentConfig?.billplz?.enabled ? t('reload.onlinePaymentLabel') : ''}
                </Button>
              )}

              {/* 提示信息 */}
              <div style={{ textAlign: 'center', marginTop: 16 }}>
                <Text style={{ 
                  fontSize: 12,
                  color: '#999999'
                }}>
                  {t('reload.submitNote')}
                </Text>
              </div>
            </>
          )}
        </Space>
      </Card>
    </div>
  );
};

export default ReloadPage;

