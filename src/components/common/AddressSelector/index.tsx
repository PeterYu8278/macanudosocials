/**
 * 地址选择组件
 */

import React, { useState, useEffect } from 'react'
import { 
  Select, 
  Button, 
  Modal, 
  Form, 
  Input, 
  message,
  Space,
  Empty,
  Checkbox,
  Row,
  Col
} from 'antd'
import { PlusOutlined, EditOutlined, DeleteOutlined } from '@ant-design/icons'
import type { Address } from '../../../types'
import { 
  getUserAddresses, 
  addAddress, 
  updateAddress, 
  deleteAddress,
  setDefaultAddress 
} from '../../../services/firebase/address'
import { useAuthStore } from '../../../store/modules/auth'
import { getModalThemeStyles } from '../../../config/modalTheme'
import { useTranslation } from 'react-i18next'
import MalaysiaStateSelect from '../MalaysiaStateSelect'

interface AddressSelectorProps {
  value?: string // 选中的地址ID
  onChange?: (addressId: string | null) => void
  allowCreate?: boolean // 是否允许创建新地址
  showSelect?: boolean // 是否显示地址选择下拉框
  style?: React.CSSProperties
}

export const AddressSelector: React.FC<AddressSelectorProps> = ({
  value,
  onChange,
  allowCreate = true,
  showSelect = true,
  style
}) => {
  const { user } = useAuthStore()
  const { t } = useTranslation()
  // 直接从 user 对象获取地址列表，利用 authStore 的实时监听功能
  const addresses = user?.addresses || []
  
  const [loading, setLoading] = useState(false)
  const [modalVisible, setModalVisible] = useState(false)
  const [editingAddress, setEditingAddress] = useState<Address | null>(null)
  const [form] = Form.useForm()
  const [isMobile, setIsMobile] = useState(false)

  useEffect(() => {
    const checkMobile = () => {
      setIsMobile(window.matchMedia('(max-width: 768px)').matches)
    }
    checkMobile()
    window.addEventListener('resize', checkMobile)
    return () => window.removeEventListener('resize', checkMobile)
  }, [])

  // 移除了 loadAddresses，因为 user 对象会自动通过 onSnapshot 更新

  const handleCreate = () => {
    setEditingAddress(null)
    form.resetFields()
    // 如果用户信息存在，自动填充姓名和手机号
    const userPhone = (user as any)?.profile?.phone || user?.phone
    if (user?.displayName || userPhone) {
      form.setFieldsValue({
        name: user?.displayName || '',
        phone: userPhone || '',
        isSelf: true
      })
    } else {
      form.setFieldsValue({
        isSelf: true
      })
    }
    setModalVisible(true)
  }

  const handleIsSelfChange = (e: any) => {
    const isSelf = e.target.checked
    if (isSelf && user) {
      // 如果选中"是本人"，自动填充用户信息
      const userPhone = (user as any)?.profile?.phone || user?.phone
      form.setFieldsValue({
        name: user.displayName || '',
        phone: userPhone || ''
      })
    }
  }

  const handleEdit = (address: Address) => {
    setEditingAddress(address)
    // 判断地址的姓名和手机号是否与用户信息匹配
    let isSelf = false
    if (user) {
      const userPhone = (user as any)?.profile?.phone || user?.phone
      const nameMatch = user.displayName && address.name === user.displayName
      const phoneMatch = userPhone && address.phone === userPhone
      isSelf = (nameMatch && phoneMatch) || (nameMatch && !userPhone) || (phoneMatch && !user.displayName)
    }
    form.setFieldsValue({
      name: address.name,
      phone: address.phone,
      province: address.province,
      city: address.city,
      district: address.district,
      detail: address.detail,
      postalCode: address.postalCode,
      isDefault: address.isDefault,
      isSelf: isSelf
    })
    setModalVisible(true)
  }

  const handleDelete = async (addressId: string) => {
    if (!user?.id) return
    
    Modal.confirm({
      title: t('address.deleteConfirm'),
      content: t('address.deleteContent'),
      okText: t('common.confirm'),
      cancelText: t('common.cancel'),
      okButtonProps: { danger: true },
      onOk: async () => {
        try {
          const result = await deleteAddress(user.id, addressId)
          if (result.success) {
            message.success(t('address.deleteSuccess'))
            // 如果删除的是当前选中的地址，清空选择
            if (value === addressId) {
              onChange?.(null)
            }
          } else {
            message.error(result.error?.message || t('address.deleteFailed'))
          }
        } catch (error) {
          console.error('Delete address failed:', error)
          message.error(t('address.deleteFailed'))
        }
      }
    })
  }

  const handleSetDefault = async (addressId: string) => {
    if (!user?.id) return
    setLoading(true)
    try {
      const result = await setDefaultAddress(user.id, addressId)
      if (result.success) {
        message.success(t('address.setDefaultSuccess'))
      } else {
        message.error(result.error?.message || t('messages.operationFailed'))
      }
    } catch (error) {
      message.error(t('messages.operationFailed'))
    } finally {
      setLoading(false)
    }
  }

  const handleSubmit = async () => {
    if (!user?.id) return
    
    try {
      const values = await form.validateFields()
      const addressData = {
        name: values.name,
        phone: values.phone,
        province: values.province,
        city: values.city,
        district: values.district,
        detail: values.detail,
        postalCode: values.postalCode,
        isDefault: values.isDefault || false
      }

      let result
      if (editingAddress) {
        result = await updateAddress(user.id, editingAddress.id, addressData)
      } else {
        result = await addAddress(user.id, addressData)
      }

      if (result.success) {
        message.success(t('address.saveSuccess'))
        setModalVisible(false)
        // 如果是新创建的地址且设为默认，自动选中
        if (!editingAddress && addressData.isDefault) {
          const addResult = result as { success: boolean; addressId?: string; error?: Error }
          if (addResult.addressId) {
            onChange?.(addResult.addressId)
          }
        }
      } else {
        message.error(result.error?.message || t('messages.operationFailed'))
      }
    } catch (error) {
      // 表单验证失败
    }
  }

  const formatAddress = (address: Address): string => {
    const stateKey = address.province.toLowerCase().replace(/\s+/g, '')
    const translatedState = t(`address.states.${stateKey}`)
    // If translation doesn't exist (e.g. key doesn't match), fallback to original
    const displayState = translatedState.includes('address.states') ? address.province : translatedState
    return `${displayState} ${address.city} ${address.district} ${address.detail} (${address.name} ${address.phone})`
  }

  if (addresses.length === 0 && !allowCreate) {
    return (
      <div style={style}>
        <Empty description={t('address.noAddress')} />
      </div>
    )
  }

  return (
    <div style={style}>
      <div style={{ 
        display: 'flex', 
        flexDirection: 'column', 
        gap: '12px',
        width: '100%' 
      }}>
        {/* 地址卡片列表 */}
        {addresses.length > 0 ? (
          <div 
            className="hide-scrollbar"
            style={{ 
              display: 'flex', 
              flexDirection: 'column', 
              gap: '8px',
              maxHeight: isMobile ? '240px' : '300px',
              overflowY: 'auto',
              paddingRight: '4px'
            }}
          >
            {addresses.map(addr => {
              const isSelected = value === addr.id
              const stateKey = addr.province.toLowerCase().replace(/\s+/g, '')
              const translatedState = t(`address.states.${stateKey}`)
              const displayState = translatedState.includes('address.states') ? addr.province : translatedState

              return (
                <div 
                  key={addr.id}
                  onClick={() => onChange?.(addr.id)}
                  style={{
                    padding: '12px',
                    borderRadius: '8px',
                    background: isSelected ? 'rgba(244, 175, 37, 0.15)' : 'rgba(255, 255, 255, 0.03)',
                    border: isSelected ? '1px solid #F4AF25' : '1px solid rgba(255, 255, 255, 0.1)',
                    cursor: 'pointer',
                    transition: 'all 0.2s ease',
                    position: 'relative'
                  }}
                >
                  {/* 收货人信息 */}
                  <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '4px' }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                      <span style={{ color: '#fff', fontWeight: 'bold', fontSize: '14px' }}>{addr.name}</span>
                      <span style={{ color: 'rgba(255, 255, 255, 0.6)', fontSize: '12px' }}>{addr.phone}</span>
                      {addr.isDefault && (
                        <span style={{ 
                          fontSize: '10px', 
                          background: 'rgba(244, 175, 37, 0.2)', 
                          color: '#F4AF25', 
                          padding: '0 4px', 
                          borderRadius: '2px',
                          border: '1px solid rgba(244, 175, 37, 0.3)'
                        }}>
                          {t('address.default')}
                        </span>
                      )}
                    </div>
                  </div>
                  
                  {/* 地址详情 */}
                  <div style={{ 
                    color: 'rgba(255, 255, 255, 0.85)', 
                    fontSize: '12px',
                    lineHeight: '1.5',
                    marginTop: '4px',
                    marginBottom: '8px'
                  }}>
                    <div style={{ fontWeight: '500', color: '#fff' }}>{addr.detail}</div>
                    <div style={{ color: 'rgba(255, 255, 255, 0.6)' }}>
                      {addr.district}, {addr.city}, {displayState} {addr.postalCode ? `(${addr.postalCode})` : ''}
                    </div>
                  </div>

                  {/* 底部操作栏 */}
                  <div style={{ 
                    display: 'flex', 
                    justifyContent: 'space-between', 
                    alignItems: 'center',
                    borderTop: '1px solid rgba(255, 255, 255, 0.05)',
                    paddingTop: '8px',
                    marginTop: '4px'
                  }}>
                    <div style={{ display: 'flex', gap: '8px' }}>
                      {!addr.isDefault && (
                        <Button
                          type="text"
                          onClick={(e) => {
                            e.stopPropagation()
                            handleSetDefault(addr.id)
                          }}
                          size="small"
                          style={{ color: '#F4AF25', fontSize: '10px', padding: 0 }}
                        >
                          {t('address.setDefault')}
                        </Button>
                      )}
                      <Button
                        type="text"
                        icon={<EditOutlined style={{ fontSize: '11px' }} />}
                        onClick={(e) => {
                          e.stopPropagation()
                          handleEdit(addr)
                        }}
                        size="small"
                        style={{ color: 'rgba(255, 255, 255, 0.45)', padding: 0, fontSize: '10px' }}
                      >
                        {t('common.edit')}
                      </Button>
                      <Button
                        type="text"
                        danger
                        icon={<DeleteOutlined style={{ fontSize: '11px' }} />}
                        onClick={(e) => {
                          e.stopPropagation()
                          handleDelete(addr.id)
                        }}
                        size="small"
                        style={{ padding: 0, fontSize: '10px' }}
                      >
                        {t('common.delete')}
                      </Button>
                    </div>

                    {/* 选中标记 */}
                    {isSelected && (
                      <div style={{ color: '#F4AF25', height: '14px', display: 'flex', alignItems: 'center' }}>
                        <Checkbox checked={true} style={{ pointerEvents: 'none' }} />
                      </div>
                    )}
                  </div>
                </div>
              )
            })}
          </div>
        ) : (
          <Empty 
            image={Empty.PRESENTED_IMAGE_SIMPLE} 
            description={<span style={{ color: 'rgba(255, 255, 255, 0.45)' }}>{t('address.noAddress')}</span>} 
            style={{ margin: '12px 0' }}
          />
        )}
        
        {/* 添加新地址按钮 */}
        {allowCreate && (
          <Button 
            type="dashed" 
            icon={<PlusOutlined />} 
            onClick={handleCreate}
            block
            style={{
              height: '40px',
              borderColor: 'rgba(244, 175, 37, 0.5)',
              color: '#F4AF25',
              background: 'rgba(244, 175, 37, 0.05)',
              borderRadius: '8px'
            }}
          >
            {t('address.addAddress')}
          </Button>
        )}
      </div>

      <Modal
        title={<span style={{ color: '#F4AF25', fontWeight: 'bold' }}>{editingAddress ? t('address.editAddress') : t('address.addAddress')}</span>}
        open={modalVisible}
        onOk={handleSubmit}
        onCancel={() => setModalVisible(false)}
        width={isMobile ? '90%' : 600}
        styles={getModalThemeStyles(isMobile, true)}
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
            background: 'rgba(255, 255, 255, 0.1)',
            border: '1px solid rgba(255, 255, 255, 0.2)',
            color: '#fff'
          }
        }}
      >
        <Form 
          form={form} 
          layout="horizontal" 
          className="dark-theme-form" 
          labelCol={{ flex: isMobile ? '100px' : '120px' }}
          wrapperCol={{ flex: 'auto' }}
          labelWrap
        >
          <Form.Item
            name="isSelf"
            valuePropName="checked"
            initialValue={true}
            label=" "
            colon={false}
          >
            <Checkbox 
              style={{ color: '#fff' }}
              onChange={handleIsSelfChange}
            >
              {t('address.isSelf')}
            </Checkbox>
          </Form.Item>

          <Form.Item
            name="name"
            label={<span style={{ color: '#fff' }}>{t('address.receiverName')}</span>}
            rules={[{ required: true, message: t('address.pleaseInputName') }]}
          >
            <Input 
              placeholder={t('address.pleaseInputName')}
            />
          </Form.Item>
          
          <Form.Item
            name="phone"
            label={<span style={{ color: '#fff' }}>{t('address.contactPhone')}</span>}
            rules={[
              { required: true, message: t('address.pleaseInputPhone') },
              { pattern: /^((\+?60[1-9]\d{8,9})|(0[1-9]\d{8,9}))$/, message: t('address.pleaseInputPhoneValid') }
            ]}
          >
            <Input 
              placeholder={t('address.pleaseInputPhone')}
            />
          </Form.Item>

          <Form.Item
            name="isDefault"
            valuePropName="checked"
            initialValue={addresses.length === 0}
            label=" "
            colon={false}
          >
            <Checkbox style={{ color: '#fff' }}>
              {t('address.isDefault')}
            </Checkbox>
          </Form.Item>
          
          <Form.Item
            name="province"
            label={<span style={{ color: '#fff' }}>{t('address.province')}</span>}
            rules={[{ required: true, message: t('address.pleaseSelectProvince') }]}
          >
            <MalaysiaStateSelect />
          </Form.Item>
          
          <Form.Item
            name="city"
            label={<span style={{ color: '#fff' }}>{t('address.city')}</span>}
            rules={[{ required: true, message: t('address.pleaseInputCity') }]}
          >
            <Input 
              placeholder={t('address.pleaseInputCity')}
            />
          </Form.Item>
          
          <Form.Item
            name="district"
            label={<span style={{ color: '#fff' }}>{t('address.district')}</span>}
            rules={[{ required: true, message: t('address.pleaseInputDistrict') }]}
          >
            <Input 
              placeholder={t('address.pleaseInputDistrict')}
            />
          </Form.Item>
          
          <Form.Item
            name="detail"
            label={<span style={{ color: '#fff' }}>{t('address.detail')}</span>}
            rules={[{ required: true, message: t('address.pleaseInputDetail') }]}
          >
            <Input.TextArea 
              rows={2} 
              placeholder={t('address.pleaseInputDetail')}
            />
          </Form.Item>
          
          <Form.Item
            name="postalCode"
            label={<span style={{ color: '#fff' }}>{t('address.postalCode')}</span>}
          >
            <Input 
              placeholder={t('address.postalCodeOptional')}
            />
          </Form.Item>
        </Form>
      </Modal>
    </div>
  )
}

