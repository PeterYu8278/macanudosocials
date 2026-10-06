// 用户管理页面
import React, { useEffect, useMemo, useState } from 'react'
import { Table, Button, Tag, Space, Typography, Input, Select, Modal, Form, Switch, Dropdown, Checkbox, Row, Col, Spin, App, InputNumber, Tooltip, Upload, Alert, Radio } from 'antd'
import { EditOutlined, DeleteOutlined, PlusOutlined, SearchOutlined, EyeOutlined, ArrowLeftOutlined, CalendarOutlined, ShoppingOutlined, TrophyOutlined, KeyOutlined, MailOutlined, WhatsAppOutlined, SendOutlined, UploadOutlined } from '@ant-design/icons'
import { MemberProfileCard } from '../../../components/common/MemberProfileCard'
import { ProfileView } from '../../../components/common/ProfileView'
import { ReferralTreeView } from '../../../components/admin/ReferralTreeView'

const { Title, Text } = Typography
const { Search } = Input
const { Option } = Select

const ROLE_RANK: Record<string, number> = {
  developer: 5,
  superAdmin: 4,
  admin: 3,
  storeAdmin: 2,
  vip: 1,
  member: 1,
  guest: 0,
}

const ROLE_SORT_INDEX: Record<string, number> = {
  developer: 0,
  superAdmin: 1,
  admin: 2,
  storeAdmin: 3,
  vip: 4,
  member: 5,
  guest: 6,
}

import { getUsers, getUserById, updateDocument, deleteDocument, COLLECTIONS, getEventsByUser, getOrdersByUser } from '../../../services/firebase/firestore'
import { useFirestoreQuery } from '../../../hooks/useFirestoreQuery'
import { useVirtualTableScroll } from '../../../hooks/useVirtualTableScroll'
import { useDetailDrawer } from '../../../hooks/useDetailDrawer'
import type { User, Event, Order } from '../../../types'
import dayjs from 'dayjs'
import { sendPasswordResetEmailFor, resetPasswordByPhone, generateResetPasswordMessageByPhone } from '../../../services/firebase/auth'
import { useTranslation } from 'react-i18next'
import { useAuthStore } from '../../../store/modules/auth'
import { getModalThemeStyles, getModalWidth, getResponsiveModalConfig, modalButtonStyles } from '../../../config/modalTheme'
import { normalizePhoneNumber } from '../../../utils/phoneNormalization'
import { usePhoneChangeVerification } from '../../../hooks/usePhoneChangeVerification'
import { updateMemberPhone } from '../../../services/firebase/memberPhone'
import { MemberEmailError, normalizeMemberEmail, updateMemberEmail } from '../../../services/firebase/memberEmail'
import { collection, query, where, getDocs, limit, doc, setDoc } from 'firebase/firestore'
import { UserSkeletonList } from '../../../components/features/admin/UserSkeleton'
import { auth, db } from '../../../config/firebase'
import {
  prepareLegacyMigrationWorkbook,
  type LegacyMigrationPayload,
  type LegacyMigrationWorkbookReport,
} from '../../../utils/legacyMigrationWorkbook'

const compareUsersByRoleAndName = (a: User, b: User, locale: string) => {
  const roleDifference = (ROLE_SORT_INDEX[a.role] ?? Number.MAX_SAFE_INTEGER)
    - (ROLE_SORT_INDEX[b.role] ?? Number.MAX_SAFE_INTEGER)
  if (roleDifference !== 0) return roleDifference

  const nameDifference = (a.displayName || '').localeCompare(b.displayName || '', locale, {
    sensitivity: 'base',
    numeric: true,
  })
  if (nameDifference !== 0) return nameDifference

  return (a.memberId || a.email || a.id).localeCompare(b.memberId || b.email || b.id, locale, {
    sensitivity: 'base',
    numeric: true,
  })
}

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

type BulkImportRow = {
  name: string
  email: string
  phone?: string
  activationDate?: string
  invitedCount: number
  totalVisitHours: number
  points: number
  redeemedCigarCount: number
}

type LegacyMigrationStage = 'users' | 'reload' | 'membership' | 'visits'
type LegacyMigrationSkippedRecord = {
  row: number | null
  name: string
  phone: string
  email: string
  userId: string
  role: string
  reason: string
}
type LegacyMigrationStageResult = {
  created: number
  updated: number
  skipped: number
  failedCount: number
  skippedDetails: LegacyMigrationSkippedRecord[]
}

const parseDurationHours = (value: string) => {
  const hours = Number(value.match(/(\d+(?:\.\d+)?)\s*Hours?/i)?.[1] || 0)
  const minutes = Number(value.match(/(\d+)\s*Minutes?/i)?.[1] || 0)
  return hours + minutes / 60
}

const parseBulkImport = (text: string): BulkImportRow[] => {
  const lines = text.split(/\r?\n/).map(line => line.trim()).filter(Boolean)
  if (!lines.length) return []
  const delimiter = lines[0].includes('\t') ? '\t' : ','
  const first = lines[0].split(delimiter).map(value => value.trim().toUpperCase())
  const hasHeader = first.includes('NAME') && first.includes('EMAIL')
  const headers = hasHeader ? first : ['NAME', 'EMAIL', 'PHONE NUMBER', 'DATE::TIME', 'FRIENDS INVITE', 'TOTAL SPEND', 'WALLET BALANCE', 'REDEEMED CIGAR']
  const dataLines = hasHeader ? lines.slice(1) : lines
  const indexOf = (names: string[]) => names.map(name => headers.indexOf(name)).find(index => index >= 0) ?? -1
  const index = {
    name: indexOf(['NAME']),
    email: indexOf(['EMAIL']),
    phone: indexOf(['PHONE NUMBER', 'PHONE']),
    activationDate: indexOf(['DATE::TIME', 'ACTIVATION DATE']),
    invited: indexOf(['FRIENDS INVITE', 'INVITED COUNT']),
    duration: indexOf(['TOTAL SPEND', 'TOTAL VISIT HOURS']),
    points: indexOf(['WALLET BALANCE', 'POINTS']),
    redeemed: indexOf(['REDEEMED CIGAR', 'REDEEMED CIGARS']),
  }
  return dataLines.map(line => line.split(delimiter).map(value => value.trim())).map(values => ({
    name: values[index.name] || '',
    email: values[index.email] || '',
    phone: values[index.phone] || undefined,
    activationDate: values[index.activationDate] || undefined,
    invitedCount: Number(values[index.invited] || 0) || 0,
    totalVisitHours: parseDurationHours(values[index.duration] || ''),
    points: Number(values[index.points] || 0) || 0,
    redeemedCigarCount: Number(values[index.redeemed] || 0) || 0,
  })).filter(row => row.name || row.email)
}

const emptyBulkImportRow = (): BulkImportRow => ({
  name: '', email: '', phone: '', activationDate: '', invitedCount: 0,
  totalVisitHours: 0, points: 0, redeemedCigarCount: 0,
})

