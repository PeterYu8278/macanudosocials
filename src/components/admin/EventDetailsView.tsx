import React, { useState, useEffect } from 'react'
import { Descriptions, Input, Select, DatePicker, InputNumber, Tag, Progress, Space, Switch, Row, Col } from 'antd'
import { EditOutlined, DeleteOutlined, FileTextOutlined, CalendarOutlined, TeamOutlined } from '@ant-design/icons'
import dayjs from 'dayjs'
import type { Event } from '../../types'
import ImageUpload from '../common/ImageUpload'
import { useTranslation } from 'react-i18next'
import { getModalTheme } from '../../config/modalTheme'

const { Option } = Select

interface EventDetailsViewProps {
  event: Event
  isEditing: boolean
  editForm: any
  onEditFormChange: (form: any) => void
  onSaveField: (fieldName: string) => Promise<void>
  onToggleEdit: () => void
  onDelete: () => void
  onImageChange: (url: string | null) => Promise<void>
}

const EventDetailsView: React.FC<EventDetailsViewProps> = ({
  event,
  isEditing,
  editForm,
  onEditFormChange,
  onSaveField,
  onToggleEdit,
  onDelete,
  onImageChange
}) => {
  const { t } = useTranslation()
  const theme = getModalTheme()
  const [isMobile, setIsMobile] = useState(window.innerWidth <= 768)

  useEffect(() => {
    const handleResize = () => setIsMobile(window.innerWidth <= 768)
    window.addEventListener('resize', handleResize)
    return () => window.removeEventListener('resize', handleResize)
  }, [])

  // 创建模式：使用卡片布局
  if (event.id === 'new' && isEditing) {
    const cardStyle: React.CSSProperties = {
      ...theme.card.elevated,
      marginBottom: 12,
      borderLeft: '3px solid rgba(253,224,141,0.5)',
      padding: isMobile ? 14 : 16,
      boxShadow: '0 4px 20px rgba(0,0,0,0.25)',
    }

    const sectionHeader = (icon: React.ReactNode, label: string) => (
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 14 }}>
        <span style={{ color: '#FDE08D', fontSize: 15, display: 'flex', alignItems: 'center' }}>{icon}</span>
        <span style={{ backgroundImage: 'linear-gradient(to right,#FDE08D,#C48D3A)', WebkitBackgroundClip: 'text', color: 'transparent', fontWeight: 700, fontSize: 14, letterSpacing: '0.3px' }}>
          {label}
        </span>
      </div>
    )

    const fieldLabel = (label: string) => (
      <div style={{ fontSize: 11, color: 'rgba(255,255,255,0.5)', marginBottom: 6, fontWeight: 600, letterSpacing: '0.6px', textTransform: 'uppercase' }}>
        {label}
      </div>
    )

    return (
      <div style={{ width: '100%', overflow: 'hidden' }}>
        {/* 基本信息卡片 */}
        <div style={cardStyle}>
          {sectionHeader(<FileTextOutlined />, t('events.basicInfo'))}

          <div style={{ marginBottom: 12 }}>
            {fieldLabel(t('events.eventName'))}
            <Input
              value={editForm.title}
              onChange={(e) => onEditFormChange({...editForm, title: e.target.value})}
              placeholder={t('events.namePlaceholder')}
            />
          </div>

          <div style={{ marginBottom: 12 }}>
            {fieldLabel(t('events.description'))}
            <Input.TextArea
              value={editForm.description}
              onChange={(e) => onEditFormChange({...editForm, description: e.target.value})}
              rows={isMobile ? 2 : 3}
              placeholder={t('events.descriptionPlaceholder')}
            />
          </div>

          <div>
            {fieldLabel(t('events.location'))}
            <Input
              value={editForm.locationName}
              onChange={(e) => onEditFormChange({...editForm, locationName: e.target.value})}
              placeholder={t('events.locationPlaceholder')}
            />
          </div>
        </div>

        {/* 时间设置卡片 */}
        <div style={cardStyle}>
          {sectionHeader(<CalendarOutlined />, t('events.timeSettings'))}

          <Row gutter={isMobile ? 0 : 12}>
            <Col span={isMobile ? 24 : 12} style={isMobile ? { marginBottom: 12 } : {}}>
              {fieldLabel(t('common.startDate'))}
              <DatePicker
                value={editForm.startDate}
                onChange={(date) => onEditFormChange({...editForm, startDate: date})}
                style={{ width: '100%' }}
                showTime={{ format: 'HH:mm' }}
                format="YYYY-MM-DD HH:mm"
                placeholder={t('common.pleaseSelectStartDate')}
              />
            </Col>
            <Col span={isMobile ? 24 : 12}>
              {fieldLabel(t('common.endDate'))}
              <DatePicker
                value={editForm.endDate}
                onChange={(date) => onEditFormChange({...editForm, endDate: date})}
                style={{ width: '100%' }}
                showTime={{ format: 'HH:mm' }}
                format="YYYY-MM-DD HH:mm"
                placeholder={t('common.pleaseSelectEndDate')}
              />
            </Col>
          </Row>
        </div>

        {/* 参与设置卡片 */}
        <div style={cardStyle}>
          {sectionHeader(<TeamOutlined />, t('events.participationSettings'))}

          <Row gutter={12} style={{ marginBottom: 12 }}>
            <Col span={12}>
              {fieldLabel(t('common.fee'))}
              <InputNumber
                value={editForm.fee}
                onChange={(val) => onEditFormChange({...editForm, fee: val})}
                min={0}
                style={{ width: '100%' }}
                controls={false}
                addonBefore={<span style={{ color: 'rgba(255,255,255,0.6)', fontSize: 12 }}>RM</span>}
                placeholder="0"
              />
            </Col>
            <Col span={12}>
              {fieldLabel(t('common.maxParticipants'))}
              <InputNumber
                value={editForm.maxParticipants}
                onChange={(val) => onEditFormChange({...editForm, maxParticipants: val})}
                min={0}
                style={{ width: '100%' }}
                controls={false}
                placeholder="0"
              />
            </Col>
          </Row>

          <Row gutter={12}>
            <Col span={12}>
              {fieldLabel(t('common.privateEvent'))}
              <div style={{ paddingTop: 4 }}>
                <Switch
                  checked={editForm.isPrivate}
                  onChange={(checked) => onEditFormChange({...editForm, isPrivate: checked})}
                  style={{ backgroundColor: editForm.isPrivate ? '#C48D3A' : undefined }}
                />
              </div>
            </Col>
            <Col span={12}>
              {fieldLabel(t('common.status'))}
              <Select
                value={editForm.status ?? 'draft'}
                onChange={(val) => onEditFormChange({...editForm, status: val})}
                style={{ width: '100%' }}
                className="gold-select"
                popupClassName="gold-select-dropdown"
              >
                <Option value="draft">{t('common.draft')}</Option>
                <Option value="published">{t('common.published')}</Option>
                <Option value="ongoing">{t('common.ongoing')}</Option>
                <Option value="completed">{t('common.completed')}</Option>
                <Option value="cancelled">{t('common.cancelled')}</Option>
              </Select>
            </Col>
          </Row>
        </div>

        {/* 创建按钮 */}
        <button
          style={{
            width: '100%',
            padding: isMobile ? '12px 0' : '10px 0',
            borderRadius: 10,
            background: 'linear-gradient(to right, #FDE08D, #C48D3A)',
            color: '#111',
            fontWeight: 700,
            fontSize: 15,
            cursor: 'pointer',
            border: 'none',
            boxShadow: '0 4px 15px rgba(244,175,37,0.35)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            gap: 8,
            marginTop: 4,
          }}
          onClick={async () => {
            await onSaveField('__CREATE_ALL__')
            onToggleEdit()
          }}
        >
          <EditOutlined />
          {t('common.create')}
        </button>
      </div>
    )
  }

  // 查看/编辑模式：使用原有的 Descriptions 布局
  return (
    <div style={{ color: '#FFFFFF' }}>
      {/* 活动基本信息 - 手机端垂直布局，桌面端左右布局 */}
      <div style={{ 
        display: 'flex', 
        flexDirection: isMobile ? 'column' : 'row',
        gap: '16px', 
        marginBottom: '16px' 
      }}>
        {/* 活动图片上传 - 手机端顶部全宽，桌面端右侧固定宽度 */}
        {isMobile && (
          <div style={{ width: '100%' }}>
            <div style={{ 
              padding: '16px', 
              border: '1px solid rgba(244, 175, 37, 0.6)', 
              borderRadius: '6px',
              background: 'rgba(39, 35, 27, 0.5)',
              backdropFilter: 'blur(10px)'
            }}>
              <div style={{ 
                fontSize: '14px', 
                fontWeight: '600', 
                marginBottom: '8px',
                color: '#FFFFFF'
              }}>
                {t('common.eventImage')}
              </div>
              <div style={{ display: 'flex', justifyContent: 'center' }}>
                <ImageUpload
                  value={editForm.image || (event as any).image || undefined}
                  onChange={async (url) => {
                    // 更新 editForm
                    onEditFormChange({...editForm, image: url || null})
                    // 调用 onImageChange，让父组件决定是否保存
                    await onImageChange(url)
                  }}
                  folder="events"
                  maxSize={2 * 1024 * 1024} // 2MB
                  width={100}
                  height={100}
                  showPreview={true}
                />
              </div>
            </div>
          </div>
        )}
        
        {/* 左侧：活动名称和描述 */}
        <div style={{ flex: 1 }}>
          <Descriptions 
            className="cigar-bordered-descriptions"
            bordered 
            column={1} 
            size="small"
            style={{ 
              color: '#FFFFFF'
            }}
            styles={{
              label: {
                color: 'rgba(255, 255, 255, 0.7)'
              },
              content: {
                color: '#FFFFFF'
              }
            }}
          >
            <Descriptions.Item label={t('events.eventName')}>
              {isEditing ? (
                <Input
                  value={editForm.title}
                  onChange={(e) => onEditFormChange({...editForm, title: e.target.value})}
                  autoFocus
                />
              ) : (
                <span style={{ fontWeight: 'bold', fontSize: '16px', color: '#FFFFFF' }}>
                  {event.title}
                </span>
              )}
            </Descriptions.Item>
            <Descriptions.Item label={t('events.description')}>
              {isEditing ? (
                <Input.TextArea
                  value={editForm.description}
                  onChange={(e) => onEditFormChange({...editForm, description: e.target.value})}
                  autoFocus
                  rows={3}
                />
              ) : (
                <div style={{ maxHeight: '100px', overflow: 'auto', color: '#FFFFFF' }}>
                  {(event as any).description || t('common.noDescription')}
                </div>
              )}
            </Descriptions.Item>
            <Descriptions.Item label={t('events.location')}>
              {isEditing ? (
                <Input
                  value={editForm.locationName}
                  onChange={(e) => onEditFormChange({...editForm, locationName: e.target.value})}
                  autoFocus
                />
              ) : (
                <div style={{ color: '#FFFFFF' }}>
                  {(event as any)?.location?.name || '-'}
                  {(event as any)?.location?.address && (
                    <div style={{ fontSize: '12px', color: 'rgba(255, 255, 255, 0.6)', marginTop: '4px' }}>
                      {(event as any).location.address}
                    </div>
                  )}
                </div>
              )}
            </Descriptions.Item>
            
          </Descriptions>
        </div>
        
        {/* 右侧：活动图片上传 - 桌面端显示 */}
        {!isMobile && (
          <div style={{ width: '150px', flexShrink: 0 }}>
            <div style={{ 
              padding: '16px', 
              border: '1px solid rgba(244, 175, 37, 0.6)', 
              borderRadius: '6px',
              background: 'rgba(39, 35, 27, 0.5)',
              backdropFilter: 'blur(10px)'
            }}>
              <div style={{ 
                fontSize: '14px', 
                fontWeight: '600', 
                marginBottom: '8px',
                color: '#FFFFFF'
              }}>
                {t('common.eventImage')}
              </div>
              <ImageUpload
                value={editForm.image || (event as any).image || undefined}
                onChange={async (url) => {
                  // 更新 editForm
                  onEditFormChange({...editForm, image: url || null})
                  // 调用 onImageChange，让父组件决定是否保存
                  await onImageChange(url)
                }}
                folder="events"
                maxSize={2 * 1024 * 1024} // 2MB
                width={100}
                height={100}
                showPreview={true}
              />
            </div>
          </div>
        )}
      </div>
      
      {/* 其他活动信息 - 手机端单列，桌面端两列 */}
      <Descriptions 
        className="cigar-bordered-descriptions"
        bordered 
        column={isMobile ? 1 : 2} 
        size="small"
        style={{ 
          color: '#FFFFFF'
        }}
        styles={{
          label: {
            color: 'rgba(255, 255, 255, 0.7)'
          },
          content: {
            color: '#FFFFFF'
          }
        }}
      >
        <Descriptions.Item label={t('events.status')}>
          {isEditing ? (
             <Select
               value={editForm.status}
               onChange={(value) => onEditFormChange({...editForm, status: value})}
               style={{ width: '100%' }}
               autoFocus
             >
              <Option value="draft">{t('events.draft')}</Option>
              <Option value="published">{t('events.published')}</Option>
              <Option value="ongoing">{t('events.ongoing')}</Option>
              <Option value="completed">{t('events.completed')}</Option>
              <Option value="cancelled">{t('events.cancelled')}</Option>
            </Select>
          ) : (
            <span style={{ 
              fontSize: 12, 
              padding: '2px 8px', 
              borderRadius: 9999, 
              background: 'linear-gradient(to right,#FDE08D,#C48D3A)',
              color: '#221c10', 
              fontWeight: 600,
              display: 'inline-block'
            }}>
              {event.status === 'published' ? t('events.published') :
               event.status === 'ongoing' ? t('events.ongoing') :
               event.status === 'completed' ? t('events.completed') :
               event.status === 'cancelled' ? t('events.cancelled') :
               event.status === 'draft' ? t('events.draft') : event.status}
            </span>
          )}
        </Descriptions.Item>
        <Descriptions.Item label={t('common.privateEvent')}>
          {isEditing ? (
              <Switch
                checked={editForm.isPrivate}
                onChange={(checked) => onEditFormChange({...editForm, isPrivate: checked})}
                style={{
                  backgroundColor: editForm.isPrivate ? '#FDE08D' : '#d9d9d9'
                }}
                checkedChildren=""
                unCheckedChildren=""
              />
          ) : (
            <span style={{ 
              fontSize: 12, 
              padding: '2px 8px', 
              borderRadius: 9999, 
              background: 'linear-gradient(to right,#FDE08D,#C48D3A)',
              color: '#221c10', 
              fontWeight: 600,
              display: 'inline-block'
            }}>
              {event.isPrivate ? t('common.private') : t('common.public')}
            </span>
          )}
        </Descriptions.Item>
        <Descriptions.Item label={t('events.startTime')}>
          {isEditing ? (
              <DatePicker
                value={editForm.startDate}
                onChange={(date) => onEditFormChange({...editForm, startDate: date})}
                style={{ width: '100%' }}
                autoFocus
                showTime={{ format: 'HH:mm' }}
                format="YYYY-MM-DD HH:mm"
              />
          ) : (
            <span style={{ color: '#FFFFFF' }}>
              {(() => {
                const s = (event as any)?.schedule?.startDate
                const sd = (s as any)?.toDate ? (s as any).toDate() : s
                return sd ? new Date(sd).toLocaleString() : '-'
              })()}
            </span>
          )}
        </Descriptions.Item>
        <Descriptions.Item label={t('events.endTime')}>
          {isEditing ? (
              <DatePicker
                value={editForm.endDate}
                onChange={(date) => onEditFormChange({...editForm, endDate: date})}
                style={{ width: '100%' }}
                autoFocus
                showTime={{ format: 'HH:mm' }}
                format="YYYY-MM-DD HH:mm"
              />
          ) : (
            <span style={{ color: '#FFFFFF' }}>
              {(() => {
                const e = (event as any)?.schedule?.endDate
                const ed = (e as any)?.toDate ? (e as any).toDate() : e
                return ed ? new Date(ed).toLocaleString() : '-'
              })()}
            </span>
          )}
        </Descriptions.Item>
        <Descriptions.Item label={t('events.fee')}>
          {isEditing ? (
            <InputNumber
              value={editForm.fee}
              onChange={(value) => onEditFormChange({...editForm, fee: value})}
              style={{ width: '100%' }}
              autoFocus
              min={0}
              controls={false}
              addonBefore={<span style={{ color: '#FFFFFF' }}>RM</span>}
            />
          ) : (
            <span style={{ color: '#FFFFFF', fontWeight: 'bold' }}>
              <span style={{ color: '#FFFFFF' }}>RM</span>{(event as any)?.participants?.fee ?? 0}
            </span>
          )}
        </Descriptions.Item>
        <Descriptions.Item label={t('events.maxParticipants')}>
          {isEditing ? (
            <InputNumber
              value={editForm.maxParticipants}
              onChange={(value) => onEditFormChange({...editForm, maxParticipants: value})}
              style={{ width: '100%' }}
              autoFocus
              min={0}
              controls={false}
              addonAfter={<span style={{ color: '#FFFFFF' }}>{t('events.people')}</span>}
            />
          ) : (
            <span style={{ color: '#FFFFFF' }}>
              {(() => {
                const maxP = (event as any)?.participants?.maxParticipants ?? 0
                return maxP === 0 ? t('events.noLimit') : `${maxP} ${t('events.people')}`
              })()}
            </span>
          )}
        </Descriptions.Item>
        <Descriptions.Item label={t('events.currentParticipants')}>
          <span style={{ color: '#95de64', fontWeight: 'bold' }}>
            {((event as any)?.participants?.registered || []).length} {t('events.people')}
          </span>
        </Descriptions.Item>
        <Descriptions.Item label={t('events.registrationProgress')}>
          {(() => {
            const registered = ((event as any)?.participants?.registered || []).length
            const max = (event as any)?.participants?.maxParticipants ?? 0
            const percentage = max > 0 ? Math.round((registered / max) * 100) : 0
            return (
              <div style={{ position: 'relative' }}>
                <Progress 
                  percent={percentage} 
                  size="small" 
                  status={percentage >= 100 ? 'exception' : 'active'}
                  strokeColor={{
                    '0%': '#FDE08D',
                    '100%': '#C48D3A',
                  }}
                  trailColor="#d9d9d9"
                  format={(percent) => (
                    <span style={{ color: '#FFFFFF', fontSize: 12 }}>{percent}%</span>
                  )}
                />
              </div>
            )
          })()}
        </Descriptions.Item>
      </Descriptions>
      
      {/* 操作按钮区域 - 手机端垂直排列，桌面端水平排列 */}
      <div style={{ 
        marginTop: '24px', 
        paddingTop: '16px', 
        borderTop: '1px solid rgba(244, 175, 37, 0.6)' 
      }}>
        <Space 
          direction={isMobile ? 'vertical' : 'horizontal'} 
          wrap={!isMobile}
          style={{ width: isMobile ? '100%' : 'auto' }}
        >
          <button 
            style={{ 
              display: 'flex', 
              alignItems: 'center', 
              justifyContent: 'center',
              gap: 8, 
              padding: '8px 16px', 
              borderRadius: 8, 
              background: 'linear-gradient(to right,#FDE08D,#C48D3A)', 
              color: '#111', 
              fontWeight: 600, 
              cursor: 'pointer', 
              transition: 'all 0.2s ease',
              width: isMobile ? '100%' : 'auto'
            }}
            onClick={async () => {
              if (isEditing) {
                // 🔥 创建模式：一次性创建活动，不要循环调用 onSaveField
                if (event.id === 'new') {
                  // 只调用一次 onSaveField，传入特殊标识
                  await onSaveField('__CREATE_ALL__')
                  onToggleEdit()
                } else {
                  // 编辑模式：保存所有更改的字段
                try {
                  // 保存所有字段
                  const fieldsToSave = ['title', 'description', 'status', 'isPrivate', 'locationName', 'fee', 'maxParticipants', 'image']
                  for (const field of fieldsToSave) {
                    if (editForm[field] !== undefined) {
                      await onSaveField(field)
                    }
                  }
                  // 保存日期字段（startDate 会同时保存 endDate）
                  if (editForm.startDate !== undefined) {
                    await onSaveField('startDate')
                  } else if (editForm.endDate !== undefined) {
                    await onSaveField('endDate')
                  }
                  // 退出编辑模式
                  onToggleEdit()
                } catch (error) {
                    console.error('🟠 EDIT MODE error:', error)
                  }
                }
              } else {
                // 非编辑模式下，进入编辑模式
                onToggleEdit()
              }
            }}
          >
            <EditOutlined />
            {isEditing ? t('common.save') : t('common.editEvent')}
          </button>
          {isEditing && (
            <button 
              style={{ 
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                padding: '8px 16px', 
                borderRadius: 8, 
                background: 'rgba(255,255,255,0.1)', 
                color: '#ccc', 
                cursor: 'pointer', 
                transition: 'all 0.2s ease',
                width: isMobile ? '100%' : 'auto'
              }}
              onClick={() => {
                onEditFormChange({})
                onToggleEdit()
              }}
            >
              {t('common.cancelEdit')}
            </button>
          )}
          <button 
            style={{ 
              display: 'flex', 
              alignItems: 'center',
              justifyContent: 'center',
              gap: 8, 
              padding: '8px 16px', 
              borderRadius: 8, 
              background: '#ff4d4f', 
              color: '#fff', 
              cursor: 'pointer', 
              transition: 'all 0.2s ease',
              width: isMobile ? '100%' : 'auto'
            }}
            onClick={onDelete}
          >
            <DeleteOutlined />
            {t('common.deleteEvent')}
          </button>
        </Space>
      </div>
    </div>
  )
}

export default EventDetailsView
