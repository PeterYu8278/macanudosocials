import React, { useMemo, useState, useEffect } from 'react'
import { Spin, Select, InputNumber, Button, App, Modal, Tag } from 'antd'
import { CheckCircleOutlined, UserOutlined, DeleteOutlined, PlusOutlined } from '@ant-design/icons'
import type { User, Cigar, Event, Order, Transaction } from '../../types'
import { updateDocument, COLLECTIONS, unregisterFromEvent, getAllOrders, getAllTransactions } from '../../services/firebase/firestore'
import { useTranslation } from 'react-i18next'

interface ParticipantsListProps {
  event: Event | null
  participantsUsers: User[]
  cigars: Cigar[]
  participantsLoading: boolean
  allocSaving: string | null
  onEventUpdate: (event: Event) => void
  onAllocSavingChange: (uid: string | null) => void
  getCigarPriceById: (cigarId: string) => number
}

const ParticipantsList: React.FC<ParticipantsListProps> = ({
  event,
  participantsUsers,
  cigars,
  participantsLoading,
  allocSaving,
  onEventUpdate,
  onAllocSavingChange,
  getCigarPriceById
}) => {
  const { t, i18n } = useTranslation()
  const lang = i18n.language?.startsWith('zh') ? 'zh' : 'en'
  const { message } = App.useApp()
  const [isMobile, setIsMobile] = useState(window.innerWidth <= 768)
  const [orders, setOrders] = useState<Order[]>([])
  const [transactions, setTransactions] = useState<Transaction[]>([])

  useEffect(() => {
    let active = true
    const loadData = async () => {
      try {
        const [ordersList, transactionsList] = await Promise.all([
          getAllOrders(),
          getAllTransactions()
        ])
        if (active) {
          setOrders(ordersList)
          setTransactions(transactionsList)
        }
      } catch (err) {
        console.error('Failed to load data in ParticipantsList:', err)
      }
    }
    loadData()
    return () => {
      active = false
    }
  }, [event])

  // 计算订单匹配状态
  const getOrderMatchStatus = (orderId: string) => {
    const order = orders.find(o => o.id === orderId)
    if (!order) return { matched: 0, total: 0, status: 'none' }
    
    const orderTotal = Number(order.total || 0)
    const matchedAmount = transactions
      .filter(t => {
        const relatedOrders = (t as any)?.relatedOrders || []
        return relatedOrders.some((ro: any) => ro.orderId === orderId)
      })
      .reduce((sum, t) => {
        const relatedOrders = (t as any)?.relatedOrders || []
        const orderMatch = relatedOrders.find((ro: any) => ro.orderId === orderId)
        return sum + (orderMatch ? Number(orderMatch.amount || 0) : 0)
      }, 0)
    
    if (matchedAmount >= orderTotal) {
      return { matched: matchedAmount, total: orderTotal, status: 'fully' }
    } else if (matchedAmount > 0) {
      return { matched: matchedAmount, total: orderTotal, status: 'partial' }
    } else {
      return { matched: matchedAmount, total: orderTotal, status: 'none' }
    }
  }

  useEffect(() => {
    const handleResize = () => setIsMobile(window.innerWidth <= 768)
    window.addEventListener('resize', handleResize)
    return () => window.removeEventListener('resize', handleResize)
  }, [])
  
  // 产品下拉：按品牌分组，并按品牌与产品名称字母排序
  const groupedCigars = useMemo(() => {
    const brandToList = new Map<string, Cigar[]>()
    cigars.forEach((c) => {
      const brand = (c as any)?.brand || 'Unknown'
      const list = brandToList.get(brand) || []
      list.push(c)
      brandToList.set(brand, list)
    })
    const sorted = Array.from(brandToList.entries())
      .sort((a, b) => a[0].toLowerCase().localeCompare(b[0].toLowerCase()))
      .map(([brand, list]) => ({
        brand,
        list: list.sort((a, b) => a.name.toLowerCase().localeCompare(b.name.toLowerCase()))
      }))
    return sorted
  }, [cigars])
  
  if (!event) return null

  const registeredParticipants = (event as any)?.participants?.registered || []

  if (participantsLoading) {
    return (
      <div style={{ textAlign: 'center', padding: 40, color: 'rgba(255, 255, 255, 0.6)' }}>
        <Spin size="large" />
        <div style={{ marginTop: 16, color: 'rgba(255, 255, 255, 0.6)' }}>{t('participants.loadingParticipants')}</div>
      </div>
    )
  }

  if (registeredParticipants.length === 0) {
    return (
      <div style={{ textAlign: 'center', padding: 40, color: 'rgba(255, 255, 255, 0.6)' }}>
        <UserOutlined style={{ fontSize: 48, marginBottom: 16, color: 'rgba(255, 255, 255, 0.6)' }} />
        <div>{t('participants.noParticipants')}</div>
      </div>
    )
  }

  return (
    <div style={{ 
      flex: 1,
      height: '100%',
      maxHeight: '100%',
      overflowY: 'auto',
      overflowX: 'hidden',
      width: '100%',
      boxSizing: 'border-box',
      display: 'flex',
      flexDirection: 'column',
      minHeight: 0
    }}>
      <div style={{ 
        display: 'grid', 
        gap: '12px',
        width: '100%',
        boxSizing: 'border-box'
      }}>
      {registeredParticipants.map((uid: string, index: number) => {
        const user = participantsUsers.find(x => x.id === uid)
        const allocation = (event as any)?.allocations?.[uid]
        const cigar = cigars.find(c => c.id === allocation?.cigarId)
        
        return (
          <div 
            key={uid} 
            style={{ 
                padding: '16px',
              background: 'rgba(255, 255, 255, 0.05)',
                borderRadius: '8px',
              border: '1px solid rgba(244, 175, 37, 0.2)',
                boxShadow: '0 2px 4px rgba(0,0,0,0.2)',
                transition: 'all 0.2s ease',
                width: '100%',
                boxSizing: 'border-box',
                overflow: 'hidden'
            }}
          >
            {/* 第一行：序号 | 名字 电话号码 | 删除按键 */}
            <div style={{ 
              display: 'flex', 
              alignItems: 'center', 
              gap: 12, 
              marginBottom: 8,
              width: '100%'
            }}>
              {/* 序号 */}
              <div style={{ 
                width: 32, 
                height: 32,
                textAlign: 'center', 
                lineHeight: '32px',
                color: '#FFFFFF', 
                fontSize: 12,
                flexShrink: 0
              }}>
                # {index + 1}
              </div>
              {/* 名字和电话号码 */}
              <div style={{ 
                display: 'flex', 
                alignItems: 'center', 
                gap: 8,
                flex: 1,
                minWidth: 0
              }}>
                <span style={{ 
                  fontWeight: 600, 
                  color: '#FFFFFF', 
                  fontSize: 13,
                  whiteSpace: 'nowrap',
                  overflow: 'hidden',
                  textOverflow: 'ellipsis'
                }}>
                  {user ? user.displayName : t('participants.unknownUser')}
                </span>
                <span style={{ 
                  fontSize: 11, 
                  color: 'rgba(255, 255, 255, 0.6)', 
                  whiteSpace: 'nowrap',
                  flexShrink: 0
                }}>
                  {user ? ((user as any)?.profile?.phone || user.email || uid) : uid}
                </span>
                  </div>
                {/* 删除参与者按钮 */}
              <div style={{ flexShrink: 0 }}>
                  <Button
                    size="small"
                    danger
                    icon={<DeleteOutlined />}
                    onClick={async () => {
                      try {
                        // 本地移除
                        const updatedParticipants = registeredParticipants.filter((id: string) => id !== uid)
                        const updatedAllocations = { ...(event as any).allocations }
                        delete updatedAllocations[uid]

                        onEventUpdate({
                          ...event,
                          participants: { ...(event as any).participants, registered: updatedParticipants },
                          allocations: updatedAllocations
                        } as Event)

                        // 远端同步
                        try {
                          const [regRes] = await Promise.all([
                            unregisterFromEvent((event as any).id, uid),
                            updateDocument(COLLECTIONS.EVENTS, (event as any).id, { allocations: updatedAllocations } as any)
                          ])
                          if (!(regRes as any)?.success) {
                            message.warning(t('participants.removeFailed'))
                          } else {
                            message.success(t('participants.removed'))
                          }
                        } catch (e) {
                          message.warning(t('participants.removeFailed'))
                        }
                      } catch (err) {
                        message.error(t('participants.removeFailed'))
                      }
                    }}
                  />
                </div>
              </div>

            {/* 第二行：订单号码 | 订单状态 */}
            {allocation?.orderId && (
              <div style={{ 
                display: 'flex', 
                alignItems: 'center', 
                justifyContent: 'space-between',
                gap: 8,
                marginBottom: 12,
                paddingLeft: 44,
                width: '100%',
                boxSizing: 'border-box'
              }}>
                <span style={{ fontSize: 11, color: 'rgba(255, 255, 255, 0.6)', whiteSpace: 'nowrap' }}>
                  ID: {allocation.orderId}
                </span>
                <div style={{ display: 'flex', gap: 6, alignItems: 'center', flexShrink: 0 }}>
                  <Tag color="green" style={{ margin: 0 }}>{t('participants.orderCreated')}</Tag>
                  {(() => {
                    const matchStatus = getOrderMatchStatus(allocation.orderId)
                    if (matchStatus.status === 'fully') {
                      return (
                        <Tag color="green" style={{ margin: 0 }}>
                          {t('financeAdmin.fullyMatched')}
                        </Tag>
                      )
                    } else if (matchStatus.status === 'partial') {
                      return (
                        <Tag color="orange" style={{ margin: 0 }}>
                          {t('financeAdmin.partialMatched')}: RM{matchStatus.matched.toFixed(2)}
                        </Tag>
                      )
                    } else {
                      return (
                        <Tag color="red" style={{ margin: 0 }}>
                          {lang === 'zh' ? '未支付' : 'Unpaid'}
                        </Tag>
                      )
                    }
                  })()}
                </div>
              </div>
            )}
            {!allocation?.orderId && (
              <div style={{ 
                display: 'flex', 
                alignItems: 'center', 
                justifyContent: 'flex-end',
                gap: 8,
                marginBottom: 12,
                paddingLeft: 44,
                width: '100%',
                boxSizing: 'border-box'
              }}>
                <Tag color="orange" style={{ margin: 0 }}>{t('participants.orderPending')}</Tag>
            </div>
            )}
            {/* 第二行：活动费用（使用活动名称，可调整数量与费用，保存到 allocations） */}
            {(event as any)?.participants?.fee > 0 && (
              <div
                style={{
                  marginBottom: 8,
                  padding: '8px',
                  background: 'rgba(244, 175, 37, 0.1)',
                  border: '1px dashed rgba(244, 175, 37, 0.3)',
                  borderRadius: 6,
              display: 'flex', 
              flexDirection: isMobile ? 'column' : 'row',
              alignItems: isMobile ? 'stretch' : 'center', 
              gap: 8,
              width: '100%',
              boxSizing: 'border-box'
                }}
              >
                {/* 名称：活动名称（与雪茄分配列宽一致） */}
                <div style={{ 
                  width: isMobile ? '100%' : 180, 
                  flexShrink: 0, 
                  color: '#FFFFFF', 
                  fontSize: 12, 
                  fontWeight: 600 
                }}>
                  {(event as any)?.title || t('events.fee')}
                </div>
                {/* 数量和价钱同排显示 */}
                <div style={{ 
                  display: 'flex', 
                  flexDirection: 'row',
                  alignItems: 'center',
                  gap: 8,
                  flex: isMobile ? '0 0 100%' : '0 0 auto'
                }}>
                {/* 数量可调，默认 1 */}
                  <div style={{ width: isMobile ? '50%' : 90, flexShrink: 0 }}>
                  <InputNumber
                    min={1}
                    max={99}
                    size="small"
                    value={(allocation as any)?.feeQuantity || 1}
                    onChange={async (val) => {
                      const qty = Number(val) || 1
                      const unitPrice = (allocation as any)?.feeUnitPrice != null
                        ? Number((allocation as any)?.feeUnitPrice)
                        : Number((event as any)?.participants?.fee || 0)
                      const feeAmount = unitPrice * qty
                      const current = (event as any)?.allocations?.[uid] || {}
                      const updated = { ...(event as any).allocations, [uid]: { ...current, feeQuantity: qty, feeUnitPrice: unitPrice, feeAmount } }
                      onAllocSavingChange(uid)
                      await updateDocument(COLLECTIONS.EVENTS, (event as any).id, { allocations: updated } as any)
                      onEventUpdate({ ...event, allocations: updated } as Event)
                      onAllocSavingChange(null)
                    }}
                    style={{ width: '100%' }}
                      controls={false}
                    addonAfter={<span style={{ color: 'rgba(255, 255, 255, 0.6)', fontSize: 11 }}>{t('participants.pieces')}</span>}
                  />
                </div>
                {/* 费用可调，默认活动 fee */}
                  <div style={{ width: isMobile ? '50%' : 100, flexShrink: 0 }}>
                  <InputNumber
                    min={0}
                    step={0.01}
                    precision={2}
                    size="small"
                    value={(() => {
                      if ((allocation as any)?.feeUnitPrice != null) return Number((allocation as any)?.feeUnitPrice)
                      return Number((event as any)?.participants?.fee || 0)
                    })()}
                    onChange={async (val) => {
                      const unitPrice = Number(val) || 0
                      const qty = (allocation as any)?.feeQuantity || 1
                      const feeAmount = unitPrice * qty
                      const current = (event as any)?.allocations?.[uid] || {}
                      const updated = { ...(event as any).allocations, [uid]: { ...current, feeUnitPrice: unitPrice, feeQuantity: qty, feeAmount } }
                      onAllocSavingChange(uid)
                      await updateDocument(COLLECTIONS.EVENTS, (event as any).id, { allocations: updated } as any)
                      onEventUpdate({ ...event, allocations: updated } as Event)
                      onAllocSavingChange(null)
                    }}
                    style={{ width: '100%' }}
                      controls={false}
                    placeholder="0.00"
                  />
                  </div>
                </div>
                {/* 末尾占位，保持与删除按钮列对齐 */}
                {!isMobile && <div style={{ width: 36, flexShrink: 0 }} />}
              </div>
            )}

            {/* 第二行：产品选择 + 数量 + 价钱 + 删除按键（支持多行） */}
            {(() => {
              const items = (allocation as any)?.items as any[] | undefined
              const ensureItemsInit = async () => {
                // 将旧的单一字段迁移为 items 数组；若不存在任何配置，则新增一条空行
                const current = (event as any)?.allocations?.[uid] || {}
                const baseItem = (current?.cigarId)
                  ? [{
                      cigarId: current.cigarId,
                      quantity: current.quantity || 1,
                      unitPrice: current.unitPrice != null ? current.unitPrice : getCigarPriceById(current.cigarId),
                      amount: (current.unitPrice != null ? current.unitPrice : getCigarPriceById(current.cigarId)) * (current.quantity || 1)
                    }]
                  : [{ cigarId: undefined, quantity: 1, unitPrice: 0, amount: 0 }]
                const updated = { ...(event as any).allocations, [uid]: { ...current, items: baseItem } }
                onAllocSavingChange(uid)
                await updateDocument(COLLECTIONS.EVENTS, (event as any).id, { allocations: updated } as any)
                onEventUpdate({ ...event, allocations: updated } as Event)
                onAllocSavingChange(null)
              }

              const renderRow = (row: any, idx: number) => (
                <div 
                  key={`${uid}-${row?.cigarId || 'row'}-${idx}`} 
                  style={{ 
                    display: 'flex', 
                    flexDirection: isMobile ? 'column' : 'row',
                    alignItems: isMobile ? 'stretch' : 'center', 
                    gap: 8, 
                    marginBottom: 8,
                    width: '100%',
                    boxSizing: 'border-box'
                  }}
                >
                  <div style={{ width: isMobile ? '100%' : 200, flexShrink: 0 }}>
                <Select
                  placeholder={t('participants.selectCigarModel')}
                  style={{ width: '100%' }}
                      value={row?.cigarId}
                  showSearch
                  optionFilterProp="children"
                  size="small"
                  onChange={async (val) => {
                        const unitPrice = getCigarPriceById(val)
                        const qty = row?.quantity || 1
                        const amount = unitPrice * qty
                    const current = (event as any)?.allocations?.[uid] || {}
                        const nextItems = [...((current?.items as any[]) || [])]
                        nextItems[idx] = { ...(nextItems[idx] || {}), cigarId: val, quantity: qty, unitPrice, amount }
                        const updated = { ...(event as any).allocations, [uid]: { ...current, items: nextItems } }
                    onAllocSavingChange(uid)
                    await updateDocument(COLLECTIONS.EVENTS, (event as any).id, { allocations: updated } as any)
                    onEventUpdate({ ...event, allocations: updated } as Event)
                    onAllocSavingChange(null)
                  }}
                  filterOption={(input, option) => {
                    const kw = (input || '').toLowerCase()
                    const text = String((option?.children as any) || '').toLowerCase()
                    return text.includes(kw)
                  }}
                >
                  {groupedCigars.map(group => (
                    <Select.OptGroup key={group.brand} label={group.brand}>
                      {group.list.map(c => (
                        <Select.Option key={c.id} value={c.id}>{c.name} - RM{c.price}</Select.Option>
                      ))}
                    </Select.OptGroup>
                  ))}
                </Select>
              </div>
                  {/* 数量、金额和删除键同排显示，手机端总宽度与产品选择下拉框一致（100%） */}
                  <div style={{ 
                    display: 'flex', 
                    flexDirection: 'row',
                    alignItems: 'center',
                    gap: 8,
                    flex: isMobile ? '0 0 100%' : '1 1 auto',
                    minWidth: 0,
                    width: isMobile ? '100%' : 'auto',
                    boxSizing: 'border-box'
                  }}>
                    <div style={{ 
                      width: isMobile ? 'calc((100% - 80px) / 2)' : 90, 
                      flexShrink: 0,
                      flexGrow: isMobile ? 0 : 0
                    }}>
                <InputNumber
                  min={1}
                  max={99}
                      value={row?.quantity || 1}
                  size="small"
                  onChange={async (val) => {
                        const qty = Number(val) || 1
                        const unitPrice = row?.unitPrice != null ? row.unitPrice : getCigarPriceById(row?.cigarId)
                        const amount = unitPrice * qty
                    const current = (event as any)?.allocations?.[uid] || {}
                        const nextItems = [...((current?.items as any[]) || [])]
                        nextItems[idx] = { ...(nextItems[idx] || {}), quantity: qty, unitPrice, amount }
                        const updated = { ...(event as any).allocations, [uid]: { ...current, items: nextItems } }
                    onAllocSavingChange(uid)
                    await updateDocument(COLLECTIONS.EVENTS, (event as any).id, { allocations: updated } as any)
                    onEventUpdate({ ...event, allocations: updated } as Event)
                    onAllocSavingChange(null)
                  }}
                  style={{ width: '100%' }}
                        controls={false}
                  addonAfter={<span style={{ color: 'rgba(255, 255, 255, 0.6)', fontSize: 11 }}>{t('participants.pieces')}</span>}
                />
              </div>
                    <div style={{ 
                      width: isMobile ? 'calc((100% - 80px) / 2)' : 100, 
                      flexShrink: 0,
                      flexGrow: isMobile ? 0 : 0
                    }}>
                <InputNumber
                  min={0}
                  step={0.01}
                  precision={2}
                  size="small"
                  value={(() => {
                        if (row?.unitPrice != null) return row.unitPrice
                        return getCigarPriceById(row?.cigarId)
                  })()}
                  onChange={async (val) => {
                        const unitPrice = Number(val) || 0
                        const qty = row?.quantity || 1
                        const amount = unitPrice * qty
                    const current = (event as any)?.allocations?.[uid] || {}
                        const nextItems = [...((current?.items as any[]) || [])]
                        nextItems[idx] = { ...(nextItems[idx] || {}), unitPrice, quantity: qty, amount }
                        const updated = { ...(event as any).allocations, [uid]: { ...current, items: nextItems } }
                    onAllocSavingChange(uid)
                    await updateDocument(COLLECTIONS.EVENTS, (event as any).id, { allocations: updated } as any)
                    onEventUpdate({ ...event, allocations: updated } as Event)
                    onAllocSavingChange(null)
                  }}
                  style={{ width: '100%' }}
                        controls={false}
                  placeholder="0.00"
                />
              </div>
                    <div style={{ 
                      display: 'flex', 
                      alignItems: 'center', 
                      justifyContent: 'flex-end', 
                      gap: 4, 
                      flexShrink: 0,
                      width: isMobile ? 'auto' : 68,
                      minWidth: isMobile ? 'auto' : 68,
                      flexGrow: 0
                    }}>
                <Button 
                  size="small" 
                  danger 
                  icon={<DeleteOutlined />}
                        style={{ width: 32, height: 24, padding: 0, display: 'flex', alignItems: 'center', justifyContent: 'center' }}
                  onClick={async () => {
                        const current = (event as any)?.allocations?.[uid] || {}
                        const nextItems = [...((current?.items as any[]) || [])]
                        nextItems.splice(idx, 1)
                        const updated = { ...(event as any).allocations, [uid]: { ...current, items: nextItems } }
                        onAllocSavingChange(uid)
                        await updateDocument(COLLECTIONS.EVENTS, (event as any).id, { allocations: updated } as any)
                        onEventUpdate({ ...event, allocations: updated } as Event)
                        onAllocSavingChange(null)
                  }}
                />
                <Button 
                  size="small"
                  icon={<PlusOutlined />}
                  style={{ width: 32, height: 24, padding: 0, display: 'flex', alignItems: 'center', justifyContent: 'center' }}
                  onClick={async () => {
                        const current = (event as any)?.allocations?.[uid] || {}
                        const nextItems = [...((current?.items as any[]) || []), { cigarId: undefined, quantity: 1, unitPrice: 0, amount: 0 }]
                        const updated = { ...(event as any).allocations, [uid]: { ...current, items: nextItems } }
                        onAllocSavingChange(uid)
                        await updateDocument(COLLECTIONS.EVENTS, (event as any).id, { allocations: updated } as any)
                        onEventUpdate({ ...event, allocations: updated } as Event)
                        onAllocSavingChange(null)
                  }}
                />
                    </div>
              </div>
            </div>
              )

              if (items && items.length > 0) {
                return (
                  <div>
                    {items.map((row, idx) => renderRow(row, idx))}
                  </div>
                )
              }

              // 未初始化 items：立即展示一行空的输入行，首次操作时迁移/初始化
              return (
                <div>
                  {renderRow({ cigarId: undefined, quantity: 1, unitPrice: 0, amount: 0 }, 0)}
                </div>
              )
            })()}

            
          </div>
        )
      })}
      </div>
    </div>
  )
}

export default ParticipantsList