const AdminUsers: React.FC = () => {
  const virtualTableScroll = useVirtualTableScroll(980, 290)
  const tableScroll = { ...virtualTableScroll, x: 'max-content' as const }
  const { t, i18n } = useTranslation()
  const { modal, message } = App.useApp() // 使用 App.useApp() 获取 modal 实例以支持 React 19
  const { user: currentUser } = useAuthStore()
  const canBatchDelete = currentUser?.role === 'developer' || currentUser?.role === 'superAdmin'
  const canManageDiscount = currentUser?.role === 'developer' || currentUser?.role === 'superAdmin'

  const assignableRoles = (() => {
    const all = [
      { value: 'developer', label: t('auth.developer') },
      { value: 'superAdmin', label: t('auth.superAdmin') },
      { value: 'admin', label: t('auth.admin') },
      { value: 'storeAdmin', label: t('auth.storeAdmin') },
      { value: 'vip', label: t('auth.vip') },
      { value: 'member', label: t('auth.member') },
      { value: 'guest', label: t('auth.guest') },
    ]
    const myRank = ROLE_RANK[currentUser?.role ?? ''] ?? 0
    return all.filter(r => ROLE_RANK[r.value] < myRank)
  })()

  const { data: users = [], loading: usersLoading, refresh: refreshUsers } = useFirestoreQuery(getUsers)
  const { item: viewing, open: editingOpen, openDrawer: openEditing, closeDrawer: closeEditing } = useDetailDrawer<User>()
  const [closingProfile, setClosingProfile] = useState(false)
  const finishClosingProfile = () => {
    closeEditing()
    setClosingProfile(false)
  }
  const { item: resettingPassword, open: resettingPasswordOpen, openDrawer: openResettingPassword, closeDrawer: closeResettingPassword } = useDetailDrawer<User>()
  const [actionLoading, setLoading] = useState(false)
  // Keep the edit target independent of the profile modal's closing lifecycle.
  const [editor, setEditor] = useState<{ open: boolean; user: User | null }>({ open: false, user: null })
  const creating = editor.open
  const editing = editor.user
  const [bulkImportOpen, setBulkImportOpen] = useState(false)
  const [bulkImportRows, setBulkImportRows] = useState<BulkImportRow[]>([emptyBulkImportRow()])
  const [bulkImportLoading, setBulkImportLoading] = useState(false)
  const [legacyDryRunOpen, setLegacyDryRunOpen] = useState(false)
  const [legacyDryRunLoading, setLegacyDryRunLoading] = useState(false)
  const [legacyDryRunReport, setLegacyDryRunReport] = useState<LegacyMigrationWorkbookReport | null>(null)
  const [legacyMigrationPayload, setLegacyMigrationPayload] = useState<LegacyMigrationPayload | null>(null)
  const [legacyMigrationBatchId, setLegacyMigrationBatchId] = useState('')
  const [legacyMigrationStageLoading, setLegacyMigrationStageLoading] = useState<LegacyMigrationStage | null>(null)
  const [legacyMigrationResults, setLegacyMigrationResults] = useState<Partial<Record<LegacyMigrationStage, LegacyMigrationStageResult>>>({})
  const { verifyPhoneChange, verifyEmailChange, phoneVerificationModal } = usePhoneChangeVerification()
  const [deleting, setDeleting] = useState<null | User>(null)
  const [resettingPasswordLoading, setResettingPasswordLoading] = useState(false)
  const [form] = Form.useForm()
  const editorEmail = Form.useWatch('email', form)
  const emailChangeMode = Form.useWatch('emailChangeMode', form) || 'request'
  const emailChanged = !!editing && normalizeMemberEmail(editorEmail || '') !== normalizeMemberEmail(editing.email || '')
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
    () => viewing?.id ? getOrdersByUser(viewing.id) : Promise.resolve([]),
    [viewing?.id]
  )
  const { data: userEvents = [], loading: loadingEvents } = useFirestoreQuery(
    () => viewing?.id ? getEventsByUser(viewing.id) : Promise.resolve([]),
    [viewing?.id]
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
      case 'storeAdmin': return 'orange'
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
      case 'storeAdmin': return t('auth.storeAdmin')
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

  const formatMembershipExpiry = (value: unknown) => {
    if (!value) return '-'
    try {
      const date = typeof (value as any)?.toDate === 'function'
        ? (value as any).toDate()
        : new Date(value as any)
      if (Number.isNaN(date.getTime())) return '-'
      return dayjs(date).format(i18n.language === 'en-US' ? 'D MMM YYYY' : 'YYYY-MM-DD')
    } catch {
      return '-'
    }
  }

  const allColumns = [
    {
      title: t('usersAdmin.name'),
      dataIndex: 'displayName',
      key: 'displayName',
      width: 180,
      render: (_: any, record: any) => (
        <div>
          <div style={{ fontWeight: 600, color: '#FFFFFF', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{record.displayName || '-'}</div>
          <Tooltip title={currentUser?.role === 'developer' ? `UID: ${record.id}` : record.memberId}>
            <div style={{ fontSize: 11, color: '#FDE08D', fontWeight: 600, whiteSpace: 'nowrap' }}>
              {record.memberId || '-'}
            </div>
          </Tooltip>
        </div>
      ),
    },
    {
      title: t('usersAdmin.email'),
      dataIndex: 'email',
      key: 'email',
      width: 210,
      ellipsis: true,
      render: (val: string, record: User) => (
        <div style={{ minWidth: 0 }}>
          <Tooltip title={val}>
            <div style={{ color: '#FFFFFF', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{val || '-'}</div>
          </Tooltip>
          <div style={{ fontSize: 11, color: '#CCCCCC', whiteSpace: 'nowrap' }}>{record.profile?.phone || record.phone || '-'}</div>
        </div>
      )
    },
    ...(canManageDiscount ? [{
      title: t('usersAdmin.discount'),
      dataIndex: 'discount',
      key: 'discount',
      width: 72,
      responsive: ['xl'] as any,
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
      width: 105,
      render: (role: string) => {
        // ✅ VIP 标签使用金色渐变背景和黑色字体
        if (role === 'vip') {
          return (
            <Tag
              style={{
                background: 'linear-gradient(to right, #FDE08D, #C48D3A)',
                color: '#000000',
                border: 'none',
                fontWeight: 600,
                marginInlineEnd: 0,
              }}
            >
              {getRoleText(role)}
            </Tag>
          )
        }
        // 其他角色使用默认颜色
        return (
          <Tag color={getRoleColor(role)} style={{ marginInlineEnd: 0 }}>
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
      width: 175,
      render: (_: any, record: any) => {
        const status = statusMap[record.id] || record.status || 'inactive'
        return (
          <div style={{ width: '100%', minWidth: 0, overflow: 'hidden' }}>
            <Space size={4} style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', width: '100%' }}>
              <Tag color={getStatusColor(status)} style={{ marginInlineEnd: 0 }}>
                {getStatusText(status)}
              </Tag>
              <Switch
                checked={status === 'active'}
                onChange={async (checked) => {
                  const next = checked ? 'active' : 'inactive'
                  setStatusMap((m) => ({ ...m, [record.id]: next }))

                  // 会员状态只联动会员角色，管理员和开发者角色始终保持不变。
                  const updateData: Partial<User> = { status: next }
                  if (checked && (record.role === 'guest' || record.role === 'member')) {
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
            <div style={{ marginTop: 3, fontSize: 11, color: '#CCCCCC', whiteSpace: 'nowrap' }}>
              {t('usersAdmin.expiryDate')}: {formatMembershipExpiry(record.membership?.activeUntil)}
            </div>
          </div>
        )
      },
    },
    {
      title: t('usersAdmin.aiUsage'),
      key: 'aiUsageStats',
      width: 100,
      responsive: ['xl'] as any,
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
      width: 88,
      fixed: 'right' as const,
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
      const status = statusMap[u.id] || (u as any).status || 'inactive'
      const passStatus = !statusFilter || status === statusFilter

      // role筛选（客户端）
      const passRole = !roleFilter || u.role === roleFilter

      // level筛选（客户端）
      const passLevel = !levelFilter || u.membership?.level === levelFilter

      return passKw && passStatus && passRole && passLevel
    })
    return filtered.sort((a, b) => compareUsersByRoleAndName(a, b, i18n.language))
  }, [users, keyword, statusFilter, roleFilter, levelFilter, statusMap, currentUser?.role, i18n.language])

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
    return sortedKeys.map(k => ({
      key: k,
      items: groups[k].sort((a, b) => compareUsersByRoleAndName(a, b, i18n.language)),
    }))
  }, [filteredUsers, i18n.language])

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

  const handleBulkImport = async () => {
    const rows = bulkImportRows.filter(row => row.name.trim() || row.email.trim())
    if (!rows.length) {
      message.warning(t('usersAdmin.bulkImportEmpty'))
      return
    }
    const currentFirebaseUser = auth.currentUser
    if (!currentFirebaseUser) {
      message.error(t('usersAdmin.bulkImportFailed'))
      return
    }
    setBulkImportLoading(true)
    try {
      const token = await currentFirebaseUser.getIdToken()
      const response = await fetch('/.netlify/functions/bulk-create-users', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body: JSON.stringify({ rows }),
      })
      const result = await response.json() as { createdCount?: number; updatedCount?: number; failedCount?: number; error?: string }
      if (!response.ok) throw new Error(result.error || t('usersAdmin.bulkImportFailed'))
      if ((result.failedCount || 0) > 0) {
        message.warning(t('usersAdmin.bulkImportPartial', {
          created: result.createdCount || 0,
          updated: result.updatedCount || 0,
          failed: result.failedCount || 0,
        }))
      } else {
        message.success(t('usersAdmin.bulkImportSuccess', {
          created: result.createdCount || 0,
          updated: result.updatedCount || 0,
        }))
      }
      await refreshUsers()
      setBulkImportOpen(false)
      setBulkImportRows([emptyBulkImportRow()])
    } catch (error: any) {
      message.error(error?.message || t('usersAdmin.bulkImportFailed'))
    } finally {
      setBulkImportLoading(false)
    }
  }

  const updateBulkImportRow = (rowIndex: number, field: keyof BulkImportRow, value: string | number) => {
    setBulkImportRows(current => current.map((row, index) => index === rowIndex ? { ...row, [field]: value } : row))
  }

  const handleBulkTablePaste = (event: React.ClipboardEvent<HTMLDivElement>) => {
    const text = event.clipboardData.getData('text/plain')
    if (!text.includes('\t') && !text.includes('\n')) return
    const parsed = parseBulkImport(text)
    if (!parsed.length) return
    event.preventDefault()
    setBulkImportRows(parsed)
  }

  const handleLegacyWorkbookDryRun = async (file: File) => {
    setLegacyDryRunLoading(true)
    try {
      const data = await file.arrayBuffer()
      const prepared = prepareLegacyMigrationWorkbook(data, file.name)
      const digest = await crypto.subtle.digest('SHA-256', data.slice(0))
      const batchId = `legacy_${Array.from(new Uint8Array(digest)).map(byte => byte.toString(16).padStart(2, '0')).join('').slice(0, 24)}`
      const report = prepared.report
      setLegacyDryRunReport(report)
      setLegacyMigrationPayload(prepared.payload)
      setLegacyMigrationBatchId(batchId)
      setLegacyMigrationResults({})
      setLegacyDryRunOpen(true)
      if (report.sheets.missing.length) {
        message.warning(t('usersAdmin.migrationDryRunMissingSheets'))
      } else {
        message.success(t('usersAdmin.migrationDryRunComplete'))
      }
    } catch (error) {
      console.error('[LegacyMigrationDryRun] Failed:', error)
      message.error(t('usersAdmin.migrationDryRunFailed'))
    } finally {
      setLegacyDryRunLoading(false)
    }
    return false
  }

  const runLegacyMigrationStage = async (stage: LegacyMigrationStage) => {
    if (!legacyMigrationPayload || !legacyMigrationBatchId) return
    setLegacyMigrationStageLoading(stage)
    try {
      const token = await auth.currentUser?.getIdToken()
      if (!token) throw new Error(t('usersAdmin.migrationAuthenticationRequired'))
      const rows: unknown[] = stage === 'users'
        ? legacyMigrationPayload.users
        : stage === 'reload'
          ? legacyMigrationPayload.reloads
          : stage === 'membership'
            ? legacyMigrationPayload.memberships
            : legacyMigrationPayload.visits
      const chunks = <T,>(items: T[], size: number) => Array.from(
        { length: Math.ceil(items.length / size) },
        (_, index) => items.slice(index * size, (index + 1) * size),
      )
      const jobs: Array<{ rows: unknown[]; redemptions?: unknown[] }> = []
      if (stage !== 'visits') {
        chunks(rows, stage === 'users' ? 4 : 10).forEach(chunk => jobs.push({ rows: chunk }))
      } else {
        const remainingRedemptions = new Set(legacyMigrationPayload.redemptions)
        chunks(legacyMigrationPayload.visits, 10).forEach(visitChunk => {
          const matched = legacyMigrationPayload.redemptions.filter(redemption => {
            const redeemedAt = new Date(redemption.occurredAt).getTime()
            const match = visitChunk.some(visit => (
              visit.phone === redemption.phone
              && visit.lounge.trim().toLowerCase() === redemption.lounge.trim().toLowerCase()
              && redeemedAt >= new Date(visit.occurredAt).getTime()
              && redeemedAt <= new Date(visit.endedAt).getTime()
            ))
            if (match) remainingRedemptions.delete(redemption)
            return match
          })
          jobs.push({ rows: visitChunk, redemptions: matched })
        })
        chunks([...remainingRedemptions], 10).forEach(chunk => jobs.push({ rows: [], redemptions: chunk }))
      }
      if (!jobs.length) jobs.push({ rows: [], ...(stage === 'visits' ? { redemptions: [] } : {}) })

      const result: LegacyMigrationStageResult = { created: 0, updated: 0, skipped: 0, failedCount: 0, skippedDetails: [] }
      for (const job of jobs) {
        const response = await fetch('/.netlify/functions/legacy-migration', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
          body: JSON.stringify({ stage, batchId: legacyMigrationBatchId, ...job }),
        })
        const responseBody = await response.text()
        let chunkResult: Record<string, any> = {}
        try {
          chunkResult = responseBody ? JSON.parse(responseBody) : {}
        } catch {
          // Netlify gateway errors may return HTML instead of the function's JSON response.
        }
        if (!response.ok || !chunkResult.success) {
          const fallbackMessage = response.status === 504
            ? t('usersAdmin.migrationGatewayTimeout')
            : t('usersAdmin.migrationStageFailed')
          throw new Error(chunkResult.error || fallbackMessage)
        }
        result.created += Number(chunkResult.created || 0)
        result.updated += Number(chunkResult.updated || 0)
        result.skipped += Number(chunkResult.skipped || 0)
        if (Array.isArray(chunkResult.skippedDetails)) result.skippedDetails.push(...chunkResult.skippedDetails)
        result.failedCount += Number(chunkResult.failedCount || 0)
      }
      setLegacyMigrationResults(current => ({
        ...current,
        [stage]: {
          created: Number(result.created || 0),
          updated: Number(result.updated || 0),
          skipped: Number(result.skipped || 0),
          failedCount: Number(result.failedCount || 0),
          skippedDetails: result.skippedDetails,
        },
      }))
      if (stage === 'users') await refreshUsers()
      if (result.failedCount) {
        message.warning(t('usersAdmin.migrationStagePartial', { failed: result.failedCount }))
      } else {
        message.success(t('usersAdmin.migrationStageComplete'))
      }
    } catch (error: any) {
      message.error(error?.message || t('usersAdmin.migrationStageFailed'))
    } finally {
      setLegacyMigrationStageLoading(null)
    }
  }

  return (
    <div style={{
      height: isMobile ? '90vh' : 'auto',
      display: 'flex',
      flexDirection: 'column',
      overflow: isMobile ? 'hidden' : 'visible',
      paddingRight: isMobile && activeTab === 'list' ? '32px' : '0',
      paddingBottom: selectedRowKeys.length > 0 && activeTab === 'list' ? '140px' : isMobile ? '46px' : '0'
    }}>
      {phoneVerificationModal}
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
            {selectedRowKeys.length > 0 && (
              <div role="toolbar" aria-label={t('common.itemsSelected', { count: selectedRowKeys.length })} style={{
                position: 'fixed', bottom: isMobile ? 'calc(84px + env(safe-area-inset-bottom))' : 24,
                right: isMobile ? 16 : 24, width: isMobile ? 'calc(100% - 32px)' : 'max-content',
                maxWidth: isMobile ? 'calc(100% - 32px)' : 'calc(100% - 112px)',
                display: 'flex', flexWrap: 'wrap', gap: 12, alignItems: 'center',
                padding: '12px 16px', background: '#191919', border: '1px solid #C48D3A',
                borderRadius: 8, boxShadow: '0 4px 20px rgba(0,0,0,0.35)', zIndex: 1000,
              }}>
                <Text style={{ color: '#FDE08D' }}>{t('common.itemsSelected', { count: selectedRowKeys.length })}</Text>
                <Space wrap>
                  {selectedRowKeys.length > 0 && (
                    <>
                      <Button
                        loading={actionLoading}
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
                      {canBatchDelete && <Button
                        danger
                        icon={<DeleteOutlined />}
                        disabled={actionLoading}
                        onClick={async () => {
                          if (!['superAdmin', 'developer'].includes(useAuthStore.getState().user?.role || '')) return
                          modal.confirm({
                            title: t('usersAdmin.batchDeleteConfirm'),
                            content: t('usersAdmin.batchDeleteContent', { count: selectedRowKeys.length }),
                            okButtonProps: { danger: true },
                            onOk: async () => {
                              if (!['superAdmin', 'developer'].includes(useAuthStore.getState().user?.role || '')) return
                              setLoading(true)
                              try {
                                const token = await auth.currentUser?.getIdToken()
                                if (!token) throw new Error('auth-required')
                                const failed: React.Key[] = []
                                for (const id of selectedRowKeys) {
                                  try {
                                    const response = await fetch('/.netlify/functions/delete-member', {
                                      method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
                                      body: JSON.stringify({ userId: String(id) }),
                                    })
                                    const result = await response.json()
                                    if (!response.ok || !result.success) failed.push(id)
                                  } catch { failed.push(id) }
                                }
                                if (!failed.length) message.success(t('usersAdmin.batchDeleted'))
                                else message.error(t('usersAdmin.batchDeleteFailed'))
                                setSelectedRowKeys(failed)
                                await refreshUsers()
                              } catch {
                                message.error(t('usersAdmin.batchDeleteFailed'))
                              } finally {
                                setLoading(false)
                              }
                            }
                          })
                        }}
                        style={{ background: 'rgba(255, 77, 79, 0.8)', border: 'none', color: '#FFFFFF', fontWeight: 700 }}
                      >
                        {t('usersAdmin.batchDelete')}
                      </Button>}
                      <Button disabled={actionLoading} onClick={() => setSelectedRowKeys([])}>{t('common.cancel')}</Button>
                    </>
                  )}
                </Space>
              </div>
            )}

            {/* 桌面端：筛选区 */}
            {!isMobile && (
              <div style={{
                marginBottom: 8,
                padding: 12,
                background: 'rgba(255, 255, 255, 0.05)',
                borderRadius: 12,
                border: '1px solid rgba(244, 175, 37, 0.6)',
                backdropFilter: 'blur(10px)'
              }}>
                <Space size="small" wrap>
                  <Search
                    placeholder={t('usersAdmin.searchByNameOrEmail')}
                    allowClear
                    style={{ width: 260 }}
                    prefix={<SearchOutlined />}
                    value={keyword}
                    onChange={(e) => setKeyword(e.target.value)}
                    className="points-config-form"
                    size="small"
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
                    size="small"
                  >
                    <Option value="superAdmin">{t('auth.superAdmin')}</Option>
                    <Option value="admin">{t('auth.admin')}</Option>
                    <Option value="storeAdmin">{t('auth.storeAdmin')}</Option>
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
                    size="small"
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
                    size="small"
                  >
                    <Option value="active">{t('usersAdmin.active')}</Option>
                    <Option value="inactive">{t('usersAdmin.inactive')}</Option>
                  </Select>
                  <Button
                    size="small"
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
                    onClick={() => { setEditor({ open: true, user: null }); form.resetFields() }}
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
                  {currentUser?.role === 'developer' && (
                    <>
                      <Button
                        size="small"
                        icon={<UploadOutlined />}
                        onClick={() => setBulkImportOpen(true)}
                        style={{ background: 'rgba(244, 175, 37, 0.14)', border: '1px solid #C48D3A', color: '#FDE08D' }}
                      >
                        {t('usersAdmin.bulkImport')}
                      </Button>
                      <Upload
                        accept=".xlsx,.xls"
                        showUploadList={false}
                        disabled={legacyDryRunLoading}
                        beforeUpload={handleLegacyWorkbookDryRun}
                      >
                        <Button
                          size="small"
                          loading={legacyDryRunLoading}
                          icon={<SearchOutlined />}
                          style={{ background: 'rgba(255,255,255,0.06)', border: '1px solid rgba(253,224,141,0.45)', color: '#FDE08D' }}
                        >
                          {t('usersAdmin.migrationDryRun')}
                        </Button>
                      </Upload>
                    </>
                  )}
                </Space>
              </div>
            )}

            {isMobile && activeTab === 'list' && (
              <div
                onClick={() => { setEditor({ open: true, user: null }); form.resetFields() }}
                style={{
                  position: 'fixed',
                  right: 20,
                  bottom: selectedRowKeys.length > 0 ? 210 : 80,
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
              <div className="points-config-form user-management-table">
                  <Table
                    columns={columns}
                    dataSource={filteredUsers}
                    rowKey="id"
                    loading={usersLoading}
                    virtual
                    size="small"
                    rowSelection={{
                      columnWidth: 42,
                      fixed: true,
                      selectedRowKeys,
                      onChange: setSelectedRowKeys,
                    }}
                    scroll={tableScroll}
                    tableLayout="fixed"
                    pagination={{
                      pageSize: isMobile ? 10 : 20,
                      total: filteredUsers.length,
                      showSizeChanger: true,
                      showTotal: (total, range) => t('common.paginationTotal', {
                        start: range[0], end: range[1], total,
                      }),
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
                          { key: 'storeAdmin', label: t('auth.storeAdmin') },
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
                    paddingBottom: selectedRowKeys.length > 0 ? '140px' : '16px',
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
                            const status = statusMap[u.id] || (u as any).status || 'inactive'
                            const role = u.role || 'member'
                            return (
                              <div key={u.id} style={{ borderRadius: 12, border: '1px solid rgba(255,255,255,0.1)', background: 'rgba(255,255,255,0.05)', padding: 12, marginBottom: 8, backdropFilter: 'blur(6px)' }}>
                                <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: 12 }}>
                                  <Checkbox
                                    aria-label={u.displayName || u.email || u.id}
                                    checked={selectedRowKeys.includes(u.id)}
                                    disabled={actionLoading}
                                    onChange={event => setSelectedRowKeys(keys => event.target.checked ? [...keys, u.id] : keys.filter(key => key !== u.id))}
                                  />
                                  <div style={{ flex: 1, minWidth: 0 }}>
                                    <div style={{ display: 'flex', alignItems: 'center', gap: 8, minWidth: 0 }}>
                                      <Tag color={getRoleColor(role)} style={{ margin: 0, width: 108, flexShrink: 0, paddingInline: 4, textAlign: 'center', whiteSpace: 'nowrap' }}>
                                        {getRoleText(role)}
                                      </Tag>
                                      <div style={{ flex: 1, minWidth: 0, fontWeight: 700, color: '#FFFFFF', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                                        {u.displayName || '-'}
                                      </div>
                                    </div>
                                    <div style={{ marginTop: 4, fontSize: 12, color: '#CCCCCC' }}>
                                      {u.memberId && <span style={{ marginRight: 8, fontFamily: 'monospace', color: '#FDE08D', fontWeight: 500 }}>{t('usersAdmin.memberId')}: {u.memberId}</span>}
                                      <span style={{ color: '#FFFFFF' }}>{maskPhone((u as any)?.profile?.phone)}</span>
                                      {canManageDiscount && u.discount?.rate !== undefined && (
                                        <span style={{ marginLeft: 8, color: '#FDE08D', fontWeight: 600 }}>{t('usersAdmin.discount')} {u.discount.rate}%</span>
                                      )}
                                    </div>
                                    <div style={{ marginTop: 6, display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
                                      <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6, whiteSpace: 'nowrap' }}>
                                        <span style={{ width: 8, height: 8, borderRadius: 999, background: status === 'active' ? '#52c41a' : '#ff4d4f', display: 'inline-block' }} />
                                        <span style={{ fontSize: 12, color: '#FFFFFF', fontWeight: 500 }}>{getStatusText(status)}</span>
                                      </span>
                                      <span style={{ fontSize: 11, color: '#CCCCCC', whiteSpace: 'nowrap' }}>
                                        {t('usersAdmin.expiryDate')}: {formatMembershipExpiry(u.membership?.activeUntil)}
                                      </span>
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
        zIndex={2000}
        destroyOnHidden
        onCancel={() => setClosingProfile(true)}
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
        {editingOpen && viewing && (
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
                onClick={() => setClosingProfile(true)}
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
                active={editingOpen && !creating}
                closing={closingProfile}
                onCloseComplete={finishClosingProfile}
                detailDrawerWidth={480}
                user={viewing}
                readOnly={false}
                showEditButton={true}
                onEdit={async (user) => {
                  const latest = await getUserById(user.id).catch(() => null)
                  user = latest || user
                  setEditor({ open: true, user })
                  form.resetFields()
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
                    emailChangeMode: 'request',
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
        zIndex={2110}
        onCancel={() => {
          setEditor(previous => ({ ...previous, open: false }))
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
                if (!editing || normalizedPhone !== normalizePhoneNumber(editing.profile?.phone || '')) {
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
                const token = await auth.currentUser?.getIdToken()
                if (!token) throw new Error(t('usersAdmin.createAccountFailed'))
                const response = await fetch('/.netlify/functions/create-member', {
                  method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
                  body: JSON.stringify({ userId: editing.id,
                    email: normalizeMemberEmail(values.email || ''), phone: normalizedPhone }),
                })
                const result = await response.json()
                if (!response.ok || !result.success) {
                  const key = result.code === 'identity-required' ? 'usersAdmin.accountIdentityRequired'
                    : result.code === 'identity-conflict' ? 'usersAdmin.accountIdentityConflict'
                    : result.code === 'email-in-use' ? 'usersAdmin.emailInUseError'
                    : result.code === 'phone-in-use' ? 'usersAdmin.phoneInUseError' : 'usersAdmin.createAccountFailed'
                  throw new Error(t(key))
                }
                if (result.passwordSetupEmail === 'sent') message.success(t('usersAdmin.passwordSetupSent'))
                if (result.passwordSetupEmail === 'failed') message.warning(t('usersAdmin.passwordSetupFailed'))
                const email = normalizeMemberEmail(values.email || '')
                if (email !== normalizeMemberEmail(editing.email || '') && email !== normalizeMemberEmail(result.email || editing.email || '')) {
                  if (!email) throw new Error(t('profile.emailSync.required'))
                  const correction = values.emailChangeMode === 'correct'
                  if (!await verifyEmailChange({ memberName: editing.displayName, email, correction })) return
                  await updateMemberEmail(editing.id, correction ? 'correct' : 'request', email)
                  if (!correction) message.info(t('profile.emailSync.requestSaved'))
                }
                if (normalizedPhone) {
                  const currentPhone = normalizePhoneNumber(result.phone || editing.profile?.phone || '')
                  if (normalizedPhone !== normalizePhoneNumber(editing.profile?.phone || '') && normalizedPhone !== currentPhone) {
                    if (!await verifyPhoneChange({ memberName: editing.displayName || editing.email || '', phone: normalizedPhone })) return
                    await updateMemberPhone(editing.id, normalizedPhone)
                  }
                } else if (editing.profile?.phone) {
                  throw new Error(t('profile.phoneRequired'))
                }
                const res = await updateDocument<User>(COLLECTIONS.USERS, editing.id, {
                  displayName: values.displayName,
                  role: values.role,
                  membership: { ...editing.membership, level: values.level },
                  'profile.gender': values.gender || null,
                  'profile.race': values.race || null,
                  ...discountPayload,
                } as any)
                if (res.success) message.success(t('usersAdmin.saved'))
              } else {
                const token = await auth.currentUser?.getIdToken()
                if (!token) throw new Error(t('usersAdmin.createAccountFailed'))
                const response = await fetch('/.netlify/functions/create-member', {
                  method: 'POST',
                  headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
                  body: JSON.stringify({
                  displayName: values.displayName,
                  email: normalizeMemberEmail(values.email || ''),
                  phone: normalizedPhone,
                  role: values.role,
                  level: values.level,
                  gender: values.gender,
                  race: values.race,
                  ...(discountPayload.discount ? { discount: discountPayload.discount } : {}),
                  }),
                })
                const result = await response.json()
                if (!response.ok || !result.success) {
                  const errorKey = result.code === 'email-in-use' ? 'usersAdmin.emailInUseError'
                    : result.code === 'phone-in-use' ? 'usersAdmin.phoneInUseError' : 'usersAdmin.createAccountFailed'
                  throw new Error(t(errorKey))
                }
                message.success(t('usersAdmin.created'))
                if (result.passwordSetupEmail === 'sent') message.success(t('usersAdmin.passwordSetupSent'))
                if (result.passwordSetupEmail === 'failed') message.warning(t('usersAdmin.passwordSetupFailed'))
              }
              await refreshUsers()
              setEditor(previous => ({ ...previous, open: false }))
              closeEditing()
            } catch (error) {
              if (error instanceof MemberEmailError && editing) {
                const latest = await getUserById(editing.id).catch(() => null)
                if (latest) setEditor(previous => ({ ...previous, user: latest }))
              }
              message.error(error instanceof Error ? error.message : t('profile.phoneSync.failed'))
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
              { required: !editing, message: t('auth.emailRequired') },
              { type: 'email', message: t('auth.emailInvalid') },
              {
                validator: async (_, value) => {
                  // 如果没有输入，跳过验证（非必填）
                  if (!value) {
                    return Promise.resolve()
                  }

                  // ✅ 如果是编辑模式且邮箱没有改变，跳过验证
                  if (editing && normalizeMemberEmail(value) === normalizeMemberEmail(editing.email || '')) {
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

          {editing && (emailChanged || ['requested', 'awaiting-verification', 'sync-pending'].includes(editing.emailChange?.status || '') || editing.emailAuth?.verified === false) && (
            <div style={{ marginBottom: 20 }}>
              {emailChanged && <Form.Item name="emailChangeMode" label={t('profile.emailSync.mode')} initialValue="request">
                <Radio.Group options={[
                  { label: t('profile.emailSync.requestMode'), value: 'request' },
                  { label: t('profile.emailSync.correctMode'), value: 'correct' },
                ]} />
              </Form.Item>}
              {emailChanged && emailChangeMode === 'correct' && <Alert type="warning" showIcon message={t('profile.emailSync.correctionWarning')} />}
              {editing.emailAuth?.verified === false && <Tag color="warning">{t('profile.emailSync.unverified')}</Tag>}
              {editing.emailChange && ['requested', 'awaiting-verification', 'sync-pending'].includes(editing.emailChange.status) && (
                <Alert type="warning" showIcon message={editing.emailChange.status === 'sync-pending'
                  ? t('profile.emailSync.syncFailed') : t('profile.emailSync.requested', { email: editing.emailChange.email })}
                  action={editing.emailChange.status === 'sync-pending' && editing.emailChange.method === 'admin-correction' ? (
                    <Button size="small" icon={<SendOutlined />} loading={actionLoading} onClick={async () => {
                      if (!editing.emailChange || actionLoading) return
                      setLoading(true)
                      try {
                        const email = editing.emailChange.email
                        if (!await verifyEmailChange({ memberName: editing.displayName, email, correction: true })) return
                        await updateMemberEmail(editing.id, 'correct', email)
                        const latest = await getUserById(editing.id)
                        if (latest) { setEditor(previous => ({ ...previous, user: latest })); form.setFieldValue('email', latest.email) }
                        message.success(t('profile.emailSync.synced'))
                      } catch (error) { message.error(error instanceof Error ? error.message : t('profile.emailSync.failed')) }
                      finally { setLoading(false) }
                    }}>{t('profile.emailSync.retry')}</Button>
                  ) : undefined} />
              )}
            </div>
          )}

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

      {/* Developer bulk import */}
      <Modal
        title={<span style={{ color: '#FFFFFF' }}>{t('usersAdmin.bulkImport')}</span>}
        open={bulkImportOpen}
        onCancel={() => { if (!bulkImportLoading) setBulkImportOpen(false) }}
        onOk={handleBulkImport}
        okText={t('usersAdmin.bulkImportCreate')}
        confirmLoading={bulkImportLoading}
        width={getModalWidth(isMobile, 760)}
        styles={getModalThemeStyles(isMobile, true)}
      >
        <Typography.Paragraph style={{ color: 'rgba(255,255,255,0.72)', marginBottom: 12 }}>
          {t('usersAdmin.bulkImportHint')}
        </Typography.Paragraph>
        <div onPaste={handleBulkTablePaste}>
          <Table
            size="small"
            bordered
            pagination={false}
            scroll={{ x: 980, y: 320 }}
            rowKey={(_, index) => String(index)}
            dataSource={bulkImportRows}
            columns={[
              {
                title: 'NAME', dataIndex: 'name', width: 150,
                render: (value: string, _row: BulkImportRow, index: number) => (
                  <Input size="small" value={value} disabled={bulkImportLoading} onChange={event => updateBulkImportRow(index, 'name', event.target.value)} />
                ),
              },
              {
                title: 'EMAIL', dataIndex: 'email', width: 210,
                render: (value: string, _row: BulkImportRow, index: number) => (
                  <Input size="small" value={value} disabled={bulkImportLoading} onChange={event => updateBulkImportRow(index, 'email', event.target.value)} />
                ),
              },
              {
                title: 'PHONE', dataIndex: 'phone', width: 150,
                render: (value: string, _row: BulkImportRow, index: number) => (
                  <Input size="small" value={value} disabled={bulkImportLoading} onChange={event => updateBulkImportRow(index, 'phone', event.target.value)} />
                ),
              },
              {
                title: 'ACTIVATION DATE', dataIndex: 'activationDate', width: 170,
                render: (value: string, _row: BulkImportRow, index: number) => (
                  <Input size="small" value={value} disabled={bulkImportLoading} onChange={event => updateBulkImportRow(index, 'activationDate', event.target.value)} />
                ),
              },
              {
                title: 'INVITED', dataIndex: 'invitedCount', width: 90,
                render: (value: number, _row: BulkImportRow, index: number) => (
                  <InputNumber size="small" min={0} value={value} disabled={bulkImportLoading} onChange={value => updateBulkImportRow(index, 'invitedCount', value || 0)} />
                ),
              },
              {
                title: 'VISIT HOURS', dataIndex: 'totalVisitHours', width: 110,
                render: (value: number, _row: BulkImportRow, index: number) => (
                  <InputNumber size="small" min={0} step={0.01} value={value} disabled={bulkImportLoading} onChange={value => updateBulkImportRow(index, 'totalVisitHours', value || 0)} />
                ),
              },
              {
                title: 'POINTS', dataIndex: 'points', width: 90,
                render: (value: number, _row: BulkImportRow, index: number) => (
                  <InputNumber size="small" min={0} value={value} disabled={bulkImportLoading} onChange={value => updateBulkImportRow(index, 'points', value || 0)} />
                ),
              },
              {
                title: 'REDEEMED', dataIndex: 'redeemedCigarCount', width: 100,
                render: (value: number, _row: BulkImportRow, index: number) => (
                  <InputNumber size="small" min={0} value={value} disabled={bulkImportLoading} onChange={value => updateBulkImportRow(index, 'redeemedCigarCount', value || 0)} />
                ),
              },
              {
                title: '', key: 'remove', width: 48,
                render: (_: unknown, _row: BulkImportRow, index: number) => (
                  <Button type="text" danger icon={<DeleteOutlined />} disabled={bulkImportLoading || bulkImportRows.length === 1} onClick={() => setBulkImportRows(current => current.filter((_, rowIndex) => rowIndex !== index))} />
                ),
              },
            ]}
          />
        </div>
        <Space style={{ marginTop: 12 }}>
          <Button icon={<PlusOutlined />} disabled={bulkImportLoading} onClick={() => setBulkImportRows(current => [...current, emptyBulkImportRow()])}>
            {t('usersAdmin.bulkImportAddRow')}
          </Button>
          <Typography.Text style={{ color: 'rgba(255,255,255,0.55)', fontSize: 12 }}>
            {t('usersAdmin.bulkImportPasteHint')}
          </Typography.Text>
        </Space>
        <Typography.Text style={{ display: 'block', color: 'rgba(255,255,255,0.55)', marginTop: 8, fontSize: 12 }}>
          {t('usersAdmin.bulkImportSecurity')}
        </Typography.Text>
      </Modal>

      {/* Legacy migration workbook dry run */}
      <Modal
        title={<span style={{ color: '#FFFFFF' }}>{t('usersAdmin.migrationDryRunTitle')}</span>}
        open={legacyDryRunOpen}
        onCancel={() => setLegacyDryRunOpen(false)}
        width={900}
        centered
        wrapClassName="legacy-migration-modal"
        zIndex={2100}
        style={{ maxWidth: 'calc(100% - 32px)', paddingBottom: 0 }}
        styles={getModalThemeStyles(isMobile, true)}
        footer={[
          <Button key="close" onClick={() => setLegacyDryRunOpen(false)}>
            {t('common.close')}
          </Button>,
        ]}
      >
        {legacyDryRunReport && (
          <Space direction="vertical" size={16} style={{ width: '100%' }}>
            <Alert
              type={legacyDryRunReport.sheets.missing.length ? 'error' : 'info'}
              showIcon
              message={legacyDryRunReport.sheets.missing.length
                ? t('usersAdmin.migrationMissingSheets', { sheets: legacyDryRunReport.sheets.missing.join(', ') })
                : t('usersAdmin.migrationDryRunOnly')}
            />

            <Typography.Text style={{ color: 'rgba(255,255,255,0.72)' }}>
              {legacyDryRunReport.fileName}
            </Typography.Text>

            <div className="legacy-migration-summary" style={{ display: 'grid', gap: 1, border: '1px solid rgba(196,141,58,0.4)', background: 'rgba(196,141,58,0.35)' }}>
              {[
                [t('usersAdmin.migrationReadyUsers'), legacyDryRunReport.users.readyForAuth],
                [t('usersAdmin.migrationInvalidUsers'), legacyDryRunReport.users.invalidIdentity],
                [t('usersAdmin.migrationReferralPlaceholders'), legacyDryRunReport.referrals.placeholderCount],
                [t('usersAdmin.migrationCoVisitCandidates'), legacyDryRunReport.referrals.coVisitCandidatePairs],
                [t('usersAdmin.migrationWalletSnapshots'), legacyDryRunReport.wallet.snapshotUsers],
                [t('usersAdmin.migrationReloadAmount'), `RM ${legacyDryRunReport.wallet.reloadAmount.toLocaleString()}`],
                [t('usersAdmin.migrationVisitMinutes'), legacyDryRunReport.visits.completedMinutes.toLocaleString()],
                [t('usersAdmin.migrationIssues'), legacyDryRunReport.issues.length],
              ].map(([label, value]) => (
                <div key={String(label)} style={{ minWidth: 0, padding: 12, background: '#191816' }}>
                  <Typography.Text style={{ display: 'block', color: 'rgba(255,255,255,0.58)', fontSize: 12 }}>{label}</Typography.Text>
                  <Typography.Text style={{ color: '#FDE08D', fontSize: 20, fontWeight: 700 }}>{value}</Typography.Text>
                </div>
              ))}
            </div>

            <Row gutter={[12, 12]} style={{ marginInline: 0 }}>
              <Col xs={24} md={8}>
                <Typography.Text style={{ color: '#FFFFFF', fontWeight: 600 }}>{t('usersAdmin.migrationUsers')}</Typography.Text>
                <div style={{ color: 'rgba(255,255,255,0.7)', marginTop: 6 }}>
                  {t('usersAdmin.migrationUserStatusSummary', {
                    available: legacyDryRunReport.users.available,
                    pending: legacyDryRunReport.users.pending,
                    deleted: legacyDryRunReport.users.deleted,
                  })}
                </div>
              </Col>
              <Col xs={24} md={8}>
                <Typography.Text style={{ color: '#FFFFFF', fontWeight: 600 }}>{t('usersAdmin.migrationBusinessRecords')}</Typography.Text>
                <div style={{ color: 'rgba(255,255,255,0.7)', marginTop: 6 }}>
                  {t('usersAdmin.migrationBusinessSummary', {
                    fees: legacyDryRunReport.membership.successfulRows,
                    visits: legacyDryRunReport.visits.successfulRows,
                    redemptions: legacyDryRunReport.redemptions.successfulRows,
                  })}
                </div>
              </Col>
              <Col xs={24} md={8}>
                <Typography.Text style={{ color: '#FFFFFF', fontWeight: 600 }}>{t('usersAdmin.migrationReview')}</Typography.Text>
                <div style={{ color: 'rgba(255,255,255,0.7)', marginTop: 6 }}>
                  {t('usersAdmin.migrationReviewSummary', {
                    balances: legacyDryRunReport.wallet.usersRequiringBalanceReview,
                    visits: legacyDryRunReport.visits.anomalousDurationRows,
                    cigars: legacyDryRunReport.redemptions.unresolvedCigarRows,
                  })}
                </div>
              </Col>
            </Row>

            <div>
              <Typography.Text style={{ color: '#FFFFFF', fontWeight: 600 }}>{t('usersAdmin.migrationLounges')}</Typography.Text>
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, marginTop: 8 }}>
                {legacyDryRunReport.lounges.map(lounge => <Tag key={lounge} color="gold">{lounge}</Tag>)}
              </div>
            </div>

            <div>
              <Typography.Text style={{ color: '#FFFFFF', fontWeight: 600 }}>
                {t('usersAdmin.migrationStages')}
              </Typography.Text>
              <Alert
                type="warning"
                showIcon
                style={{ marginTop: 8, marginBottom: 10 }}
                message={t('usersAdmin.migrationWriteWarning')}
              />
              <Space direction="vertical" size={8} style={{ width: '100%' }}>
                {([
                  ['users', t('usersAdmin.migrationStageUsers'), legacyMigrationPayload?.users.length || 0],
                  ['reload', t('usersAdmin.migrationStageReload'), legacyMigrationPayload?.reloads.length || 0],
                  ['membership', t('usersAdmin.migrationStageMembership'), legacyMigrationPayload?.memberships.length || 0],
                  ['visits', t('usersAdmin.migrationStageVisits'), (legacyMigrationPayload?.visits.length || 0) + (legacyMigrationPayload?.redemptions.length || 0)],
                ] as Array<[LegacyMigrationStage, string, number]>).map(([stage, label, count], index) => {
                  const previousStage = (['users', 'reload', 'membership', 'visits'] as LegacyMigrationStage[])[index - 1]
                  const result = legacyMigrationResults[stage]
                  const disabled = legacyDryRunReport.sheets.missing.length > 0 || (index > 0 && !legacyMigrationResults[previousStage])
                  return (
                    <div
                      key={stage}
                      className="legacy-migration-stage"
                      style={{
                        display: 'grid',
                        alignItems: 'center',
                        gap: 10,
                        padding: 10,
                        border: '1px solid rgba(196,141,58,0.35)',
                        background: 'rgba(255,255,255,0.025)',
                      }}
                    >
                      <Typography.Text style={{ color: '#FFFFFF', fontWeight: 600 }}>
                        {index + 1}. {label} ({count})
                      </Typography.Text>
                      <Typography.Text style={{ color: result ? '#b7eb8f' : 'rgba(255,255,255,0.55)' }}>
                        {result
                          ? t('usersAdmin.migrationStageResult', result)
                          : disabled && index > 0
                            ? t('usersAdmin.migrationCompletePreviousStage')
                            : t('usersAdmin.migrationStageReady')}
                      </Typography.Text>
                      <Button
                        type="primary"
                        disabled={disabled || !!legacyMigrationStageLoading}
                        loading={legacyMigrationStageLoading === stage}
                        onClick={() => modal.confirm({
                          title: t('usersAdmin.migrationConfirmTitle', { stage: label }),
                          zIndex: 2110,
                          content: t('usersAdmin.migrationConfirmContent', { count }),
                          okText: result ? t('usersAdmin.migrationRetryStage') : t('usersAdmin.migrationRunStage'),
                          cancelText: t('common.cancel'),
                          centered: true,
                          styles: getModalThemeStyles(isMobile, true),
                          okButtonProps: { style: modalButtonStyles.primary },
                          cancelButtonProps: { style: modalButtonStyles.secondary },
                          onOk: () => runLegacyMigrationStage(stage),
                        })}
                      >
                        {result ? t('usersAdmin.migrationRetryStage') : t('usersAdmin.migrationRunStage')}
                      </Button>
                      {!!result?.skippedDetails.length && (
                        <details style={{ gridColumn: '1 / -1', minWidth: 0 }}>
                          <summary style={{ cursor: 'pointer', color: '#FDE08D' }}>
                            {t('usersAdmin.migrationSkippedDetails', { count: result.skippedDetails.length })}
                          </summary>
                          <Table<LegacyMigrationSkippedRecord>
                            size="small"
                            style={{ marginTop: 8 }}
                            dataSource={result.skippedDetails}
                            rowKey={(record, rowIndex) => `${record.userId}-${record.row ?? rowIndex}`}
                            pagination={{ pageSize: 5, showSizeChanger: false }}
                            scroll={{ x: 760 }}
                            columns={[
                              { title: t('usersAdmin.migrationLocation'), dataIndex: 'row', width: 90, render: (row: number | null) => row == null ? '-' : `#${row}` },
                              { title: t('usersAdmin.migrationSkippedRecord'), key: 'member', width: 230, render: (_: unknown, record) => (
                                <div style={{ overflowWrap: 'anywhere' }}>
                                  <div>{record.name || '-'}</div>
                                  <div>{record.phone || '-'}</div>
                                  <div>{record.email || '-'}</div>
                                </div>
                              ) },
                              { title: t('usersAdmin.migrationSkippedReason'), key: 'reason', render: (_: unknown, record) => record.reason === 'protected-role'
                                ? t('usersAdmin.migrationSkippedProtectedRole', { role: record.role })
                                : record.reason },
                            ]}
                          />
                        </details>
                      )}
                    </div>
                  )
                })}
              </Space>
            </div>

            <Table
              size="small"
              bordered
              pagination={{ pageSize: 8, showSizeChanger: false }}
              rowKey={(record, index) => `${record.code}-${record.sheet || ''}-${record.row || index}`}
              dataSource={legacyDryRunReport.issues}
              scroll={{ x: 680 }}
              columns={[
                {
                  title: t('usersAdmin.migrationSeverity'), dataIndex: 'severity', width: 90,
                  render: (severity: string) => <Tag color={severity === 'error' ? 'red' : severity === 'warning' ? 'orange' : 'blue'}>{severity.toUpperCase()}</Tag>,
                },
                { title: t('usersAdmin.migrationLocation'), key: 'location', width: 150, render: (_: unknown, record) => `${record.sheet || '-'}${record.row ? ` #${record.row}` : ''}` },
                { title: t('usersAdmin.migrationMessage'), dataIndex: 'message' },
              ]}
              locale={{ emptyText: t('usersAdmin.migrationNoIssues') }}
            />
          </Space>
        )}
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
