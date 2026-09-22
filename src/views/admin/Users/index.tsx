// 用户管理页面
import React, { useEffect, useMemo, useState } from 'react'
import { Table, Button, Tag, Space, Typography, Input, Select, Modal, Form, Switch, Dropdown, Checkbox, Row, Col, Spin, App, InputNumber } from 'antd'
import { EditOutlined, DeleteOutlined, PlusOutlined, SearchOutlined, EyeOutlined, ArrowLeftOutlined, CalendarOutlined, ShoppingOutlined, TrophyOutlined, KeyOutlined, MailOutlined, WhatsAppOutlined, SendOutlined } from '@ant-design/icons'
import { MemberProfileCard } from '../../../components/common/MemberProfileCard'
import { ProfileView } from '../../../components/common/ProfileView'
import { ReferralTreeView } from '../../../components/admin/ReferralTreeView'

const { Title, Text } = Typography
const { Search } = Input
const { Option } = Select

import { getUsers, createDocument, updateDocument, deleteDocument, COLLECTIONS, getEventsByUser, getOrdersByUser } from '../../../services/firebase/firestore'
import { useFirestoreQuery } from '../../../hooks/useFirestoreQuery'
import { useDetailDrawer } from '../../../hooks/useDetailDrawer'
import type { User, Event, Order } from '../../../types'
import dayjs from 'dayjs'
import { sendPasswordResetEmailFor, resetPasswordByPhone, generateResetPasswordMessageByPhone } from '../../../services/firebase/auth'
import { useTranslation } from 'react-i18next'
import { useAuthStore } from '../../../store/modules/auth'
import { getModalThemeStyles, getModalWidth, getResponsiveModalConfig, modalButtonStyles } from '../../../config/modalTheme'
import { normalizePhoneNumber } from '../../../utils/phoneNormalization'
import { collection, query, where, getDocs, limit, doc, setDoc } from 'firebase/firestore'
import { UserSkeletonList } from '../../../components/features/admin/UserSkeleton'
import { db } from '../../../config/firebase'
import { generateMemberId } from '../../../utils/memberId'

// CSS样式对象
const glassmorphismInputStyle = {
  width: '100%',
  padding: '8px 12px',
  marginTop: '4px',
  color: '#FFFFFF',
  background: 'transparent',
  border: 'none',
  borderBottom: '2px solid transparent',
  borderRadius: 0,
  fontSize: '16px',
  transition: 'border-color 0.3s ease',
  position: 'relative' as const,
  backgroundImage: 'linear-gradient(to right,#FDE08D,#C48D3A)',
  backgroundSize: '100% 2px',
  backgroundRepeat: 'no-repeat',
  backgroundPosition: 'bottom'
}

