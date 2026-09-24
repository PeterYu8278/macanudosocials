import React, { useCallback, useEffect, useMemo, useState } from 'react'
import {
  Alert,
  App,
  Button,
  DatePicker,
  Empty,
  Form,
  Input,
  List,
  Modal,
  Segmented,
  Select,
  Space,
  Table,
  Tag,
  Typography,
} from 'antd'
import {
  BellOutlined,
  CloudServerOutlined,
  ReloadOutlined,
  SendOutlined,
  UserOutlined,
} from '@ant-design/icons'
import type { Dayjs } from 'dayjs'
import { auth } from '../../../config/firebase'
import { getAllUsers, getUpcomingEvents } from '../../../services/firebase/firestore'
import type { Event, User, UserRole } from '../../../types'
import './index.css'

const { Title, Text } = Typography

type NotificationUserRecord = {
  key: string
  userId: string
  displayName: string
  email: string
  subscriptionId: string
  device: string
  os: string
  browser: string
  phone: string
  role: UserRole
  storeId: string
}

type SendFormValues = {
  provider: 'onesignal' | 'fcm'
  messageType: 'custom' | 'event_reminder' | 'vip_expiry'
  title: string
  body: string
  clickAction?: string
  eventId?: string
  expiryDate?: Dayjs
}

const toDate = (value: unknown) => {
  if (value && typeof value === 'object' && 'toDate' in value) {
    return (value as { toDate: () => Date }).toDate()
  }
  return new Date(value as string | number | Date)
}

const formatReminderDate = (value: Date) => new Intl.DateTimeFormat(undefined, {
  dateStyle: 'medium',
  timeStyle: 'short',
}).format(value)

