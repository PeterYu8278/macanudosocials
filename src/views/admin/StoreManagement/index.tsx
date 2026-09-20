import React, { useState, useEffect } from 'react';
import { useDetailDrawer } from '../../../hooks/useDetailDrawer';
import { useDeleteConfirm } from '../../../hooks/useDeleteConfirm';
import { useFirestoreQuery } from '../../../hooks/useFirestoreQuery';
import { 
  Button, 
  Space, 
  Tag, 
  Modal, 
  Form, 
  Input, 
  Select, 
  message, 
  Typography,
  Row,
  Col,
  Spin
} from 'antd';
import { 
  PlusOutlined, 
  EditOutlined, 
  DeleteOutlined, 
  ShopOutlined,
  EnvironmentOutlined,
  PhoneOutlined,
  MailOutlined,
  CheckCircleOutlined,
  CloseCircleOutlined,
  CalendarOutlined
} from '@ant-design/icons';
import { useTranslation } from 'react-i18next';
import { 
  getAllStores, 
  createStore, 
  updateStore, 
  deleteStore 
} from '../../../services/firebase/stores';
import { getAppConfig } from '../../../services/firebase/appConfig';
import type { Store, AppConfig } from '../../../types';
import { RoomManagement } from '../../../components/admin/RoomManagement';

const { Title, Text } = Typography;
const { Option } = Select;