const AdminUsers: React.FC = () => {
  const { t, i18n } = useTranslation()
  const { modal, message } = App.useApp() // 使用 App.useApp() 获取 modal 实例以支持 React 19
  const { user: currentUser } = useAuthStore()
  const canManageDiscount = currentUser?.role === 'developer' || currentUser?.role === 'superAdmin'

  const assignableRoles = (() => {
    const all = [
      { value: 'developer', label: t('auth.developer') },
      { value: 'superAdmin', label: t('auth.superAdmin') },
      { value: 'admin', label: t('auth.admin') },
      { value: 'vip', label: t('auth.vip') },
      { value: 'member', label: t('auth.member') },
      { value: 'guest', label: t('auth.guest') },
    ]
    const ROLE_RANK: Record<string, number> = { developer: 4, superAdmin: 3, admin: 2, vip: 1, member: 1, guest: 0 }
    const myRank = ROLE_RANK[currentUser?.role ?? ''] ?? 0
    return all.filter(r => ROLE_RANK[r.value] < myRank)
  })()

  const { data: users = [], loading: usersLoading, refresh: refreshUsers } = useFirestoreQuery(getUsers)
  const { item: editing, open: editingOpen, openDrawer: openEditing, closeDrawer: closeEditing } = useDetailDrawer<User>()
  const { item: resettingPassword, open: resettingPasswordOpen, openDrawer: openResettingPassword, closeDrawer: closeResettingPassword } = useDetailDrawer<User>()
  const [actionLoading, setLoading] = useState(false)
  const [creating, setCreating] = useState(false)
  const [deleting, setDeleting] = useState<null | User>(null)
  const [resettingPasswordLoading, setResettingPasswordLoading] = useState(false)
  const [form] = Form.useForm()
  const [keyword, setKeyword] = useState('')
  const [roleFilter, setRoleFilter] = useState<string | undefined>()
  const [levelFilter, setLevelFilter] = useState<string | undefined>()
  const [statusFilter, setStatusFilter] = useState<string | undefined>()
  const [statusMap, setStatusMap] = useState<Record<string, 'active' | 'inactive'>>({})
  const [selectedRowKeys, setSelectedRowKeys] = useState<React.Key[]>([])
  const [isMobile, setIsMobile] = useState<boolean>(() => {
    if (typeof window === 'undefined') return false
    return window.innerWidth < 768
  })
  const [visibleCols, setVisibleCols] = useState<Record<string, boolean>>(() => {
    const saved = localStorage.getItem('users.visibleCols')
    if (saved) {
      try {
        const parsed = JSON.parse(saved)
        // 确保 id 字段根据用户角色设置
        parsed.id = currentUser?.role === 'developer'
        // 只有管理员/开发者可见折扣列
        parsed.discount = canManageDiscount
        return parsed
      } catch { }
    }
    return {
      id_combined: true,
      displayName: true,
      email: true,
      role: true,
      discount: canManageDiscount,
      lastActive: true,
      status: true,
      action: true,
    }
  })
  const [activeTab, setActiveTab] = useState<'list' | 'referralTree'>('list')
  const [allUsersForTree, setAllUsersForTree] = useState<User[]>([])

  useEffect(() => {
    if (activeTab === 'referralTree') {
      getUsers().then(setAllUsersForTree)
    }
  }, [activeTab])
  const [showMemberCard, setShowMemberCard] = useState(false) // 控制头像/会员卡切换
  const { data: userOrders = [], loading: loadingOrders } = useFirestoreQuery(
    () => editing?.id ? getOrdersByUser(editing.id) : Promise.resolve([]),
    [editing?.id]
  )
  const { data: userEvents = [], loading: loadingEvents } = useFirestoreQuery(
    () => editing?.id ? getEventsByUser(editing.id) : Promise.resolve([]),
    [editing?.id]
  )
  const loadingUserData = loadingOrders || loadingEvents
  const [activeIndex, setActiveIndex] = useState<string>('') // 当前高亮的字母
  const [showBubble, setShowBubble] = useState(false) // 字母气泡显示
  const [bubbleLetter, setBubbleLetter] = useState('') // 气泡字母

  useEffect(() => {
    const update = () => setIsMobile(window.innerWidth < 768)
    update()
    window.addEventListener('resize', update)
    return () => window.removeEventListener('resize', update)
  }, [])

  const getRoleColor = (role: string) => {
    switch (role) {
      case 'developer': return 'red'
      case 'superAdmin': return 'red'
      case 'admin': return 'volcano'
      case 'member': return 'blue'
      case 'vip': return 'gold'  // VIP 使用自定义渐变样式，此颜色不会被使用
      case 'guest': return 'default'
      default: return 'default'
    }
  }

  const getRoleText = (role: string) => {
    switch (role) {
      case 'developer': return t('auth.developer')
      case 'superAdmin': return t('auth.superAdmin')
      case 'admin': return t('auth.admin')
      case 'member': return t('auth.member')
      case 'vip': return t('auth.vip')
      case 'guest': return t('auth.guest')
      default: return t('profile.unknown')
    }
  }

  const getMembershipColor = (level: string) => {
    switch (level) {
      case 'bronze': return 'default'
      case 'silver': return 'default'
      case 'gold': return '#faad14'
      case 'platinum': return '#722ed1'
      default: return 'default'
    }
  }

  const getMembershipText = (level: string) => {
    switch (level) {
      case 'bronze': return t('profile.bronzeMember')
      case 'silver': return t('profile.silverMember')
      case 'gold': return t('profile.goldMember')
      case 'platinum': return t('profile.platinumMember')
      default: return t('profile.regularMember')
    }
  }

  const getStatusColor = (status: string) => {
    switch (status) {
      case 'active': return 'green'
      case 'inactive': return 'default'
      default: return 'default'
    }
  }

  const getStatusText = (status: string) => {
    switch (status) {
      case 'active': return t('usersAdmin.active')
      case 'inactive': return t('usersAdmin.inactive')
      default: return t('profile.unknown')
    }
  }

  const allColumns = [
    {
      title: 'ID',
      key: 'id_combined',
      width: 140,
      render: (_: any, record: User) => (
        <div>
          <div style={{ fontWeight: 600, color: '#FDE08D' }}>
            {record.memberId || '-'}
          </div>
          {currentUser?.role === 'developer' && (
            <div style={{ fontSize: '10px', opacity: 0.5, fontFamily: 'monospace', marginTop: 2 }}>
              {record.id}
            </div>
          )}
        </div>
      ),
    },
    {
      title: t('usersAdmin.name'),
      dataIndex: 'displayName',
      key: 'displayName',
      render: (_: any, record: any) => (
        <div>
          <div style={{ fontWeight: 600, color: '#FFFFFF' }}>{record.displayName || '-'}</div>
          <div style={{ fontSize: 12, color: '#CCCCCC' }}>{(record as any)?.profile?.phone || ''}</div>
        </div>
      ),
    },
    {
      title: t('usersAdmin.email'),
      dataIndex: 'email',
      key: 'email',
      render: (val: string) => <span style={{ color: '#FFFFFF' }}>{val || '-'}</span>
    },
    ...(canManageDiscount ? [{
      title: t('usersAdmin.discount'),
      dataIndex: 'discount',
      key: 'discount',
      width: 80,
      render: (_: any, record: any) => {
        const rate = record.discount?.rate
        return rate !== undefined && rate !== null ? (
          <span style={{ color: '#FDE08D', fontWeight: 600 }}>{rate}%</span>
        ) : '-'
      }
    }] : []),
    {
      title: t('usersAdmin.role'),
      dataIndex: 'role',
      key: 'role',
      render: (role: string) => {
        // ✅ VIP 标签使用金色渐变背景和黑色字体
        if (role === 'vip') {
          return (
            <Tag
              style={{
                background: 'linear-gradient(to right, #FDE08D, #C48D3A)',
                color: '#000000',
                border: 'none',
                fontWeight: 600
              }}
            >
              {getRoleText(role)}
            </Tag>
          )
        }
        // 其他角色使用默认颜色
        return (
          <Tag color={getRoleColor(role)}>
            {getRoleText(role)}
          </Tag>
        )
      },
    },
    // 移除加入时间列以适配移动端
    // 在移动端隐藏“最后活跃”列
    // { title: '最后活跃', dataIndex: 'lastActive', key: 'lastActive', responsive: ['md'] as any },
    {
      title: t('usersAdmin.status'),
      dataIndex: 'status',
      key: 'status',
      render: (_: any, record: any) => {
        const status = statusMap[record.id] || record.status || 'active'
        return (
          <Space>
            <Tag color={getStatusColor(status)}>
              {getStatusText(status)}
            </Tag>
            <Switch
              checked={status === 'active'}
              onChange={async (checked) => {
                const next = checked ? 'active' : 'inactive'
                setStatusMap((m) => ({ ...m, [record.id]: next }))

                // ✅ 当状态变为活跃时，角色自动变为 VIP；变为非活跃时，角色改回 member（不影响 admin）
                const updateData: Partial<User> = { status: next }
                if (checked && record.role !== 'superAdmin') {
                  updateData.role = 'vip'
                } else if (!checked && record.role === 'vip') {
                  updateData.role = 'member'
                }

                const res = await updateDocument<User>(COLLECTIONS.USERS, record.id, updateData as any)
                if (res.success) {
                  message.success(t('usersAdmin.statusUpdated'))
                  // 刷新用户列表以显示角色变化
                  await refreshUsers()
                }
              }}
              size="small"
            />
          </Space>
        )
      },
    },
    {
      title: t('usersAdmin.aiUsage'),
      key: 'aiUsageStats',
      width: 120,
      render: (_: any, record: any) => {
        const scanCount = record.aiUsageStats?.cigarScanCount || 0;
        const lastScanAt = record.aiUsageStats?.lastCigarScanAt;

        if (scanCount === 0) {
          return <Text style={{ color: '#FFFFFF' }}>{t('usersAdmin.unused')}</Text>;
        }

        // 处理 Firestore Timestamp 或 Date 对象
        let formattedDate = '';
        if (lastScanAt) {
          try {
            // 如果是 Firestore Timestamp，使用 toDate() 方法
            const date = lastScanAt?.toDate ? lastScanAt.toDate() : new Date(lastScanAt);
            if (date && !isNaN(date.getTime())) {
              formattedDate = dayjs(date).format(i18n.language === 'en-US' ? 'D MMM, YYYY' : 'YYYY-MM-DD');
            }
          } catch (error) {
            console.error('[Users] 日期格式化失败:', error);
          }
        }

        return (
          <Space direction="vertical" size="small">
            <Tag color="blue">{scanCount} {t('usersAdmin.times')}</Tag>
            {formattedDate && (
              <Text style={{ fontSize: '11px', color: '#FFFFFF' }}>
                {t('usersAdmin.lastScan')}: {formattedDate}
              </Text>
            )}
          </Space>
        );
      },
      sorter: (a: any, b: any) => {
        const aCount = a.aiUsageStats?.cigarScanCount || 0;
        const bCount = b.aiUsageStats?.cigarScanCount || 0;
        return aCount - bCount;
      },
    },
    {
      title: t('usersAdmin.actions'),
      key: 'action',
      render: (_: any, record: any) => (
        <Space size="small" style={{ justifyContent: 'center', width: '100%' }}>
          <Button type="link" icon={<EyeOutlined />} size="small" onClick={() => {
            openEditing(record)
            form.setFieldsValue({
              displayName: record.displayName,
              email: record.email,
              role: record.role,
              discountRate: record.discount?.rate,
              discountNote: record.discount?.note,
              level: record.membership?.level,
              phone: (record as any)?.profile?.phone,
              gender: record.profile?.gender,
              race: record.profile?.race,
            })
          }}>
          </Button>
          <Button
            type="link"
            icon={<KeyOutlined />}
            size="small"
            onClick={() => openResettingPassword(record)}
            title={t('usersAdmin.resetPassword')}
          >
          </Button>
        </Space>
      ),
    },
  ]
  const columns = allColumns.filter(c => visibleCols[c.key as string] !== false)

  const filteredUsers = useMemo(() => {
    const kw = keyword.trim().toLowerCase()
    const filtered = users.filter(u => {
      // 如果不是开发者，过滤掉开发者角色的用户
      if (currentUser?.role !== 'developer' && u.role === 'developer') {
        return false
      }
      // 关键词搜索（客户端）
      const passKw = !kw ||
        u.displayName?.toLowerCase().includes(kw) ||
        (u.email || '').toLowerCase().includes(kw) ||
        ((u as any)?.profile?.phone || '').includes(keyword.trim()) ||
        (u.memberId || '').toLowerCase().includes(kw)

      // 状态筛选（客户端，因为statusMap是动态的）
      const status = statusMap[u.id] || (u as any).status || 'active'
      const passStatus = !statusFilter || status === statusFilter

      // role筛选（客户端）
      const passRole = !roleFilter || u.role === roleFilter

      // level筛选（客户端）
      const passLevel = !levelFilter || u.membership?.level === levelFilter

      return passKw && passStatus && passRole && passLevel
    })
    // 按字母顺序排序（按displayName）
    return filtered.sort((a, b) => {
      const nameA = (a.displayName || '').toLowerCase()
      const nameB = (b.displayName || '').toLowerCase()
      return nameA.localeCompare(nameB)
    })
  }, [users, keyword, statusFilter, roleFilter, levelFilter, statusMap, currentUser?.role])

  const groupedByInitial = useMemo(() => {
    const groups: Record<string, User[]> = {}
    for (const u of filteredUsers) {
      const name = u.displayName || ''
      const ch = name.trim().charAt(0).toUpperCase()
      const key = ch && /[A-Z]/.test(ch) ? ch : '#'
      if (!groups[key]) groups[key] = []
      groups[key].push(u)
    }
    const sortedKeys = Object.keys(groups).sort()
    return sortedKeys.map(k => ({ key: k, items: groups[k].sort((a, b) => (a.displayName || '').localeCompare(b.displayName || '')) }))
  }, [filteredUsers])

  const alphaIndex = useMemo(() => {
    const letters = Array.from({ length: 26 }, (_, i) => String.fromCharCode(65 + i))
    return [...letters, '#']
  }, [])

  const [alphaY, setAlphaY] = useState<number>(typeof window !== 'undefined' ? window.innerHeight / 2 : 300)

  // 监听滚动，更新当前高亮字母
  useEffect(() => {
    if (!isMobile) return

    const handleScroll = () => {
      for (const group of groupedByInitial) {
        const el = document.getElementById(`group-${group.key}`)
        if (el) {
          const rect = el.getBoundingClientRect()
          // 如果分组在可视区域顶部附近
          if (rect.top >= 0 && rect.top < 200) {
            setActiveIndex(group.key)
            break
          }
        }
      }
    }

    window.addEventListener('scroll', handleScroll)
    handleScroll() // 初始化

    return () => window.removeEventListener('scroll', handleScroll)
  }, [groupedByInitial, isMobile])

  const maskPhone = (phone?: string) => {
    if (!phone) return ''
    return phone.replace(/(\d{3})\d+(\d{2})/, '$1****$2')
  }

  // 持久化列显示设置
  useEffect(() => {
    try {
      localStorage.setItem('users.visibleCols', JSON.stringify(visibleCols))
    } catch { }
  }, [visibleCols])

  return (
    <div style={{
      height: isMobile ? '90vh' : 'auto',
      display: 'flex',
      flexDirection: 'column',
      overflow: isMobile ? 'hidden' : 'visible',
      paddingRight: isMobile && activeTab === 'list' ? '32px' : '0',
      paddingBottom: isMobile ? '112px' : '0'
    }}>
      {/* 标签页 */}
      <div>
        <div style={{
          display: 'flex',
          borderBottom: '1px solid rgba(244,175,37,0.2)',
          marginBottom: 10
        }}>
          {(['list', 'referralTree'] as const).map((tabKey) => {
            const isActive = activeTab === tabKey
            const baseStyle: React.CSSProperties = {
              flex: 1,
              padding: '10px 0',
              fontWeight: 800,
              fontSize: 12,
              cursor: 'pointer',
              backgroundColor: 'transparent',
              border: 'none',
              position: 'relative' as const,
            }
            const activeStyle: React.CSSProperties = {
              color: 'transparent',
              backgroundImage: 'linear-gradient(to right,#FDE08D,#C48D3A)',
              WebkitBackgroundClip: 'text',
            }
            const inactiveStyle: React.CSSProperties = {
              color: '#A0A0A0',
            }

            const getTabLabel = (key: string) => {
              switch (key) {
                case 'list': return t('usersAdmin.userList')
                case 'referralTree': return t('usersAdmin.referralTree')
                default: return ''
              }
            }

            return (
              <button
                key={tabKey}
                type="button"
                aria-current={isActive ? 'page' : undefined}
                style={{
                  ...baseStyle,
                  ...(isActive ? activeStyle : inactiveStyle),
                }}
                onClick={() => setActiveTab(tabKey)}
              >
                {getTabLabel(tabKey)}
                {isActive && (
                  <div style={{
                    position: 'absolute',
                    bottom: 0,
                    left: 0,
                    right: 0,
                    height: '2px',
                    background: 'linear-gradient(to right,#FDE08D,#C48D3A)',
                  }} />
                )}
              </button>
            )
          })}
        </div>
      </div>

      {
        activeTab === 'referralTree' && (
          <ReferralTreeView users={allUsersForTree} />
        )
      }

      {
        activeTab === 'list' && (
          <>
            {/* 桌面端：标题和批量操作 */}
            {!isMobile && (
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                <Space>
                  {selectedRowKeys.length > 0 && (
                    <>
                      <Button
                        onClick={async () => {
                          setLoading(true)
                          try {
                            await Promise.all(selectedRowKeys.map(id => {
                              const user = users.find(u => u.id === String(id))
                              const updateData: Partial<User> = { status: 'inactive' }
                              if (user?.role === 'vip') updateData.role = 'member'
                              return updateDocument<User>(COLLECTIONS.USERS, String(id), updateData as any)
                            }))
                            message.success(t('usersAdmin.batchDisabled'))
                            await refreshUsers()
                            setSelectedRowKeys([])
                          } finally {
                            setLoading(false)
                          }
                        }}
                        style={{ background: 'rgba(255, 255, 255, 0.1)', border: '1px solid rgba(255, 255, 255, 0.2)', color: '#FFFFFF' }}
                      >
                        {t('usersAdmin.batchDisable')}
                      </Button>
                      <Button
                        onClick={async () => {
                          modal.confirm({
                            title: t('usersAdmin.batchDeleteConfirm'),
                            content: t('usersAdmin.batchDeleteContent', { count: selectedRowKeys.length }),
                            okButtonProps: { danger: true },
                            onOk: async () => {
                              setLoading(true)
                              try {
                                const results = await Promise.all(selectedRowKeys.map(id => deleteDocument(COLLECTIONS.USERS, String(id))))
                                if (results.every(r => r.success)) message.success(t('usersAdmin.batchDeleted'))
                                else message.error(t('usersAdmin.batchDeleteFailed'))
                                await refreshUsers()
                                setSelectedRowKeys([])
                              } finally {
                                setLoading(false)
                              }
                            }
                          })
                        }}
                        style={{ background: 'rgba(255, 77, 79, 0.8)', border: 'none', color: '#FFFFFF', fontWeight: 700 }}
                      >
                        {t('usersAdmin.batchDelete')}
                      </Button>
                    </>
                  )}
                </Space>
              </div>
            )}

            {/* 桌面端：筛选区 */}
            {!isMobile && (
              <div style={{
                marginBottom: 10,
                padding: '16px',
                background: 'rgba(255, 255, 255, 0.05)',
                borderRadius: 12,
                border: '1px solid rgba(244, 175, 37, 0.6)',
                backdropFilter: 'blur(10px)'
              }}>
                <Space size="middle" wrap>
                  <Search
                    placeholder={t('usersAdmin.searchByNameOrEmail')}
                    allowClear
                    style={{ width: 260 }}
                    prefix={<SearchOutlined />}
                    value={keyword}
                    onChange={(e) => setKeyword(e.target.value)}
                    className="points-config-form"
                  />
                  <Select
                    allowClear
                    placeholder={t('usersAdmin.selectRole')}
                    value={roleFilter}
                    style={{ width: 140 }}
                    onChange={(v) => {
                      setRoleFilter(v)
                    }}
                    className="points-config-form"
                  >
                    <Option value="superAdmin">{t('auth.superAdmin')}</Option>
                    <Option value="admin">{t('auth.admin')}</Option>
                    <Option value="vip">{t('auth.vip')}</Option>
                    <Option value="member">{t('auth.member')}</Option>
                    <Option value="guest">{t('auth.guest')}</Option>
                    {currentUser?.role === 'developer' && <Option value="developer">{t('auth.developer')}</Option>}
                  </Select>
                  <Select
                    allowClear
                    placeholder={t('usersAdmin.selectLevel')}
                    value={levelFilter}
                    style={{ width: 140 }}
                    onChange={(v) => {
                      setLevelFilter(v)
                    }}
                    className="points-config-form"
                  >
                    <Option value="bronze">{t('usersAdmin.bronzeMember')}</Option>
                    <Option value="silver">{t('usersAdmin.silverMember')}</Option>
                    <Option value="gold">{t('usersAdmin.goldMember')}</Option>
                    <Option value="platinum">{t('usersAdmin.platinumMember')}</Option>
                  </Select>
                  <Select
                    allowClear
                    placeholder={t('usersAdmin.selectStatus')}
                    value={statusFilter}
                    style={{ width: 140 }}
                    onChange={(v) => {
                      setStatusFilter(v)
                    }}
                    className="points-config-form"
                  >
                    <Option value="active">{t('usersAdmin.active')}</Option>
                    <Option value="inactive">{t('usersAdmin.inactive')}</Option>
                  </Select>
                  <Button
                    onClick={() => {
                      setKeyword('')
                      setRoleFilter(undefined)
                      setLevelFilter(undefined)
                      setStatusFilter(undefined)
                      setSelectedRowKeys([])
                    }}
                    style={{ background: 'rgba(255, 255, 255, 0.1)', border: '1px solid rgba(255, 255, 255, 0.2)', color: '#FFFFFF' }}
                  >
                    {t('common.resetFilters')}
                  </Button>
                  <button
                    onClick={() => { setCreating(true); form.resetFields() }}
                    style={{
                      display: 'flex',
                      alignItems: 'center',
                      gap: 8,
                      borderRadius: 8,
                      padding: '8px 16px',
                      background: 'linear-gradient(to right,#FDE08D,#C48D3A)',
                      color: '#111',
                      fontWeight: 700,
                      cursor: 'pointer',
                      border: 'none'
                    }}
                  >
                    <PlusOutlined />
                    {t('usersAdmin.addUser')}
                  </button>
                </Space>
              </div>
            )}

            {isMobile && activeTab === 'list' && (
              <div
                onClick={() => { setCreating(true); form.resetFields() }}
                style={{
                  position: 'fixed',
                  right: 20,
                  bottom: 80,
                  width: 56,
                  height: 56,
                  borderRadius: '28px',
                  background: 'linear-gradient(to right,#FDE08D,#C48D3A)',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  boxShadow: '0 4px 12px rgba(196, 141, 58, 0.4)',
                  zIndex: 1000,
                  cursor: 'pointer'
                }}
              >
                <PlusOutlined style={{ fontSize: 24, color: '#111' }} />
              </div>
            )}

            {/* 桌面：表格 */}
            {!isMobile && (
              <div className="points-config-form">
                  <Table
                    columns={columns}
                    dataSource={filteredUsers}
                    rowKey="id"
                    loading={usersLoading}
                    virtual
                    rowSelection={{
                      selectedRowKeys,
                      onChange: setSelectedRowKeys,
                    }}
                    scroll={{
                      y: isMobile ? 'calc(100vh - 250px)' : 'calc(100vh - 350px)',
                      x: 'max-content'
                    }}
                    pagination={{
                      pageSize: isMobile ? 10 : 20,
                      total: filteredUsers.length,
                      showSizeChanger: true,
                    }}
                    style={{
                      background: 'transparent'
                    }}
                  />
              </div>
            )}

            {/* 移动端：列表视图 */}
            {isMobile && activeTab === 'list' && (
              <div style={{
                display: 'flex',
                flexDirection: 'column',
                flex: 1,
                overflow: 'hidden'
              }}>
                {/* 固定顶部区域 - 不滚动 */}
                <div style={{ flexShrink: 0 }}>

                  {/* 搜索框 */}
                  <div style={{ position: 'relative', marginBottom: 12 }}>
                    <Search
                      placeholder={t('usersAdmin.searchByNameOrEmail')}
                      allowClear
                      value={keyword}
                      onChange={(e) => setKeyword(e.target.value)}
                      style={{ width: '100%' }}
                      prefix={<SearchOutlined />}
                      className="points-config-form"
                    />
                  </div>

                  {/* 筛选与添加 */}
                  <div style={{ display: 'flex', gap: 8, alignItems: 'center', overflowX: 'auto', padding: '0 0px 12px 0px', borderBottom: '2px solid rgba(255, 215, 0, 0.2)' }}>
                    <Dropdown
                      menu={{
                        items: [
                          { key: 'all', label: t('common.all') },
                          { key: 'superAdmin', label: t('auth.superAdmin') },
                          { key: 'admin', label: t('auth.admin') },
                          { key: 'vip', label: t('auth.vip') },
                          { key: 'member', label: t('auth.member') },
                          { key: 'guest', label: t('auth.guest') },
                          ...(currentUser?.role === 'developer' ? [{ key: 'developer', label: t('auth.developer') }] : []),
                        ],
                        onClick: ({ key }) => {
                          const v = key === 'all' ? undefined : (key as string)
                          setRoleFilter(v)
                        },
                      }}
                    >
                      <Button
                        shape="round"
                        size="small"
                        style={{
                          background: 'rgba(255, 255, 255, 0.1)',
                          border: '1px solid rgba(255, 255, 255, 0.2)',
                          color: '#FFFFFF'
                        }}
                      >
                        {t('usersAdmin.role')}{roleFilter ? `: ${getRoleText(roleFilter)}` : ''}
                      </Button>
                    </Dropdown>
                    <Dropdown
                      menu={{
                        items: [
                          { key: 'all', label: t('common.all') },
                          { key: 'bronze', label: t('usersAdmin.bronzeMember') },
                          { key: 'silver', label: t('usersAdmin.silverMember') },
                          { key: 'gold', label: t('usersAdmin.goldMember') },
                          { key: 'platinum', label: t('usersAdmin.platinumMember') },
                        ],
                        onClick: ({ key }) => {
                          const v = key === 'all' ? undefined : (key as string)
                          setLevelFilter(v)
                        },
                      }}
                    >
                      <Button
                        shape="round"
                        size="small"
                        style={{
                          background: 'rgba(255, 255, 255, 0.1)',
                          border: '1px solid rgba(255, 255, 255, 0.2)',
                          color: '#FFFFFF'
                        }}
                      >
                        {t('usersAdmin.level')}{levelFilter ? `: ${getMembershipText(levelFilter)}` : ''}
                      </Button>
                    </Dropdown>
                    <Dropdown
                      menu={{
                        items: [
                          { key: 'all', label: t('common.all') },
                          { key: 'active', label: t('usersAdmin.active') },
                          { key: 'inactive', label: t('usersAdmin.inactive') },
                        ],
                        onClick: ({ key }) => {
                          const v = key === 'all' ? undefined : (key as string)
                          setStatusFilter(v)
                        },
                      }}
                    >
                      <Button
                        shape="round"
                        size="small"
                        style={{
                          background: 'rgba(255, 255, 255, 0.1)',
                          border: '1px solid rgba(255, 255, 255, 0.2)',
                          color: '#FFFFFF'
                        }}
                      >
                        {t('usersAdmin.status')}{statusFilter ? `: ${getStatusText(statusFilter)}` : ''}
                      </Button>
                    </Dropdown>
                  </div>
                </div>

                {/* 顶部渐变装饰 */}
                <div style={{
                  position: 'sticky',
                  top: 0,
                  left: 0,
                  right: 0,
                  height: '20px',
                  background: 'linear-gradient(180deg, rgba(0, 0, 0, 0.1) 0%, transparent 100%)',
                  zIndex: 2,
                  pointerEvents: 'none',
                  marginLeft: '-12px',
                  marginRight: '-12px'
                }} />

                {/* 可滚动内容区域 - 独立滚动 */}
                <div
                  className="users-scroll-area"
                  style={{
                    flex: 1,
                    overflowY: 'auto',
                    overflowX: 'hidden',
                    paddingBottom: '16px',
                    position: 'relative',
                    zIndex: 1
                  }}
                >
                  {usersLoading && !users.length ? (
                    <div style={{ padding: '0 16px' }}>
                      <UserSkeletonList count={10} />
                    </div>
                  ) : (
                    <>
                      {groupedByInitial.map(group => (
                        <div key={group.key} id={`group-${group.key}`} style={{ marginBottom: 12 }}>
                          <div style={{ color: '#f4af25', fontWeight: 600, marginBottom: 8 }}>{group.key}</div>
                          {group.items.map((u) => {
                            const status = statusMap[u.id] || (u as any).status || 'active'
                            const role = u.role || 'member'
                            return (
                              <div key={u.id} style={{ borderRadius: 12, border: '1px solid rgba(255,255,255,0.1)', background: 'rgba(255,255,255,0.05)', padding: 12, marginBottom: 8, backdropFilter: 'blur(6px)' }}>
                                <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: 12 }}>
                                  <div style={{ flex: 1 }}>
                                    <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                                      <div style={{ fontWeight: 700, color: '#FFFFFF' }}>{u.displayName || '-'}</div>
                                      <Tag color={getRoleColor(role)} style={{ margin: 0 }}>
                                        {getRoleText(role)}
                                      </Tag>
                                    </div>
                                    <div style={{ marginTop: 4, fontSize: 12, color: '#CCCCCC' }}>
                                      {u.memberId && <span style={{ marginRight: 8, fontFamily: 'monospace', color: '#FDE08D', fontWeight: 500 }}>{t('usersAdmin.memberId')}: {u.memberId}</span>}
                                      <span style={{ color: '#FFFFFF' }}>{maskPhone((u as any)?.profile?.phone)}</span>
                                      {canManageDiscount && u.discount?.rate !== undefined && (
                                        <span style={{ marginLeft: 8, color: '#FDE08D', fontWeight: 600 }}>{t('usersAdmin.discount')} {u.discount.rate}%</span>
                                      )}
                                    </div>
                                    <div style={{ marginTop: 6, display: 'flex', alignItems: 'center', gap: 6 }}>
                                      <span style={{ width: 8, height: 8, borderRadius: 999, background: status === 'active' ? '#52c41a' : '#ff4d4f', display: 'inline-block' }} />
                                      <span style={{ fontSize: 12, color: '#FFFFFF', fontWeight: 500 }}>{getStatusText(status)}</span>
                                    </div>
                                  </div>
                                  <div style={{ display: 'flex', flexDirection: 'column', gap: 6, alignItems: 'flex-end' }}>
                                    <button style={{ padding: '4px 8px', borderRadius: 6, background: 'linear-gradient(to right,#FDE08D,#C48D3A)', color: '#221c10', fontWeight: 600, fontSize: 12, cursor: 'pointer', transition: 'all 0.2s ease', width: '100%', minWidth: '40px' }} onClick={() => {
                                      openEditing(u)
                                      form.setFieldsValue({
                                        displayName: u.displayName,
                                        email: u.email,
                                        role: u.role,
                                        discountRate: u.discount?.rate,
                                        discountNote: u.discount?.note,
                                        level: u.membership?.level,
                                        phone: (u as any)?.profile?.phone,
                                        gender: u.profile?.gender,
                                        race: u.profile?.race,
                                      })
                                    }}>{t('common.viewDetails')}</button>
                                    <button
                                      style={{
                                        padding: '4px 8px',
                                        borderRadius: 6,
                                        background: 'rgba(255,255,255,0.1)',
                                        border: '1px solid rgba(244, 175, 37, 0.6)',
                                        color: '#FDE08D',
                                        fontWeight: 600,
                                        fontSize: 12,
                                        cursor: 'pointer',
                                        transition: 'all 0.2s ease',
                                        display: 'flex',
                                        alignItems: 'center',
                                        justifyContent: 'center',
                                        width: '100%',
                                        minWidth: '40px'
                                      }}
                                      onClick={() => openResettingPassword(u)}
                                      title={t('usersAdmin.resetPassword')}
                                    >
                                      <KeyOutlined style={{ fontSize: 14 }} />
                                    </button>
                                  </div>
                                </div>
                              </div>
                            )
                          })}
                        </div>
                      ))}
                      {groupedByInitial.length === 0 && (
                        <div style={{ color: '#999', textAlign: 'center', padding: '24px 0' }}>{t('common.noData')}</div>
                      )}
                    </>
                  )}
                </div>
              </div>
            )}

            {/* 右侧字母索引（固定居中）- 移至最外层 */}
            {isMobile && activeTab === 'list' && (
              <div
                style={{
                  position: 'fixed',
                  right: 7,
                  top: '48%',
                  transform: 'translateY(-50%)',
                  maxHeight: '90vh',
                  padding: 4,
                  zIndex: 1000,
                  background: 'rgba(0,0,0,0.35)',
                  border: '1px solid rgba(255,215,0,0.25)',
                  borderRadius: 12,
                  backdropFilter: 'blur(6px)',
                  WebkitBackdropFilter: 'blur(6px)',
                  boxShadow: '0 6px 20px rgba(0,0,0,0.25)',
                  display: 'flex',
                  flexDirection: 'column',
                  justifyContent: 'center'
                }}
              >
                <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 5, fontSize: 10, fontWeight: 600 }}>
                  {alphaIndex.map(letter => {
                    const enabled = groupedByInitial.some(g => g.key === letter)
                    const isActive = letter === activeIndex
                    return (
                      <a
                        key={letter}
                        onClick={(e) => {
                          e.preventDefault()
                          if (!enabled) return

                          // 1. 触摸振动反馈
                          if (navigator.vibrate) {
                            navigator.vibrate(10)
                          }

                          // 2. 显示字母气泡
                          setBubbleLetter(letter)
                          setShowBubble(true)
                          setTimeout(() => setShowBubble(false), 500)

                          // 3. 滚动到对应分组
                          const el = document.getElementById(`group-${letter}`)
                          if (el) el.scrollIntoView({ behavior: 'smooth', block: 'start' })
                        }}
                        style={{
                          color: isActive ? '#fff' : enabled ? '#f4af25' : '#777',
                          background: isActive ? 'rgba(244, 175, 37, 0.8)' : 'transparent',
                          textDecoration: 'none',
                          padding: '1px 3px',
                          borderRadius: '3px',
                          cursor: enabled ? 'pointer' : 'default',
                          transition: 'all 0.3s ease',
                          fontWeight: isActive ? 700 : 600,
                          lineHeight: 1
                        }}
                      >
                        {letter}
                      </a>
                    )
                  })}
                </div>
              </div>
            )}

            {/* 字母气泡提示 - 移至最外层 */}
            {showBubble && isMobile && (
              <div style={{
                position: 'fixed',
                top: '50%',
                left: '50%',
                transform: 'translate(-50%, -50%)',
                width: '100px',
                height: '100px',
                background: 'rgba(244, 175, 37, 0.95)',
                borderRadius: '16px',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                fontSize: '56px',
                fontWeight: 'bold',
                color: '#111',
                zIndex: 9999,
                pointerEvents: 'none',
                boxShadow: '0 8px 32px rgba(244, 175, 37, 0.6)',
                animation: 'bubblePop 0.3s ease-out'
              }}>
                {bubbleLetter}
              </div>
            )}

            {/* 字母气泡动画 + 隐藏滚动条 */}
            <style>{`
        @keyframes bubblePop {
          0% {
            transform: translate(-50%, -50%) scale(0.5);
            opacity: 0;
          }
          50% {
            transform: translate(-50%, -50%) scale(1.1);
          }
          100% {
            transform: translate(-50%, -50%) scale(1);
            opacity: 1;
          }
        }
        
        /* 隐藏滚动条但保持滚动功能 */
        .users-scroll-area::-webkit-scrollbar {
          display: none;
        }
        .users-scroll-area {
          -ms-overflow-style: none;  /* IE and Edge */
          scrollbar-width: none;  /* Firefox */
        }
      `}</style>
          </>
        )
      }

      {/* 查看用户详情弹窗 */}
      <Modal
        title={null}
        open={editingOpen}
        onCancel={closeEditing}
        footer={null}
        width={isMobile ? '100%' : 480}
        style={{ top: isMobile ? 0 : 20 }}
        styles={{
          body: {
            padding: 0,
            background: 'linear-gradient(180deg, #221c10 0%, #181611 0%)',
            minHeight: isMobile ? '100vh' : 'auto'
          },
          mask: { backgroundColor: 'rgba(0, 0, 0, 0.8)' },
          content: {
            border: 'none',
            boxShadow: 'none',
            background: 'linear-gradient(180deg, #221c10 0%, #181611 0%)'
          }
        }}
        className="user-detail-modal"
        closable={false}
      >
        {editing && (
          <div style={{
            minHeight: isMobile ? '100vh' : 'auto',
            color: '#FFFFFF'
          }}>
            {/* Header */}
            <div style={{
              position: 'sticky',
              top: 0,
              zIndex: 10,
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'space-between',
              padding: '16px',

              background: 'transparent',
              backdropFilter: 'blur(10px)'
            }}>
              <Button
                type="text"
                icon={<ArrowLeftOutlined />}
                onClick={closeEditing}
                style={{ color: '#FFFFFF', fontSize: '20px' }}
              />
              <h1 style={{
                fontSize: '18px',
                fontWeight: 'bold',
                color: '#FFFFFF',
                margin: 0,
                textAlign: 'center',
                flex: 1
              }}>
                {t('usersAdmin.memberDetails')}
              </h1>
            </div>

            {/* ProfileView Component */}
            <div>
              <ProfileView
                user={editing}
                readOnly={false}
                showEditButton={true}
                onEdit={(user) => {
                  setCreating(true)
                  form.setFieldsValue({
                    displayName: user.displayName,
                    email: user.email,
                    role: user.role,
                    discountRate: user.discount?.rate,
                    discountNote: user.discount?.note,
                    level: user.membership?.level,
                    phone: (user as any)?.profile?.phone,
                    gender: user.profile?.gender,
                    race: user.profile?.race,
                  })
                }}
              />
            </div>
          </div>
        )}
      </Modal>

      {/* 创建/编辑弹窗 */}
      <Modal
        title={editing ? t('usersAdmin.editUser') : t('usersAdmin.addUser')}
        open={creating}
        onCancel={() => {
          setCreating(false)
          closeEditing()
        }}
        onOk={() => form.submit()}
        confirmLoading={actionLoading}
        width={getModalWidth(isMobile, 520)}
        styles={getModalThemeStyles(isMobile, true)}
      >
        <Form
          form={form}
          layout="vertical"
          style={{ color: '#FFFFFF' }}
          onFinish={async (values) => {
            setLoading(true)
            try {
              // 标准化手机号
              let normalizedPhone: string | undefined = undefined
              if (values.phone) {
                const normalized = normalizePhoneNumber(values.phone)
                if (!normalized) {
                  message.error(t('usersAdmin.phoneFormatError'))
                  setLoading(false)
                  return
                }
                normalizedPhone = normalized
                // 检查手机号唯一性
                const phoneQuery = query(
                  collection(db, 'users'),
                  where('profile.phone', '==', normalizedPhone),
                  limit(1)
                )
                const phoneSnap = await getDocs(phoneQuery)

                if (!phoneSnap.empty) {
                  const existingUserId = phoneSnap.docs[0].id
                  // 如果是编辑模式，检查是否是当前用户自己的手机号
                  if (!editing || existingUserId !== editing.id) {
                    message.error(t('usersAdmin.phoneInUseError'))
                    setLoading(false)
                    return
                  }
                }
              }

              const hasDiscountValue = values.discountRate !== undefined && values.discountRate !== null && values.discountRate !== ''
              const hasDiscountNote = values.discountNote && values.discountNote.trim() !== ''
              const discountPayload = canManageDiscount ? (
                hasDiscountValue || hasDiscountNote || editing?.discount
                  ? {
                    discount: hasDiscountValue || hasDiscountNote ? {
                      rate: hasDiscountValue ? Number(values.discountRate) : undefined,
                      note: hasDiscountNote ? values.discountNote.trim() : undefined,
                      updatedBy: currentUser?.id,
                      updatedAt: new Date(),
                    } : null
                  }
                  : {}
              ) : {}

              if (editing) {
                const res = await updateDocument<User>(COLLECTIONS.USERS, editing.id, {
                  displayName: values.displayName,
                  email: values.email || undefined, // ✅ 允许email为空
                  role: values.role,
                  membership: { ...editing.membership, level: values.level },
                  profile: { ...(editing as any).profile, phone: normalizedPhone, gender: values.gender || null, race: values.race || null },
                  ...discountPayload,
                } as any)
                if (res.success) message.success(t('usersAdmin.saved'))
              } else {
                // 创建新用户时，先创建文档获取ID，然后生成会员ID并更新
                const userData: Omit<User, 'id'> = {
                  displayName: values.displayName,
                  email: values.email || undefined, // ✅ 允许email为空
                  role: values.role,
                  status: 'inactive',  // ✅ 默认状态为非活跃
                  profile: { phone: normalizedPhone, gender: values.gender || null, race: values.race || null },
                  preferences: {
                    locale: 'zh',
                    notifications: true,
                  },
                  membership: { level: values.level, joinDate: new Date(), lastActive: new Date() },
                  createdAt: new Date(),
                  updatedAt: new Date(),
                  ...(discountPayload.discount ? { discount: discountPayload.discount } : {}),
                } as any

                const res = await createDocument<User>(COLLECTIONS.USERS, userData)

                if ((res as any).success) {
                  const newUserId = (res as any).id

                  // 生成会员ID并更新用户文档
                  try {
                    const memberId = await generateMemberId(newUserId)
                    await updateDocument<User>(COLLECTIONS.USERS, newUserId, { memberId } as any)
                    message.success(t('usersAdmin.created'))
                  } catch (error) {
                    console.error('生成会员ID失败:', error)
                    message.warning(t('usersAdmin.created') + '，' + t('usersAdmin.memberIdGenerationFailed'))
                  }
                } else {
                  message.error(t('messages.dataLoadFailed'))
                }
              }
              await refreshUsers()
              setCreating(false)
              closeEditing()
            } finally {
              setLoading(false)
            }
          }}>
          <Form.Item
            label={<span style={{ color: '#FFFFFF' }}>{t('common.name')}</span>}
            name="displayName"
            rules={[{ required: true, message: t('profile.nameRequired') }]}
          >
            <Input placeholder={t('auth.name')} />
          </Form.Item>

          <Form.Item
            label={<span style={{ color: '#FFFFFF' }}>{t('auth.email')}</span>}
            name="email"
            rules={[
              // ✅ 管理员和开发者手动创建用户时，电邮为选填
              { type: 'email', message: t('auth.emailInvalid') },
              {
                validator: async (_, value) => {
                  // 如果没有输入，跳过验证（非必填）
                  if (!value) {
                    return Promise.resolve()
                  }

                  // ✅ 如果是编辑模式且邮箱没有改变，跳过验证
                  if (editing && value === editing.email) {
                    return Promise.resolve()
                  }

                  // ✅ 先验证格式，格式无效则跳过唯一性检查
                  const emailPattern = /^[^\s@]+@[^\s@]+\.[^\s@]+$/
                  if (!emailPattern.test(value)) {
                    return Promise.resolve()
                  }

                  // ✅ 格式有效，检查邮箱唯一性
                  try {
                    const emailQuery = query(
                      collection(db, 'users'),
                      where('email', '==', value.toLowerCase().trim()),
                      limit(1)
                    )
                    const emailSnap = await getDocs(emailQuery)

                    if (!emailSnap.empty) {
                      const existingUserId = emailSnap.docs[0].id
                      // 如果是编辑模式，检查是否是当前用户
                      if (!editing || existingUserId !== editing.id) {
                        return Promise.reject(new Error(t('usersAdmin.emailInUseError')))
                      }
                    }
                  } catch (error) {
                    // 如果查询失败，允许通过（不阻止用户提交）
                  }

                  return Promise.resolve()
                }
              }
            ]}
            validateTrigger={['onBlur', 'onChange']}
            validateDebounce={500}
          >
            <Input placeholder={t('auth.email')} />
          </Form.Item>

          <Form.Item
            label={<span style={{ color: '#FFFFFF' }}>{t('auth.phone')}</span>}
            name="phone"
            rules={[
              { required: true, message: t('profile.phoneRequired') },
              {
                pattern: /^((\+?60[1-9]\d{8,9})|(0[1-9]\d{8,9}))$/,
                message: t('usersAdmin.phoneFormatError')
              },
              {
                validator: async (_, value) => {
                  if (!value) return Promise.resolve()

                  // ✅ 如果是编辑模式且手机号没有改变，跳过验证
                  if (editing) {
                    const currentPhone = normalizePhoneNumber((editing as any)?.profile?.phone || '')
                    const newPhone = normalizePhoneNumber(value)
                    if (newPhone === currentPhone) {
                      return Promise.resolve()
                    }
                  }

                  // ✅ 先验证格式，格式无效则跳过唯一性检查
                  const formatPattern = /^((\+?60[1-9]\d{8,9})|(0[1-9]\d{8,9}))$/
                  if (!formatPattern.test(value)) {
                    return Promise.resolve()
                  }

                  // ✅ 格式有效，检查手机号唯一性
                  const normalized = normalizePhoneNumber(value)
                  if (!normalized) {
                    return Promise.resolve()
                  }

                  try {
                    const phoneQuery = query(
                      collection(db, 'users'),
                      where('profile.phone', '==', normalized),
                      limit(1)
                    )
                    const phoneSnap = await getDocs(phoneQuery)

                    if (!phoneSnap.empty) {
                      const existingUserId = phoneSnap.docs[0].id
                      // 如果是编辑模式，检查是否是当前用户
                      if (!editing || existingUserId !== editing.id) {
                        return Promise.reject(new Error(t('usersAdmin.phoneInUseError')))
                      }
                    }
                  } catch (error) {
                    // 如果查询失败，允许通过（不阻止用户提交）
                  }

                  return Promise.resolve()
                }
              }
            ]}
            validateTrigger={['onBlur', 'onChange']}
            validateDebounce={500}
          >
            <Input
              placeholder={t('auth.phone')}
              onInput={(e) => {
                const input = e.currentTarget
                // ✅ 只保留数字、加号和空格
                input.value = input.value.replace(/[^\d+\s-]/g, '')
              }}
            />
          </Form.Item>

          <Row gutter={12}>
            <Col span={12}>
              <Form.Item
                label={<span style={{ color: '#FFFFFF' }}>{t('profile.gender')}</span>}
                name="gender"
              >
                <Select
                  allowClear
                  placeholder={t('profile.selectGender')}
                  options={[
                    { value: 'male', label: t('profile.genderOptions.male') },
                    { value: 'female', label: t('profile.genderOptions.female') },
                  ]}
                />
              </Form.Item>
            </Col>
            <Col span={12}>
              <Form.Item
                label={<span style={{ color: '#FFFFFF' }}>{t('profile.race')}</span>}
                name="race"
              >
                <Select
                  allowClear
                  placeholder={t('profile.selectRace')}
                  options={[
                    { value: 'chinese', label: t('profile.raceOptions.chinese') },
                    { value: 'indian', label: t('profile.raceOptions.indian') },
                    { value: 'malay', label: t('profile.raceOptions.malay') },
                    { value: 'other', label: t('profile.raceOptions.other') },
                  ]}
                />
              </Form.Item>
            </Col>
          </Row>

          {canManageDiscount && (
            <Row gutter={12}>
              <Col span={12}>
                <Form.Item
                  label={<span style={{ color: '#FFFFFF' }}>{t('usersAdmin.discountRate')}</span>}
                  name="discountRate"
                  rules={[
                    {
                      type: 'number',
                      min: 0,
                      max: 100,
                      message: t('usersAdmin.discountRateRangeError')
                    }
                  ]}
                >
                  <InputNumber min={0} max={100} step={1} style={{ width: '100%' }} addonAfter="%" />
                </Form.Item>
              </Col>
              <Col span={12}>
                <Form.Item
                  label={<span style={{ color: '#FFFFFF' }}>{t('usersAdmin.discountNote')}（{t('usersAdmin.discountAdminOnly')}）</span>}
                  name="discountNote"
                >
                  <Input placeholder={t('usersAdmin.discountNotePlaceholder')} />
                </Form.Item>
              </Col>
            </Row>
          )}

          <Form.Item
            label={<span style={{ color: '#FFFFFF' }}>{t('usersAdmin.role')}</span>}
            name="role"
            rules={[{ required: true }]}
            initialValue="member"
          >
            <Select disabled={(() => {
              const ROLE_RANK: Record<string, number> = { developer: 4, superAdmin: 3, admin: 2, vip: 1, member: 1, guest: 0 }
              const myRank = ROLE_RANK[currentUser?.role ?? ''] ?? 0
              const targetRank = ROLE_RANK[(editing as any)?.role ?? ''] ?? 0
              return editing?.id === currentUser?.id || targetRank >= myRank
            })()}>
              {assignableRoles.map(r => (
                <Option key={r.value} value={r.value}>{r.label}</Option>
              ))}
            </Select>
          </Form.Item>

          <Form.Item
            label={<span style={{ color: '#FFFFFF' }}>{t('usersAdmin.membershipLevel')}</span>}
            name="level"
            rules={[{ required: true }]}
            initialValue="bronze"
          >
            <Select>
              <Option value="bronze">{t('usersAdmin.bronzeMember')}</Option>
              <Option value="silver">{t('usersAdmin.silverMember')}</Option>
              <Option value="gold">{t('usersAdmin.goldMember')}</Option>
              <Option value="platinum">{t('usersAdmin.platinumMember')}</Option>
            </Select>
          </Form.Item>
        </Form>
      </Modal>

      {/* 删除确认 */}
      <Modal
        title={t('usersAdmin.deleteUser')}
        open={!!deleting}
        onCancel={() => setDeleting(null)}
        onOk={async () => {
          if (!deleting) return
          setLoading(true)
          try {
            const res = await deleteDocument(COLLECTIONS.USERS, deleting.id)
            if (res.success) {
              message.success(t('common.deleted'))
              await refreshUsers()
            }
          } finally {
            setLoading(false)
            setDeleting(null)
          }
        }}
        okButtonProps={{ danger: true }}
      >
        {t('usersAdmin.deleteUserConfirm', { name: deleting?.displayName })}
      </Modal>

      {/* 重置密码确认 */}
      <Modal
        title={<span style={{ color: '#FFFFFF' }}>{t('usersAdmin.resetPassword')}</span>}
        open={resettingPasswordOpen}
        onCancel={closeResettingPassword}
        footer={null}
        {...getResponsiveModalConfig(isMobile, true, 500)}
        styles={getModalThemeStyles(isMobile, true)}
      >
        <div style={{ color: '#FFFFFF' }}>
          <p style={{ marginBottom: 20, color: '#f4af25', fontWeight: 600 }}>
            {t('usersAdmin.selectResetMethod')}
          </p>

          {/* 重置方式按钮 */}
          <Space direction="vertical" size="middle" style={{ width: '100%' }}>
            {/* 电邮重置按钮 */}
            <Button
              type="default"
              block
              size="large"
              icon={<MailOutlined />}
              disabled={!resettingPassword?.email || resettingPassword.email.trim() === ''}
              loading={resettingPasswordLoading}
              onClick={async () => {
                if (!resettingPassword || !resettingPassword.email) {
                  message.error(t('usersAdmin.noEmailForReset'))
                  return
                }

                modal.confirm({
                  title: <span style={{ color: '#FFFFFF' }}>{t('usersAdmin.confirmEmailReset')}</span>,
                  content: <span style={{ color: '#FFFFFF' }}>{t('usersAdmin.resetPasswordConfirm', { name: resettingPassword.email })}</span>,
                  okText: t('common.confirm'),
                  cancelText: t('common.cancel'),
                  centered: true,
                  styles: getModalThemeStyles(isMobile, true),
                  okButtonProps: {
                    style: modalButtonStyles.primary
                  },
                  cancelButtonProps: {
                    style: modalButtonStyles.secondary
                  },
                  onOk: async () => {
                    setResettingPasswordLoading(true)
                    try {
                      const result = await sendPasswordResetEmailFor(resettingPassword.email!)
                      if (result.success) {
                        message.success(t('usersAdmin.passwordResetSent'))
                        closeResettingPassword()
                      } else {
                        message.error(result.error?.message || t('usersAdmin.passwordResetFailed'))
                      }
                    } catch (error: any) {
                      message.error(error.message || t('usersAdmin.passwordResetFailed'))
                    } finally {
                      setResettingPasswordLoading(false)
                    }
                  }
                })
              }}
              style={{
                ...modalButtonStyles.secondary,
                height: '54px',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                fontSize: '16px',
              }}
            >
              {t('usersAdmin.resetByEmail')}
              {resettingPassword?.email && (
                <span style={{ marginLeft: 8, fontSize: '12px', opacity: 0.6 }}>
                  ({resettingPassword.email})
                </span>
              )}
            </Button>

            {/* WhatsApp重置按钮 */}
            <Button
              type="default"
              block
              size="large"
              icon={<WhatsAppOutlined />}
              disabled={!(resettingPassword as any)?.profile?.phone || (resettingPassword as any).profile.phone.trim() === ''}
              loading={resettingPasswordLoading}
              onClick={async () => {
                if (!resettingPassword || !(resettingPassword as any)?.profile?.phone) {
                  message.error(t('usersAdmin.noPhoneForReset'))
                  return
                }

                const phone = (resettingPassword as any).profile.phone
                modal.confirm({
                  title: <span style={{ color: '#FFFFFF' }}>{t('usersAdmin.confirmWhatsappReset')}</span>,
                  content: <span style={{ color: '#FFFFFF' }}>{t('usersAdmin.resetPasswordConfirm', { name: phone })}</span>,
                  okText: t('common.confirm'),
                  cancelText: t('common.cancel'),
                  centered: true,
                  styles: getModalThemeStyles(isMobile, true),
                  okButtonProps: {
                    style: modalButtonStyles.primary
                  },
                  cancelButtonProps: {
                    style: modalButtonStyles.secondary
                  },
                  onOk: async () => {
                    setResettingPasswordLoading(true)
                    try {
                      const result = await resetPasswordByPhone(phone)
                      if (result.success) {
                        message.success(t('usersAdmin.whatsappResetSuccess'))
                        closeResettingPassword()
                      } else {
                        message.error(result.error || t('usersAdmin.passwordResetFailed'))
                      }
                    } catch (error: any) {
                      message.error(error.message || t('usersAdmin.passwordResetFailed'))
                    } finally {
                      setResettingPasswordLoading(false)
                    }
                  }
                })
              }}
              style={{
                ...modalButtonStyles.secondary,
                height: '54px',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                fontSize: '16px',
              }}
            >
              {t('usersAdmin.resetByWhatsapp')}
              {(resettingPassword as any)?.profile?.phone && (
                <span style={{ marginLeft: 8, fontSize: '12px', opacity: 0.6 }}>
                  ({(resettingPassword as any).profile.phone})
                </span>
              )}
            </Button>

            {/* 复制内容手动发送按钮 */}
            <Button
              type="default"
              block
              size="large"
              icon={<SendOutlined />}
              onClick={async () => {
                try {
                  if (!resettingPassword || !(resettingPassword as any)?.profile?.phone) {
                    message.error(t('usersAdmin.noPhoneForReset'));
                    return;
                  }

                  const phone = (resettingPassword as any).profile.phone;
                  setResettingPasswordLoading(true);

                  // 调用后端逻辑：重置密码并生成与 WhatsApp 相同的消息内容（但不发送）
                  const result = await generateResetPasswordMessageByPhone(phone);

                  if (!result.success || !result.message || !result.normalizedPhone) {
                    message.error(result.error || t('usersAdmin.generateResetContentFailed'));
                    return;
                  }

                  // 构造 WhatsApp 官方发送链接，phone 不带 "+"，text 为 URL 编码后的完整消息
                  const whatsappPhone = result.normalizedPhone.replace(/^\+/, '');
                  const url = `https://api.whatsapp.com/send?phone=${encodeURIComponent(
                    whatsappPhone
                  )}&text=${encodeURIComponent(result.message)}`;

                  // 优先直接打开链接，方便管理员一键跳转到 WhatsApp 发送
                  const opened = window.open(url, '_blank');
                  if (!opened) {
                    // 如果被拦截，则回退为展示链接供手动复制
                    modal.info({
                      title: t('usersAdmin.whatsappLinkTitle'),
                      content: (
                        <div>
                          <p>{t('usersAdmin.whatsappLinkHint')}</p>
                          <pre
                            style={{
                              whiteSpace: 'pre-wrap',
                              wordBreak: 'break-all',
                              background: 'rgba(0,0,0,0.4)',
                              padding: 12,
                              borderRadius: 8,
                              color: '#fff',
                              maxHeight: 260,
                              overflow: 'auto'
                            }}
                          >
                            {url}
                          </pre>
                        </div>
                      ),
                      okText: t('common.done'),
                      centered: true,
                      styles: getModalThemeStyles(isMobile, true)
                    });
                  }
                } catch (error: any) {
                  message.error(error?.message || t('usersAdmin.passwordResetFailed'));
                } finally {
                  setResettingPasswordLoading(false);
                }
              }}
              style={{
                ...modalButtonStyles.secondary,
                borderStyle: 'dashed',
                height: '54px',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                fontSize: '16px',
              }}
            >
              {t('usersAdmin.manualSend')}
            </Button>
          </Space>

          {/* 提示信息 */}
          {(!resettingPassword?.email || resettingPassword.email.trim() === '') &&
            (!(resettingPassword as any)?.profile?.phone || (resettingPassword as any).profile.phone.trim() === '') && (
              <p style={{ color: '#ff4d4f', fontSize: '12px', marginTop: 16, textAlign: 'center' }}>
                {t('usersAdmin.noEmailOrPhone')}
              </p>
            )}
        </div>
      </Modal>
    </div >
  )
}

export default AdminUsers
