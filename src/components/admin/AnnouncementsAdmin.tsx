import React, { useEffect, useMemo, useState } from 'react'
import {
  Table, Button, Tag, Space, Modal, Form, Input, Select,
  Switch, App, Popconfirm, DatePicker, Tooltip, Empty
} from 'antd'
import {
  PlusOutlined,
  EditOutlined,
  DeleteOutlined,
  PushpinOutlined,
  SearchOutlined,
  CalendarOutlined,
  ClockCircleOutlined,
  NotificationOutlined,
} from '@ant-design/icons'
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
import ImageUpload from '../common/ImageUpload'

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

const TYPE_ACCENTS: Record<AnnouncementType, string> = {
  info: '#60a5fa',
  warning: '#f59e0b',
  important: '#ef4444',
}

const toDate = (value: unknown): Date | null => {
  if (!value) return null
  if (typeof (value as any)?.toDate === 'function') return (value as any).toDate()
  const date = new Date(value as any)
  return Number.isNaN(date.getTime()) ? null : date
}

interface AnnouncementsAdminProps {
  isMobile?: boolean
}

const AnnouncementsAdmin: React.FC<AnnouncementsAdminProps> = ({ isMobile = false }) => {
  const { t } = useTranslation()
  const { message } = App.useApp()
  const { user } = useAuthStore()

  const [announcements, setAnnouncements] = useState<Announcement[]>([])
  const [loading, setLoading] = useState(false)
  const [modalOpen, setModalOpen] = useState(false)
  const [editing, setEditing] = useState<Announcement | null>(null)
  const [saving, setSaving] = useState(false)
  const [keyword, setKeyword] = useState('')
  const [statusFilter, setStatusFilter] = useState<'all' | AnnouncementStatus>('all')

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
      image: record.image || null,
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

  const filteredAnnouncements = useMemo(() => {
    const normalizedKeyword = keyword.trim().toLowerCase()
    return announcements
      .filter(record => statusFilter === 'all' || record.status === statusFilter)
      .filter(record => !normalizedKeyword || `${record.title} ${record.content}`.toLowerCase().includes(normalizedKeyword))
      .sort((a, b) => {
        if (a.pinned !== b.pinned) return a.pinned ? -1 : 1
        const aTime = toDate(a.publishedAt)?.getTime() ?? toDate(a.createdAt)?.getTime() ?? 0
        const bTime = toDate(b.publishedAt)?.getTime() ?? toDate(b.createdAt)?.getTime() ?? 0
        return bTime - aTime
      })
  }, [announcements, keyword, statusFilter])

  const getTypeLabel = (type: AnnouncementType) => t(`announcements.${type}`, { defaultValue: type })
  const getStatusLabel = (status: AnnouncementStatus) => t(`announcements.${status}`, { defaultValue: status })
  const formatDateTime = (value: unknown) => {
    const date = toDate(value)
    return date ? dayjs(date).format('DD MMM YYYY, HH:mm') : '-'
  }

  const columns = [
    {
      title: t('announcements.title', { defaultValue: 'Title' }),
      dataIndex: 'title',
      key: 'title',
      render: (v: string, r: Announcement) => (
        <Space size={10}>
          {r.image && (
            <img
              src={r.image}
              alt=""
              style={{ width: 48, height: 36, borderRadius: 4, objectFit: 'cover', flexShrink: 0 }}
            />
          )}
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
      render: (v: AnnouncementType) => <Tag color={TYPE_COLORS[v]}>{getTypeLabel(v)}</Tag>,
    },
    {
      title: t('announcements.status', { defaultValue: 'Status' }),
      dataIndex: 'status',
      key: 'status',
      width: 100,
      render: (v: AnnouncementStatus) => <Tag color={STATUS_COLORS[v]}>{getStatusLabel(v)}</Tag>,
    },
    {
      title: t('announcements.publishedAt', { defaultValue: 'Published At' }),
      dataIndex: 'publishedAt',
      key: 'publishedAt',
      width: 160,
      render: (v: Date | null) => formatDateTime(v),
    },
    {
      title: t('announcements.expiresAt', { defaultValue: 'Expires At' }),
      dataIndex: 'expiresAt',
      key: 'expiresAt',
      width: 160,
      render: (v: Date | null) => formatDateTime(v),
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
    <div style={{ display: 'flex', flexDirection: 'column', gap: 12, paddingTop: 8 }}>
      <button
        type="button"
        onClick={openCreate}
        style={{
          width: '100%',
          minHeight: 56,
          padding: '0 16px',
          display: 'flex',
          alignItems: 'center',
          gap: 12,
          border: '1px solid rgba(244, 175, 37, 0.5)',
          borderRadius: 8,
          background: 'linear-gradient(90deg, rgba(253, 224, 141, 0.12), rgba(196, 141, 58, 0.06))',
          color: '#FDE08D',
          fontSize: 15,
          fontWeight: 700,
          cursor: 'pointer',
          textAlign: 'left',
        }}
      >
        <PlusOutlined style={{ fontSize: 18, color: '#E7B54A' }} />
        <span>{t('announcements.create', { defaultValue: 'New Announcement' })}</span>
      </button>

      <div style={{
        display: 'grid',
        gridTemplateColumns: isMobile ? '1fr' : 'minmax(260px, 1fr) 180px',
        gap: 8,
        paddingBottom: 12,
        borderBottom: '1px solid rgba(244,175,37,0.2)',
      }}>
        <Input
          allowClear
          prefix={<SearchOutlined style={{ color: 'rgba(255,255,255,0.5)' }} />}
          value={keyword}
          onChange={event => setKeyword(event.target.value)}
          placeholder={t('announcements.searchPlaceholder', { defaultValue: 'Search announcements' })}
          size="large"
        />
        <Select
          value={statusFilter}
          onChange={setStatusFilter}
          size="large"
          options={[
            { value: 'all', label: t('announcements.all', { defaultValue: 'All' }) },
            { value: 'draft', label: getStatusLabel('draft') },
            { value: 'published', label: getStatusLabel('published') },
            { value: 'archived', label: getStatusLabel('archived') },
          ]}
        />
      </div>

      {!isMobile ? (
        <div className="points-config-form">
          <Table
            dataSource={filteredAnnouncements}
            columns={columns}
            rowKey="id"
            loading={loading}
            pagination={{ pageSize: 20, showSizeChanger: false }}
            style={{ background: 'transparent' }}
          />
        </div>
      ) : filteredAnnouncements.length > 0 ? (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
          {filteredAnnouncements.map(record => {
            const accent = TYPE_ACCENTS[record.type]
            return (
              <article
                key={record.id}
                style={{
                  border: `1px solid ${accent}66`,
                  borderRadius: 8,
                  background: '#1a1a1a',
                  overflow: 'hidden',
                  boxShadow: '0 4px 18px rgba(0,0,0,0.28)',
                }}
              >
                {record.image && (
                  <img
                    src={record.image}
                    alt=""
                    style={{ width: '100%', height: 128, objectFit: 'cover', display: 'block' }}
                  />
                )}
                <div style={{ padding: 14, display: 'flex', flexDirection: 'column', gap: 10 }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: 12 }}>
                    <div style={{ minWidth: 0 }}>
                      <div style={{ display: 'flex', alignItems: 'center', gap: 7, marginBottom: 6, color: accent, fontSize: 12, fontWeight: 700 }}>
                        {record.pinned ? <PushpinOutlined /> : <NotificationOutlined />}
                        <span>{getTypeLabel(record.type)}</span>
                      </div>
                      <h3 style={{ margin: 0, color: '#fff', fontSize: 16, lineHeight: 1.35 }}>{record.title}</h3>
                    </div>
                    <Tag color={STATUS_COLORS[record.status]} style={{ margin: 0, flexShrink: 0 }}>
                      {getStatusLabel(record.status)}
                    </Tag>
                  </div>

                  <p style={{
                    margin: 0,
                    color: 'rgba(255,255,255,0.68)',
                    fontSize: 13,
                    lineHeight: 1.5,
                    display: '-webkit-box',
                    WebkitLineClamp: 2,
                    WebkitBoxOrient: 'vertical',
                    overflow: 'hidden',
                  }}>
                    {record.content}
                  </p>

                  <div style={{ display: 'grid', gap: 5, color: 'rgba(255,255,255,0.5)', fontSize: 12 }}>
                    <span style={{ display: 'flex', alignItems: 'center', gap: 7 }}>
                      <CalendarOutlined />
                      {t('announcements.publishedAt', { defaultValue: 'Publish Time' })}: {formatDateTime(record.publishedAt)}
                    </span>
                    <span style={{ display: 'flex', alignItems: 'center', gap: 7 }}>
                      <ClockCircleOutlined />
                      {t('announcements.expiresAt', { defaultValue: 'Expiry Time' })}: {formatDateTime(record.expiresAt)}
                    </span>
                  </div>
                </div>

                <div style={{
                  display: 'grid',
                  gridTemplateColumns: '44px 1fr 44px',
                  gap: 8,
                  padding: '10px 14px',
                  borderTop: '1px solid rgba(255,255,255,0.08)',
                  background: 'rgba(255,255,255,0.025)',
                }}>
                  <Tooltip title={record.pinned ? t('announcements.unpin') : t('announcements.pin')}>
                    <Button
                      aria-label={record.pinned ? t('announcements.unpin') : t('announcements.pin')}
                      icon={<PushpinOutlined />}
                      type={record.pinned ? 'primary' : 'default'}
                      onClick={() => handleTogglePin(record)}
                    />
                  </Tooltip>
                  <Button icon={<EditOutlined />} onClick={() => openEdit(record)}>
                    {t('common.edit')}
                  </Button>
                  <Popconfirm
                    title={t('common.confirmDelete', { defaultValue: 'Confirm delete?' })}
                    onConfirm={() => handleDelete(record.id)}
                    okButtonProps={{ danger: true }}
                  >
                    <Button aria-label={t('common.delete')} icon={<DeleteOutlined />} danger />
                  </Popconfirm>
                </div>
              </article>
            )
          })}
        </div>
      ) : (
        <Empty description={t('announcements.noAnnouncements', { defaultValue: 'No announcements' })} />
      )}

      <Modal
        title={editing ? t('announcements.edit', { defaultValue: 'Edit Announcement' }) : t('announcements.create', { defaultValue: 'New Announcement' })}
        open={modalOpen}
        onCancel={() => setModalOpen(false)}
        onOk={handleSave}
        okText={t('common.save')}
        cancelText={t('common.cancel')}
        confirmLoading={saving}
        width={isMobile ? 'calc(100vw - 24px)' : 560}
        centered
      >
        <Form form={form} layout="vertical" style={{ marginTop: 16 }}>
          <Form.Item name="image" label={t('announcements.image', { defaultValue: 'Announcement Image' })}>
            <ImageUpload
              folder="announcements"
              maxSize={5 * 1024 * 1024}
              width={isMobile ? 280 : 320}
              height={isMobile ? 158 : 180}
              showPreview
              enableCrop
              cropAspectRatio={16 / 9}
              cropMinWidth={320}
              cropMinHeight={180}
              cropMaxWidth={1200}
              cropMaxHeight={675}
            />
          </Form.Item>
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
