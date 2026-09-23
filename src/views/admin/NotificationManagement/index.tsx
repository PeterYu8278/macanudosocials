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
  CloudServerOutlined,
  ReloadOutlined,
  SendOutlined,
  UserOutlined,
} from '@ant-design/icons'
import { auth } from '../../../config/firebase'
import { getAllUsers } from '../../../services/firebase/firestore'
import type { User, UserRole } from '../../../types'

const { Title, Text } = Typography

type OneSignalUserRecord = {
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
  title: string
  body: string
  clickAction?: string
}

const NotificationManagement: React.FC = () => {
  const { message } = App.useApp()
  const [form] = Form.useForm<SendFormValues>()
  const [records, setRecords] = useState<OneSignalUserRecord[]>([])
  const [loading, setLoading] = useState(false)
  const [search, setSearch] = useState('')
  const [sendTarget, setSendTarget] = useState<OneSignalUserRecord | null>(null)
  const [sending, setSending] = useState(false)

  const loadUsers = useCallback(async () => {
    setLoading(true)
    try {
      const users = await getAllUsers()
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

  const openSendModal = (record: OneSignalUserRecord) => {
    setSendTarget(record)
    form.resetFields()
    form.setFieldsValue({
      title: 'Macanudo Socials notification test',
      body: 'This is a targeted OneSignal test notification.',
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
        throw new Error(result.error || result.message || 'OneSignal delivery request failed')
      }

      const recipients = result.results?.sent ?? 0
      message.success(
        recipients > 0
          ? `OneSignal accepted the message for ${recipients} subscription${recipients === 1 ? '' : 's'}`
          : `OneSignal accepted message ${result.messageId || ''}`.trim(),
      )
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
      render: (_: unknown, record: OneSignalUserRecord) => (
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
      render: (_: unknown, record: OneSignalUserRecord) => (
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
      <Text type="secondary">Send targeted push notifications through OneSignal External IDs.</Text>

      <Alert
        type="info"
        showIcon
        style={{ margin: '16px 0' }}
        message="OneSignal targeted delivery"
        description="The selected user must have signed in after OneSignal initialized and allowed notifications on at least one device. Users without an active subscription will return a clear delivery error."
      />

      <Row gutter={[12, 12]} style={{ marginBottom: 16 }}>
        <Col xs={24} sm={8}><Card><Statistic title="Registered Users" value={records.length} prefix={<UserOutlined />} /></Card></Col>
        <Col xs={24} sm={8}><Card><Statistic title="Visible Users" value={filteredRecords.length} prefix={<BellOutlined />} /></Card></Col>
        <Col xs={24} sm={8}><Card><Statistic title="Push Provider" value="OneSignal" prefix={<CloudServerOutlined />} /></Card></Col>
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
          <Form.Item label="OneSignal External ID">
            <Input value={sendTarget?.userId} disabled />
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
