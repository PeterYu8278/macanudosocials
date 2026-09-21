import React, { useState, useEffect, useRef } from 'react'
import { Space, Select, Button, App, Modal, Form, Input } from 'antd'
import { CheckCircleOutlined, DownloadOutlined, PlusOutlined } from '@ant-design/icons'
import type { Event, User, Cigar } from '../../types'
import ParticipantsList from './ParticipantsList'
import ParticipantsSummary from './ParticipantsSummary'
import { registerForEvent, createOrdersFromEventAllocations, updateDocument, COLLECTIONS, getEvents, createDocument, getUsers } from '../../services/firebase/firestore'
import { useTranslation } from 'react-i18next'
import { normalizePhoneNumber } from '../../utils/phoneNormalization'
import { generateMemberId } from '../../utils/memberId'

const { Option } = Select

interface EventParticipantsManagerProps {
  event: Event
  participantsUsers: User[]
  cigars: Cigar[]
  onEventUpdate: (event: Event) => void
  getCigarPriceById: (id: string) => number
  getCigarCostById?: (id: string) => number
}

const EventParticipantsManager: React.FC<EventParticipantsManagerProps> = ({
  event,
  participantsUsers,
  cigars,
  onEventUpdate,
  getCigarPriceById,
  getCigarCostById
}) => {
  const { t } = useTranslation()
  const { message } = App.useApp()
  const [manualAddValue, setManualAddValue] = useState<string>('')
  const [manualAddLoading, setManualAddLoading] = useState(false)
  const [participantsLoading, setParticipantsLoading] = useState(false)
  const [allocSaving, setAllocSaving] = useState<string | null>(null)
  const [showCreateUserModal, setShowCreateUserModal] = useState(false)
  const [createUserLoading, setCreateUserLoading] = useState(false)
  const [createUserForm] = Form.useForm()
  const [isMobile, setIsMobile] = useState(window.innerWidth <= 768)
  const summaryRef = useRef<HTMLDivElement>(null)
  const [summaryHeight, setSummaryHeight] = useState<number | null>(null)

  useEffect(() => {
    const handleResize = () => setIsMobile(window.innerWidth <= 768)
    window.addEventListener('resize', handleResize)
    return () => window.removeEventListener('resize', handleResize)
  }, [])

  // 动态同步 ParticipantsSummary 的高度到参与者列表容器（仅电脑端）
  useEffect(() => {
    if (isMobile) {
      setSummaryHeight(null)
      return
    }

    const updateHeight = () => {
      if (summaryRef.current) {
        const height = summaryRef.current.offsetHeight
        setSummaryHeight(height)
      }
    }

    // 初始设置
    updateHeight()

    // 使用 ResizeObserver 监听高度变化
    const resizeObserver = new ResizeObserver(updateHeight)
    if (summaryRef.current) {
      resizeObserver.observe(summaryRef.current)
    }

    return () => {
      resizeObserver.disconnect()
    }
  }, [isMobile, event, participantsUsers, cigars])

  const handleAddParticipant = async () => {
    if (!event) return
    const raw = manualAddValue.trim()
    if (!raw) return
    setManualAddLoading(true)
    try {
      let userId = raw
      const byId = participantsUsers.find(u => u.id === raw)
      if (!byId) {
        if (raw.includes('@')) {
          const match = participantsUsers.find(u => u.email?.toLowerCase() === raw.toLowerCase())
          if (!match) { 
            // 用户不存在，打开创建用户弹窗
            setManualAddLoading(false)
            createUserForm.setFieldsValue({ email: raw })
            setShowCreateUserModal(true)
            return 
          }
          userId = match.id
        } else if (/^\+?\d[\d\s-]{5,}$/.test(raw)) {
          const match = participantsUsers.find(u => ((u as any)?.profile?.phone || '').replace(/\s|-/g,'') === raw.replace(/\s|-/g,''))
          if (!match) { 
            // 用户不存在，打开创建用户弹窗
            setManualAddLoading(false)
            createUserForm.setFieldsValue({ phone: raw })
            setShowCreateUserModal(true)
            return 
          }
          userId = match.id
        } else {
          const matches = participantsUsers.filter(u => (u.displayName || '').toLowerCase().includes(raw.toLowerCase()))
          if (matches.length === 1) userId = matches[0].id
          else { 
            // 名字搜索不到或有多个匹配，询问是否创建新用户
            setManualAddLoading(false)
            Modal.confirm({
              title: t('common.userNotFound'),
              content: t('common.createNewUserWithName', { name: raw }),
              okText: t('common.create'),
              cancelText: t('common.cancel'),
              onOk: () => {
                createUserForm.setFieldsValue({ displayName: raw })
                setShowCreateUserModal(true)
              }
            })
            return 
          }
        }
      }
      const res = await registerForEvent((event as any).id, userId)
      if ((res as any)?.success) {
        message.success(t('common.participantAdded'))
        const list = await getEvents()
        const next = list.find((e: any) => e.id === (event as any).id) as any
        onEventUpdate(next)
        setManualAddValue('')
      } else {
        message.error(t('common.addFailed'))
      }
    } finally {
      setManualAddLoading(false)
    }
  }

  const handleCreateOrders = async () => {
    if (!event) return
    const orderResult = await createOrdersFromEventAllocations((event as any).id);
    if (orderResult.success) {
      if (orderResult.createdOrders > 0) {
        message.success(`${t('common.ordersCreated')} ${orderResult.createdOrders} ${t('common.forEvent')}`);
      } else {
        message.info(t('common.noParticipantsAssignedCigars'));
      }
    } else {
      message.error(t('common.createOrdersFailed') + (orderResult.error?.message || t('common.unknownError')));
    }
  }

  const handleExportAllocations = () => {
    if (!event) return
    const header = ['userId','displayName','phone','email','cigarName','quantity','amount']
    const rows = (((event as any)?.participants?.registered || []) as string[]).map((id) => {
      const u = participantsUsers.find(x => x.id === id)
      const alloc = (event as any)?.allocations?.[id]
      const cigar = cigars.find(c => c.id === alloc?.cigarId)
      return [
        id, 
        u?.displayName || '', 
        (u as any)?.profile?.phone || '',
        u?.email || '',
        cigar?.name || '',
        alloc?.quantity || 0,
        alloc?.amount || 0
      ]
    })
    const csv = [header.join(','), ...rows.map(r => r.map(x => `"${String(x ?? '').replace(/"/g,'""')}"`).join(','))].join('\n')
    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = `participants-${(event as any)?.title || 'event'}.csv`
    a.click()
    URL.revokeObjectURL(url)
  }

  const handleCreateUser = async () => {
    try {
      const values = await createUserForm.validateFields()
      setCreateUserLoading(true)

      // 标准化手机号
      let normalizedPhone: string | undefined = undefined
      if (values.phone) {
        const normalized = normalizePhoneNumber(values.phone)
        if (!normalized) {
          message.error(t('auth.phoneInvalid'))
          return
        }
        normalizedPhone = normalized
      }

      // 创建用户
      const userData: Partial<User> = {
        displayName: values.displayName,
        email: values.email,
        role: 'member',
        status: 'inactive',  // ✅ 默认状态为非活跃
        profile: { 
          phone: normalizedPhone,
        },
        preferences: {
          locale: 'zh',
          notifications: true,
        },
        membership: { 
          level: 'bronze', 
          joinDate: new Date(), 
          lastActive: new Date() 
        },
        createdAt: new Date(),
        updatedAt: new Date(),
      }

      const res = await createDocument(COLLECTIONS.USERS, userData as any)
      
      if ((res as any)?.success) {
        const newUserId = (res as any).id
        
        // 生成会员ID并更新用户文档
        try {
          const memberId = await generateMemberId(newUserId)
          await updateDocument<User>(COLLECTIONS.USERS, newUserId, { memberId } as any)
        } catch (error) {
          console.error('生成会员ID失败:', error)
          // 不阻止用户创建流程，只记录错误
        }
        
        message.success(t('usersAdmin.created'))
        
        // 刷新用户列表
        const updatedUsers = await getUsers()
        
        // 自动将新创建的用户添加到活动参与者
        const registerRes = await registerForEvent((event as any).id, newUserId)
        if ((registerRes as any)?.success) {
          message.success(t('common.participantAdded'))
          const list = await getEvents()
          const next = list.find((e: any) => e.id === (event as any).id) as any
          onEventUpdate(next)
          setManualAddValue('')
        }
        
        setShowCreateUserModal(false)
        createUserForm.resetFields()
      } else {
        message.error(t('usersAdmin.createFailed'))
      }
    } catch (error: any) {
      console.error('Error creating user:', error)
      if (error.errorFields) {
        // 表单验证错误，不显示消息
        return
      }
      message.error(t('usersAdmin.createFailed'))
    } finally {
      setCreateUserLoading(false)
    }
  }

  return (
    <div>
      <div style={{ marginBottom: 12, color: '#666' }}>
        {t('common.registered')}: {((event as any)?.participants?.registered || []).length} / {(event as any)?.participants?.maxParticipants || 0}
      </div>
      
      <div style={{ marginBottom: 16, width: '100%', boxSizing: 'border-box' }}>
        <div style={{ 
          display: 'flex', 
          alignItems: 'center', 
          gap: 8, 
          width: '100%',
          boxSizing: 'border-box'
        }}>
          <Select
            showSearch
            allowClear
            placeholder={t('common.pleaseInputNameEmailPhoneOrUserId')}
            style={{ flex: 1, minWidth: 0 }}
            value={manualAddValue || undefined}
            onSearch={(val) => setManualAddValue(val)}
            onChange={(val) => setManualAddValue(val || '')}
            onSelect={(val) => setManualAddValue(String(val))}
            filterOption={(input, option) => {
              const keyword = (input || '').toLowerCase()
              const searchable = String((option as any)?.searchText || '').toLowerCase()
              return searchable.includes(keyword)
            }}
            notFoundContent={manualAddValue && manualAddValue.trim() !== '' ? t('common.noMatch') : t('common.noData')}
            options={(manualAddValue && manualAddValue.trim() !== '' ? participantsUsers : []).map(u => {
              const isRegistered = ((event as any)?.participants?.registered || []).includes(u.id)
              return {
                value: u.id,
                searchText: `${u.displayName || ''} ${(u as any)?.profile?.phone || ''} ${u.email || ''} ${u.id}`.trim(),
                label: (
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                    <span style={{ flex: 1, textAlign: 'left' }}>{u.displayName || t('common.unnamed')}</span>
                    <span style={{ flex: 2, textAlign: 'left', color: '#999', fontSize: '12px' }}>
                      {(u as any)?.profile?.phone || t('common.noPhone')}
                    </span>
                    <span style={{ flex: 6, textAlign: 'left', color: '#999', fontSize: '12px' }}>
                      {u.email || t('common.noEmail')}
                    </span>
                    {isRegistered && (
                      <CheckCircleOutlined style={{ color: '#52c41a', marginLeft: 8 }} />
                    )}
                  </div>
                )
              }
            })}
          />
          <button 
            style={{ 
              display: 'flex', 
              alignItems: 'center', 
              gap: 8, 
              padding: '8px 16px', 
              borderRadius: 8, 
              background: 'linear-gradient(to right,#FDE08D,#C48D3A)', 
              color: '#111', 
              fontWeight: 600, 
              cursor: 'pointer', 
              transition: 'all 0.2s ease', 
              opacity: manualAddLoading ? 0.6 : 1,
              border: 'none',
              whiteSpace: 'nowrap',
              flexShrink: 0
            }}
            disabled={manualAddLoading}
            onClick={handleAddParticipant}
          >
            {manualAddLoading ? '...' : t('common.add')}
          </button>
        </div>
      </div>

      <div style={{ marginBottom: 16 }}>
        <Space>
          <button 
            style={{ 
              display: 'flex', 
              alignItems: 'center', 
              gap: 8, 
              padding: '8px 16px', 
              borderRadius: 8, 
              background: 'linear-gradient(to right,#FDE08D,#C48D3A)', 
              color: '#111', 
              fontWeight: 600, 
              cursor: 'pointer', 
              transition: 'all 0.2s ease' 
            }}
            onClick={handleCreateOrders}
          >
            <CheckCircleOutlined />
            {t('common.createOrders')}
          </button>
          <button 
            style={{ 
              display: 'flex', 
              alignItems: 'center', 
              gap: 8, 
              padding: '8px 16px', 
              borderRadius: 8, 
              background: 'rgba(255,255,255,0.1)', 
              color: '#ccc', 
              cursor: 'pointer', 
              transition: 'all 0.2s ease' 
            }}
            onClick={handleExportAllocations}
          >
            <DownloadOutlined />
            {t('common.exportAllocations')}
          </button>
        </Space>
      </div>

      {/* 响应式布局：手机端上下排列，桌面端左右并排 */}
      <div style={{ 
        display: 'flex', 
        flexDirection: isMobile ? 'column' : 'row',
        gap: '16px', 
        alignItems: 'flex-start' 
      }}>
        {/* 参与者列表 */}
        <div style={{ flex: 1, width: isMobile ? '100%' : 'auto', alignSelf: 'flex-start' }}>
          <div style={{ 
            height: isMobile ? 'auto' : (summaryHeight ? `${summaryHeight}px` : '400px'),
            maxHeight: isMobile ? 400 : (summaryHeight ? `${summaryHeight}px` : '400px'),
            width: isMobile ? '100%' : '520px',
            overflow: 'hidden', 
            border: '1px solid rgba(244, 175, 37, 0.3)', 
            borderRadius: 8,
            background: 'rgba(255, 255, 255, 0.05)',
            backdropFilter: 'blur(10px)',
            display: 'flex',
            flexDirection: 'column'
          }}>
            <ParticipantsList
              event={event}
              participantsUsers={participantsUsers}
              cigars={cigars}
              participantsLoading={participantsLoading}
              allocSaving={allocSaving}
              onEventUpdate={onEventUpdate}
              onAllocSavingChange={setAllocSaving}
              getCigarPriceById={getCigarPriceById}
            />
          </div>
        </div>
        
        {/* 产品类别统计 */}
        <div 
          ref={summaryRef}
          style={{ flex: 1, width: isMobile ? '100%' : 'auto', alignSelf: 'flex-start' }}
        >
          <ParticipantsSummary
            event={event}
            getCigarPriceById={getCigarPriceById}
            getCigarCostById={getCigarCostById}
            cigars={cigars}
            onEventUpdate={onEventUpdate}
          />
        </div>
      </div>

      {/* 创建用户弹窗 */}
      <Modal
        title={
          <Space>
            <PlusOutlined />
            {t('usersAdmin.addUser')}
          </Space>
        }
        open={showCreateUserModal}
        onCancel={() => {
          setShowCreateUserModal(false)
          createUserForm.resetFields()
        }}
        onOk={handleCreateUser}
        confirmLoading={createUserLoading}
        okText={t('common.createAndAdd')}
        cancelText={t('common.cancel')}
        width={480}
      >
        <Form
          form={createUserForm}
          layout="vertical"
          style={{ marginTop: '24px' }}
        >
          <Form.Item
            name="displayName"
            label={t('common.name')}
            rules={[{ required: true, message: t('profile.nameRequired') }]}
          >
            <Input placeholder={t('auth.name')} />
          </Form.Item>

          <Form.Item
            name="email"
            label={t('auth.email')}
            rules={[
              { required: true, message: t('auth.emailRequired') },
              { type: 'email', message: t('auth.emailInvalid') }
            ]}
          >
            <Input placeholder={t('auth.email')} />
          </Form.Item>

          <Form.Item
            name="phone"
            label={t('auth.phone')}
            rules={[{ required: true, message: t('profile.phoneRequired') }]}
          >
            <Input placeholder={t('auth.phone')} />
          </Form.Item>
        </Form>
      </Modal>
    </div>
  )
}

export default EventParticipantsManager
