import React, { useCallback, useEffect, useMemo, useState } from 'react'
import {
  Alert,
  App,
  Button,
  Card,
  Col,
  DatePicker,
  Empty,
  Form,
  Input,
  Modal,
  Row,
  Segmented,
  Select,
  Space,
  Statistic,
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

const { Title, Text } = Typography

type NotificationUserRecord = {
  key: string
  userId: string
  displayName: string
  email: string
  memberId: string
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
        memberId: user.memberId || '-',
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
      record.memberId,
      record.phone,
      record.role,
      record.storeId,
      record.userId,
    ].some((value) => value.toLowerCase().includes(keyword)))
  }, [records, search])

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
        : recipients > 0
          ? `OneSignal accepted ${recipients} subscription${recipients === 1 ? '' : 's'}; delivery is not yet confirmed`
          : `OneSignal accepted message ${result.messageId || ''}`.trim())
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
        <Space>
          <UserOutlined style={{ color: '#F4AF25' }} />
          <div>
            <Text strong style={{ color: '#FDE08D' }}>{record.displayName}</Text>
            <div><Text type="secondary">{record.email}</Text></div>
            <Text type="secondary">{record.memberId}</Text>
          </div>
        </Space>
      ),
    },
    {
      title: 'External ID',
      dataIndex: 'userId',
      key: 'userId',
      render: (userId: string) => <Text code copyable={{ text: userId }}>{userId}</Text>,
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
      render: (role: UserRole) => <Tag color="gold">{role}</Tag>,
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
        <Button type="primary" icon={<SendOutlined />} onClick={() => openSendModal(record)}>
          Test Send
        </Button>
      ),
    },
  ]

  return (
    <div style={{ padding: 16, maxWidth: 1500, margin: '0 auto' }}>
      <Space align="center" style={{ marginBottom: 8 }}>
        <BellOutlined style={{ color: '#F4AF25', fontSize: 24 }} />
        <Title level={2} style={{ color: '#FDE08D', margin: 0 }}>Notification Management</Title>
      </Space>
      <Text type="secondary">Send targeted push notifications through FCM or OneSignal.</Text>

      <Alert
        type="info"
        showIcon
        style={{ margin: '16px 0' }}
        message="Targeted push delivery"
        description="The selected user must allow notifications and have an active token for the selected provider. FCM uses stored device tokens; OneSignal uses the user's External ID subscriptions."
      />

      <Row gutter={[12, 12]} style={{ marginBottom: 16 }}>
        <Col xs={24} sm={8}><Card><Statistic title="Registered Users" value={records.length} prefix={<UserOutlined />} /></Card></Col>
        <Col xs={24} sm={8}><Card><Statistic title="Visible Users" value={filteredRecords.length} prefix={<BellOutlined />} /></Card></Col>
        <Col xs={24} sm={8}><Card><Statistic title="Push Providers" value="FCM / OneSignal" prefix={<CloudServerOutlined />} /></Card></Col>
      </Row>

      <Card>
        <Space wrap style={{ width: '100%', justifyContent: 'space-between', marginBottom: 16 }}>
          <Input.Search
            allowClear
            placeholder="Search user, email, member ID, phone, or External ID"
            onChange={(event) => setSearch(event.target.value)}
            style={{ width: 420, maxWidth: '100%' }}
          />
          <Button icon={<ReloadOutlined />} loading={loading} onClick={loadUsers}>Refresh</Button>
        </Space>
        <Table
          rowKey="key"
          loading={loading}
          columns={columns}
          dataSource={filteredRecords}
          locale={{ emptyText: <Empty description="No registered users found" /> }}
          scroll={{ x: 1050 }}
          pagination={{ pageSize: 10, showSizeChanger: true }}
        />
      </Card>

      <Modal
        open={!!sendTarget}
        title={sendTarget ? `Send to ${sendTarget.displayName}` : 'Send notification'}
        okText="Send Notification"
        okButtonProps={{ icon: <SendOutlined />, loading: sending }}
        cancelButtonProps={{ disabled: sending }}
        onCancel={() => setSendTarget(null)}
        onOk={() => form.submit()}
        destroyOnHidden
      >
        <Form form={form} layout="vertical" onFinish={sendNotification}>
          <Form.Item label="Target user ID">
            <Input value={sendTarget?.userId} disabled />
          </Form.Item>
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
