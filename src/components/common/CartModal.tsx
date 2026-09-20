// Common Cart Modal Component
import React, { useState, useEffect } from 'react'
import { Modal, Button, List, Typography, Radio, Divider, message, Select } from 'antd'
import { useNavigate } from 'react-router-dom'
import { getModalThemeStyles, getModalWidth } from '../../config/modalTheme'
import type { Cigar, Event } from '../../types'
import { CigarRatingBadge } from './CigarRatingBadge'
import { AddressSelector } from './AddressSelector'
import { getEvents } from '../../services/firebase/firestore'
import { useAuthStore } from '../../store/modules/auth'
import { createOrder } from '../../services/firebase/orders'
import { createBill } from '../../services/billplz'

const { Title, Text } = Typography

const DEFAULT_CIGAR_IMAGE = 'data:image/svg+xml;base64,PHN2ZyB3aWR0aD0iODAiIGhlaWdodD0iODAiIHZpZXdCb3g9IjAgMCA4MCA4MCIgZmlsbD0ibm9uZSIgeG1sbnM9Imh0dHA6Ly93d3cudzMub3JnLzIwMDAvc3ZnIj4KPHJlY3Qgd2lkdGg9IjgwIiBoZWlnaHQ9IjgwIiBmaWxsPSIjMzMzMzMzIi8+Cjx0ZXh0IHg9IjQwIiB5PSI0MCIgZm9udC1mYW1pbHk9IkFyaWFsLCBzYW5zLXNlcmlmIiBmb250LXNpemU9IjE0IiBmaWxsPSIjNjY2NjY2IiB0ZXh0LWFuY2hvcj0ibWlkZGxlIiBkeT0iLjNlbSI+Q2lnYXI8L3RleHQ+Cjwvc3ZnPgo='

interface CartModalProps {
  open: boolean
  onClose: () => void
  cartItems: (Cigar & { quantity: number })[]
  quantities: Record<string, number>
  cartItemCount: number
  cartTotal: number
  setQuantity: (id: string, quantity: number) => void
  addToCart: (id: string) => void
  removeFromCart: (id: string) => void
  clearCart?: () => void
  isMobile: boolean
  t: (key: string, options?: any) => string
  onCheckout?: () => void
}

