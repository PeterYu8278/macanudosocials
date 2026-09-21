import React, { useEffect, useState } from 'react'
import {
  Table, Button, Tag, Space, Modal, Form, Input, Select,
  Switch, App, Popconfirm, DatePicker, Tooltip
} from 'antd'
import { PlusOutlined, EditOutlined, DeleteOutlined, PushpinOutlined } from '@ant-design/icons'
import dayjs from 'dayjs'
import { useTranslation } from 'react-i18next'
import type { Announcement, AnnouncementType, AnnouncementStatus } from '../../types'
import {
  getAnnouncements,
  createAnnouncement,
  updateAnnouncement,
  deleteAnnouncement,
} from '../../services/firebase/announcements'
import { useAuthStore } from '../../store/modules/auth'

const { TextArea } = Input
const { Option } = Select

const TYPE_COLORS: Record<AnnouncementType, string> = {
  info: 'blue',
  warning: 'orange',
  important: 'red',
}

const STATUS_COLORS: Record<AnnouncementStatus, string> = {
  draft: 'default',
  published: 'green',
  archived: 'volcano',
}

const AnnouncementsAdmin: React.FC = () => {
  const { t } = useTranslation()
  const { message } = App.useApp()
  const { user } = useAuthStore()

  const [announcements, setAnnouncements] = useState<Announcement[]>([])
  const [loading, setLoading] = useState(false)
  const [modalOpen, setModalOpen] = useState(false)
  const [editing, setEditing] = useState<Announcement | null>(null)
  const [saving, setSaving] = useState(false)

  const [form] = Form.useForm()

  const load = async () => {
    setLoading(true)
    try {
      setAnnouncements(await getAnnouncements())
    } catch {
      message.error(t('common.loadFailed', { defaultValue: 'Load failed' }))
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => { load() }, [])

  const openCreate = () => {
    setEditing(null)
    form.resetFields()
    form.setFieldsValue({ type: 'info', status: 'draft', pinned: false })
    setModalOpen(true)
  }

  const openEdit = (record: Announcement) => {
    setEditing(record)
    form.setFieldsValue({
      title: record.title,
      content: record.content,
      type: record.type,
      status: record.status,
      pinned: record.pinned,
      publishedAt: record.publishedAt ? dayjs(record.publishedAt) : null,
      expiresAt: record.expiresAt ? dayjs(record.expiresAt) : null,
    })
    setModalOpen(true)
  }

  const handleSave = async () => {
    let values: any
    try { values = await form.validateFields() } catch { return }
    setSaving(true)
    try {
      const payload = {
        ...values,
        publishedAt: values.publishedAt?.toDate() ?? null,
        expiresAt: values.expiresAt?.toDate() ?? null,
      }
      if (editing) {
        await updateAnnouncement(editing.id, payload)
      } else {
        await createAnnouncement({ ...payload, createdBy: user?.id ?? 'unknown' })
      }
      message.success(t('common.saved'))
      setModalOpen(false)
      load()
    } catch {
      message.error(t('common.saveFailed', { defaultValue: 'Save failed' }))
    } finally {
      setSaving(false)
    }
  }

  const handleDelete = async (id: string) => {
    try {
      await deleteAnnouncement(id)
      message.success(t('common.deleted'))
      load()
    } catch {
      message.error(t('common.operationFailed', { defaultValue: 'Operation failed' }))
    }
  }

  const handleTogglePin = async (record: Announcement) => {
    try {
      await updateAnnouncement(record.id, { pinned: !record.pinned })
      load()
    } catch {
      message.error(t('common.operationFailed', { defaultValue: 'Operation failed' }))
    }
  }

  const columns = [
    {
      title: t('announcements.title', { defaultValue: 'Title' }),
      dataIndex: 'title',
      key: 'title',
      render: (v: string, r: Announcement) => (
        <Space>
          {r.pinned && <PushpinOutlined style={{ color: '#FDE08D' }} />}
          <span style={{ color: '#fff' }}>{v}</span>
        </Space>
      ),
    },
    {
      title: t('announcements.type', { defaultValue: 'Type' }),
      dataIndex: 'type',
      key: 'type',
      width: 100,
      render: (v: AnnouncementType) => <Tag color={TYPE_COLORS[v]}>{v}</Tag>,
    },
    {
      title: t('announcements.status', { defaultValue: 'Status' }),
      dataIndex: 'status',
      key: 'status',
      width: 100,
      render: (v: AnnouncementStatus) => <Tag color={STATUS_COLORS[v]}>{v}</Tag>,
    },
    {
      title: t('announcements.publishedAt', { defaultValue: 'Published At' }),
      dataIndex: 'publishedAt',
      key: 'publishedAt',
      width: 160,
      render: (v: Date | null) => v ? dayjs(v).format('YYYY-MM-DD HH:mm') : '-',
    },
    {
      title: t('announcements.expiresAt', { defaultValue: 'Expires At' }),
      dataIndex: 'expiresAt',
      key: 'expiresAt',
      width: 160,
      render: (v: Date | null) => v ? dayjs(v).format('YYYY-MM-DD HH:mm') : '-',
    },
    {
      title: t('common.actions', { defaultValue: 'Actions' }),
      key: 'actions',
      width: 140,
      render: (_: any, record: Announcement) => (
        <Space size="small">
          <Tooltip title={record.pinned ? t('announcements.unpin', { defaultValue: 'Unpin' }) : t('announcements.pin', { defaultValue: 'Pin' })}>
            <Button
              size="small"
              icon={<PushpinOutlined />}
              type={record.pinned ? 'primary' : 'text'}
              onClick={() => handleTogglePin(record)}
            />
          </Tooltip>
          <Button size="small" icon={<EditOutlined />} onClick={() => openEdit(record)} />
          <Popconfirm
            title={t('common.confirmDelete', { defaultValue: 'Confirm delete?' })}
            onConfirm={() => handleDelete(record.id)}
            okButtonProps={{ danger: true }}
          >
            <Button size="small" icon={<DeleteOutlined />} danger />
          </Popconfirm>
        </Space>
      ),
    },
  ]

  return (
    <div>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16 }}>
        <h2 style={{ margin: 0, fontSize: 18, fontWeight: 700, color: 'rgba(255,255,255,0.85)' }}>
          {t('announcements.management', { defaultValue: 'Announcements' })}
        </h2>
        <Button
          type="primary"
          icon={<PlusOutlined />}
          onClick={openCreate}
          style={{ background: 'linear-gradient(to right,#FDE08D,#C48D3A)', border: 'none', color: '#111', fontWeight: 700 }}
        >
          {t('announcements.create', { defaultValue: 'New Announcement' })}
        </Button>
      </div>

      <Table
        dataSource={announcements}
        columns={columns}
        rowKey="id"
        loading={loading}
        pagination={{ pageSize: 20, showSizeChanger: false }}
        style={{ background: 'transparent' }}
      />

      <Modal
        title={editing ? t('announcements.edit', { defaultValue: 'Edit Announcement' }) : t('announcements.create', { defaultValue: 'New Announcement' })}
        open={modalOpen}
        onCancel={() => setModalOpen(false)}
        onOk={handleSave}
        okText={t('common.save')}
        cancelText={t('common.cancel')}
        confirmLoading={saving}
        width={560}
        centered
      >
        <Form form={form} layout="vertical" style={{ marginTop: 16 }}>
          <Form.Item name="title" label={t('announcements.title', { defaultValue: 'Title' })} rules={[{ required: true }]}>
            <Input placeholder={t('announcements.titlePlaceholder', { defaultValue: 'Announcement title' })} />
          </Form.Item>
          <Form.Item name="content" label={t('announcements.content', { defaultValue: 'Content' })} rules={[{ required: true }]}>
            <TextArea rows={4} placeholder={t('announcements.contentPlaceholder', { defaultValue: 'Announcement content' })} />
          </Form.Item>
          <Form.Item name="type" label={t('announcements.type', { defaultValue: 'Type' })}>
            <Select>
              <Option value="info">Info</Option>
              <Option value="warning">Warning</Option>
              <Option value="important">Important</Option>
            </Select>
          </Form.Item>
          <Form.Item name="status" label={t('announcements.status', { defaultValue: 'Status' })}>
            <Select>
              <Option value="draft">Draft</Option>
              <Option value="published">Published</Option>
              <Option value="archived">Archived</Option>
            </Select>
          </Form.Item>
          <Form.Item name="publishedAt" label={t('announcements.publishedAt', { defaultValue: 'Publish Time' })}>
            <DatePicker showTime style={{ width: '100%' }} />
          </Form.Item>
          <Form.Item name="expiresAt" label={t('announcements.expiresAt', { defaultValue: 'Expiry Time' })}>
            <DatePicker showTime style={{ width: '100%' }} />
          </Form.Item>
          <Form.Item name="pinned" label={t('announcements.pinned', { defaultValue: 'Pin to top' })} valuePropName="checked">
            <Switch />
          </Form.Item>
        </Form>
      </Modal>
    </div>
  )
}

export default AnnouncementsAdmin
