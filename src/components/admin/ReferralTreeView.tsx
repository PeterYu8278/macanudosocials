// 引荐关系图组件
import React, { useMemo, useState, useEffect } from 'react'
import { Card, Space, Input, Select, Button, Typography, Spin, App, Tag, Dropdown } from 'antd'
import { SearchOutlined, UserOutlined, ExpandOutlined, ShrinkOutlined, ReloadOutlined } from '@ant-design/icons'
import { useTranslation } from 'react-i18next'
import type { User } from '../../types'
import { getUsers } from '../../services/firebase/firestore'

const { Text } = Typography
const { Search } = Input
const { Option } = Select

interface ReferralNode {
  user: User
  children: ReferralNode[]
  level: number
  path: string[]
  expanded: boolean
}

interface ReferralTreeViewProps {
  users?: User[] // 可选：直接传入用户列表
}

export const ReferralTreeView: React.FC<ReferralTreeViewProps> = ({ users: propUsers }) => {
  const { t } = useTranslation()
  const { message } = App.useApp()
  const [users, setUsers] = useState<User[]>(propUsers || [])
  const [loading, setLoading] = useState(!propUsers)
  const [searchKeyword, setSearchKeyword] = useState('')
  const [filterType, setFilterType] = useState<'all' | 'hasReferrer' | 'hasReferrals'>('all')
  const [expandedNodes, setExpandedNodes] = useState<Set<string>>(new Set())
  const [selectedNodeId, setSelectedNodeId] = useState<string | null>(null)
  const [activeIndex, setActiveIndex] = useState<string>('')
  const [showBubble, setShowBubble] = useState(false)
  const [bubbleLetter, setBubbleLetter] = useState('')
  const alphaIndex = useMemo(() => {
    const letters = Array.from({ length: 26 }, (_, i) => String.fromCharCode(65 + i))
    return [...letters, '#']
  }, [])
  const [isMobile, setIsMobile] = useState<boolean>(() => {
    if (typeof window === 'undefined') return false
    return window.innerWidth < 768
  })

  // 监听窗口大小变化
  useEffect(() => {
    const update = () => setIsMobile(window.innerWidth < 768)
    update()
    window.addEventListener('resize', update)
    return () => window.removeEventListener('resize', update)
  }, [])

  // 加载用户数据
  useEffect(() => {
    if (propUsers) {
      setUsers(propUsers)
      return
    }

    const loadUsers = async () => {
      setLoading(true)
      try {
        const userList = await getUsers()
        setUsers(userList)
      } catch (error) {
        console.error('Error loading users:', error)
        message.error(t('messages.dataLoadFailed'))
      } finally {
        setLoading(false)
      }
    }
    loadUsers()
  }, [propUsers, t])

  // 构建引荐关系树
  const referralTree = useMemo(() => {
    if (users.length === 0) return []

    // 创建用户ID到用户的映射
    const userMap = new Map<string, User>()
    users.forEach(user => userMap.set(user.id, user))

    // 创建节点映射
    const nodeMap = new Map<string, ReferralNode>()

    // 初始化所有节点
    users.forEach(user => {
      nodeMap.set(user.id, {
        user,
        children: [],
        level: 0,
        path: [],
        expanded: expandedNodes.has(user.id)
      })
    })

    // 构建树结构
    const rootNodes: ReferralNode[] = []

    users.forEach(user => {
      const node = nodeMap.get(user.id)!
      const referrerId = user.referral?.referredByUserId

      if (referrerId && nodeMap.has(referrerId)) {
        // 有引荐人，添加到引荐人的children
        const referrerNode = nodeMap.get(referrerId)!
        node.level = (referrerNode.level || 0) + 1
        node.path = [...referrerNode.path, referrerId]
        referrerNode.children.push(node)
      } else {
        // 没有引荐人或引荐人不存在，作为根节点
        rootNodes.push(node)
      }
    })

    // 对每个节点的children按注册时间排序
    const sortChildren = (node: ReferralNode) => {
      node.children.sort((a, b) => {
        const dateA = a.user.createdAt instanceof Date ? a.user.createdAt : new Date(a.user.createdAt)
        const dateB = b.user.createdAt instanceof Date ? b.user.createdAt : new Date(b.user.createdAt)
        return dateB.getTime() - dateA.getTime()
      })
      node.children.forEach(sortChildren)
    }

    rootNodes.forEach(sortChildren)

    return rootNodes
  }, [users, expandedNodes])

  // 过滤和搜索
  const filteredTree = useMemo(() => {
    /**
     * 递归过滤函数
     * @param node 当前处理的节点
     * @param isParentMatch 父节点是否已匹配筛选条件（用于显示匹配项的子节点）
     */
    const filterNode = (node: ReferralNode, isParentMatch: boolean = false): ReferralNode | null => {
      const user = node.user
      const keyword = searchKeyword.trim().toLowerCase()

      // 1. 搜索关键字匹配
      const matchSearch = !keyword ||
        user.displayName?.toLowerCase().includes(keyword) ||
        user.email?.toLowerCase().includes(keyword) ||
        user.memberId?.toLowerCase().includes(keyword)

      // 2. 类型筛选匹配
      let matchType = true
      if (filterType === 'hasReferrer') {
        matchType = !!user.referral?.referredByUserId
      } else if (filterType === 'hasReferrals') {
        matchType = (user.referral?.referrals?.length || 0) > 0
      }

      const currentMatches = matchSearch && matchType
      
      // 如果自身匹配，或者作为匹配项的子节点被包含
      const shouldIncludeSelf = currentMatches || isParentMatch

      // 3. 递归处理子节点
      // 如果没有关键字搜索，且当前节点匹配了类型筛选（如“有推荐”），则允许显示其子节点
      const childrenToPassMatch = !keyword && currentMatches
      
      const filteredChildren = node.children
        .map(child => filterNode(child, childrenToPassMatch))
        .filter((child): child is ReferralNode => child !== null)

      // 4. 决定保留逻辑：自身符合显示条件，或者子孙节点中有符合条件的
      if (shouldIncludeSelf || filteredChildren.length > 0) {
        return {
          ...node,
          children: filteredChildren
        }
      }

      return null
    }

    return referralTree.map(n => filterNode(n)).filter((node): node is ReferralNode => node !== null)
  }, [referralTree, searchKeyword, filterType])

  // 按首字母对根节点分组
  const groupedRoots = useMemo(() => {
    const groups: { key: string; items: ReferralNode[] }[] = []
    const map: Record<string, ReferralNode[]> = {}

    filteredTree.forEach(node => {
      const name = node.user.displayName || ''
      let initial = name.charAt(0).toUpperCase()
      if (!/[A-Z]/.test(initial)) initial = '#'
      
      if (!map[initial]) map[initial] = []
      map[initial].push(node)
    })

    alphaIndex.forEach(letter => {
      if (map[letter]) {
        groups.push({ key: letter, items: map[letter] })
      }
    })

    return groups
  }, [filteredTree, alphaIndex])

  // 监听滚动更新高亮字母
  useEffect(() => {
    if (!isMobile) return

    const scrollArea = document.querySelector('.referral-scroll-area')
    if (!scrollArea) return

    const handleScroll = () => {
      for (const group of groupedRoots) {
        const el = document.getElementById(`ref-group-${group.key}`)
        if (el) {
          const rect = el.getBoundingClientRect()
          if (rect.top >= 0 && rect.top < 200) {
            setActiveIndex(group.key)
            break
          }
        }
      }
    }

    scrollArea.addEventListener('scroll', handleScroll)
    return () => scrollArea.removeEventListener('scroll', handleScroll)
  }, [groupedRoots, isMobile])

  // 展开/折叠节点
  const toggleNode = (nodeId: string) => {
    const newExpanded = new Set(expandedNodes)
    if (newExpanded.has(nodeId)) {
      newExpanded.delete(nodeId)
    } else {
      newExpanded.add(nodeId)
    }
    setExpandedNodes(newExpanded)
  }

  // 切换全部展开/折叠
  const toggleAll = () => {
    if (expandedNodes.size > 0) {
      setExpandedNodes(new Set())
    } else {
      const allIds = new Set<string>()
      const collectIds = (nodes: ReferralNode[]) => {
        nodes.forEach(node => {
          allIds.add(node.user.id)
          if (node.children.length > 0) {
            collectIds(node.children)
          }
        })
      }
      collectIds(referralTree) // 使用 referralTree 而不是 filteredTree 以便展开所有
      setExpandedNodes(allIds)
    }
  }

  // 渲染节点
  const renderNode = (node: ReferralNode, isRoot: boolean = false) => {
    const user = node.user
    const hasChildren = node.children.length > 0
    const isExpanded = expandedNodes.has(user.id)
    const isSelected = selectedNodeId === user.id

    const totalReferrals = user.referral?.referrals?.length || 0
    const referralPoints = user.membership?.referralPoints || 0

    return (
      <div key={user.id} style={{ position: 'relative', marginLeft: isRoot ? 0 : 24 }}>
        {/* 连接线 */}
        {!isRoot && (
          <div style={{
            position: 'absolute',
            left: -20,
            top: 0,
            width: 16,
            height: 20,
            borderLeft: '2px solid rgba(255, 215, 0, 0.3)',
            borderBottom: '2px solid rgba(255, 215, 0, 0.3)',
          }} />
        )}

        {/* 节点卡片 */}
        <Card
          size="small"
          style={{
            background: isSelected
              ? 'rgba(255, 215, 0, 0.15)'
              : 'rgba(255, 255, 255, 0.05)',
            border: isSelected
              ? '1px solid rgba(255, 215, 0, 0.5)'
              : '1px solid rgba(255, 255, 255, 0.1)',
            borderRadius: 12,
            marginBottom: 12,
            cursor: 'pointer',
            transition: 'all 0.3s ease',
            boxShadow: isSelected
              ? '0 4px 12px rgba(255, 215, 0, 0.2)'
              : '0 2px 8px rgba(0, 0, 0, 0.1)'
          }}
          onClick={() => setSelectedNodeId(isSelected ? null : user.id)}
          onMouseEnter={(e) => {
            if (!isSelected) {
              e.currentTarget.style.background = 'rgba(255, 215, 0, 0.08)'
              e.currentTarget.style.borderColor = 'rgba(255, 215, 0, 0.3)'
            }
          }}
          onMouseLeave={(e) => {
            if (!isSelected) {
              e.currentTarget.style.background = 'rgba(255, 255, 255, 0.05)'
              e.currentTarget.style.borderColor = 'rgba(255, 255, 255, 0.1)'
            }
          }}
        >
          <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: 12 }}>
            <div style={{ flex: 1, minWidth: 0 }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 4 }}>
                <UserOutlined style={{ color: '#FFD700', fontSize: 16 }} />
                <Text strong style={{ color: '#FFFFFF', fontSize: 14 }}>
                  {user.displayName || t('profile.unknownUser')}
                </Text>
                {user.memberId && (
                  <Tag color="default" style={{ fontSize: 10, padding: '0 6px', margin: 0 }}>
                    {user.memberId}
                  </Tag>
                )}
              </div>

              <Text style={{ color: 'rgba(255, 255, 255, 0.6)', fontSize: 12, display: 'block', marginBottom: 8 }}>
                {user.email}
              </Text>

              <div style={{ display: 'flex', alignItems: 'center', gap: 12, flexWrap: 'wrap' }}>
                <Text style={{ color: 'rgba(255, 255, 255, 0.6)', fontSize: 11 }}>
                  {t('profile.totalReferred')}: {totalReferrals}
                </Text>
                <Text style={{ color: 'rgba(255, 255, 255, 0.6)', fontSize: 11 }}>
                  💰 {t('profile.referralPoints')}: {referralPoints}
                </Text>
              </div>
            </div>

            {hasChildren && (
              <Button
                type="text"
                size="small"
                icon={isExpanded ? <ShrinkOutlined /> : <ExpandOutlined />}
                onClick={(e) => {
                  e.stopPropagation()
                  toggleNode(user.id)
                }}
                style={{ color: '#FFD700' }}
              />
            )}
          </div>
        </Card>

        {/* 子节点 */}
        {hasChildren && isExpanded && (
          <div style={{ marginTop: 8 }}>
            {node.children.map(child => renderNode(child, false))}
          </div>
        )}
      </div>
    )
  }

  // 统计信息
  const stats = useMemo(() => {
    const totalUsers = users.length
    const hasReferral = users.filter(u => u.referral?.referredByUserId).length
    const hasReferrals = users.filter(u => (u.referral?.referrals?.length || 0) > 0).length
    const maxDepth = Math.max(...referralTree.map(node => {
      const getDepth = (n: ReferralNode): number => {
        if (n.children.length === 0) return n.level
        return Math.max(n.level, ...n.children.map(getDepth))
      }
      return getDepth(node)
    }), 0)
    const totalReferralPoints = users.reduce((sum, u) => sum + (u.membership?.referralPoints || 0), 0)

    return {
      totalUsers,
      hasReferral,
      hasReferrals,
      maxDepth: maxDepth + 1,
      totalReferralPoints
    }
  }, [users, referralTree])

  if (loading) {
    return (
      <div style={{ textAlign: 'center', padding: '40px 20px' }}>
        <Spin size="large" />
      </div>
    )
  }

  return (
    <div>
      {/* 统计面板 */}
      <div style={{
        display: 'flex',
        gap: 8,
        marginBottom: 16,
        padding: 12,
        background: 'rgba(255, 255, 255, 0.05)',
        borderRadius: 12,
        border: '1px solid rgba(244, 175, 37, 0.6)'
      }}>
        <div 
          onClick={() => setFilterType('all')}
          style={{ 
            textAlign: 'center', 
            flex: 1, 
            cursor: 'pointer', 
            borderRadius: 8, 
            padding: '4px 0', 
            background: filterType === 'all' ? 'rgba(244, 175, 37, 0.2)' : 'transparent',
            transition: 'all 0.3s ease'
          }}
        >
          <div style={{ fontSize: 20, fontWeight: 800, color: '#FFD700' }}>{stats.totalUsers}</div>
          <div style={{ fontSize: 10, color: 'rgba(255, 255, 255, 0.6)', lineHeight: 1.2 }}>{t('usersAdmin.totalUsers')}</div>
        </div>
        <div 
          onClick={() => setFilterType('hasReferrer')}
          style={{ 
            textAlign: 'center', 
            flex: 1, 
            cursor: 'pointer', 
            borderRadius: 8, 
            padding: '4px 0', 
            background: filterType === 'hasReferrer' ? 'rgba(244, 175, 37, 0.2)' : 'transparent',
            transition: 'all 0.3s ease'
          }}
        >
          <div style={{ fontSize: 20, fontWeight: 800, color: '#FFD700' }}>{stats.hasReferral}</div>
          <div style={{ fontSize: 10, color: 'rgba(255, 255, 255, 0.6)', lineHeight: 1.2 }}>{t('usersAdmin.hasReferrer')}</div>
        </div>
        <div 
          onClick={() => setFilterType('hasReferrals')}
          style={{ 
            textAlign: 'center', 
            flex: 1, 
            cursor: 'pointer', 
            borderRadius: 8, 
            padding: '4px 0', 
            background: filterType === 'hasReferrals' ? 'rgba(244, 175, 37, 0.2)' : 'transparent',
            transition: 'all 0.3s ease'
          }}
        >
          <div style={{ fontSize: 20, fontWeight: 800, color: '#FFD700' }}>{stats.hasReferrals}</div>
          <div style={{ fontSize: 10, color: 'rgba(255, 255, 255, 0.6)', lineHeight: 1.2 }}>{t('usersAdmin.hasReferrals')}</div>
        </div>
        <div style={{ textAlign: 'center', flex: 1, padding: '4px 0' }}>
          <div style={{ fontSize: 20, fontWeight: 800, color: '#FFD700' }}>{stats.maxDepth}</div>
          <div style={{ fontSize: 10, color: 'rgba(255, 255, 255, 0.6)', lineHeight: 1.2 }}>{t('usersAdmin.maxDepth')}</div>
        </div>
        <div style={{ textAlign: 'center', flex: 1, padding: '4px 0' }}>
          <div style={{ fontSize: 20, fontWeight: 800, color: '#FFD700' }}>{stats.totalReferralPoints}</div>
          <div style={{ fontSize: 10, color: 'rgba(255, 255, 255, 0.6)', lineHeight: 1.2 }}>{t('usersAdmin.totalReferralPoints')}</div>
        </div>
      </div>

      {/* 搜索和筛选 */}
      <div style={{ marginBottom: 16 }}>
        {!isMobile ? (
          /* 桌面端：筛选区 */
          <div style={{ 
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
                value={searchKeyword}
                onChange={(e) => setSearchKeyword(e.target.value)}
                className="points-config-form"
              />
              <Button
                icon={expandedNodes.size > 0 ? <ShrinkOutlined /> : <ExpandOutlined />}
                onClick={toggleAll}
                style={{ background: 'rgba(255, 255, 255, 0.1)', border: '1px solid rgba(255, 255, 255, 0.2)', color: '#FFFFFF' }}
              >
                {expandedNodes.size > 0 ? t('usersAdmin.collapseAll') : t('usersAdmin.expandAll')}
              </Button>
              <Button
                icon={<ReloadOutlined />}
                onClick={() => window.location.reload()}
                style={{ background: 'rgba(255, 255, 255, 0.1)', border: '1px solid rgba(255, 255, 255, 0.2)', color: '#FFFFFF' }}
              >
                {t('common.refresh')}
              </Button>
            </Space>
          </div>
        ) : (
          /* 移动端：筛选区 - 同排显示 */
          <div style={{ 
            display: 'flex', 
            alignItems: 'center', 
            gap: 8, 
            paddingBottom: 12,
            borderBottom: '2px solid rgba(255, 215, 0, 0.2)'
          }}>
            <div style={{ flex: 1 }}>
              <Search
                placeholder={t('usersAdmin.searchByNameOrEmail')}
                allowClear
                style={{ width: '100%' }}
                prefix={<SearchOutlined />}
                value={searchKeyword}
                onChange={(e) => setSearchKeyword(e.target.value)}
                className="points-config-form"
              />
            </div>
            <Button 
              size="small" 
              shape="round" 
              icon={expandedNodes.size > 0 ? <ShrinkOutlined /> : <ExpandOutlined />}
              onClick={toggleAll}
              style={{ background: 'rgba(255, 255, 255, 0.1)', border: '1px solid rgba(255, 255, 255, 0.2)', color: '#FFFFFF' }}
            />
            <Button 
              size="small" 
              shape="round" 
              icon={<ReloadOutlined />}
              onClick={() => window.location.reload()}
              style={{ background: 'rgba(255, 255, 255, 0.1)', border: '1px solid rgba(255, 255, 255, 0.2)', color: '#FFFFFF' }}
            />
          </div>
        )}
      </div>

      <div 
        className="referral-scroll-area"
        style={{
          minHeight: 400,
          maxHeight: isMobile ? 'calc(100vh - 350px)' : 'calc(100vh - 400px)',
          overflowY: 'auto',
          overflowX: 'hidden',
          WebkitOverflowScrolling: 'touch',
          paddingRight: isMobile ? 30 : 4,
          position: 'relative'
        }}
      >
        {filteredTree.length === 0 ? (
          <div style={{ textAlign: 'center', padding: '40px 20px', color: 'rgba(255, 255, 255, 0.6)' }}>
            {t('usersAdmin.noReferralData')}
          </div>
        ) : (
          <div>
            {!isMobile ? (
              filteredTree.map(node => renderNode(node, true))
            ) : (
              groupedRoots.map(group => (
                <div key={group.key} id={`ref-group-${group.key}`} style={{ marginBottom: 20 }}>
                  <div style={{ color: '#f4af25', fontWeight: 600, marginBottom: 12, paddingLeft: 4, borderLeft: '3px solid #f4af25' }}>
                    {group.key}
                  </div>
                  {group.items.map(node => renderNode(node, true))}
                </div>
              ))
            )}
          </div>
        )}
      </div>

      {/* 右侧字母索引（固定居中） */}
      {isMobile && (
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
              const enabled = groupedRoots.some(g => g.key === letter)
              const isActive = letter === activeIndex
              return (
                <a
                  key={letter}
                  onClick={(e) => {
                    e.preventDefault()
                    if (!enabled) return

                    if (navigator.vibrate) navigator.vibrate(10)

                    setBubbleLetter(letter)
                    setShowBubble(true)
                    setTimeout(() => setShowBubble(false), 500)

                    const el = document.getElementById(`ref-group-${letter}`)
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

      {/* 字母气泡提示 */}
      {showBubble && isMobile && (
        <div style={{
          position: 'fixed',
          top: '50%',
          left: '50%',
          transform: 'translate(-50%, -50%)',
          width: '80px',
          height: '80px',
          background: 'rgba(244, 175, 37, 0.95)',
          borderRadius: '16px',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          fontSize: '40px',
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

      <style>{`
        @keyframes bubblePop {
          0% { transform: translate(-50%, -50%) scale(0.5); opacity: 0; }
          100% { transform: translate(-50%, -50%) scale(1); opacity: 1; }
        }
        .referral-scroll-area::-webkit-scrollbar {
          width: 0px;
          background: transparent;
        }
      `}</style>
    </div>
  )
}

