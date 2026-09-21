/**
 * Whapi 消息发送测试组件
 */
import React, { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Card, Form, Input, Button, Space, App, Typography, Divider, Tag, Switch, Radio } from 'antd';
import { SendOutlined, CheckCircleOutlined, CloseCircleOutlined, ReloadOutlined } from '@ant-design/icons';
import { sendTextMessage, sendEventReminder, sendVipExpiryReminder, sendPasswordReset, checkWhapiHealth, formatPhoneNumber } from '../../services/whapi';
import type { SendMessageResponse } from '../../types/whapi';
import { getAppConfig } from '../../services/firebase/appConfig';

const { Title, Text } = Typography;
const { TextArea } = Input;

interface WhapiMessageTesterProps {
  whapiConfig?: {
    apiToken?: string;
    channelId?: string;
    baseUrl?: string;
    enabled?: boolean;
  };
}

const WhapiMessageTester: React.FC<WhapiMessageTesterProps> = ({ whapiConfig }) => {
  const { t } = useTranslation();
  const { message } = App.useApp();
  const [form] = Form.useForm();
  const [loading, setLoading] = useState(false);
  const [healthStatus, setHealthStatus] = useState<{ success: boolean; error?: string; data?: any } | null>(null);
  const [lastResult, setLastResult] = useState<SendMessageResponse | null>(null);
  const [appName, setAppName] = useState<string>('');
  const isMobile = typeof window !== 'undefined' && window.matchMedia('(max-width: 768px)').matches;

  // 加载应用名称
  React.useEffect(() => {
    const loadAppName = async () => {
      const config = await getAppConfig();
      setAppName(config?.appName || '');
    };
    loadAppName();
  }, []);

  // 检查连接状态
  const handleCheckHealth = async () => {
    setLoading(true);
    try {
      const result = await checkWhapiHealth();
      setHealthStatus(result);
      if (result.success) {
        message.success(t('whapiTester.connectionOk'));
      } else {
        message.error(result.error || t('whapiTester.connectionFailed'));
      }
    } catch (error: any) {
      message.error(t('whapiTester.checkConnectionFailed') + error.message);
      setHealthStatus({ success: false, error: error.message });
    } finally {
      setLoading(false);
    }
  };

  // 发送测试消息
  const handleSendMessage = async (values: any) => {
    setLoading(true);
    try {
      const { phone, messageType, customMessage, eventName, eventDate, eventLocation, userName, expiryDate, resetLink } = values;
      const formattedPhone = formatPhoneNumber(phone);
      let result: SendMessageResponse;

      switch (messageType) {
        case 'event_reminder':
          result = await sendEventReminder(
            formattedPhone,
            userName || t('whapiTester.defaultUserName'),
            eventName || t('whapiTester.defaultEventName'),
            eventDate || new Date().toLocaleString(),
            eventLocation || t('whapiTester.defaultEventLocation')
          );
          break;
        case 'vip_expiry':
          result = await sendVipExpiryReminder(
            formattedPhone,
            userName || t('whapiTester.defaultUserName'),
            expiryDate || new Date().toLocaleString()
          );
          break;
        case 'password_reset':
          result = await sendPasswordReset(
            formattedPhone,
            userName || t('whapiTester.defaultUserName'),
            resetLink || 'https://example.com/reset-password'
          );
          break;
        case 'custom':
        default:
          result = await sendTextMessage(formattedPhone, customMessage);
          break;
      }

      setLastResult(result);
      if (result.success) {
        message.success(t('whapiTester.messageSentSuccess'));
        form.resetFields(['customMessage', 'eventName', 'eventDate', 'eventLocation', 'expiryDate', 'resetLink']);
      } else {
        message.error(t('whapiTester.messageSendFailed') + result.error);
      }
    } catch (error: any) {
      message.error(t('whapiTester.sendFailed') + error.message);
      setLastResult({ success: false, error: error.message });
    } finally {
      setLoading(false);
    }
  };

  return (
    <div>
      <style>{`
        .whapi-message-type-group .ant-radio-button-wrapper {
          background: rgba(255, 255, 255, 0.05) !important;
          border-color: rgba(244, 175, 37, 0.6) !important;
          color: #f8f8f8 !important;
          transition: all 0.3s ease !important;
        }
        .whapi-message-type-group .ant-radio-button-wrapper-checked {
          background: linear-gradient(to right, #FDE08D, #C48D3A) !important;
          border-color: rgba(244, 175, 37, 0.8) !important;
          color: #111 !important;
          font-weight: 600 !important;
          box-shadow: 0 4px 14px rgba(196, 141, 58, 0.35) !important;
        }
        .whapi-message-type-group .ant-radio-button-wrapper-checked:hover {
          filter: brightness(1.05) !important;
          box-shadow: 0 6px 18px rgba(196, 141, 58, 0.45) !important;
        }
        .whapi-message-type-group .ant-radio-button-wrapper:first-child {
          border-radius: 8px 0 0 8px !important;
        }
        .whapi-message-type-group .ant-radio-button-wrapper:last-child {
          border-radius: 0 8px 8px 0 !important;
        }
        @media (max-width: 768px) {
          .whapi-message-type-group {
            display: flex !important;
            width: 100% !important;
          }
          .whapi-message-type-group .ant-radio-button-wrapper {
            flex: 1 !important;
            font-size: 12px !important;
            padding: 4px 6px !important;
            white-space: nowrap !important;
            text-align: center !important;
            min-width: 0 !important;
            display: flex !important;
            align-items: center !important;
            justify-content: center !important;
          }
          .whapi-message-type-group .ant-radio-button-wrapper:first-child {
            border-radius: 6px 0 0 6px !important;
          }
          .whapi-message-type-group .ant-radio-button-wrapper:last-child {
            border-radius: 0 6px 6px 0 !important;
          }
        }
      `}</style>
      <Card
        style={{
          background: 'rgba(255, 255, 255, 0.05)',
          borderRadius: 12,
          border: '1px solid rgba(244, 175, 37, 0.6)',
          backdropFilter: 'blur(10px)',
          marginBottom: 16,
        }}
      >
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16 }}>
          <Title level={4} style={{ color: '#f8f8f8', margin: 0, fontSize: '16px' }}>
            {t('whapiTester.connectionStatus')}
          </Title>
          <Space>
            <Button
              icon={<ReloadOutlined />}
              onClick={handleCheckHealth}
              loading={loading}
              size="small"
            >
              {t('whapiTester.checkConnection')}
            </Button>
            {healthStatus && (
              <Tag
                icon={healthStatus.success ? <CheckCircleOutlined /> : <CloseCircleOutlined />}
                color={healthStatus.success ? 'success' : 'error'}
              >
                {healthStatus.success ? t('whapiTester.connected') : t('whapiTester.connectionFailed')}
              </Tag>
            )}
          </Space>
        </div>
        {healthStatus?.error && (
          <Text type="danger" style={{ fontSize: '12px' }}>
            {healthStatus.error}
          </Text>
        )}
        {!whapiConfig?.enabled && (
          <Text type="warning" style={{ fontSize: '12px' }}>
            {t('whapiTester.notEnabled')}
          </Text>
        )}
      </Card>

      <Card
        style={{
          background: 'rgba(255, 255, 255, 0.05)',
          borderRadius: 12,
          border: '1px solid rgba(244, 175, 37, 0.6)',
          backdropFilter: 'blur(10px)',
        }}
      >
        <Title level={4} style={{ color: '#f8f8f8', marginBottom: 16, fontSize: '16px' }}>
          {t('whapiTester.sendTestMessage')}
        </Title>
        <Form
          form={form}
          layout="vertical"
          onFinish={handleSendMessage}
          initialValues={{
            messageType: 'custom',
            phone: '601157288278',
          }}
        >
          <Form.Item
            label={<span style={{ color: '#f8f8f8', fontSize: '16px' }}>{t('whapiTester.recipientPhone')}</span>}
            name="phone"
            rules={[{ required: true, message: t('whapiTester.phoneRequired') }]}
          >
            <Input
              placeholder={t('whapiTester.phonePlaceholder')}
              style={{
                background: 'rgba(255, 255, 255, 0.05)',
                border: '1px solid rgba(255, 255, 255, 0.1)',
                color: '#f8f8f8',
              }}
            />
          </Form.Item>

          <Form.Item
            label={<span style={{ color: '#f8f8f8', fontSize: '16px' }}>{t('whapiTester.messageType')}</span>}
            name="messageType"
            rules={[{ required: true }]}
          >
            <Radio.Group
              style={{ width: '100%' }}
              optionType="button"
              buttonStyle="solid"
              size={isMobile ? 'middle' : 'large'}
              className="whapi-message-type-group"
            >
              <Radio.Button value="custom" style={isMobile ? { fontSize: '12px', padding: '4px 8px' } : {}}>{t('whapiTester.customMessage')}</Radio.Button>
              <Radio.Button value="event_reminder" style={isMobile ? { fontSize: '12px', padding: '4px 8px' } : {}}>{t('whapiTester.eventReminder')}</Radio.Button>
              <Radio.Button value="vip_expiry" style={isMobile ? { fontSize: '12px', padding: '4px 8px' } : {}}>{t('whapiTester.vipExpiryReminder')}</Radio.Button>
              <Radio.Button value="password_reset" style={isMobile ? { fontSize: '12px', padding: '4px 8px' } : {}}>{t('whapiTester.resetPassword')}</Radio.Button>
            </Radio.Group>
          </Form.Item>

          <Form.Item noStyle shouldUpdate={(prev, curr) => prev.messageType !== curr.messageType}>
            {({ getFieldValue }) => {
              const messageType = getFieldValue('messageType');
              
              if (messageType === 'custom') {
                return (
                  <Form.Item
                    label={<span style={{ color: '#f8f8f8', fontSize: '16px' }}>{t('whapiTester.messageContent')}</span>}
                    name="customMessage"
                    rules={[{ required: true, message: t('whapiTester.messageContentRequired') }]}
                  >
                    <TextArea
                      rows={4}
                      placeholder={t('whapiTester.messageContentPlaceholder')}
                      style={{
                        background: 'rgba(255, 255, 255, 0.05)',
                        border: '1px solid rgba(255, 255, 255, 0.1)',
                        color: '#f8f8f8',
                      }}
                    />
                  </Form.Item>
                );
              }

              if (messageType === 'event_reminder') {
                return (
                  <>
                    <Form.Item
                      label={<span style={{ color: '#f8f8f8', fontSize: '16px' }}>{t('whapiTester.userName')}</span>}
                      name="userName"
                    >
                      <Input
                        placeholder={t('whapiTester.userName')}
                        style={{
                          background: 'rgba(255, 255, 255, 0.05)',
                          border: '1px solid rgba(255, 255, 255, 0.1)',
                          color: '#f8f8f8',
                        }}
                      />
                    </Form.Item>
                    <Form.Item
                      label={<span style={{ color: '#f8f8f8', fontSize: '16px' }}>{t('whapiTester.eventName')}</span>}
                      name="eventName"
                    >
                      <Input
                        placeholder={t('whapiTester.eventName')}
                        style={{
                          background: 'rgba(255, 255, 255, 0.05)',
                          border: '1px solid rgba(255, 255, 255, 0.1)',
                          color: '#f8f8f8',
                        }}
                      />
                    </Form.Item>
                    <Form.Item
                      label={<span style={{ color: '#f8f8f8', fontSize: '16px' }}>{t('whapiTester.eventDate')}</span>}
                      name="eventDate"
                    >
                      <Input
                        placeholder={t('whapiTester.eventDate')}
                        style={{
                          background: 'rgba(255, 255, 255, 0.05)',
                          border: '1px solid rgba(255, 255, 255, 0.1)',
                          color: '#f8f8f8',
                        }}
                      />
                    </Form.Item>
                    <Form.Item
                      label={<span style={{ color: '#f8f8f8', fontSize: '16px' }}>{t('whapiTester.eventLocation')}</span>}
                      name="eventLocation"
                    >
                      <Input
                        placeholder={t('whapiTester.eventLocation')}
                        style={{
                          background: 'rgba(255, 255, 255, 0.05)',
                          border: '1px solid rgba(255, 255, 255, 0.1)',
                          color: '#f8f8f8',
                        }}
                      />
                    </Form.Item>
                  </>
                );
              }

              if (messageType === 'vip_expiry') {
                return (
                  <>
                    <Form.Item
                      label={<span style={{ color: '#f8f8f8', fontSize: '16px' }}>{t('whapiTester.userName')}</span>}
                      name="userName"
                    >
                      <Input
                        placeholder={t('whapiTester.userName')}
                        style={{
                          background: 'rgba(255, 255, 255, 0.05)',
                          border: '1px solid rgba(255, 255, 255, 0.1)',
                          color: '#f8f8f8',
                        }}
                      />
                    </Form.Item>
                    <Form.Item
                      label={<span style={{ color: '#f8f8f8', fontSize: '16px' }}>{t('whapiTester.expiryDate')}</span>}
                      name="expiryDate"
                    >
                      <Input
                        placeholder={t('whapiTester.expiryDate')}
                        style={{
                          background: 'rgba(255, 255, 255, 0.05)',
                          border: '1px solid rgba(255, 255, 255, 0.1)',
                          color: '#f8f8f8',
                        }}
                      />
                    </Form.Item>
                  </>
                );
              }

              if (messageType === 'password_reset') {
                return (
                  <>
                    <Form.Item
                      label={<span style={{ color: '#f8f8f8', fontSize: '16px' }}>{t('whapiTester.userName')}</span>}
                      name="userName"
                    >
                      <Input
                        placeholder={t('whapiTester.userName')}
                        style={{
                          background: 'rgba(255, 255, 255, 0.05)',
                          border: '1px solid rgba(255, 255, 255, 0.1)',
                          color: '#f8f8f8',
                        }}
                      />
                    </Form.Item>
                    <Form.Item
                      label={<span style={{ color: '#f8f8f8', fontSize: '16px' }}>{t('whapiTester.resetLink')}</span>}
                      name="resetLink"
                    >
                      <Input
                        placeholder={t('whapiTester.resetLink')}
                        style={{
                          background: 'rgba(255, 255, 255, 0.05)',
                          border: '1px solid rgba(255, 255, 255, 0.1)',
                          color: '#f8f8f8',
                        }}
                      />
                    </Form.Item>
                  </>
                );
              }

              return null;
            }}
          </Form.Item>

          {/* 消息预览 */}
          <Form.Item noStyle shouldUpdate={(prev, curr) => {
            return prev.messageType !== curr.messageType ||
                   prev.customMessage !== curr.customMessage ||
                   prev.userName !== curr.userName ||
                   prev.eventName !== curr.eventName ||
                   prev.eventDate !== curr.eventDate ||
                   prev.eventLocation !== curr.eventLocation ||
                   prev.expiryDate !== curr.expiryDate ||
                   prev.resetLink !== curr.resetLink;
          }}>
            {({ getFieldValue }) => {
              const messageType = getFieldValue('messageType') || 'custom';
              const customMessage = getFieldValue('customMessage') || '';
              const userName = getFieldValue('userName') || t('whapiTester.defaultUserName');
              const eventName = getFieldValue('eventName') || t('whapiTester.defaultEventName');
              const eventDate = getFieldValue('eventDate') || new Date().toLocaleString();
              const eventLocation = getFieldValue('eventLocation') || t('whapiTester.defaultEventLocation');
              const expiryDate = getFieldValue('expiryDate') || new Date().toLocaleString();
              const resetLink = getFieldValue('resetLink') || 'https://example.com/reset-password';

              let previewMessage = '';

              switch (messageType) {
                case 'custom':
                  previewMessage = customMessage;
                  break;
                case 'event_reminder': {
                  // 解析日期和时间
                  let dateStr = '';
                  let timeStr = '';
                  
                  try {
                    const dateObj = new Date(eventDate);
                    if (!isNaN(dateObj.getTime())) {
                      // 格式化日期：YYYY/MM/DD
                      const year = dateObj.getFullYear();
                      const month = String(dateObj.getMonth() + 1).padStart(2, '0');
                      const day = String(dateObj.getDate()).padStart(2, '0');
                      dateStr = `${year}/${month}/${day}`;
                      
                      // 格式化时间：HH:mm:ss
                      const hours = String(dateObj.getHours()).padStart(2, '0');
                      const minutes = String(dateObj.getMinutes()).padStart(2, '0');
                      const seconds = String(dateObj.getSeconds()).padStart(2, '0');
                      timeStr = `${hours}:${minutes}:${seconds}`;
                    } else {
                      // 如果无法解析，使用原始字符串
                      dateStr = eventDate;
                      timeStr = '';
                    }
                  } catch {
                    dateStr = eventDate;
                    timeStr = '';
                  }

                  previewMessage = t('whapiTester.eventReminderPreview', {
                    appName,
                    userName,
                    eventName,
                    date: dateStr,
                    timeLine: timeStr ? t('whapiTester.eventReminderTimeLine', { time: timeStr }) : '',
                    eventLocation,
                  });
                  break;
                }
                case 'vip_expiry':
                  previewMessage = t('whapiTester.vipExpiryPreview', {
                    appName,
                    userName,
                    expiryDate,
                  });
                  break;
                case 'password_reset':
                  previewMessage = t('whapiTester.passwordResetPreview', {
                    appName,
                    userName,
                    resetLink,
                  });
                  break;
                default:
                  previewMessage = '';
              }

              if (!previewMessage) {
                return null;
              }

              return (
                <Form.Item
                  label={<span style={{ color: '#f8f8f8', fontSize: '16px' }}>{t('whapiTester.messagePreview')}</span>}
                >
                  <div
                    style={{
                      background: 'rgba(255, 255, 255, 0.05)',
                      border: '1px solid rgba(255, 255, 255, 0.1)',
                      borderRadius: '8px',
                      padding: '12px 16px',
                      minHeight: '60px',
                      color: '#f8f8f8',
                      fontSize: '14px',
                      lineHeight: '1.6',
                      whiteSpace: 'pre-wrap',
                      wordBreak: 'break-word',
                    }}
                  >
                    {previewMessage}
                  </div>
                </Form.Item>
              );
            }}
          </Form.Item>

          <Form.Item>
            <div style={{ display: 'flex', justifyContent: 'flex-end' }}>
              <Button
                type="primary"
                icon={<SendOutlined />}
                htmlType="submit"
                loading={loading}
                disabled={!whapiConfig?.enabled}
                style={{
                  background: 'linear-gradient(to right,#FDE08D,#C48D3A)',
                  border: 'none',
                  color: '#000',
                }}
              >
                {t('whapiTester.sendMessage')}
              </Button>
            </div>
          </Form.Item>
        </Form>

        {lastResult && (
          <>
            <Divider style={{ margin: '16px 0', borderColor: 'rgba(255, 255, 255, 0.1)' }} />
            <div>
            <Text style={{ color: '#f8f8f8', fontSize: '14px', fontWeight: 600 }}>{t('whapiTester.sendResult')}</Text>
            <div style={{ marginTop: 8 }}>
              {lastResult.success ? (
                <Tag icon={<CheckCircleOutlined />} color="success">
                  {t('common.success')}
                </Tag>
              ) : (
                <Tag icon={<CloseCircleOutlined />} color="error">
                  {t('common.failed')}
                </Tag>
              )}
              {lastResult.messageId && (
                <Text style={{ color: '#c0c0c0', fontSize: '12px', marginLeft: 8 }}>
                  {t('whapiTester.messageIdLabel')}{lastResult.messageId}
                </Text>
              )}
              {lastResult.error && (
                <Text type="danger" style={{ fontSize: '12px', display: 'block', marginTop: 4 }}>
                  {t('whapiTester.errorPrefix')}{lastResult.error}
                </Text>
              )}
            </div>
          </div>
          </>
        )}
      </Card>
    </div>
  );
};

export default WhapiMessageTester;