const NotificationManagement: React.FC = () => {
  const { message } = App.useApp()
  const [form] = Form.useForm<SendFormValues>()
  const [records, setRecords] = useState<NotificationUserRecord[]>([])
  const [events, setEvents] = useState<Event[]>([])
  const [loading, setLoading] = useState(false)
  const [search, setSearch] = useState('')
  const [sendTarget, setSendTarget] = useState<NotificationUserRecord | null>(null)
  const [sending, setSending] = useState(false)

  const loadUsers = useCallback(async () => {
    setLoading(true)
    try {
      const [users, upcomingEvents] = await Promise.all([getAllUsers(), getUpcomingEvents()])
      setRecords(users.map((user: User) => ({
        key: user.id,
        userId: user.id,
        displayName: user.displayName || 'Unnamed user',
        email: user.email || '-',
        subscriptionId: user.notificationSummary?.currentSubscriptionId || '-',
        device: user.notificationSummary?.currentDeviceType || '-',
        os: user.notificationSummary?.currentOs || '-',
        browser: user.notificationSummary?.currentBrowser || '-',
        phone: user.phone || user.profile?.phone || '-',
        role: user.role,
        storeId: user.storeId || '-',
      })))
      setEvents(upcomingEvents)
    } catch (error) {
      console.error('[NotificationManagement] Failed to load users:', error)
      message.error('Unable to load users')
    } finally {
      setLoading(false)
    }
  }, [message])

  useEffect(() => {
    loadUsers()
  }, [loadUsers])

  const filteredRecords = useMemo(() => {
    const keyword = search.trim().toLowerCase()
    if (!keyword) return records
    return records.filter((record) => [
      record.displayName,
      record.email,
      record.subscriptionId,
      record.device,
      record.os,
      record.browser,
      record.phone,
      record.role,
      record.storeId,
    ].some((value) => value.toLowerCase().includes(keyword)))
  }, [records, search])

  const subscribedUserCount = useMemo(
    () => records.filter((record) => record.subscriptionId !== '-').length,
    [records],
  )

  const openSendModal = (record: NotificationUserRecord) => {
    setSendTarget(record)
    form.resetFields()
    form.setFieldsValue({
      provider: 'onesignal',
      messageType: 'custom',
      title: 'Macanudo Socials notification test',
      body: 'This is a targeted push notification test.',
      clickAction: '/profile',
    })
  }

  const renderSubscription = (record: NotificationUserRecord) => {
    const tags = [
      { key: 'device', value: record.device },
      { key: 'os', value: record.os },
      { key: 'browser', value: record.browser },
    ].filter((item) => item.value !== '-')

    return (
      <div className="notification-subscription-cell">
        {tags.length > 0 && (
          <div className="notification-device-tags">
            {tags.map((item) => (
              <Tag key={item.key} className={`notification-device-tag is-${item.key}`}>
                {item.value}
              </Tag>
            ))}
          </div>
        )}
        {record.subscriptionId === '-' ? (
          <Text type="secondary">-</Text>
        ) : (
          <Text
            code
            copyable={{ text: record.subscriptionId }}
            ellipsis={{ tooltip: record.subscriptionId }}
          >
            {record.subscriptionId}
          </Text>
        )}
      </div>
    )
  }

  const updateMessageType = (messageType: SendFormValues['messageType']) => {
    if (!sendTarget) return

    if (messageType === 'event_reminder') {
      form.setFieldsValue({
        messageType,
        eventId: undefined,
        expiryDate: undefined,
        title: 'Event Reminder',
        body: `Hi ${sendTarget.displayName}, this is a test event reminder from Macanudo Socials.`,
        clickAction: '/events',
      })
      return
    }

    if (messageType === 'vip_expiry') {
      form.setFieldsValue({
        messageType,
        eventId: undefined,
        expiryDate: undefined,
        title: 'VIP Expiry Reminder',
        body: `Hi ${sendTarget.displayName}, this is a test VIP expiry reminder from Macanudo Socials.`,
        clickAction: '/profile',
      })
      return
    }

    form.setFieldsValue({
      messageType,
      eventId: undefined,
      expiryDate: undefined,
      title: 'Macanudo Socials notification test',
      body: 'This is a targeted push notification test.',
      clickAction: '/profile',
    })
  }

  const updateEventReminder = (eventId: string) => {
    if (!sendTarget) return
    const event = events.find((item) => item.id === eventId)
    if (!event) return

    const startsAt = toDate(event.schedule.startDate)
    const location = event.location?.name || event.location?.address || 'Macanudo Socials'
    form.setFieldsValue({
      title: `Event Reminder: ${event.title}`,
      body: `Hi ${sendTarget.displayName}, ${event.title} starts on ${formatReminderDate(startsAt)} at ${location}. We look forward to seeing you!`,
      clickAction: '/events',
    })
  }

  const updateVipExpiryReminder = (expiryDate: Dayjs | null) => {
    if (!sendTarget || !expiryDate) return
    form.setFieldsValue({
      title: 'VIP Expiry Reminder',
      body: `Hi ${sendTarget.displayName}, your VIP membership will expire on ${expiryDate.format('DD MMM YYYY')}. Please renew to continue enjoying member benefits.`,
      clickAction: '/profile',
    })
  }

  const sendNotification = async (values: SendFormValues) => {
    if (!sendTarget) return
    setSending(true)
    try {
      const idToken = await auth.currentUser?.getIdToken()
      if (!idToken) throw new Error('Please sign in again before sending')

      const response = await fetch('/.netlify/functions/send-notification', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${idToken}`,
        },
        body: JSON.stringify({
          provider: values.provider,
          title: values.title,
          body: values.body,
          type: values.messageType === 'custom' ? 'system' : values.messageType,
          targetUsers: [sendTarget.userId],
          clickAction: values.clickAction || '/profile',
          data: {
            ...(values.eventId ? { eventId: values.eventId } : {}),
            ...(values.expiryDate ? { expiryDate: values.expiryDate.toISOString() } : {}),
            test: true,
          },
        }),
      })
      const responseText = await response.text()
      let result: {
        success?: boolean
        messageId?: string
        targetedSubscriptions?: number
        results?: { sent?: number; failed?: number }
        error?: string
        message?: string
      } = {}
      try {
        result = responseText ? JSON.parse(responseText) : {}
      } catch {
        throw new Error(
          `Notification endpoint returned ${response.status} ${response.statusText || 'without a JSON response'}`,
        )
      }
      if (!response.ok || !result.success) {
        throw new Error(result.error || result.message || 'Push delivery request failed')
      }

      const recipients = result.results?.sent ?? 0
      const failures = result.results?.failed ?? 0
      message.success(values.provider === 'fcm'
        ? `FCM sent: ${recipients}, failed: ${failures}`
        : `OneSignal accepted message ${result.messageId || ''} for ${result.targetedSubscriptions || recipients} subscription${(result.targetedSubscriptions || recipients) === 1 ? '' : 's'}; check Confirmed Delivery in OneSignal`)
      setSendTarget(null)
    } catch (error: any) {
      message.error(error?.message || 'Notification request failed')
    } finally {
      setSending(false)
    }
  }

  const columns = [
    {
      title: 'User',
      key: 'user',
      render: (_: unknown, record: NotificationUserRecord) => (
        <Space className="notification-user-cell">
          <span className="notification-user-icon"><UserOutlined /></span>
          <div>
            <Text strong className="notification-user-name">{record.displayName}</Text>
            <div><Text type="secondary">{record.email}</Text></div>
          </div>
        </Space>
      ),
    },
    {
      title: 'Subscription',
      key: 'subscriptionId',
      render: (_: unknown, record: NotificationUserRecord) => renderSubscription(record),
    },
    {
      title: 'Contact',
      dataIndex: 'phone',
      key: 'phone',
    },
    {
      title: 'Role',
      dataIndex: 'role',
      key: 'role',
      render: (role: UserRole) => <Tag className="notification-role-tag">{role}</Tag>,
    },
    {
      title: 'Store',
      dataIndex: 'storeId',
      key: 'storeId',
    },
    {
      title: 'Action',
      key: 'action',
      render: (_: unknown, record: NotificationUserRecord) => (
        <Button className="notification-primary-button" type="primary" icon={<SendOutlined />} onClick={() => openSendModal(record)}>
          Test Send
        </Button>
      ),
    },
  ]

  return (
    <div className="notification-management-page">
      <header className="notification-page-header">
        <div className="notification-title-group">
          <span className="notification-title-icon"><BellOutlined /></span>
          <div>
            <Title level={2}>Notification Management</Title>
            <Text type="secondary">Send targeted push notifications through FCM or OneSignal.</Text>
          </div>
        </div>
      </header>

      <Alert
        className="notification-delivery-alert"
        type="info"
        showIcon
        message="Targeted push delivery"
        description="The selected user must allow notifications and have an active subscription for the selected provider."
      />

      <section className="notification-status-strip" aria-label="Notification overview">
        <div className="notification-status-item">
          <UserOutlined />
          <div><strong>{records.length}</strong><span>Registered users</span></div>
        </div>
        <div className="notification-status-item">
          <BellOutlined />
          <div><strong>{subscribedUserCount}</strong><span>OneSignal ready</span></div>
        </div>
        <div className="notification-status-item">
          <CloudServerOutlined />
          <div><strong>2</strong><span>Push providers</span></div>
        </div>
      </section>

      <section className="notification-directory">
        <div className="notification-directory-header">
          <div>
            <Title level={4}>Recipients</Title>
            <Text type="secondary">{filteredRecords.length} users shown</Text>
          </div>
          <Space className="notification-toolbar">
          <Input.Search
            allowClear
            placeholder="Search user, subscription, device, OS, browser, role, or store"
            onChange={(event) => setSearch(event.target.value)}
          />
            <Button className="notification-refresh-button" icon={<ReloadOutlined />} loading={loading} onClick={loadUsers}>
              <span>Refresh</span>
            </Button>
          </Space>
        </div>

        <div className="notification-desktop-table">
          <Table
            rowKey="key"
            loading={loading}
            columns={columns}
            dataSource={filteredRecords}
            locale={{ emptyText: <Empty description="No registered users found" /> }}
            scroll={{ x: 900 }}
            pagination={{ pageSize: 10, showSizeChanger: true }}
          />
        </div>

        <List<NotificationUserRecord>
          className="notification-mobile-list"
          loading={loading}
          dataSource={filteredRecords}
          locale={{ emptyText: <Empty description="No registered users found" /> }}
          pagination={{ pageSize: 10, size: 'small', showSizeChanger: false }}
          renderItem={(record) => (
            <List.Item>
              <article className="notification-mobile-user">
                <div className="notification-mobile-user-header">
                  <div className="notification-mobile-identity">
                    <span className="notification-user-icon"><UserOutlined /></span>
                    <div>
                      <strong>{record.displayName}</strong>
                      <span>{record.email}</span>
                    </div>
                  </div>
                  <Tag className="notification-role-tag">{record.role}</Tag>
                </div>

                <div className="notification-mobile-meta">
                  <div><span>Phone</span><strong>{record.phone}</strong></div>
                  <div><span>Store</span><strong>{record.storeId}</strong></div>
                  <div className="notification-subscription-row">
                    <span>Subscription</span>
                    {renderSubscription(record)}
                  </div>
                </div>

                <Button
                  className="notification-primary-button"
                  type="primary"
                  icon={<SendOutlined />}
                  block
                  onClick={() => openSendModal(record)}
                >
                  Test Send
                </Button>
              </article>
            </List.Item>
          )}
        />
      </section>

      <Modal
        open={!!sendTarget}
        width={560}
        centered
        wrapClassName="notification-send-modal"
        title={sendTarget ? `Send to ${sendTarget.displayName}` : 'Send notification'}
        okText="Send Notification"
        okButtonProps={{ icon: <SendOutlined />, loading: sending }}
        cancelButtonProps={{ disabled: sending }}
        onCancel={() => setSendTarget(null)}
        onOk={() => form.submit()}
        destroyOnHidden
      >
        <Form form={form} layout="vertical" onFinish={sendNotification}>
          {sendTarget && (
            <div className="notification-modal-target">
              <span className="notification-user-icon"><UserOutlined /></span>
              <div>
                <strong>{sendTarget.displayName}</strong>
                <span>{sendTarget.email}</span>
              </div>
              <Tag className="notification-role-tag">{sendTarget.role}</Tag>
            </div>
          )}
          <Form.Item name="provider" label="Push provider" rules={[{ required: true }]}>
            <Segmented
              block
              options={[
                { value: 'onesignal', label: 'OneSignal' },
                { value: 'fcm', label: 'FCM' },
              ]}
            />
          </Form.Item>
          <Form.Item
            name="messageType"
            label="Notification type"
            rules={[{ required: true }]}
          >
            <Select
              onChange={updateMessageType}
              options={[
                { value: 'custom', label: 'Custom test' },
                { value: 'event_reminder', label: 'Event Reminder' },
                { value: 'vip_expiry', label: 'VIP Expiry Reminder' },
              ]}
            />
          </Form.Item>
          <Form.Item noStyle shouldUpdate={(previous, current) => previous.messageType !== current.messageType}>
            {({ getFieldValue }) => {
              const messageType = getFieldValue('messageType') as SendFormValues['messageType']
              if (messageType === 'event_reminder') {
                return (
                  <Form.Item
                    name="eventId"
                    label="Event"
                    rules={[{ required: true, message: 'Select an event to test' }]}
                  >
                    <Select
                      showSearch
                      placeholder="Select an upcoming event"
                      optionFilterProp="label"
                      onChange={updateEventReminder}
                      options={events.map((event) => ({
                        value: event.id,
                        label: `${event.title} - ${formatReminderDate(toDate(event.schedule.startDate))}`,
                      }))}
                      notFoundContent="No upcoming events found"
                    />
                  </Form.Item>
                )
              }
              if (messageType === 'vip_expiry') {
                return (
                  <Form.Item
                    name="expiryDate"
                    label="VIP expiry date"
                    rules={[{ required: true, message: 'Select an expiry date to test' }]}
                  >
                    <DatePicker style={{ width: '100%' }} onChange={updateVipExpiryReminder} />
                  </Form.Item>
                )
              }
              return null
            }}
          </Form.Item>
          <Form.Item name="title" label="Title" rules={[{ required: true, max: 100 }]}>
            <Input />
          </Form.Item>
          <Form.Item name="body" label="Message" rules={[{ required: true, max: 500 }]}>
            <Input.TextArea rows={4} showCount maxLength={500} />
          </Form.Item>
          <Form.Item name="clickAction" label="Click path">
            <Input placeholder="/profile" />
          </Form.Item>
        </Form>
      </Modal>
    </div>
  )
}

export default NotificationManagement
