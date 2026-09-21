import React from 'react'
import dayjs from 'dayjs'
import { Button, Tag, Input, App } from 'antd'
import { ArrowLeftOutlined } from '@ant-design/icons'
import { useTranslation } from 'react-i18next'
import type { Order, User, Cigar, Transaction } from '../../../types'
import { updateDocument, COLLECTIONS } from '../../../services/firebase/firestore'
import { refundOrderPoints } from '../../../services/firebase/orders'
import { getStatusColor, getStatusText, getPaymentText, getUserName, getUserPhone } from './helpers'
import { getModalTheme } from '../../../config/modalTheme'

interface OrderDetailsProps {
  order: Order
  users: User[]
  cigars: Cigar[]
  isMobile: boolean
  isEditingInView: boolean
  onClose: () => void
  onEditToggle: () => void
  onOrderUpdate: () => void
  transactions?: Transaction[]
}

const OrderDetails: React.FC<OrderDetailsProps> = ({
  order,
  users,
  cigars,
  isMobile,
  isEditingInView,
  onClose,
  onEditToggle,
  onOrderUpdate,
  transactions
}) => {
  const { t } = useTranslation()
  const { message } = App.useApp()
  const theme = getModalTheme(true) // 使用暗色主题

  // 安全日期转换函数
  const toDateSafe = (val: any): Date | null => {
    if (!val) return null
    try {
      let v: any = val
      // Firestore Timestamp -> Date
      if (v && typeof v.toDate === 'function') {
        v = v.toDate()
      }
      // Date -> Date
      const d = v instanceof Date ? v : new Date(v)
      return isNaN(d.getTime()) ? null : d
    } catch (error) {
      return null
    }
  }

  const handleStatusUpdate = async (status: string) => {
    try {
      // 如果是取消操作，自动退还积分
      if (status === 'cancelled') {
        const result = await refundOrderPoints(order.id)
        if (!result.success) {
          message.error(result.error || t('ordersAdmin.updateFailed'))
          return
        }
        if (result.refunded && result.refunded > 0) {
          message.success(`${t('ordersAdmin.orderCancelled')} (${t('ordersAdmin.pointsRefunded', { points: result.refunded })})`)
        } else {
          // 非积分支付的订单，正常更新状态
          await updateDocument(COLLECTIONS.ORDERS, order.id, { status } as any)
          message.success(t('ordersAdmin.orderCancelled'))
        }
      } else {
        await updateDocument(COLLECTIONS.ORDERS, order.id, { status } as any)
        message.success(t(`ordersAdmin.order${status.charAt(0).toUpperCase() + status.slice(1)}`))
      }
      onOrderUpdate()
    } catch (error) {
      message.error(t('ordersAdmin.updateFailed'))
    }
  }

  const handleTrackingNumberUpdate = async (newTrackingNumber: string) => {
    if (newTrackingNumber !== order.shipping.trackingNumber) {
      try {
        await updateDocument(COLLECTIONS.ORDERS, order.id, {
          shipping: {
            ...order.shipping,
            trackingNumber: newTrackingNumber
          }
        } as any)
        message.success(t('ordersAdmin.trackingNumberUpdated'))
        onOrderUpdate()
      } catch (error) {
        message.error(t('ordersAdmin.updateFailed'))
      }
    }
  }

  return (
    <div style={{
      background: 'transparent',
      minHeight: isMobile ? '100%' : 'auto',
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
          onClick={onClose}
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
          {t('ordersAdmin.orderDetails')}
        </h1>
      </div>

      {/* Content */}
      <div style={{ padding: '0 0 0' }}>
        <div style={{ display: 'flex', flexDirection: 'column', gap: '24px', marginBottom: '30px' }}>

          {/* 商品列表 */}
          <section style={theme.content.section}>
            <h2 style={theme.content.sectionTitle}>
              {t('ordersAdmin.itemDetails')}
            </h2>
            <ul style={{ listStyle: 'none', padding: 0, margin: 0, display: 'flex', flexDirection: 'column', gap: '16px' }}>
              {order.items.map((item) => {
                const cigar = cigars.find(c => c.id === item.cigarId)
                return (
                  <li key={`${order.id}_${item.cigarId}`} style={{
                    display: 'flex',
                    alignItems: 'center',
                    gap: '16px'
                  }}>
                    <div style={{
                      width: '80px',
                      height: '80px',
                      borderRadius: '8px',
                      background: 'rgba(244, 175, 37, 0.1)',
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'center',
                      fontSize: '24px',
                      color: '#f4af25'
                    }}>
                      🚬
                    </div>
                    <div style={{ flex: 1 }}>
                      <p style={{ ...theme.text.body, fontWeight: 'bold', margin: '0 0 4px 0' }}>
                        {cigar?.name || item.cigarId}
                      </p>
                      <p style={{ ...theme.text.hint, fontSize: '12px' }}>
                        {t('ordersAdmin.item.quantity')}: {item.quantity}
                      </p>
                    </div>
                    <p style={{ ...theme.text.body, fontWeight: '600' }}>
                      RM{item.price.toFixed(2)}
                    </p>
                  </li>
                )
              })}
            </ul>
            <div style={{
              marginTop: '16px',
              paddingTop: '16px',
              borderTop: '1px solid #393328',
              display: 'flex',
              justifyContent: 'space-between',
              alignItems: 'center'
            }}>
              <p style={theme.text.secondary}>
                {t('ordersAdmin.totalAmount')}:
              </p>
              <p style={{ ...theme.text.primary, fontSize: '20px', fontWeight: 'bold' }}>
                RM{order.total.toFixed(2)}
              </p>
            </div>
          </section>

          {/* 订单信息 */}
          <section style={theme.content.section}>
            <h2 style={theme.content.sectionTitle}>
              {t('ordersAdmin.orderInfo')}
            </h2>
            <div style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
              <div style={theme.content.row}>
                <p style={theme.text.secondary}>{t('ordersAdmin.orderId')}</p>
                <p style={{ ...theme.text.body, wordBreak: 'break-all', whiteSpace: 'normal' }}>{order.id}</p>
              </div>
              <div style={theme.content.row}>
                <p style={theme.text.secondary}>{t('ordersAdmin.status.title')}</p>
                <Tag color={getStatusColor(order.status)} style={{ margin: 0 }}>
                  {getStatusText(order.status, t)}
                </Tag>
              </div>
              <div style={theme.content.row}>
                <p style={{ ...theme.text.secondary, whiteSpace: 'nowrap' }}>{t('ordersAdmin.createdAt')}</p>
                <p style={theme.text.body}>
                  {(() => {
                    const date = toDateSafe(order.createdAt)
                    return date ? dayjs(date).format('DD MMM YYYY') : '-'
                  })()}
                </p>
              </div>
              <div style={theme.content.row}>
                <p style={{ ...theme.text.secondary, whiteSpace: 'nowrap' }}>{t('ordersAdmin.payment.title')}</p>
                <p style={theme.text.body}>{getPaymentText(order.payment.method, t)}</p>
              </div>
              <div style={{ ...theme.content.row, alignItems: 'flex-start', gap: '16px' }}>
                <p style={{ ...theme.text.secondary, whiteSpace: 'nowrap', marginBottom: 0, flexShrink: 0 }}>{t('ordersAdmin.transactionIds', '交易流水记录')}</p>
                <div style={{ flex: 1, display: 'flex', flexDirection: 'column', gap: '8px', alignItems: 'flex-end' }}>
                  {(order.payment?.transactionIds || (order.payment?.transactionId ? [order.payment.transactionId] : [])).map(txId => {
                    // 如果传入了 transactions 列表，则尝试查找匹配的详细信息
                    const tx = (transactions || []).find(t => t.id === txId)
                    const relatedOrders = (tx as any)?.relatedOrders || []
                    const matchedAmount = relatedOrders.find((ro: any) => ro.orderId === order.id)?.amount

                    return (
                      <div key={txId} style={{
                        padding: '8px 12px',
                        background: 'rgba(255,255,255,0.05)',
                        borderRadius: '6px',
                        border: '1px solid rgba(255,255,255,0.1)',
                        display: 'flex',
                        justifyContent: 'space-between',
                        alignItems: 'center',
                        gap: '12px',
                        width: '100%',
                        maxWidth: '220px'
                      }}>
                        <div style={{ display: 'flex', flexDirection: 'column', gap: '2px' }}>
                          <span style={{ fontSize: '11px', fontFamily: 'monospace', color: '#f4af25' }}>{txId}</span>
                          {tx && (
                            <span style={{ fontSize: '10px', color: 'rgba(255,255,255,0.5)' }}>
                              {dayjs(toDateSafe(tx.createdAt)).format('DD MMM YYYY HH:mm')}
                            </span>
                          )}
                        </div>
                        {matchedAmount !== undefined && (
                          <span style={{ fontSize: '13px', fontWeight: 'bold', color: '#52c41a' }}>
                            RM{Number(matchedAmount).toFixed(2)}
                          </span>
                        )}
                      </div>
                    )
                  })}
                  {(order.payment?.transactionIds?.length === 0 && !order.payment?.transactionId) && (
                    <p style={{ ...theme.text.body, margin: 0 }}>-</p>
                  )}
                </div>
              </div>
              <div style={theme.content.row}>
                <p style={{ ...theme.text.secondary, whiteSpace: 'nowrap' }}>{t('ordersAdmin.paidAt')}</p>
                <p style={theme.text.body}>
                  {(() => {
                    const date = toDateSafe(order.payment?.paidAt)
                    return date ? dayjs(date).format('DD MMM YYYY HH:mm') : '-'
                  })()}
                </p>
              </div>
              <div style={{ ...theme.content.row, alignItems: 'flex-start', gap: '16px' }}>
                <p style={{ ...theme.text.secondary, whiteSpace: 'nowrap', width: '100px' }}>{t('ordersAdmin.note')}</p>
                <p style={{ ...theme.text.body, whiteSpace: 'pre-wrap', flex: 1, textAlign: 'right' }}>
                  {order.source?.note || '-'}
                </p>
              </div>
              <div style={theme.content.row}>
                <p style={{ ...theme.text.secondary, whiteSpace: 'nowrap' }}>{t('ordersAdmin.trackingNumber')}</p>
                {isEditingInView ? (
                  <Input
                    defaultValue={order.shipping.trackingNumber || ''}
                    placeholder={t('ordersAdmin.enterTrackingNo')}
                    style={{ ...(theme.input as any).base, width: '200px' }}
                    onBlur={(e) => handleTrackingNumberUpdate(e.target.value)}
                    onPressEnter={(e) => handleTrackingNumberUpdate(e.currentTarget.value)}
                  />
                ) : (
                  <p style={{ ...theme.text.body, wordBreak: 'break-all', whiteSpace: 'normal' }}>{order.shipping.trackingNumber || '-'}</p>
                )}
              </div>
            </div>
          </section>

          {/* 收货信息 */}
          <section style={theme.content.section}>
            <h2 style={theme.content.sectionTitle}>
              {t('ordersAdmin.shippingInfo')}
            </h2>
            <div style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
              <div style={theme.content.row}>
                <p style={theme.text.secondary}>{t('ordersAdmin.user')}</p>
                <p style={theme.text.body}>{getUserName(order.userId, users)}</p>
              </div>
              <div style={theme.content.row}>
                <p style={theme.text.secondary}>{t('ordersAdmin.phone')}</p>
                <p style={theme.text.body}>{getUserPhone(order.userId, users) || '-'}</p>
              </div>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', fontSize: '14px' }}>
                <p style={{ ...theme.text.secondary, whiteSpace: 'nowrap', marginRight: '16px' }}>{t('ordersAdmin.address')}</p>
                <p style={{ ...theme.text.body, textAlign: 'right' }}>{order.shipping.address || '-'}</p>
              </div>
            </div>
          </section>
        </div>
      </div>

      {/* Action Buttons */}
      <div style={{
        position: 'sticky',
        bottom: 0,
        zIndex: 10,
        background: 'rgba(24, 22, 17, 0.8)',
        backdropFilter: 'blur(10px)',
        padding: '12px 0px',
        borderTop: '1px solid #393328',
        marginTop: 'auto'
      }}>
        <div style={{
          display: 'flex',
          gap: '4px',
          maxWidth: '100%',
          overflow: 'hidden'
        }}>
          {!isEditingInView && (
            <>
              <button
                onClick={() => handleStatusUpdate('confirmed')}
                style={{ ...theme.button.primary, flex: 2, height: '40px', transition: 'all 0.2s ease' }}
              >
                {t('ordersAdmin.confirmOrder')}
              </button>
              <button
                onClick={() => handleStatusUpdate('shipped')}
                style={{ ...theme.button.primary, flex: 2, height: '40px', transition: 'all 0.2s ease' }}
              >
                {t('ordersAdmin.markShipped')}
              </button>
              <button
                onClick={() => handleStatusUpdate('delivered')}
                style={{ ...theme.button.primary, flex: 2, height: '40px', transition: 'all 0.2s ease' }}
              >
                {t('ordersAdmin.markDelivered')}
              </button>
            </>
          )}
          {!isEditingInView && (
            <button
              onClick={() => handleStatusUpdate('cancelled')}
              style={{ ...theme.button.primary, flex: 1, height: '40px', transition: 'all 0.2s ease', background: 'rgba(255, 77, 79, 0.6)', color: '#fff' }}
            >
              {t('ordersAdmin.cancelOrder')}
            </button>
          )}
          <button
            onClick={onEditToggle}
            style={{ ...theme.button.primary, flex: 1, height: '40px', transition: 'all 0.2s ease' }}
          >
            {isEditingInView ? t('common.save') : t('common.edit')}
          </button>
        </div>
      </div>
    </div>
  )
}

export default OrderDetails