const StoreManagement: React.FC = () => {
  const { t } = useTranslation();
  const { data: stores = [], loading, refresh } = useFirestoreQuery(getAllStores);
  const [appConfig, setAppConfig] = useState<AppConfig | null>(null);
  const { item: editingStore, open: isModalVisible, openDrawer: openEditDrawer, closeDrawer: closeEditDrawer } = useDetailDrawer<Store | null>();
  const { item: selectedStoreId, open: isRoomModalVisible, openDrawer: openRoomDrawer, closeDrawer: closeRoomDrawer } = useDetailDrawer<string>();
  const [form] = Form.useForm();
  const [isMobile, setIsMobile] = useState(() => typeof window !== 'undefined' && window.innerWidth < 768);

  useEffect(() => {
    const update = () => setIsMobile(window.innerWidth < 768);
    window.addEventListener('resize', update);
    return () => window.removeEventListener('resize', update);
  }, []);

  useEffect(() => {
    loadConfig();
  }, []);

  const loadConfig = async () => {
    try {
      const config = await getAppConfig();
      setAppConfig(config);
    } catch (error) {
      console.error('Failed to load app config:', error);
    }
  };

  const { confirmDelete } = useDeleteConfirm(
    async (id: string) => await deleteStore(id),
    { onSuccess: refresh }
  );

  const handleAdd = () => {
    // Check store quota against plan definition (falls back to stored quota)
    const activePlanDef = appConfig?.subscription?.plans?.find(
      (p: any) => p.id === (appConfig?.subscription?.planId || appConfig?.subscription?.plan)
    );
    const maxStores = activePlanDef?.maxStores ?? appConfig?.subscription?.quota?.maxStores ?? 1;
    if (activeCount >= maxStores) {
      message.error(t('storeManagement.limitReached', { max: maxStores }));
      return;
    }
    
    form.resetFields();
    openEditDrawer(null);
  };

  const handleEdit = (store: Store) => {
    form.setFieldsValue(store);
    openEditDrawer(store);
  };

  const handleDelete = (id: string) => {
    if (id === 'default') {
      message.error(t('storeManagement.defaultStoreDeleteError'));
      return;
    }
    confirmDelete(id);
  };

  const handleModalOk = async () => {
    try {
      const values = await form.validateFields();
      if (editingStore) {
        const res = await updateStore(editingStore.id, values);
        if (res.success) {
          message.success(t('storeManagement.saveSuccess'));
          closeEditDrawer();
          refresh();
        } else {
          message.error(res.error);
        }
      } else {
        const res = await createStore({
          ...values,
          status: 'active'
        });
        if (res.success) {
          message.success(t('storeManagement.createSuccess'));
          closeEditDrawer();
          refresh();
        } else {
          message.error(res.error);
        }
      }
    } catch (error) {
      // Form validation error
    }
  };

  const activeCount = stores.filter(s => s.status === 'active').length;
  const activePlanDef = appConfig?.subscription?.plans?.find(
    (p: any) => p.id === (appConfig?.subscription?.planId || appConfig?.subscription?.plan)
  );
  const maxStores = activePlanDef?.maxStores ?? appConfig?.subscription?.quota?.maxStores ?? 1;

  return (
    <div style={{ padding: isMobile ? '12px 12px' : '12px 16px', maxWidth: 1200, margin: '0 auto' }}>
      {/* Header */}
      <div style={{
        display: 'flex',
        flexDirection: isMobile ? 'column' : 'row',
        justifyContent: 'space-between',
        alignItems: isMobile ? 'flex-start' : 'center',
        marginBottom: 20,
        gap: 12
      }}>
        <div>
          <Title level={isMobile ? 3 : 2} style={{ 
            backgroundImage: 'linear-gradient(to right,#FDE08D,#C48D3A)', 
            WebkitBackgroundClip: 'text', 
            color: 'transparent',
            margin: 0
          }}>
            {t('storeManagement.title')}
          </Title>
          <Text style={{ color: 'rgba(255,255,255,0.45)', fontSize: 13 }}>
            {t('storeManagement.subtitle')}
          </Text>
        </div>
        <Button 
          type="primary" 
          icon={<PlusOutlined />} 
          onClick={handleAdd}
          style={{ 
            background: 'linear-gradient(to right,#FDE08D,#C48D3A)', 
            color: '#111', 
            border: 'none',
            fontWeight: 800,
            borderRadius: 20,
            height: 40,
            paddingInline: 24,
            boxShadow: '0 4px 15px rgba(196,141,58,0.3)'
          }}
        >
          {t('storeManagement.addStore')}
        </Button>
      </div>

      {/* Summary Stats Row */}
      <div style={{
        display: 'grid',
        gridTemplateColumns: isMobile ? 'repeat(3, 1fr)' : 'repeat(3, 1fr)',
        gap: isMobile ? 8 : 16,
        marginBottom: 24
      }}>
        {[
          { label: t('storeManagement.total'), value: stores.length, color: '#FDE08D', icon: <ShopOutlined /> },
          { label: t('storeManagement.active'), value: activeCount, color: '#52c41a', icon: <CheckCircleOutlined /> },
          { label: t('storeManagement.quota'), value: `${activeCount}/${maxStores}`, color: activeCount >= maxStores ? '#ff4d4f' : '#C48D3A', icon: <EnvironmentOutlined /> }
        ].map((stat) => (
          <div key={stat.label} style={{
            background: 'rgba(255,255,255,0.03)',
            border: '1px solid rgba(255,255,255,0.08)',
            borderRadius: 14,
            padding: isMobile ? '14px 12px' : '18px 20px',
            backdropFilter: 'blur(10px)',
            textAlign: 'center',
            transition: 'all 0.3s ease'
          }}>
            <div style={{ fontSize: isMobile ? 20 : 28, marginBottom: 4, color: stat.color, opacity: 0.7 }}>
              {stat.icon}
            </div>
            <div style={{
              fontSize: isMobile ? 18 : 24,
              fontWeight: 800,
              color: stat.color,
              lineHeight: 1
            }}>
              {stat.value}
            </div>
            <div style={{
              color: 'rgba(255,255,255,0.45)',
              fontSize: isMobile ? 10 : 12,
              marginTop: 4,
              letterSpacing: 0.5
            }}>
              {stat.label}
            </div>
          </div>
        ))}
      </div>

      {/* Store Cards */}
      {loading ? (
        <div style={{ textAlign: 'center', padding: 60 }}>
          <Spin size="large" />
        </div>
      ) : stores.length === 0 ? (
        <div style={{
          background: 'rgba(255,255,255,0.03)',
          border: '1px dashed rgba(255,255,255,0.15)',
          borderRadius: 16,
          padding: '60px 20px',
          textAlign: 'center'
        }}>
          <ShopOutlined style={{ fontSize: 48, color: 'rgba(253,224,141,0.3)', marginBottom: 16 }} />
          <div style={{ color: 'rgba(255,255,255,0.5)', fontSize: 15 }}>{t('storeManagement.noStores')}</div>
          <div style={{ color: 'rgba(255,255,255,0.3)', fontSize: 13, marginTop: 4 }}>
            {t('storeManagement.addFirstStore')}
          </div>
        </div>
      ) : (
        <div style={{
          display: 'grid',
          gridTemplateColumns: isMobile ? '1fr' : 'repeat(auto-fill, minmax(340px, 1fr))',
          gap: 16
        }}>
          {stores.map((store) => (
            <div
              key={store.id}
              className="store-card"
              style={{
                position: 'relative',
                background: 'rgba(255,255,255,0.03)',
                border: '1px solid rgba(244,175,37,0.15)',
                borderRadius: 16,
                padding: 0,
                overflow: 'hidden',
                transition: 'all 0.3s cubic-bezier(0.4,0,0.2,1)',
                cursor: 'default'
              }}
            >
              {/* Card Header - Store Name & Status */}
              <div style={{
                display: 'flex',
                justifyContent: 'space-between',
                alignItems: 'center',
                padding: '16px 20px 12px',
                borderBottom: '1px solid rgba(255,255,255,0.05)'
              }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 10, flex: 1, minWidth: 0 }}>
                  <div style={{
                    width: 38,
                    height: 38,
                    borderRadius: 10,
                    background: 'linear-gradient(135deg, rgba(253,224,141,0.15), rgba(196,141,58,0.1))',
                    border: '1px solid rgba(253,224,141,0.2)',
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    flexShrink: 0
                  }}>
                    <ShopOutlined style={{ color: '#FDE08D', fontSize: 18 }} />
                  </div>
                  <div style={{ minWidth: 0, flex: 1 }}>
                    <div style={{
                      color: '#fff',
                      fontSize: 16,
                      fontWeight: 700,
                      lineHeight: 1.3,
                      overflow: 'hidden',
                      textOverflow: 'ellipsis',
                      whiteSpace: 'nowrap'
                    }}>
                      {store.name}
                    </div>
                    <Tag
                      color={store.status === 'active' ? 'success' : 'default'}
                      style={{
                        fontSize: 10,
                        lineHeight: '16px',
                        borderRadius: 4,
                        border: 'none',
                        marginTop: 2,
                        padding: '0 6px',
                        fontWeight: 600
                      }}
                    >
                      {store.status === 'active' ? `● ${t('storeManagement.active').toUpperCase()}` : `○ ${t('storeManagement.inactive').toUpperCase()}`}
                    </Tag>
                  </div>
                </div>
                {/* Action Buttons */}
                <Space size={0}>
                  <Button
                    type="text"
                    size="small"
                    icon={<EditOutlined />}
                    onClick={() => handleEdit(store)}
                    style={{ color: '#FDE08D', fontSize: 14 }}
                  />
                  <Button
                    type="text"
                    size="small"
                    danger
                    icon={<DeleteOutlined />}
                    onClick={() => handleDelete(store.id)}
                    style={{ fontSize: 14 }}
                    disabled={store.id === 'default'}
                  />
                </Space>
              </div>

              {/* Card Body - Details */}
              <div style={{ padding: '14px 20px 16px' }}>
                {/* Address */}
                <div style={{
                  display: 'flex',
                  gap: 8,
                  marginBottom: 10,
                  alignItems: 'flex-start'
                }}>
                  <EnvironmentOutlined style={{
                    color: 'rgba(253,224,141,0.5)',
                    fontSize: 13,
                    marginTop: 3,
                    flexShrink: 0
                  }} />
                  <Text style={{
                    color: 'rgba(255,255,255,0.6)',
                    fontSize: 13,
                    lineHeight: '1.5',
                    display: '-webkit-box',
                    WebkitLineClamp: 2,
                    WebkitBoxOrient: 'vertical' as any,
                    overflow: 'hidden'
                  }}>
                    {store.address || '-'}
                  </Text>
                </div>

                {/* Contact Info */}
                <div style={{
                  display: 'flex',
                  flexWrap: 'wrap',
                  gap: '6px 16px'
                }}>
                  {store.phone && (
                    <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                      <PhoneOutlined style={{ color: 'rgba(253,224,141,0.4)', fontSize: 12 }} />
                      <Text style={{ color: 'rgba(255,255,255,0.5)', fontSize: 12 }}>{store.phone}</Text>
                    </div>
                  )}
                  {store.email && (
                    <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                      <MailOutlined style={{ color: 'rgba(253,224,141,0.4)', fontSize: 12 }} />
                      <Text style={{ color: 'rgba(255,255,255,0.5)', fontSize: 12 }}>{store.email}</Text>
                    </div>
                  )}
                </div>
              </div>

              {/* Card Footer - Room Config Button */}
              <div style={{
                padding: '12px 20px',
                borderTop: '1px solid rgba(255,255,255,0.05)',
                display: 'flex',
                justifyContent: 'flex-end',
                background: 'rgba(255,255,255,0.01)'
              }}>
                <Button
                  type="link"
                  size="small"
                  icon={<CalendarOutlined />}
                  onClick={() => openRoomDrawer(store.id)}
                  style={{ color: '#FDE08D', padding: 0, height: 'auto', display: 'flex', alignItems: 'center', gap: 4 }}
                >
                  {t('roomManagement.roomConfigTitle', 'Room Management')}
                </Button>
              </div>

              {/* Subtle gold border glow on the left */}
              <div style={{
                position: 'absolute',
                left: 0,
                top: 0,
                bottom: 0,
                width: 3,
                background: store.status === 'active'
                  ? 'linear-gradient(to bottom, #FDE08D, #C48D3A)'
                  : 'rgba(255,255,255,0.1)',
                borderRadius: '16px 0 0 16px'
              }} />
            </div>
          ))}
        </div>
      )}

      {/* Create / Edit Modal */}
      <Modal
        title={<span style={{ color: '#FDE08D', fontSize: 18, fontWeight: 700 }}>{editingStore ? t('storeManagement.editStore') : t('storeManagement.addStore')}</span>}
        open={isModalVisible}
        onOk={handleModalOk}
        onCancel={closeEditDrawer}
        okText={editingStore ? t('common.save') : t('common.add')}
        className="dark-modal"
        width={520}
        okButtonProps={{
          style: {
            background: 'linear-gradient(to right,#FDE08D,#C48D3A)',
            color: '#111',
            border: 'none',
            fontWeight: 700,
            borderRadius: 8
          }
        }}
        cancelButtonProps={{
          style: {
            background: 'rgba(255,255,255,0.05)',
            border: '1px solid rgba(255,255,255,0.15)',
            color: '#fff',
            borderRadius: 8
          }
        }}
        styles={{
          mask: { backdropFilter: 'blur(6px)' },
          content: { background: '#1a1a1a', color: '#fff', borderRadius: 16, border: '1px solid rgba(244,175,37,0.15)' }
        }}
      >
        <Form
          form={form}
          layout="vertical"
          initialValues={{ status: 'active' }}
        >
          <Form.Item
            name="name"
            label={<span style={{ color: '#ccc' }}>{t('storeManagement.storeName')}</span>}
            rules={[{ required: true, message: t('common.required') }]}
          >
            <Input placeholder="E.g., KL Main Branch" />
          </Form.Item>
          <Form.Item
            name="address"
            label={<span style={{ color: '#ccc' }}>{t('storeManagement.address')}</span>}
            rules={[{ required: true, message: t('common.required') }]}
          >
            <Input.TextArea rows={3} placeholder="Full address" />
          </Form.Item>
          <Row gutter={16}>
            <Col span={12}>
              <Form.Item
                name="phone"
                label={<span style={{ color: '#ccc' }}>{t('storeManagement.phone')}</span>}
                rules={[{ required: true, message: t('common.required') }]}
              >
                <Input placeholder="Contact number" />
              </Form.Item>
            </Col>
            <Col span={12}>
              <Form.Item
                name="status"
                label={<span style={{ color: '#ccc' }}>{t('storeManagement.status')}</span>}
              >
                <Select dropdownStyle={{ background: '#1a1a1a' }}>
                  <Option value="active">{t('storeManagement.active')}</Option>
                  <Option value="inactive">{t('storeManagement.inactive')}</Option>
                </Select>
              </Form.Item>
            </Col>
          </Row>
          <Form.Item
            name="email"
            label={<span style={{ color: '#ccc' }}>{t('storeManagement.email')}</span>}
            rules={[{ required: true, message: t('common.required') }, { type: 'email', message: t('auth.emailInvalid') }]}
          >
            <Input placeholder="Store email" />
          </Form.Item>
        </Form>
      </Modal>

      {/* Room Management Modal */}
      <Modal
        title={
          <span style={{ color: '#FDE08D', fontSize: 18, fontWeight: 700 }}>
            {t('roomManagement.roomConfigTitle', 'Room Management')} - {stores.find(s => s.id === selectedStoreId)?.name}
          </span>
        }
        open={isRoomModalVisible}
        onCancel={closeRoomDrawer}
        footer={null}
        width={1000}
        className="dark-modal"
        styles={{
          content: {
            background: 'linear-gradient(180deg, #221c10 0%, #181611 100%)',
            border: '1px solid rgba(244, 175, 37, 0.6)'
          },
          header: {
            background: 'transparent',
            borderBottom: '1px solid rgba(244, 175, 37, 0.6)'
          },
          body: {
            background: 'transparent',
            paddingTop: 16
          }
        }}
      >
        {selectedStoreId && (
          <RoomManagement filterStoreId={selectedStoreId} hideViewBookings={true} />
        )}
      </Modal>

      <style dangerouslySetInnerHTML={{ __html: `
        .store-card:hover {
          border-color: rgba(253,224,141,0.4) !important;
          background: rgba(253,224,141,0.03) !important;
          box-shadow: 0 8px 32px rgba(0,0,0,0.3), 0 0 0 1px rgba(253,224,141,0.1);
          transform: translateY(-2px);
        }
        .dark-modal .ant-modal-header, .dark-modal .ant-modal-content {
          background: #1a1a1a !important;
          color: #fff !important;
        }
        .dark-modal .ant-modal-title {
          color: #FDE08D !important;
          background: transparent !important;
        }
        .dark-modal .ant-form-item-label > label {
          color: #ccc !important;
        }
        .dark-modal .ant-input, .dark-modal .ant-select-selector, .dark-modal textarea.ant-input {
          background: rgba(255,255,255,0.05) !important;
          border: 1px solid rgba(255,255,255,0.1) !important;
          color: #fff !important;
          border-radius: 8px !important;
        }
        .dark-modal .ant-input:focus, .dark-modal .ant-input-focused,
        .dark-modal .ant-select-focused .ant-select-selector {
          border-color: rgba(253,224,141,0.5) !important;
          box-shadow: 0 0 0 2px rgba(253,224,141,0.1) !important;
        }
        .dark-modal .ant-input::placeholder {
          color: rgba(255,255,255,0.25) !important;
        }
        .ant-modal-close-icon {
          color: #fff !important;
        }
        .dark-modal .ant-modal-footer {
          border-top: 1px solid rgba(255,255,255,0.06) !important;
        }
      `}} />
    </div>
  );
};

export default StoreManagement;
