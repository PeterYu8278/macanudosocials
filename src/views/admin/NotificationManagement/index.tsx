import React, { useCallback, useEffect, useMemo, useState } from 'react'
import {
  Alert,
  App,
  Button,
  Card,
  Col,
  Empty,
  Form,
  Input,
  Modal,
  Row,
  Space,
  Statistic,
  Table,
  Tag,
  Typography,
} from 'antd'
import {
  BellOutlined,
  CheckCircleOutlined,
  ReloadOutlined,
  SendOutlined,
  UserOutlined,
} from '@ant-design/icons'
import { collection, getDocs, query, where } from 'firebase/firestore'
import dayjs from 'dayjs'
import { db } from '../../../config/firebase'
import { getAllUsers } from '../../../services/firebase/firestore'
import type { User } from '../../../types'

const { Title, Text } = Typography

type TokenRecord = {
  key: string
  userId: string
  displayName: string
  email: string
  memberId: string
  token: string
  deviceId: string
  platform: string
  language: string
  lastUsed: Date | null
  active: boolean
}

type SendFormValues = {
  title: string
  body: string
  clickAction?: string
}

const toDate = (value: any): Date | null => {
  if (!value) return null
  if (value instanceof Date) return value
  if (typeof value?.toDate === 'function') return value.toDate()
  const parsed = new Date(value)
  return Number.isNaN(parsed.getTime()) ? null : parsed
}

const maskToken = (token: string) => token.length > 18
  ? `${token.slice(0, 8)}...${token.slice(-8)}`
  : token

const NotificationManagement: React.FC = () => {
  const { message } = App.useApp()
  const [form] = Form.useForm<SendFormValues>()
  const [records, setRecords] = useState<TokenRecord[]>([])
  const [loading, setLoading] = useState(false)
  const [search, setSearch] = useState('')
  const [sendTarget, setSendTarget] = useState<TokenRecord | null>(null)
  const [sending, setSending] = useState(false)

  const loadTokens = useCallback(async () => {
    setLoading(true)
    try {
      const users = await getAllUsers()
      const tokenGroups = await Promise.all(users.map(async (user: User) => {
        const tokensSnapshot = await getDocs(query(
          collection(db, 'users', user.id, 'fcmTokens'),
          where('active', '==', true),
        ))

        return tokensSnapshot.docs.map((tokenDoc) => {
          const data = tokenDoc.data() as any
          return {
            key: `${user.id}-${tokenDoc.id}`,
            userId: user.id,
            displayName: user.displayName || 'Unnamed user',
            email: user.email || '-',
            memberId: user.memberId || '-',
            token: data.token || '',
            deviceId: data.deviceId || '-',
            platform: data.deviceInfo?.platform || data.deviceInfo?.userAgent || '-',
            language: data.deviceInfo?.language || '-',
            lastUsed: toDate(data.lastUsed || data.createdAt),
            active: data.active === true,
          } satisfies TokenRecord
        })
      }))

      setRecords(tokenGroups.flat().filter((record) => record.token))
    } catch (error) {
      console.error('[NotificationManagement] Failed to load FCM tokens:', error)
      message.error('Unable to load FCM tokens')
    } finally {
      setLoading(false)
    }
  }, [message])

  useEffect(() => {
    loadTokens()
  }, [loadTokens])

  const filteredRecords = useMemo(() => {
    const keyword = search.trim().toLowerCase()
    if (!keyword) return records
    return records.filter((record) => [
      record.displayName,
      record.email,
      record.memberId,
      record.platform,
      record.deviceId,
    ].some((value) => value.toLowerCase().includes(keyword)))
  }, [records, search])

  const userCount = useMemo(() => new Set(records.map((record) => record.userId)).size, [records])

  const openSendModal = (record: TokenRecord) => {
    setSendTarget(record)
    form.resetFields()
    form.setFieldsValue({
      title: 'Macanudo Socials 通知测试',
      body: '这是一条单用户 FCM 测试通知',
      clickAction: '/profile',
    })
  }

  const sendNotification = async (values: SendFormValues) => {
    if (!sendTarget) return
    setSending(true)
    try {
      const response = await fetch('/.netlify/functions/send-notification', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          title: values.title,
          body: values.body,
          type: 'system',
          targetUsers: [sendTarget.userId],
          clickAction: values.clickAction || '/profile',
        }),
      })
      const responseText = await response.text()
      let result: {
        success?: boolean
        results?: {
          sent?: number
          failed?: number
          failureDetails?: Array<{ code?: string; message?: string }>
        }
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
        const failure = result.results?.failureDetails?.[0]
        const detail = failure ? ` (${failure.code || 'FCM'}: ${failure.message || 'delivery failed'})` : ''
        throw new Error(result.error || result.message || `Notification delivery failed${detail}`)
      }
      const sent = result.results?.sent ?? 0
      const failed = result.results?.failed ?? 0
      if (failed > 0) {
        message.warning(`Sent: ${sent}, failed: ${failed}`)
      } else {
        message.success(`Sent: ${sent}, failed: ${failed}`)
      }
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
      render: (_: unknown, record: TokenRecord) => (
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
      title: 'Device',
      key: 'device',
      render: (_: unknown, record: TokenRecord) => (
        <div>
          <Text>{record.platform}</Text>
          <div><Text type="secondary">{record.language} · {record.deviceId}</Text></div>
        </div>
      ),
    },
    {
      title: 'Token',
      dataIndex: 'token',
      key: 'token',
      render: (token: string) => <Text code copyable={{ text: token }}>{maskToken(token)}</Text>,
    },
    {
      title: 'Last Used',
      dataIndex: 'lastUsed',
      key: 'lastUsed',
      render: (value: Date | null) => value ? dayjs(value).format('DD MMM YYYY HH:mm') : '-',
    },
    {
      title: 'Status',
      dataIndex: 'active',
      key: 'active',
      render: (active: boolean) => <Tag color={active ? 'green' : 'default'}>{active ? 'Active' : 'Inactive'}</Tag>,
    },
    {
      title: 'Action',
      key: 'action',
      render: (_: unknown, record: TokenRecord) => (
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
      <Text type="secondary">Observe active FCM devices and send a targeted test notification.</Text>

      <Alert
        type="warning"
        showIcon
        style={{ margin: '16px 0' }}
        message="Targeted delivery only"
        description="Every send from this page targets the selected user's active tokens. Broadcast sending is intentionally unavailable here."
      />

      <Row gutter={[12, 12]} style={{ marginBottom: 16 }}>
        <Col xs={24} sm={8}><Card><Statistic title="Active Tokens" value={records.length} prefix={<CheckCircleOutlined />} /></Card></Col>
        <Col xs={24} sm={8}><Card><Statistic title="Users With Devices" value={userCount} prefix={<UserOutlined />} /></Card></Col>
        <Col xs={24} sm={8}><Card><Statistic title="Visible Records" value={filteredRecords.length} prefix={<BellOutlined />} /></Card></Col>
      </Row>

      <Card>
        <Space wrap style={{ width: '100%', justifyContent: 'space-between', marginBottom: 16 }}>
          <Input.Search
            allowClear
            placeholder="Search user, email, member ID, or device"
            onChange={(event) => setSearch(event.target.value)}
            style={{ width: 360, maxWidth: '100%' }}
          />
          <Button icon={<ReloadOutlined />} loading={loading} onClick={loadTokens}>Refresh</Button>
        </Space>
        <Table
          rowKey="key"
          loading={loading}
          columns={columns}
          dataSource={filteredRecords}
          locale={{ emptyText: <Empty description="No active FCM tokens found" /> }}
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