export const CartModal: React.FC<CartModalProps> = ({
  open,
  onClose,
  cartItems,
  quantities,
  cartItemCount,
  cartTotal,
  setQuantity,
  addToCart,
  removeFromCart,
  clearCart,
  isMobile,
  t,
  onCheckout
}) => {
  // Mode: cart or checkout
  const [mode, setMode] = useState<'cart' | 'checkout'>('cart')
  // Payment method
  const [paymentMethod, setPaymentMethod] = useState<string>('points')
  // Delivery method
  const [deliveryMethod, setDeliveryMethod] = useState<'address' | 'event'>('address')
  // Address and event selection
  const [selectedAddressId, setSelectedAddressId] = useState<string | null>(null)
  const [selectedEventId, setSelectedEventId] = useState<string | null>(null)
  const [availableEvents, setAvailableEvents] = useState<Event[]>([])
  const [loading, setLoading] = useState(false)
  const { user } = useAuthStore()
  const navigate = useNavigate()

  // 自动选择默认地址
  useEffect(() => {
    if (user?.addresses && !selectedAddressId) {
      const defaultAddr = user.addresses.find(a => a.isDefault)
      if (defaultAddr) {
        setSelectedAddressId(defaultAddr.id)
      } else if (user.addresses.length > 0) {
        setSelectedAddressId(user.addresses[0].id)
      }
    }
  }, [user?.addresses, selectedAddressId, mode])

  // Reset mode when modal closes
  useEffect(() => {
    if (!open) {
      setMode('cart')
      setPaymentMethod('points')
      setDeliveryMethod('address')
      setSelectedAddressId(null)
      setSelectedEventId(null)
    }
  }, [open])

  // Load available events
  useEffect(() => {
    if (mode === 'checkout') {
      ; (async () => {
        try {
          const events = await getEvents()
          // Filter upcoming or ongoing events that haven't passed the deadline
          const now = new Date()
          const available = events.filter(event => {
            const isStatusValid = event.status === 'upcoming' || event.status === 'ongoing'
            const isDeadlineValid = new Date(event.schedule.registrationDeadline) >= now
            return isStatusValid && isDeadlineValid
          })
          setAvailableEvents(available)
        } catch (error) {
          console.error('Failed to load events:', error)
        }
      })()
    }
  }, [mode])

  // Confirm remove dialog state
  const [confirmRemove, setConfirmRemove] = useState<{
    visible: boolean
    itemId: string | null
    itemName: string | null
  }>({
    visible: false,
    itemId: null,
    itemName: null
  })

  // Strength translation
  const strengthMap: Record<string, string> = {
    'mild': t('inventory.mild') || 'Mild',
    'medium': t('inventory.medium') || 'Medium',
    'full': t('inventory.full') || 'Full'
  }

  const formatAddress = (address: any): string => {
    if (!address) return ''
    const stateKey = address.province?.toLowerCase().replace(/\s+/g, '') || ''
    const translatedState = t(`address.states.${stateKey}`)
    const displayState = translatedState.includes('address.states') ? address.province : translatedState
    return `${displayState} ${address.city || ''} ${address.district || ''} ${address.detail || ''} (${address.name || ''} ${address.phone || ''})`
  }

  const handleCheckout = () => {
    if (isMobile) {
      // Mobile: switch mode
      setMode('checkout')
    } else {
      // Desktop: call callback
      onClose()
      if (onCheckout) {
        onCheckout()
      }
    }
  }


  const handleConfirmCheckout = async () => {
    // 验证登录
    if (!user) {
      message.warning(t('profile.notLoggedIn'))
      navigate('/')
      return
    }

    // 验证配送方式
    if (deliveryMethod === 'address' && !selectedAddressId) {
      message.error(t('shop.selectAddress'))
      return
    }
    if (deliveryMethod === 'event' && !selectedEventId) {
      message.error(t('shop.selectEvent'))
      return
    }

    // 验证积分
    if (paymentMethod === 'points') {
      const currentPoints = user.membership?.points || 0
      if (currentPoints < cartTotal) {
        message.error(t('visitTimer.short') + ` ${Math.ceil(cartTotal - currentPoints)} ` + t('visitTimer.points'))
        return
      }
    }

    setLoading(true)
    try {
      // 构建订单数据
      const orderPayload = {
        userId: user.id,
        items: cartItems.map(item => ({
          cigarId: item.id,
          name: item.name,
          quantity: item.quantity,
          price: item.price
        })),
        total: cartTotal,
        status: 'pending' as const,
        source: {
          type: deliveryMethod === 'event' ? 'event' as const : 'direct' as const,
          eventId: selectedEventId || null
        },
        payment: {
          method: paymentMethod as any,
        },
        shipping: {
          address: deliveryMethod === 'address' && selectedAddressId 
            ? formatAddress(user.addresses?.find((a: any) => a.id === selectedAddressId))
            : (selectedEventId ? `Event Pickup: ${availableEvents.find(e => e.id === selectedEventId)?.title}` : '')
        }
      }

      // 如果是在线支付，先创建 Billplz 账单
      if (paymentMethod === 'online') {
        const billResponse = await createBill(
          cartTotal,
          `Shop Order for ${user.displayName || 'Member'}`,
          user.displayName || 'Member',
          user.email || '',
          user.phone || ''
        );

        if (billResponse.success && billResponse.data?.url) {
          // 创建待支付订单并关联 Billplz ID
          const orderResult = await createOrder({
            ...orderPayload,
            payment: {
              ...orderPayload.payment,
              billplzId: billResponse.data.id
            }
          });

          if (orderResult.success) {
            if (clearCart) {
              clearCart()
            }
            setMode('cart')
            setSelectedAddressId(null)
            setSelectedEventId(null)
            setDeliveryMethod('address')
            
            message.loading('正在跳转到支付页面...', 2);
            setTimeout(() => {
              window.location.href = billResponse.data!.url;
            }, 1000);
            return;
          } else {
            throw new Error(orderResult.error || '创建订单失败');
          }
        } else {
          throw new Error(billResponse.error || '无法初始化在线支付');
        }
      }

      // 积分支付或传统模式
      const result = await createOrder(orderPayload);
      
      if (result.success) {
        // 清空购物车
        if (clearCart) {
          clearCart()
        }
        setMode('cart')
        setSelectedAddressId(null)
        setSelectedEventId(null)
        setDeliveryMethod('address')
        onClose()
        
        // 显示成功消息
        message.success(t('shop.orderSuccess'))
      } else {
        throw new Error(result.error)
      }
    } catch (error: any) {
      console.error('Checkout error:', error)
      message.error(error.message || t('messages.operationFailed'))
    } finally {
      setLoading(false)
    }
  }

  // Handle confirm remove
  const handleConfirmRemove = () => {
    if (confirmRemove.itemId) {
      removeFromCart(confirmRemove.itemId)
    }
    setConfirmRemove({ visible: false, itemId: null, itemName: null })
  }

  // Handle cancel remove
  const handleCancelRemove = () => {
    setConfirmRemove({ visible: false, itemId: null, itemName: null })
  }

  return (
    <>
      <Modal
        title={null}
        open={open}
        onCancel={onClose}
        footer={null}
        width={getModalWidth(isMobile)}
        style={{
          top: isMobile ? 12 : 0,
          maxWidth: '100%'
        }}
        styles={{
          ...getModalThemeStyles(isMobile, true),
          body: {
            ...(getModalThemeStyles(isMobile, true)?.body || {}),
            height: isMobile ? 'calc(100vh - 24px)' : '100vh',
            maxHeight: isMobile ? 'calc(100vh - 24px)' : '100vh',
            display: 'flex',
            flexDirection: 'column',
            padding: 0
          }
        }}
        destroyOnHidden
        closable={false}
      >
        <div style={{
          display: 'flex',
          flexDirection: 'column',
          height: isMobile ? 'calc(100vh - 24px)' : '100vh',
          maxHeight: isMobile ? 'calc(100vh - 24px)' : '100vh',
          overflow: 'hidden'
        }}>
          {/* Modal Header */}
          <div style={{
            padding: '8px',
            borderBottom: '1px solid rgba(255, 215, 0, 0.2)',
            display: 'flex',
            justifyContent: 'space-between',
            alignItems: 'center',
            flexShrink: 0
          }}>
            <h2 style={{
              margin: 0,
              fontSize: '16px',
              fontWeight: 'bold',
              display: 'flex',
              alignItems: 'center'
            }}>
              {mode === 'cart' ? (
                <span style={{
                  background: 'linear-gradient(135deg, #FDE08D 0%, #C48D3A 100%)',
                  WebkitBackgroundClip: 'text',
                  color: 'transparent',
                  backgroundClip: 'text'
                } as React.CSSProperties}>
                  {t('shop.cart')} ({t('shop.items', { count: cartItemCount })})
                </span>
              ) : (
                <span style={{
                  background: 'linear-gradient(135deg, #FDE08D 0%, #C48D3A 100%)',
                  WebkitBackgroundClip: 'text',
                  color: 'transparent',
                  backgroundClip: 'text'
                } as React.CSSProperties}>
                  {t('shop.checkout')}
                </span>
              )}
            </h2>
            <Button
              type="text"
              onClick={onClose}
              style={{ color: '#999' }}
            >
              ✕
            </Button>
          </div>

          {/* Cart Content */}
          <div style={{
            flex: 1,
            padding: mode === 'checkout' ? '16px' : '8px 0',
            overflowY: 'auto',
            overflowX: 'hidden'
          }}>
            {mode === 'cart' ? (
              // Cart mode
              <>
                {cartItems.length === 0 ? (
                  // Empty state
                  <div style={{
                    textAlign: 'center',
                    padding: '60px 20px',
                    color: '#999'
                  }}>
                    <div style={{ fontSize: '64px', marginBottom: '16px' }}>🛒</div>
                    <div style={{ fontSize: '16px', color: '#c0c0c0' }}>
                      {t('shop.emptyCart')}
                    </div>
                    <div style={{ fontSize: '14px', color: '#666', marginTop: '8px' }}>
                      {t('shop.addSomeProducts')}
                    </div>
                  </div>
                ) : (
                  // Item list
                  <List
                    dataSource={cartItems}
                    renderItem={(item) => {
                      // Get flavor notes (merged from all tasting notes)
                      const flavorNotes = item.tastingNotes
                        ? [
                          ...(item.tastingNotes.foot || []),
                          ...(item.tastingNotes.body || []),
                          ...(item.tastingNotes.head || [])
                        ].filter(Boolean)
                        : []

                      return (
                        <List.Item
                          style={{
                            background: 'rgba(255, 255, 255, 0.03)',
                            borderRadius: '12px',
                            marginBottom: '12px',
                            padding: '16px',
                            border: '1px solid rgba(255, 255, 255, 0.1)'
                          }}
                        >
                          <div style={{ display: 'flex', flexDirection: 'column', gap: '12px', width: '100%' }}>
                            {/* Product Name */}
                            <Title level={5} style={{ color: '#ffffff', margin: 0 }}>
                              {item.name}
                            </Title>

                            {/* Image and Info Area */}
                            <div style={{
                              display: 'flex',
                              alignItems: 'flex-start',
                              gap: '16px'
                            }}>
                              {/* Left Image */}
                              <div style={{ position: 'relative', flexShrink: 0 }}>
                                <img
                                  alt={item.name}
                                  src={item.images?.[0] || DEFAULT_CIGAR_IMAGE}
                                  style={{
                                    width: '60px',
                                    height: '100px',
                                    objectFit: 'cover',
                                    borderRadius: '8px',
                                    border: '2px solid #B8860B'
                                  }}
                                />
                                <CigarRatingBadge rating={item.metadata?.rating} size="small" />
                              </div>

                              {/* Right Info */}
                              <div style={{ flex: 1 }}>
                                <div style={{ display: 'flex', flexDirection: 'column', gap: '4px', marginBottom: '12px' }}>
                                  {/* Origin */}
                                  {item.origin && (
                                    <Text style={{ color: '#9ca3af', fontSize: '12px' }}>
                                      {item.origin}
                                    </Text>
                                  )}
                                  {/* Size and Strength */}
                                  {(item.size || item.strength) && (
                                    <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                                      {item.size && (
                                        <Text style={{ color: '#9ca3af', fontSize: '12px' }}>
                                          {item.size}
                                        </Text>
                                      )}
                                      {item.size && item.strength && (
                                        <Text style={{ color: '#9ca3af', fontSize: '12px' }}>•</Text>
                                      )}
                                      {item.strength && (
                                        <Text style={{ color: '#9ca3af', fontSize: '12px' }}>
                                          {strengthMap[item.strength] || item.strength}
                                        </Text>
                                      )}
                                    </div>
                                  )}
                                  {/* Flavor Notes */}
                                  {flavorNotes.length > 0 && (
                                    <Text style={{ color: '#9ca3af', fontSize: '12px' }}>
                                      {flavorNotes.join('、')}
                                    </Text>
                                  )}
                                </div>

                                {/* Price, Quantity Controller and Remove */}
                                <div style={{
                                  display: 'flex',
                                  alignItems: 'center',
                                  justifyContent: 'space-between'
                                }}>
                                  <div style={{ color: '#FFD700', fontWeight: 'bold' }}>
                                    RM {item.price}
                                  </div>
                                  <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
                                    {/* Quantity Adjustment */}
                                    <div style={{
                                      display: 'flex',
                                      alignItems: 'center',
                                      gap: '4px',
                                      border: '1px solid rgba(255, 215, 0, 0.3)',
                                      borderRadius: '6px',
                                      padding: '2px 4px'
                                    }}>
                                      <button
                                        onClick={(e) => {
                                          e.stopPropagation()
                                          const currentQty = quantities[item.id] || 0
                                          if (currentQty > 1) {
                                            setQuantity(item.id, currentQty - 1)
                                          } else if (currentQty === 1) {
                                            // When quantity is 1, click minus to prompt confirm remove
                                            setConfirmRemove({
                                              visible: true,
                                              itemId: item.id,
                                              itemName: item.name
                                            })
                                          }
                                        }}
                                        style={{
                                          background: 'transparent',
                                          border: 'none',
                                          color: '#FFD700',
                                          cursor: 'pointer',
                                          padding: '4px 8px',
                                          fontSize: '16px',
                                          lineHeight: 1,
                                          display: 'flex',
                                          alignItems: 'center',
                                          justifyContent: 'center',
                                          minWidth: '24px',
                                          height: '24px'
                                        }}
                                      >
                                        −
                                      </button>
                                      <span style={{
                                        color: '#ffffff',
                                        fontSize: '14px',
                                        fontWeight: '500',
                                        minWidth: '24px',
                                        textAlign: 'center',
                                        lineHeight: '24px'
                                      }}>
                                        {item.quantity}
                                      </span>
                                      <button
                                        onClick={() => addToCart(item.id)}
                                        style={{
                                          background: 'transparent',
                                          border: 'none',
                                          color: '#FFD700',
                                          cursor: 'pointer',
                                          padding: '4px 8px',
                                          fontSize: '16px',
                                          lineHeight: 1,
                                          display: 'flex',
                                          alignItems: 'center',
                                          justifyContent: 'center',
                                          minWidth: '24px',
                                          height: '24px'
                                        }}
                                      >
                                        +
                                      </button>
                                    </div>
                                  </div>
                                </div>
                              </div>
                            </div>
                          </div>
                        </List.Item>
                      )
                    }}
                  />
                )}
              </>
            ) : (
              // Checkout mode
              <div style={{ display: 'flex', flexDirection: 'column', gap: '20px' }}>
                {/* Order Summary */}
                <div>
                  <h3 style={{
                    margin: '0 0 12px 0',
                    fontSize: '16px',
                    fontWeight: '600',
                    color: '#fff'
                  }}>
                    {t('shop.orderSummary')}
                  </h3>
                  <div style={{
                    background: 'rgba(255, 255, 255, 0.03)',
                    borderRadius: '8px',
                    padding: '12px',
                    border: '1px solid rgba(255, 255, 255, 0.1)'
                  }}>
                    {cartItems.map((item) => (
                      <div
                        key={item.id}
                        style={{
                          display: 'flex',
                          justifyContent: 'space-between',
                          alignItems: 'center',
                          padding: '8px 0',
                          borderBottom: '1px solid rgba(255, 255, 255, 0.05)'
                        }}
                      >
                        <div style={{ flex: 1 }}>
                          <div style={{ color: '#fff', fontSize: '14px', fontWeight: '500' }}>
                            {item.name}
                          </div>
                          <div style={{ color: '#999', fontSize: '12px', marginTop: '4px' }}>
                            {item.size && `${item.size} • `}
                            {item.strength && (strengthMap[item.strength] || item.strength)}
                          </div>
                        </div>
                        <div style={{
                          display: 'flex',
                          alignItems: 'center',
                          gap: '12px',
                          marginLeft: '16px'
                        }}>
                          <span style={{ color: '#999', fontSize: '12px' }}>
                            ×{item.quantity}
                          </span>
                          <span style={{ color: '#FFD700', fontWeight: 'bold', fontSize: '14px', minWidth: '60px', textAlign: 'right' }}>
                            RM {item.price * item.quantity}
                          </span>
                        </div>
                      </div>
                    ))}
                  </div>
                </div>

                {/* Delivery Method Selection */}
                <div>
                  <h3 style={{
                    margin: '0 0 12px 0',
                    fontSize: '16px',
                    fontWeight: '600',
                    color: '#fff'
                  }}>
                    {t('shop.deliveryMethod')}
                  </h3>
                  <Button.Group style={{ width: '100%', display: 'flex', marginBottom: '12px' }}>
                    <Button
                      type={deliveryMethod === 'address' ? 'primary' : 'default'}
                      onClick={() => {
                        setDeliveryMethod('address')
                        setSelectedEventId(null)
                      }}
                      style={{
                        flex: 1,
                        height: '44px',
                        fontSize: '14px',
                        background: deliveryMethod === 'address'
                          ? 'linear-gradient(135deg, #FDE08D 0%, #C48D3A 100%)'
                          : 'rgba(255, 255, 255, 0.03)',
                        border: deliveryMethod === 'address'
                          ? 'none'
                          : '1px solid rgba(255, 255, 255, 0.1)',
                        color: deliveryMethod === 'address' ? '#000' : '#fff',
                        fontWeight: deliveryMethod === 'address' ? 'bold' : 'normal',
                        cursor: 'pointer',
                        zIndex: 1
                      }}
                    >
                      {t('shop.homeDelivery')}
                    </Button>
                    <Button
                      type={deliveryMethod === 'event' ? 'primary' : 'default'}
                      onClick={() => {
                        setDeliveryMethod('event')
                        setSelectedAddressId(null)
                      }}
                      style={{
                        flex: 1,
                        height: '44px',
                        fontSize: '14px',
                        background: deliveryMethod === 'event'
                          ? 'linear-gradient(135deg, #FDE08D 0%, #C48D3A 100%)'
                          : 'rgba(255, 255, 255, 0.03)',
                        border: deliveryMethod === 'event'
                          ? 'none'
                          : '1px solid rgba(255, 255, 255, 0.1)',
                        color: deliveryMethod === 'event' ? '#000' : '#fff',
                        fontWeight: deliveryMethod === 'event' ? 'bold' : 'normal',
                        cursor: 'pointer',
                        zIndex: 1
                      }}
                    >
                      {t('shop.eventPickup')}
                    </Button>
                  </Button.Group>

                  {/* Address Selection */}
                  {deliveryMethod === 'address' && (
                    <div style={{ marginBottom: '12px' }}>
                      <AddressSelector
                        value={selectedAddressId || undefined}
                        onChange={(addressId) => setSelectedAddressId(addressId)}
                        allowCreate={true}
                        showSelect={true}
                      />
                    </div>
                  )}

                  {/* Event Selection */}
                  {deliveryMethod === 'event' && (
                    <div style={{ marginBottom: '12px' }}>
                      <Select
                        value={selectedEventId || undefined}
                        onChange={(eventId) => setSelectedEventId(eventId)}
                        placeholder={t('shop.selectEvent')}
                        style={{ width: '100%' }}
                        loading={availableEvents.length === 0}
                        className="dark-theme-form"
                        dropdownClassName="dark-theme-form"
                      >
                        {availableEvents.map(event => (
                          <Select.Option key={event.id} value={event.id}>
                            {event.title} - {event.location.name}
                          </Select.Option>
                        ))}
                      </Select>
                    </div>
                  )}
                </div>


                <Divider style={{ margin: '8px 0', borderColor: 'rgba(255, 215, 0, 0.2)' }} />
              </div>
            )}
          </div>

          {/* Bottom Action Bar */}
          {mode === 'cart' && cartItems.length > 0 && (
            <div style={{
              padding: '11px 14px',
              borderTop: '1px solid rgba(255, 215, 0, 0.2)',
              flexShrink: 0,
              display: 'flex',
              flexDirection: 'column',
              alignItems: 'center',
              background: 'rgba(0, 0, 0, 0.3)'
            }}>
              {/* Total */}
              <div style={{
                display: 'flex',
                justifyContent: 'space-between',
                alignItems: 'center',
                marginBottom: '11px',
                width: '100%'
              }}>
                <span style={{ fontSize: '11px', color: '#c0c0c0' }}>{t('shop.total')}：</span>
                <span style={{ fontSize: '17px', color: '#F4AF25', fontWeight: 'bold' }}>
                  RM {cartTotal.toFixed(2)}
                </span>
              </div>

              {/* Action Buttons */}
              <div style={{ display: 'flex', justifyContent: 'center', width: '100%' }}>
                <Button
                  type="primary"
                  onClick={handleCheckout}
                  style={{
                    background: 'linear-gradient(135deg, #FDE08D 0%, #C48D3A 100%)',
                    border: 'none',
                    color: '#000',
                    fontWeight: 'bold',
                    width: '100%',
                    height: '31px',
                    fontSize: '11px'
                  }}
                >
                  {t('shop.checkout')}
                </Button>
              </div>
            </div>
          )}

          {/* Checkout Mode Bottom Action Bar */}
          {mode === 'checkout' && cartItems.length > 0 && (
            <div style={{
              padding: '11px 14px',
              borderTop: '1px solid rgba(255, 215, 0, 0.2)',
              flexShrink: 0,
              display: 'flex',
              flexDirection: 'column',
              alignItems: 'center',
              background: 'rgba(0, 0, 0, 0.3)'
            }}>
              {/* 支付方式 */}
              <div style={{ width: '100%', marginBottom: '12px' }}>
                <Button.Group style={{ width: '100%', display: 'flex' }}>
                  <Button
                    type={paymentMethod === 'points' ? 'primary' : 'default'}
                    onClick={() => setPaymentMethod('points')}
                    style={{
                      flex: 1,
                      height: '44px',
                      fontSize: '14px',
                      background: paymentMethod === 'points'
                        ? 'linear-gradient(135deg, #FDE08D 0%, #C48D3A 100%)'
                        : 'rgba(255, 255, 255, 0.03)',
                      border: paymentMethod === 'points'
                        ? 'none'
                        : '1px solid rgba(255, 255, 255, 0.1)',
                      color: paymentMethod === 'points' ? '#000' : '#fff',
                      fontWeight: paymentMethod === 'points' ? 'bold' : 'normal'
                    }}
                  >
                    {t('shop.pointsRedemption')}
                  </Button>
                  <Button
                    type={paymentMethod === 'online' ? 'primary' : 'default'}
                    onClick={() => setPaymentMethod('online')}
                    style={{
                      flex: 1,
                      height: '44px',
                      fontSize: '14px',
                      background: paymentMethod === 'online'
                        ? 'linear-gradient(135deg, #FDE08D 0%, #C48D3A 100%)'
                        : 'rgba(255, 255, 255, 0.03)',
                      border: paymentMethod === 'online'
                        ? 'none'
                        : '1px solid rgba(255, 255, 255, 0.1)',
                      color: paymentMethod === 'online' ? '#000' : '#fff',
                      fontWeight: paymentMethod === 'online' ? 'bold' : 'normal'
                    }}
                  >
                    {t('shop.onlinePayment')}
                  </Button>
                </Button.Group>
              </div>

              {/* Total */}
              <div style={{
                display: 'flex',
                justifyContent: 'space-between',
                alignItems: 'center',
                marginBottom: '11px',
                width: '100%'
              }}>
                <span style={{ fontSize: '11px', color: '#c0c0c0' }}>{t('shop.total')}：</span>
                <span style={{ fontSize: '17px', color: '#F4AF25', fontWeight: 'bold' }}>
                  RM {cartTotal.toFixed(2)}
                </span>
              </div>

              {/* Action Buttons */}
              <div style={{ display: 'flex', gap: '8px', width: '100%' }}>
                <Button
                  onClick={() => setMode('cart')}
                  style={{
                    flex: 1,
                    height: '31px',
                    background: 'rgba(255, 255, 255, 0.1)',
                    border: '1px solid rgba(255, 255, 255, 0.2)',
                    color: '#fff',
                    fontSize: '11px',
                    fontWeight: '500'
                  }}
                >
                  {t('shop.back')}
                </Button>
                <Button
                  type="primary"
                  onClick={handleConfirmCheckout}
                  loading={loading}
                  disabled={loading}
                  style={{
                    flex: 2,
                    height: '31px',
                    background: 'linear-gradient(135deg, #FDE08D 0%, #C48D3A 100%)',
                    border: 'none',
                    color: '#000',
                    fontSize: '11px',
                    fontWeight: 'bold'
                  }}
                >
                  {t('shop.confirmCheckout')}
                </Button>
              </div>
            </div>
          )}
        </div>
      </Modal>

      {/* Confirm Remove Dialog */}
      <Modal
        title={t('shop.confirmRemove')}
        open={confirmRemove.visible}
        onOk={handleConfirmRemove}
        onCancel={handleCancelRemove}
        okText={t('common.confirm') || 'Confirm'}
        cancelText={t('common.cancel') || 'Cancel'}
        centered
        zIndex={3000}
        okButtonProps={{
          style: {
            background: 'linear-gradient(135deg, #FDE08D 0%, #C48D3A 100%)',
            border: 'none',
            color: '#000',
            fontWeight: 'bold'
          }
        }}
        cancelButtonProps={{
          style: {
            border: '1px solid rgba(244, 175, 37, 0.6)',
            background: 'rgba(255, 255, 255, 0.1)',
            color: '#ffffff'
          }
        }}
        styles={{
          ...getModalThemeStyles(isMobile, true),
          mask: {
            ...(getModalThemeStyles(isMobile, true)?.mask || {}),
            zIndex: 2999
          },
          wrapper: {
            zIndex: 3000
          }
        }}
        getContainer={document.body}
      >
        <p style={{
          color: '#FFFFFF',
          fontSize: '14px',
          margin: 0,
          lineHeight: '1.6'
        }}>
          {t('shop.confirmRemoveText', { name: confirmRemove.itemName })}
        </p>
      </Modal>
    </>
  )
}
