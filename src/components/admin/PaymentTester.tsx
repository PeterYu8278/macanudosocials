/**
 * Billplz 支付功能测试组件
 */
import React, { useState } from 'react';
import { Card, Form, Input, Button, Space, App, Typography, Divider, Tag, Descriptions, Badge } from 'antd';
import { CreditCardOutlined, SearchOutlined, CheckCircleOutlined, CloseCircleOutlined, SyncOutlined, LinkOutlined } from '@ant-design/icons';
import { useTranslation } from 'react-i18next';
import { createBill, getBillStatus, type BillplzBillResponse } from '../../services/billplz';
import { getAppConfig } from '../../services/firebase/appConfig';

const { Title, Text } = Typography;

interface PaymentTesterProps {
  paymentConfig?: {
    billplz?: {
      enabled?: boolean;
      isSandbox?: boolean;
    };
  };
  isPlatform?: boolean;
}

const PaymentTester: React.FC<PaymentTesterProps> = ({ paymentConfig, isPlatform = false }) => {
  const { t } = useTranslation();
  const { message } = App.useApp();
  const [createForm] = Form.useForm();
  const [statusForm] = Form.useForm();
  const [loading, setLoading] = useState(false);
  const [checking, setChecking] = useState(false);
  const [lastBill, setLastBill] = useState<BillplzBillResponse | null>(null);
  const [checkedBill, setCheckedBill] = useState<BillplzBillResponse | null>(null);
  const [appName, setAppName] = useState<string>('');

  // 加载应用名称
  React.useEffect(() => {
    const loadAppName = async () => {
      const config = await getAppConfig();
      setAppName(config?.appName || 'MS');
    };
    loadAppName();
  }, []);

  // 创建测试账单
  const handleCreateBill = async (values: any) => {
    setLoading(true);
    try {
      const { amount, description, name, email, mobile } = values;
      const result = await createBill(
        parseFloat(amount),
        description || `Test payment for ${appName}`,
        name || 'Test User',
        email || 'test@example.com',
        mobile || '60123456789',
        isPlatform
      );

      if (result.success && result.data) {
        setLastBill(result.data);
        message.success(t('common.success'));
        // 自动填充状态查询表单
        statusForm.setFieldsValue({ billId: result.data.id });
      } else {
        message.error(t('common.error') + ': ' + result.error);
      }
    } catch (error: any) {
      message.error(t('common.error') + ': ' + error.message);
    } finally {
      setLoading(false);
    }
  };

  // 查询账单状态
  const handleCheckStatus = async (values: any) => {
    setChecking(true);
    try {
      const { billId } = values;
      const result = await getBillStatus(billId, isPlatform);

      if (result.success && result.data) {
        setCheckedBill(result.data);
        message.success(t('common.success'));
      } else {
        message.error(t('common.error') + ': ' + result.error);
      }
    } catch (error: any) {
      message.error(t('common.error') + ': ' + error.message);
    } finally {
      setChecking(false);
    }
  };

  const isEnabled = paymentConfig?.billplz?.enabled;
  const isSandbox = paymentConfig?.billplz?.isSandbox;

  return (
    <div style={{ marginTop: 24 }}>
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 16 }}>
        {/* 创建测试付款 */}
        <Card
          style={{
            background: 'rgba(255, 255, 255, 0.05)',
            borderRadius: 12,
            border: '1px solid rgba(244, 175, 37, 0.6)',
            backdropFilter: 'blur(10px)',
          }}
          title={
            <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
              <CreditCardOutlined style={{ color: '#f4af25' }} />
              <span style={{ color: '#f8f8f8' }}>{t('featureManagement.createTestBill')}</span>
              {isEnabled && (
                <Tag color={isSandbox ? 'orange' : 'green'} style={{ marginLeft: 'auto' }}>
                  {isSandbox ? 'Sandbox' : 'Production'}
                </Tag>
              )}
            </div>
          }
        >
          {!isEnabled && (
            <div style={{ marginBottom: 16 }}>
              <Badge status="error" text={<Text type="danger">{t('featureManagement.featureNotAvailable')}</Text>} />
            </div>
          )}

          <Form
            form={createForm}
            layout="vertical"
            onFinish={handleCreateBill}
            initialValues={{
              amount: '1.00',
              description: `Test payment for ${appName}`,
              name: 'Tester',
              email: 'tester@jep.com',
              mobile: '60123456789'
            }}
          >
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
              <Form.Item
                label={<span style={{ color: '#c0c0c0' }}>{t('featureManagement.amount')}</span>}
                name="amount"
                rules={[{ required: true, message: t('common.required') }]}
              >
                <Input 
                  prefix="RM" 
                  placeholder="0.00"
                  style={{ background: 'rgba(255,255,255,0.05)', border: '1px solid rgba(255,255,255,0.1)', color: '#f8f8f8' }}
                />
              </Form.Item>
              <Form.Item
                label={<span style={{ color: '#c0c0c0' }}>{t('common.name')}</span>}
                name="name"
              >
                <Input 
                  placeholder="Tester"
                  style={{ background: 'rgba(255,255,255,0.05)', border: '1px solid rgba(255,255,255,0.1)', color: '#f8f8f8' }}
                />
              </Form.Item>
            </div>

            <Form.Item
              label={<span style={{ color: '#c0c0c0' }}>{t('common.email')}</span>}
              name="email"
              rules={[{ type: 'email', message: t('auth.emailInvalid') }]}
            >
              <Input 
                placeholder="tester@jep.com"
                style={{ background: 'rgba(255,255,255,0.05)', border: '1px solid rgba(255,255,255,0.1)', color: '#f8f8f8' }}
              />
            </Form.Item>

            <Form.Item
              label={<span style={{ color: '#c0c0c0' }}>{t('featureManagement.billDescription')}</span>}
              name="description"
            >
              <Input 
                placeholder="付款描述"
                style={{ background: 'rgba(255,255,255,0.05)', border: '1px solid rgba(255,255,255,0.1)', color: '#f8f8f8' }}
              />
            </Form.Item>

            <Button
              type="primary"
              icon={<CreditCardOutlined />}
              htmlType="submit"
              loading={loading}
              disabled={!isEnabled}
              block
              style={{
                background: 'linear-gradient(to right,#FDE08D,#C48D3A)',
                border: 'none',
                color: '#000',
                fontWeight: 600,
                height: '40px',
                borderRadius: '8px'
              }}
            >
              {t('featureManagement.createTestBill')}
            </Button>
          </Form>

          {lastBill && (
            <div style={{ marginTop: 16, padding: 12, background: 'rgba(255,255,255,0.05)', borderRadius: 8, border: '1px solid rgba(244,175,37,0.3)' }}>
              <Text style={{ color: '#f4af25', fontWeight: 600, display: 'block', marginBottom: 8 }}>{t('common.success')}:</Text>
              <Space direction="vertical" style={{ width: '100%' }}>
                <Text style={{ color: '#f8f8f8', fontSize: '12px' }}>ID: {lastBill.id}</Text>
                <Button 
                  type="link" 
                  icon={<LinkOutlined />} 
                  href={lastBill.url} 
                  target="_blank"
                  style={{ padding: 0, color: '#FDE08D' }}
                >
                  {t('featureManagement.openPaymentPage')}
                </Button>
              </Space>
            </div>
          )}
        </Card>

        {/* 查询付款状态 */}
        <Card
          style={{
            background: 'rgba(255, 255, 255, 0.05)',
            borderRadius: 12,
            border: '1px solid rgba(244, 175, 37, 0.6)',
            backdropFilter: 'blur(10px)',
          }}
          title={
            <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
              <SearchOutlined style={{ color: '#f4af25' }} />
              <span style={{ color: '#f8f8f8' }}>{t('featureManagement.checkPaymentStatus')}</span>
            </div>
          }
        >
          <Form
            form={statusForm}
            layout="vertical"
            onFinish={handleCheckStatus}
          >
            <Form.Item
              label={<span style={{ color: '#c0c0c0' }}>{t('featureManagement.billId')}</span>}
              name="billId"
              rules={[{ required: true, message: t('common.required') }]}
            >
              <Input 
                placeholder="例如: xxxxxxxx"
                style={{ background: 'rgba(255,255,255,0.05)', border: '1px solid rgba(255,255,255,0.1)', color: '#f8f8f8' }}
              />
            </Form.Item>

            <Button
              icon={<SearchOutlined />}
              htmlType="submit"
              loading={checking}
              block
              style={{
                background: 'rgba(255,255,255,0.1)',
                border: '1px solid rgba(244,175,37,0.5)',
                color: '#f4af25',
                fontWeight: 600,
                height: '40px',
                borderRadius: '8px'
              }}
            >
              {t('featureManagement.queryStatus')}
            </Button>
          </Form>

          {checkedBill && (
            <div style={{ marginTop: 16 }}>
              <Divider style={{ margin: '12px 0', borderColor: 'rgba(255,255,255,0.1)' }} />
              <Descriptions 
                column={1} 
                size="small" 
                bordered={false}
                labelStyle={{ color: '#c0c0c0', fontSize: '12px' }}
                contentStyle={{ color: '#f8f8f8', fontSize: '12px' }}
              >
                <Descriptions.Item label={t('common.status')}>
                  {checkedBill.paid ? (
                    <Tag icon={<CheckCircleOutlined />} color="success">{t('featureManagement.paid')}</Tag>
                  ) : (
                    <Tag icon={<SyncOutlined spin />} color="processing">{checkedBill.state.toUpperCase()}</Tag>
                  )}
                </Descriptions.Item>
                <Descriptions.Item label={t('featureManagement.amount')}>RM {(checkedBill.amount / 100).toFixed(2)}</Descriptions.Item>
                <Descriptions.Item label={t('common.name')}>{checkedBill.name}</Descriptions.Item>
                <Descriptions.Item label={t('common.email')}>{checkedBill.email}</Descriptions.Item>
                <Descriptions.Item label={t('common.createdAt')}>{new Date(checkedBill.due_at).toLocaleString()}</Descriptions.Item>
              </Descriptions>
            </div>
          )}
        </Card>
      </div>
    </div>
  );
};

export default PaymentTester;
