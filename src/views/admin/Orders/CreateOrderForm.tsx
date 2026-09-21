import React, { useState, useEffect, useMemo } from 'react'
import dayjs from 'dayjs'
import { Form, Select, DatePicker, InputNumber, Input, Button } from 'antd'
import { PlusOutlined, DeleteOutlined } from '@ant-design/icons'
import { useTranslation } from 'react-i18next'
import type { User, Cigar } from '../../../types'
import { createDirectSaleOrder } from '../../../services/firebase/firestore'
import { groupCigarsByBrand } from './helpers'
import { getModalTheme } from '../../../config/modalTheme'

interface CreateOrderFormProps {
  users: User[]
  cigars: Cigar[]
  onCreateSuccess: () => void
  onCreateError: (error: string) => void
  onCancel: () => void
  loading: boolean
}

const CreateOrderForm: React.FC<CreateOrderFormProps> = ({
  users,
  cigars,
  onCreateSuccess,
  onCreateError,
  onCancel,
  loading
}) => {
  const { t } = useTranslation()
  const [form] = Form.useForm()
  const groupedCigars = groupCigarsByBrand(cigars)
  const itemsWatch = Form.useWatch('items', form)
  const userIdWatch = Form.useWatch('userId', form)
  const theme = getModalTheme()
  const [isMobile, setIsMobile] = useState(window.innerWidth <= 768)

  const discountRate = useMemo(() => {
    const user = users.find(u => u.id === userIdWatch)
    const rate = user?.discount?.rate
    return typeof rate === 'number' ? rate : undefined
  }, [userIdWatch, users])

  const applyDiscount = (price: number) => {
    if (discountRate === undefined) return price
    const discounted = price * (1 - discountRate / 100)
    return Number(discounted.toFixed(2))
  }

  useEffect(() => {
    const handleResize = () => {
      setIsMobile(window.innerWidth <= 768)
    }
    window.addEventListener('resize', handleResize)
    return () => window.removeEventListener('resize', handleResize)
  }, [])

  // 当用户切换或折扣变动时，自动为已选择商品应用折扣价
  useEffect(() => {
    const items = form.getFieldValue('items') || []
    if (!Array.isArray(items) || items.length === 0) return

    const next = items.map((it: any) => {
      if (!it?.cigarId) return it
      const cigar = cigars.find(c => c.id === it.cigarId)
      if (!cigar) return it
      const target = applyDiscount(cigar.price)
      return Number(it.price) !== target ? { ...it, price: target } : it
    })

    const changed = next.some((it: any, idx: number) => it !== items[idx])
    if (changed) {
      form.setFieldsValue({ items: next })
    }
  }, [discountRate, cigars, form])

  const computeSummary = () => {
    const items = Array.isArray(itemsWatch) ? itemsWatch : []
    let totalQty = 0
    let totalAmount = 0
    const lines: Array<{ key: string; name: string; qty: number; unit: number; sum: number }> = []
    // 分组统计（仅对有 cigarId 的商品进行分组展示，自定义费用不计入分组）
    const brandGroups = new Map<string, Array<{ key: string; name: string; qty: number; unit: number; sum: number }>>()
    const productSubtotal = { amount: 0, qty: 0 }
    for (const it of items) {
      const qty = Number(it?.quantity || 0)
      const unit = Number(it?.price || 0)
      if (qty <= 0) continue
      const id = String(it?.cigarId || '')
      const name = id ? (cigars.find(c => c.id === id)?.name || id) : t('ordersAdmin.customFee')
      const sum = qty * unit
      totalQty += qty
      totalAmount += sum
      lines.push({ key: id || `fee-${lines.length}`, name, qty, unit, sum })
      if (id) {
        const cigar = cigars.find(c => c.id === id)
        const brand = cigar?.brand || 'Others'
        const arr = brandGroups.get(brand) || []
        arr.push({ key: id, name, qty, unit, sum })
        brandGroups.set(brand, arr)
        productSubtotal.amount += sum
        productSubtotal.qty += qty
      }
    }
    return { totalQty, totalAmount, lines, brandGroups, productSubtotal }
  }

  const handleSubmit = async (values: any) => {
    const userId: string = values.userId
    const items: { cigarId?: string; quantity: number; price?: number }[] = (values.items || [])
      .filter((it: any) => (it?.quantity > 0) && (it?.price > 0 || it?.cigarId))
    
    if (!userId) {
      onCreateError(t('ordersAdmin.pleaseSelectUser'))
      return
    }
    
    if (items.length === 0) {
      onCreateError(t('ordersAdmin.pleaseAddAtLeastOneItem'))
      return
    }
    
    const createdAt: Date = values.createdAt && typeof (values.createdAt as any)?.toDate === 'function' 
      ? (values.createdAt as any).toDate() 
      : dayjs().toDate()

    try {
      const res = await createDirectSaleOrder({ userId, items, note: values.note, createdAt })
      
      if (res.success) {
        onCreateSuccess()
        form.resetFields()
      } else {
        onCreateError(t('ordersAdmin.createFailed'))
      }
    } catch (error) {
      onCreateError(t('ordersAdmin.createFailed'))
    }
  }

  return (
    <Form 
      form={form} 
      layout="horizontal"
      labelAlign="left"
      colon={false}
      labelCol={{ flex: '120px' }}
      wrapperCol={{ flex: 'auto' }} 
      onFinish={handleSubmit}
      initialValues={{
        items: [{ cigarId: undefined, quantity: 1, price: 0 }], 
        paymentMethod: 'bank_transfer', 
        createdAt: dayjs().startOf('day') 
      }}
      id="createOrderForm"
      className="dark-theme-form"
    >
      <div style={{ 
        display: 'flex', 
        flexDirection: isMobile ? 'column' : 'row',
        gap: 16 
      }}>
        {/* Left - Main Form Card */}
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={theme.card.elevated}>
            <Form.Item label={t('ordersAdmin.orderDate')} name="createdAt">
              <DatePicker 
                style={{ width: '100%' }} 
                format="YYYY-MM-DD"
              />
            </Form.Item>
            
            <Form.Item 
              label={t('ordersAdmin.selectUser')} 
              name="userId" 
              rules={[{ required: true, message: t('ordersAdmin.pleaseSelectUser') }]}
            > 
              <Select 
                showSearch 
                placeholder={t('ordersAdmin.selectUser')}
                filterOption={(input, option) => {
                  const kw = (input || '').toLowerCase()
                  const uid = (option as any)?.value as string
                  const u = users.find(x => x.id === uid) as any
                  const name = (u?.displayName || '').toLowerCase()
                  const email = (u?.email || '').toLowerCase()
                  const phone = (u?.profile?.phone || '').toLowerCase()
                  return !!kw && (name.includes(kw) || email.includes(kw) || phone.includes(kw))
                }}
              >
                {users
                  .sort((a, b) => {
                    const nameA = (a.displayName || a.email || a.id).toLowerCase()
                    const nameB = (b.displayName || b.email || b.id).toLowerCase()
                    return nameA.localeCompare(nameB)
                  })
                  .map(u => (
                    <Select.Option key={u.id} value={u.id}>
                      {u.displayName} ({(u as any)?.profile?.phone || '-'})
                    </Select.Option>
                  ))}
              </Select>
            </Form.Item>

            {/* Product Section */}
            <div style={{ marginBottom: 16 }}>
              <div style={{ ...theme.text.subtitle, marginBottom: 12 }}>
                {t('ordersAdmin.products')}
              </div>
              <Form.List name="items">
                {(fields, { add, remove }) => (
                  <div>
                    {fields.map((field) => {
                      const { key, ...restField } = field as any
                      return (
                        <div key={`create-${key}`} style={{ 
                          display: 'flex', 
                          flexDirection: isMobile ? 'column' : 'row',
                          alignItems: isMobile ? 'stretch' : 'center', 
                          marginBottom: isMobile ? 8 : 8, 
                          gap: isMobile ? 8 : 12,
                          padding: isMobile ? '12px' : '0',
                          border: isMobile ? '1px solid rgba(244, 175, 37, 0.6)' : 'none',
                          borderRadius: isMobile ? '8px' : '0',
                          background: isMobile ? 'rgba(255, 255, 255, 0.02)' : 'transparent'
                        }}>
                          <Form.Item
                            {...restField}
                            name={[field.name, 'cigarId']}
                            fieldKey={[field.fieldKey!, 'cigarId'] as any}
                            rules={[{ required: false }]}
                            style={{ width: isMobile ? '100%' : 300, marginBottom: 0 }}
                          >
                            <Select
                              placeholder={t('ordersAdmin.selectItem') + ' / ' + t('ordersAdmin.customFee')}
                              showSearch
                              optionFilterProp="label"
                              onChange={(cigarId) => {
                                const cigar = cigars.find(c => c.id === cigarId)
                                if (cigar) {
                                  form.setFieldValue(['items', field.name, 'price'], applyDiscount(cigar.price))
                                }
                              }}
                              options={groupedCigars.map(group => ({
                                label: group.brand,
                                options: group.list.map(c => ({
                                  value: c.id,
                                  label: `${c.name} - RM${c.price}`,
                                })),
                              }))}
                            />
                          </Form.Item>
                          
                          <div style={{ 
                            display: 'flex', 
                            gap: 8, 
                            width: isMobile ? '100%' : 'auto' 
                          }}>
                            <Form.Item
                              {...restField}
                              name={[field.name, 'quantity']}
                              fieldKey={[field.fieldKey!, 'quantity'] as any}
                              rules={[{ required: true, message: t('ordersAdmin.pleaseEnterQuantity') }]}
                              style={{ flex: isMobile ? 1 : 'none', width: isMobile ? 'auto' : 120, marginBottom: 0 }}
                            >
                              <InputNumber 
                                min={1} 
                                placeholder={t('ordersAdmin.quantity')}
                                controls={false}
                                style={{ width: '100%' }}
                              />
                            </Form.Item>
                            
                            <Form.Item
                              {...restField}
                              name={[field.name, 'price']}
                              fieldKey={[field.fieldKey!, 'price'] as any}
                              rules={[{ required: true, message: t('ordersAdmin.pleaseEnterPrice') }]}
                              style={{ flex: isMobile ? 1 : 'none', width: isMobile ? 'auto' : 140, marginBottom: 0 }}
                            >
                              <InputNumber 
                                min={0} 
                                step={0.01}
                                precision={2}
                                placeholder={t('ordersAdmin.price')}
                                prefix="RM"
                                controls={false}
                                style={{ width: '100%' }}
                              />
                            </Form.Item>
                            
                            {fields.length > 1 && (
                              <Button 
                                danger 
                                type="text" 
                                icon={<DeleteOutlined />} 
                                onClick={() => remove(field.name)} 
                                style={{ marginLeft: isMobile ? 0 : 12, flexShrink: 0 }}
                              />
                            )}
                          </div>
                        </div>
                      )
                    })}
                    <Form.Item style={{ marginBottom: 16 }}>
                      <Button 
                        type="dashed" 
                        onClick={() => add({ quantity: 1, price: 0 })} 
                        icon={<PlusOutlined />}
                      >
                        {t('ordersAdmin.addItem')}
                      </Button>
                    </Form.Item>
                  </div>
                )}
              </Form.List>
            </div>

            <Form.Item label={t('ordersAdmin.note')} name="note">
              <Input placeholder={t('ordersAdmin.noteOptional')} />
            </Form.Item>
            
            <Form.Item label={t('ordersAdmin.address')} name="address">
              <Input placeholder={t('ordersAdmin.addressOptional')} />
            </Form.Item>
            
            <Form.Item label={t('ordersAdmin.payment.title')} name="paymentMethod" style={{ marginBottom: 0 }}>
              <Select>
                <Select.Option value="bank_transfer">{t('ordersAdmin.payment.bankTransfer')}</Select.Option>
                <Select.Option value="credit">{t('ordersAdmin.payment.credit')}</Select.Option>
                <Select.Option value="paypal">PayPal</Select.Option>
              </Select>
            </Form.Item>
          </div>
        </div>

        {/* Right - Product Categories Summary */}
        <div style={{ width: isMobile ? '100%' : 320 }}>
          {(() => {
            const s = computeSummary()
            return (
              <div style={{ position: isMobile ? 'relative' : 'sticky', top: 0 }}>
                <div style={{ ...theme.card.elevated, marginBottom: 12 }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 8 }}>
                    <strong style={theme.text.subtitle}>{t('participants.productCategories')}</strong>
                  </div>
                  <div style={{ maxHeight: 320, overflow: 'auto', display: 'flex', flexDirection: 'column', gap: 8 }}>
                    {s.brandGroups.size === 0 ? (
                      <div style={theme.text.secondary}>{t('common.noData')}</div>
                    ) : (
                      Array.from(s.brandGroups.entries()).map(([brand, rows]) => (
                        <div key={brand} style={{ ...theme.card.base, overflow: 'hidden', marginBottom: 0 }}>
                          <div style={{ 
                            padding: '6px 8px', 
                            fontWeight: 600, 
                            background: 'rgba(244, 175, 37, 0.1)',
                            borderBottom: '1px solid rgba(244, 175, 37, 0.6)',
                            color: '#f4af25'
                          }}>
                            {brand}
                          </div>
                          <div>
                            {rows.map(r => (
                              <div key={`${brand}-${r.key}`} style={{ 
                                display: 'flex', 
                                justifyContent: 'space-between', 
                                fontSize: 12, 
                                padding: '4px 8px', 
                                borderBottom: '1px solid rgba(244, 175, 37, 0.1)',
                                color: '#FFFFFF'
                              }}>
                                <span style={{ flex: 2 }}>{r.name}</span>
                                <span style={{ flex: 1, textAlign: 'right' }}>× {r.qty}</span>
                                <span style={{ flex: 1, textAlign: 'right' }}>RM{r.unit.toFixed(2)}</span>
                                <span style={{ flex: 1, textAlign: 'right', fontWeight: 600, color: '#f4af25' }}>RM{r.sum.toFixed(2)}</span>
                              </div>
                            ))}
                          </div>
                        </div>
                      ))
                    )}
                  </div>
                  <div style={{ 
                    borderTop: '1px solid rgba(244, 175, 37, 0.6)', 
                    marginTop: 8, 
                    paddingTop: 8 
                  }} />
                  <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                    <span style={{ ...theme.text.body, fontWeight: 600 }}>{t('participants.productsSubtotal')}</span>
                    <span style={{ ...theme.text.primary, fontWeight: 700, fontSize: '16px' }}>RM{s.productSubtotal.amount.toFixed(2)}</span>
                  </div>
                </div>
              </div>
            )
          })()}
        </div>
      </div>
    </Form>
  )
}

export default CreateOrderForm
