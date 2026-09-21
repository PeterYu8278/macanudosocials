// 充值验证组件
import React, { useState, useEffect } from 'react';
import { useTranslation } from 'react-i18next';
import { Table, Button, Space, Tag, Modal, Form, Input, InputNumber, Upload, Image, Select, Spin, Checkbox, App } from 'antd';
import { CheckOutlined, CloseOutlined, UploadOutlined, EyeOutlined, PlusOutlined } from '@ant-design/icons';
import { getAllReloadRecords, verifyReloadRecord, rejectReloadRecord, createReloadRecord } from '../../services/firebase/reload';
import { processPendingMembershipFees } from '../../services/firebase/scheduledJobs';
import dayjs from 'dayjs';
import { uploadFile } from '../../services/cloudinary/create';
import { getAllStores } from '../../services/firebase/stores';
import { getAllUsers } from '../../services/firebase/firestore';
import { useAuthStore } from '../../store/modules';
import type { ReloadRecord, Store, User } from '../../types';
import StoreSelect from '../common/StoreSelect';

interface ReloadVerificationProps {
  onRefresh?: () => void;
}

export const ReloadVerification: React.FC<ReloadVerificationProps> = ({ onRefresh }) => {
  const { message } = App.useApp();
  const [loading, setLoading] = useState(false);
  const [records, setRecords] = useState<ReloadRecord[]>([]);
  const [statusFilter, setStatusFilter] = useState<'all' | 'pending' | 'completed' | 'rejected'>('all');
  const [verifyModalVisible, setVerifyModalVisible] = useState(false);
  const [rejectModalVisible, setRejectModalVisible] = useState(false);
  const [manualCreateVisible, setManualCreateVisible] = useState(false);
  const [currentRecord, setCurrentRecord] = useState<ReloadRecord | null>(null);
  const [form] = Form.useForm();
  const [rejectForm] = Form.useForm();
  const [manualForm] = Form.useForm();
  const [uploading, setUploading] = useState(false);
  const [manualSubmitting, setManualSubmitting] = useState(false);
  const [proofUrl, setProofUrl] = useState<string>('');
  const [stores, setStores] = useState<Store[]>([]);
  const [users, setUsers] = useState<User[]>([]);
  const { t, i18n } = useTranslation();
  const { isSuperAdmin, user: currentUser } = useAuthStore();
  const isMobile = typeof window !== 'undefined' ? window.matchMedia('(max-width: 768px)').matches : false;

  useEffect(() => {
    loadRecords();
    loadStores();
    if (isSuperAdmin) loadUsers();
  }, [statusFilter]);

  const loadStores = async () => {
    try {
      const storeList = await getAllStores();
      setStores(storeList);
    } catch (error) {
      console.error('加载门店列表失败:', error);
    }
  };

  const loadUsers = async () => {
    try {
      const userList = await getAllUsers();
      setUsers(userList);
    } catch (error) {
      console.error('加载用户列表失败:', error);
    }
  };

  const loadRecords = async () => {
    setLoading(true);
    try {
      const filter = statusFilter === 'all' ? undefined : statusFilter;
      const allRecords = await getAllReloadRecords(filter);
      setRecords(allRecords);
      if (allRecords.length === 0) {
        if (statusFilter === 'pending') {
          message.info(t('pointsConfig.reloadVerification.noPendingRecords'));
        } else {
          message.info(t('pointsConfig.reloadVerification.noRecords'));
        }
      }
    } catch (error: any) {
      console.error('[ReloadVerification] 加载充值记录失败:', error);
      message.error(t('pointsConfig.reloadVerification.loadFailed') + ': ' + (error.message || t('common.unknownError')));
    } finally {
      setLoading(false);
    }
  };

  const handleVerify = (record: ReloadRecord) => {
    setCurrentRecord(record);
    setVerifyModalVisible(true);
    form.resetFields();
    setProofUrl('');
  };

  const handleReject = (record: ReloadRecord) => {
    setCurrentRecord(record);
    setRejectModalVisible(true);
    rejectForm.resetFields();
  };

  const onVerifySubmit = async (values: any) => {
    if (!currentRecord) return;

    setUploading(true);
    try {
      let finalProofUrl = proofUrl;
      
      // 如果有上传的文件，先上传到Cloudinary
      if (values.proof && values.proof.fileList && values.proof.fileList.length > 0) {
        const file = values.proof.fileList[0].originFileObj;
        if (file) {
          const uploadResult = await uploadFile(file, { 
            folder: 'jep-cigar/reload-proofs',
            resourceType: 'image'
          });
          if (uploadResult.secure_url || uploadResult.url) {
            finalProofUrl = uploadResult.secure_url || uploadResult.url || '';
          }
        }
      }

      const result = await verifyReloadRecord(
        currentRecord.id,
        'admin', // TODO: 使用实际的管理员ID
        finalProofUrl || undefined,
        values.notes
      );

      if (result.success) {
        message.success(t('pointsConfig.reloadVerification.verifySuccess'));
        setVerifyModalVisible(false);
        form.resetFields();
        setProofUrl('');
        loadRecords();
        onRefresh?.();
        
        // 充值验证成功后，自动检查并扣除年费
        try {
          const deductionResult = await processPendingMembershipFees();
          if (deductionResult.success && deductionResult.processed > 0) {
            // 静默执行，不显示消息
          }
        } catch (error: any) {
          console.error('[ReloadVerification] 充值后自动扣除年费失败:', error);
          // 静默失败，不显示错误消息
        }
      } else {
        message.error(result.error || t('pointsConfig.reloadVerification.verifyFailed'));
      }
    } catch (error: any) {
      message.error(error.message || t('pointsConfig.reloadVerification.verifyFailed'));
    } finally {
      setUploading(false);
    }
  };

  const onRejectSubmit = async (values: any) => {
    if (!currentRecord) return;

    try {
      const result = await rejectReloadRecord(
        currentRecord.id,
        'admin', // TODO: 使用实际的管理员ID
        values.notes
      );

      if (result.success) {
        message.success(t('pointsConfig.reloadVerification.rejectSuccess'));
        setRejectModalVisible(false);
        rejectForm.resetFields();
        loadRecords();
        onRefresh?.();
      } else {
        message.error(result.error || t('pointsConfig.reloadVerification.rejectFailed'));
      }
    } catch (error: any) {
      message.error(error.message || t('pointsConfig.reloadVerification.rejectFailed'));
    }
  };

  const onManualCreateSubmit = async (values: any) => {
    setManualSubmitting(true);
    try {
      const selectedUser = users.find(u => u.id === values.userId);
      const result = await createReloadRecord(
        values.userId,
        values.amount,
        selectedUser?.displayName,
        values.storeId,
        undefined
      );

      if (!result.success || !result.recordId) {
        message.error(result.error || t('pointsConfig.reloadVerification.manualCreateFailed'));
        return;
      }

      if (values.autoVerify) {
        const verifyResult = await verifyReloadRecord(
          result.recordId,
          currentUser?.id || 'admin',
          undefined,
          values.notes || `手动充值 by ${currentUser?.displayName || 'admin'}`
        );
        if (!verifyResult.success) {
          message.warning('已创建充值记录，但自动验证失败：' + verifyResult.error);
        } else {
          message.success(t('pointsConfig.reloadVerification.manualCreateSuccess'));
        }
      } else {
        message.success(t('pointsConfig.reloadVerification.manualCreateSuccess'));
      }

      setManualCreateVisible(false);
      manualForm.resetFields();
      loadRecords();
      onRefresh?.();
    } catch (error: any) {
      message.error(error.message || t('pointsConfig.reloadVerification.manualCreateFailed'));
    } finally {
      setManualSubmitting(false);
    }
  };

  const columns = [
    {
      title: t('pointsConfig.reloadVerification.time'),
      dataIndex: 'createdAt',
      key: 'createdAt',
      width: 180,
      render: (date: Date) => dayjs(date).format(i18n.language === 'en-US' ? 'D MMM, YYYY HH:mm' : 'YYYY-MM-DD HH:mm')
    },
    {
      title: t('pointsConfig.reloadVerification.user'),
      dataIndex: 'userName',
      key: 'userName',
      width: 150,
      render: (name: string, record: ReloadRecord) => name || record.userId
    },
    {
      title: t('pointsConfig.reloadVerification.store'),
      dataIndex: 'storeId',
      key: 'storeId',
      width: 150,
      render: (storeId: string) => {
        const store = stores.find(s => s.id === storeId);
        return store?.name || '-';
      }
    },
    {
      title: t('pointsConfig.reloadVerification.amount'),
      dataIndex: 'requestedAmount',
      key: 'requestedAmount',
      width: 120,
      render: (amount: number, record: ReloadRecord) => (
        <div>
          <div>{amount} RM</div>
          <div style={{ fontSize: 12, color: '#999' }}>
            {t('pointsConfig.reloadVerification.pointsEquivalent', { points: record.pointsEquivalent })}
          </div>
        </div>
      )
    },
    {
      title: t('pointsConfig.reloadVerification.status'),
      dataIndex: 'status',
      key: 'status',
      width: 100,
      render: (status: string) => {
        const statusMap: Record<string, { color: string; text: string }> = {
          pending: { color: 'orange', text: t('pointsConfig.reloadVerification.statusPending') },
          completed: { color: 'green', text: t('pointsConfig.reloadVerification.statusCompleted') },
          rejected: { color: 'red', text: t('pointsConfig.reloadVerification.statusRejected') }
        };
        const statusInfo = statusMap[status] || { color: 'default', text: status };
        return <Tag color={statusInfo.color}>{statusInfo.text}</Tag>;
      }
    },
    {
      title: t('pointsConfig.reloadVerification.adminNotes'),
      dataIndex: 'adminNotes',
      key: 'adminNotes',
      ellipsis: true,
      render: (notes: string) => notes || '-'
    },
    {
      title: t('pointsConfig.reloadVerification.proof'),
      dataIndex: 'verificationProof',
      key: 'verificationProof',
      width: 100,
      render: (proof: string) => {
        if (!proof) return '-';
        return (
          <Button
            type="link"
            icon={<EyeOutlined />}
            onClick={() => {
              Modal.info({
              title: <span style={{ color: '#FFFFFF' }}>{t('pointsConfig.reloadVerification.proofModalTitle')}</span>,
                content: <Image src={proof} alt={t('pointsConfig.reloadVerification.proofModalAlt')} style={{ maxWidth: '100%' }} />,
              width: 600,
              styles: {
                content: {
                  background: 'linear-gradient(180deg, #221c10 0%, #181611 100%)',
                  border: '1px solid rgba(244, 175, 37, 0.6)'
                },
                header: {
                  background: 'transparent',
                  borderBottom: '1px solid rgba(244, 175, 37, 0.6)'
                },
                body: {
                  background: 'transparent'
                }
              },
              okButtonProps: {
                style: {
                  background: 'linear-gradient(to right, #FDE08D, #C48D3A)',
                  border: 'none',
                  color: '#111',
                  fontWeight: 700
                }
              }
              });
            }}
          style={{
            color: '#FFD700',
            padding: 0
          }}
          >
            {t('pointsConfig.reloadVerification.view')}
          </Button>
        );
      }
    },
    {
      title: t('pointsConfig.reloadVerification.action'),
      key: 'action',
      width: 200,
      render: (_: any, record: ReloadRecord) => (
        <Space>
          <Button
            size="small"
            icon={<CheckOutlined />}
            onClick={() => handleVerify(record)}
            disabled={record.status !== 'pending'}
            style={{
              background: record.status === 'pending' 
                ? 'linear-gradient(to right, #FDE08D, #C48D3A)' 
                : 'rgba(255, 255, 255, 0.1)',
              border: 'none',
              color: record.status === 'pending' ? '#111' : 'rgba(255, 255, 255, 0.5)',
              fontWeight: 700
            }}
          >
            {t('pointsConfig.reloadVerification.verify')}
          </Button>
          <Button
            size="small"
            icon={<CloseOutlined />}
            onClick={() => handleReject(record)}
            disabled={record.status !== 'pending'}
            style={{
              background: record.status === 'pending' 
                ? 'rgba(255, 77, 79, 0.8)' 
                : 'rgba(255, 255, 255, 0.1)',
              border: 'none',
              color: record.status === 'pending' ? '#FFFFFF' : 'rgba(255, 255, 255, 0.5)',
              fontWeight: 700
            }}
          >
            {t('pointsConfig.reloadVerification.reject')}
          </Button>
        </Space>
      )
    }
  ];

  return (
    <>
      <div style={{ marginBottom: 16, display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: 8 }}>
        <Select
          value={statusFilter}
          onChange={(value) => setStatusFilter(value)}
          style={{ width: 150 }}
          options={[
            { label: t('pointsConfig.reloadVerification.statusAll'), value: 'all' },
            { label: t('pointsConfig.reloadVerification.statusPending'), value: 'pending' },
            { label: t('pointsConfig.reloadVerification.statusCompleted'), value: 'completed' },
            { label: t('pointsConfig.reloadVerification.statusRejected'), value: 'rejected' }
          ]}
          className="points-config-form"
        />
        <Space>
          {isSuperAdmin && (
            <Button
              icon={<PlusOutlined />}
              onClick={() => {
                manualForm.resetFields();
                manualForm.setFieldValue('autoVerify', true);
                setManualCreateVisible(true);
              }}
              style={{
                background: 'linear-gradient(to right, #FDE08D, #C48D3A)',
                border: 'none',
                color: '#111',
                fontWeight: 700
              }}
            >
              {t('pointsConfig.reloadVerification.manualCreate')}
            </Button>
          )}
          <Button
            onClick={loadRecords}
            loading={loading}
            style={{
              background: 'rgba(255, 255, 255, 0.1)',
              border: '1px solid rgba(255, 255, 255, 0.2)',
              color: '#FFFFFF'
            }}
          >
            {t('common.refresh')}
          </Button>
        </Space>
      </div>
      {!isMobile ? (
        <div className="points-config-form">
      <Table
        columns={columns}
        dataSource={records}
        rowKey="id"
        loading={loading}
        pagination={{
          pageSize: 20,
          showSizeChanger: true
        }}
            style={{
              background: 'transparent'
            }}
          />
        </div>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
          {loading ? (
            <div style={{ textAlign: 'center', padding: '40px 20px', color: 'rgba(255, 255, 255, 0.6)' }}>
              <Spin />
            </div>
          ) : records.length === 0 ? (
            <div style={{ color: 'rgba(255, 255, 255, 0.6)', textAlign: 'center', padding: '24px 0' }}>
              {t('pointsConfig.reloadVerification.noRecords')}
            </div>
          ) : (
            records.map((record) => {
              const statusMap: Record<string, { color: string; text: string }> = {
                pending: { color: '#fb923c', text: t('pointsConfig.reloadVerification.statusPending') },
                completed: { color: '#34d399', text: t('pointsConfig.reloadVerification.statusCompleted') },
                rejected: { color: '#f87171', text: t('pointsConfig.reloadVerification.statusRejected') }
              };
              const statusInfo = statusMap[record.status] || { color: '#9ca3af', text: record.status };

              const createdDate = record.createdAt instanceof Date
                ? record.createdAt
                : (record.createdAt as any)?.toDate
                  ? (record.createdAt as any).toDate()
                  : new Date(record.createdAt);

              return (
                <div
                  key={record.id}
                  style={{
                    border: '1px solid rgba(244,175,37,0.2)',
                    borderRadius: 12,
                    padding: 12,
                    background: 'rgba(34,28,16,0.5)',
                    backdropFilter: 'blur(10px)'
                  }}
                >
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 8 }}>
                    <div style={{ flex: 1 }}>
                      <div style={{ fontSize: 13, fontWeight: 600, color: 'rgba(255,255,255,0.85)', marginBottom: 4 }}>
                        {record.userName || record.userId.substring(0, 20)}
                      </div>
                      <div style={{ fontSize: 12, color: 'rgba(255,255,255,0.6)', marginBottom: 4 }}>
                        {dayjs(createdDate).format(i18n.language === 'en-US' ? 'D MMM, YYYY HH:mm' : 'YYYY-MM-DD HH:mm')}
                      </div>
                      <div style={{ fontSize: 12, color: 'rgba(255,255,255,0.6)' }}>
                        {record.requestedAmount} RM {t('pointsConfig.reloadVerification.pointsEquivalent', { points: record.pointsEquivalent })}
                      </div>
                      <div style={{ fontSize: 12, color: '#f4af25', marginTop: 4 }}>
                        {t('pointsConfig.reloadVerification.store')}: {stores.find(s => s.id === record.storeId)?.name || '-'}
                      </div>
                      {record.adminNotes && (
                        <div style={{ 
                          fontSize: 12, 
                          color: 'rgba(255,255,255,0.5)', 
                          marginTop: 4,
                          padding: '4px 8px',
                          background: 'rgba(255,255,255,0.05)',
                          borderRadius: 4,
                          borderLeft: '2px solid rgba(244,175,37,0.5)'
                        }}>
                          {record.adminNotes}
                        </div>
                      )}
                    </div>
                    <div style={{ textAlign: 'right', marginLeft: 12 }}>
                      <div style={{
                        fontSize: 11,
                        padding: '2px 8px',
                        borderRadius: 4,
                        background: statusInfo.color === '#fb923c' ? 'rgba(251,146,60,0.2)' :
                          statusInfo.color === '#34d399' ? 'rgba(52,211,153,0.2)' :
                          'rgba(248,113,113,0.2)',
                        color: statusInfo.color,
                        fontWeight: 600,
                        marginBottom: 8
                      }}>
                        {statusInfo.text}
                      </div>
                      {record.verificationProof && (
                        <Button
                          type="link"
                          icon={<EyeOutlined />}
                          size="small"
                          onClick={() => {
                            Modal.info({
                              title: <span style={{ color: '#FFFFFF' }}>{t('pointsConfig.reloadVerification.proofModalTitle')}</span>,
                              content: <Image src={record.verificationProof!} alt={t('pointsConfig.reloadVerification.proofModalAlt')} style={{ maxWidth: '100%' }} />,
                              width: isMobile ? '90%' : 600,
                              styles: {
                                content: {
                                  background: 'linear-gradient(180deg, #221c10 0%, #181611 100%)',
                                  border: '1px solid rgba(244, 175, 37, 0.6)'
                                },
                                header: {
                                  background: 'transparent',
                                  borderBottom: '1px solid rgba(244, 175, 37, 0.6)'
                                },
                                body: {
                                  background: 'transparent'
                                }
                              },
                              okButtonProps: {
                                style: {
                                  background: 'linear-gradient(to right, #FDE08D, #C48D3A)',
                                  border: 'none',
                                  color: '#111',
                                  fontWeight: 700
                                }
                              }
                            });
                          }}
                          style={{
                            color: '#FFD700',
                            padding: 0,
                            fontSize: 11
                          }}
                        >
                          {t('pointsConfig.reloadVerification.view')}
                        </Button>
                      )}
                    </div>
                  </div>
                  {record.status === 'pending' && (
                    <div style={{ display: 'flex', gap: 8, marginTop: 8, paddingTop: 8, borderTop: '1px solid rgba(244,175,37,0.1)' }}>
                      <Button
                        size="small"
                        icon={<CheckOutlined />}
                        onClick={() => handleVerify(record)}
                        style={{
                          flex: 1,
                          background: 'linear-gradient(to right, #FDE08D, #C48D3A)',
                          border: 'none',
                          color: '#111',
                          fontWeight: 700
                        }}
                      >
                        {t('pointsConfig.reloadVerification.verify')}
                      </Button>
                      <Button
                        size="small"
                        icon={<CloseOutlined />}
                        onClick={() => handleReject(record)}
                        style={{
                          flex: 1,
                          background: 'rgba(255, 77, 79, 0.8)',
                          border: 'none',
                          color: '#FFFFFF',
                          fontWeight: 700
                        }}
                      >
                        {t('pointsConfig.reloadVerification.reject')}
                      </Button>
                    </div>
                  )}
                </div>
              );
            })
          )}
        </div>
      )}

      {/* 验证模态框 */}
      <Modal
        title={<span style={{ color: '#FFFFFF' }}>{t('pointsConfig.reloadVerification.verifyModalTitle')}</span>}
        open={verifyModalVisible}
        onCancel={() => {
          setVerifyModalVisible(false);
          form.resetFields();
          setProofUrl('');
        }}
        onOk={() => form.submit()}
        confirmLoading={uploading}
        width={600}
        okButtonProps={{
          style: {
            background: 'linear-gradient(to right, #FDE08D, #C48D3A)',
            border: 'none',
            color: '#111',
            fontWeight: 700
          }
        }}
        cancelButtonProps={{
          style: {
            background: 'rgba(255, 255, 255, 0.1)',
            border: '1px solid rgba(255, 255, 255, 0.2)',
            color: '#FFFFFF'
          }
        }}
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
            background: 'transparent'
          },
          footer: {
            background: 'transparent',
            borderTop: '1px solid rgba(244, 175, 37, 0.6)'
          }
        }}
      >
        {currentRecord && (
          <Form
            form={form}
            layout="vertical"
            onFinish={onVerifySubmit}
            className="points-config-form"
          >
            <div style={{ marginBottom: 16, color: 'rgba(255, 255, 255, 0.85)' }}>
              <div style={{ marginBottom: 8 }}>{t('pointsConfig.reloadVerification.user')}: {currentRecord.userName || currentRecord.userId}</div>
              <div style={{ marginBottom: 8 }}>{t('pointsConfig.reloadVerification.amount')}: {currentRecord.requestedAmount} RM</div>
              <div>{t('pointsConfig.reloadVerification.pointsEquivalent', { points: currentRecord.pointsEquivalent })}</div>
            </div>

            <Form.Item
              name="proof"
              label={<span style={{ color: 'rgba(255, 255, 255, 0.85)' }}>{t('pointsConfig.reloadVerification.uploadProofLabel')}</span>}
              valuePropName="fileList"
              getValueFromEvent={(e) => {
                if (Array.isArray(e)) {
                  return e;
                }
                return e?.fileList;
              }}
            >
              <Upload
                listType="picture-card"
                maxCount={1}
                beforeUpload={() => false}
                onChange={(info) => {
                  if (info.fileList.length > 0 && info.fileList[0].originFileObj) {
                    const file = info.fileList[0].originFileObj;
                    const reader = new FileReader();
                    reader.onload = (e) => {
                      setProofUrl(e.target?.result as string);
                    };
                    reader.readAsDataURL(file);
                  } else {
                    setProofUrl('');
                  }
                }}
              >
                <div>
                  <UploadOutlined style={{ color: 'rgba(255, 255, 255, 0.85)' }} />
                  <div style={{ marginTop: 8, color: 'rgba(255, 255, 255, 0.85)' }}>{t('pointsConfig.reloadVerification.upload')}</div>
                </div>
              </Upload>
            </Form.Item>

            <Form.Item
              name="notes"
              label={<span style={{ color: 'rgba(255, 255, 255, 0.85)' }}>{t('pointsConfig.reloadVerification.notesLabel')}</span>}
            >
              <Input.TextArea 
                rows={4} 
                placeholder={t('pointsConfig.reloadVerification.notesPlaceholder')} 
                style={{
                  background: 'rgba(255, 255, 255, 0.1)',
                  border: '1px solid rgba(255, 255, 255, 0.2)',
                  color: '#FFFFFF'
                }}
              />
            </Form.Item>
          </Form>
        )}
      </Modal>

      {/* 拒绝模态框 */}
      <Modal
        title={<span style={{ color: '#FFFFFF' }}>{t('pointsConfig.reloadVerification.rejectModalTitle')}</span>}
        open={rejectModalVisible}
        onCancel={() => {
          setRejectModalVisible(false);
          rejectForm.resetFields();
        }}
        onOk={() => rejectForm.submit()}
        okButtonProps={{ 
          danger: true,
          style: {
            background: '#ff4d4f',
            border: 'none',
            color: '#FFFFFF',
            fontWeight: 700
          }
        }}
        cancelButtonProps={{
          style: {
            background: 'rgba(255, 255, 255, 0.1)',
            border: '1px solid rgba(255, 255, 255, 0.2)',
            color: '#FFFFFF'
          }
        }}
        width={500}
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
            background: 'transparent'
          },
          footer: {
            background: 'transparent',
            borderTop: '1px solid rgba(244, 175, 37, 0.6)'
          }
        }}
      >
        {currentRecord && (
          <Form
            form={rejectForm}
            layout="vertical"
            onFinish={onRejectSubmit}
            className="points-config-form"
          >
            <div style={{ marginBottom: 16, color: 'rgba(255, 255, 255, 0.85)' }}>
              <div style={{ marginBottom: 8 }}>{t('pointsConfig.reloadVerification.user')}: {currentRecord.userName || currentRecord.userId}</div>
              <div>{t('pointsConfig.reloadVerification.amount')}: {currentRecord.requestedAmount} RM</div>
            </div>

            <Form.Item
              name="notes"
              label={<span style={{ color: 'rgba(255, 255, 255, 0.85)' }}>{t('pointsConfig.reloadVerification.rejectReasonLabel')}</span>}
              rules={[{ required: true, message: t('pointsConfig.reloadVerification.rejectReasonRequired') }]}
            >
              <Input.TextArea 
                rows={4} 
                placeholder={t('pointsConfig.reloadVerification.rejectReasonPlaceholder')} 
                style={{
                  background: 'rgba(255, 255, 255, 0.1)',
                  border: '1px solid rgba(255, 255, 255, 0.2)',
                  color: '#FFFFFF'
                }}
              />
            </Form.Item>
          </Form>
        )}
      </Modal>

      {/* 手动创建充值 Modal（仅 superAdmin/developer） */}
      {isSuperAdmin && (
        <Modal
          title={<span style={{ color: '#FFFFFF' }}>{t('pointsConfig.reloadVerification.manualCreateTitle')}</span>}
          open={manualCreateVisible}
          onCancel={() => {
            setManualCreateVisible(false);
            manualForm.resetFields();
          }}
          onOk={() => manualForm.submit()}
          confirmLoading={manualSubmitting}
          okText={t('pointsConfig.reloadVerification.manualCreateSubmit')}
          okButtonProps={{
            style: {
              background: 'linear-gradient(to right, #FDE08D, #C48D3A)',
              border: 'none',
              color: '#111',
              fontWeight: 700
            }
          }}
          cancelButtonProps={{
            style: {
              background: 'rgba(255, 255, 255, 0.1)',
              border: '1px solid rgba(255, 255, 255, 0.2)',
              color: '#FFFFFF'
            }
          }}
          width={520}
          styles={{
            content: {
              background: 'linear-gradient(180deg, #221c10 0%, #181611 100%)',
              border: '1px solid rgba(244, 175, 37, 0.6)'
            },
            header: {
              background: 'transparent',
              borderBottom: '1px solid rgba(244, 175, 37, 0.6)'
            },
            body: { background: 'transparent' },
            footer: {
              background: 'transparent',
              borderTop: '1px solid rgba(244, 175, 37, 0.6)'
            }
          }}
        >
          <Form
            form={manualForm}
            layout="vertical"
            onFinish={onManualCreateSubmit}
            className="points-config-form"
            initialValues={{ autoVerify: true }}
          >
            <Form.Item
              name="userId"
              label={<span style={{ color: 'rgba(255,255,255,0.85)' }}>{t('pointsConfig.reloadVerification.manualCreateUserLabel')}</span>}
              rules={[{ required: true, message: t('pointsConfig.reloadVerification.manualCreateUserRequired') }]}
            >
              <Select
                showSearch
                placeholder={t('pointsConfig.reloadVerification.manualCreateUserPlaceholder')}
                optionFilterProp="label"
                options={users.map(u => ({
                  label: `${u.displayName || u.email} (${u.role})`,
                  value: u.id
                }))}
                className="gold-select"
                popupClassName="gold-select-dropdown"
              />
            </Form.Item>

            <Form.Item
              name="amount"
              label={<span style={{ color: 'rgba(255,255,255,0.85)' }}>{t('pointsConfig.reloadVerification.manualCreateAmountLabel')}</span>}
              rules={[
                { required: true, message: t('pointsConfig.reloadVerification.manualCreateAmountRequired') },
                { type: 'number', min: 1, message: t('pointsConfig.reloadVerification.manualCreateAmountMin') }
              ]}
            >
              <InputNumber
                min={1}
                style={{
                  width: '100%',
                  background: 'rgba(255,255,255,0.1)',
                  border: '1px solid rgba(255,255,255,0.2)',
                  color: '#FFFFFF'
                }}
                prefix="RM"
              />
            </Form.Item>

            <Form.Item
              name="storeId"
              label={<span style={{ color: 'rgba(255,255,255,0.85)' }}>{t('pointsConfig.reloadVerification.store')}</span>}
            >
              <StoreSelect
                placeholder="-"
                allowClear
              />
            </Form.Item>

            <Form.Item
              name="notes"
              label={<span style={{ color: 'rgba(255,255,255,0.85)' }}>{t('pointsConfig.reloadVerification.manualCreateNotesLabel')}</span>}
            >
              <Input.TextArea
                rows={3}
                placeholder={t('pointsConfig.reloadVerification.manualCreateNotesPlaceholder')}
                style={{
                  background: 'rgba(255,255,255,0.1)',
                  border: '1px solid rgba(255,255,255,0.2)',
                  color: '#FFFFFF'
                }}
              />
            </Form.Item>

            <Form.Item name="autoVerify" valuePropName="checked">
              <Checkbox style={{ color: 'rgba(255,255,255,0.85)' }}>
                {t('pointsConfig.reloadVerification.manualCreateAutoVerify')}
              </Checkbox>
            </Form.Item>
          </Form>
        </Modal>
      )}
    </>
  );
};

