// 充值验证组件
import React, { useState, useEffect } from 'react';
import { useTranslation } from 'react-i18next';
import { Table, Button, Space, Tag, Modal, Form, Input, InputNumber, Upload, Image, Select, Spin, Checkbox, App, Tooltip } from 'antd';
import type { ColumnsType } from 'antd/es/table';
import { CheckOutlined, CloseOutlined, UploadOutlined, EyeOutlined, PlusOutlined, ReloadOutlined, RollbackOutlined } from '@ant-design/icons';
import { getAllReloadRecords, verifyReloadRecord, rejectReloadRecord, revokeReloadRecord, createReloadRecord } from '../../services/firebase/reload';
import dayjs from 'dayjs';
import { uploadFile } from '../../services/cloudinary/create';
import { getAllStores } from '../../services/firebase/stores';
import { getAllUsers, getDocument } from '../../services/firebase/firestore';
import { GLOBAL_COLLECTIONS } from '../../config/globalCollections';
import { useAuthStore } from '../../store/modules';
import type { ReloadRecord, Store, User } from '../../types';
import StoreSelect from '../common/StoreSelect';
import { netReloadPoints } from '../../utils/reloadPoints';
import { getReloadDisplayStatus, reloadStatusQuery, type ReloadStatusFilter } from '../../utils/reloadStatus';

interface ReloadVerificationProps {
  onRefresh?: () => void;
}

export const ReloadVerification: React.FC<ReloadVerificationProps> = ({ onRefresh }) => {
  const { message } = App.useApp();
  const [loading, setLoading] = useState(false);
  const [records, setRecords] = useState<ReloadRecord[]>([]);
  const [statusFilter, setStatusFilter] = useState<ReloadStatusFilter>('all');
  const [verifyModalVisible, setVerifyModalVisible] = useState(false);
  const [rejectModalVisible, setRejectModalVisible] = useState(false);
  const [revokeModalVisible, setRevokeModalVisible] = useState(false);
  const [manualCreateVisible, setManualCreateVisible] = useState(false);
  const [currentRecord, setCurrentRecord] = useState<ReloadRecord | null>(null);
  const [form] = Form.useForm();
  const [rejectForm] = Form.useForm();
  const [revokeForm] = Form.useForm();
  const [manualForm] = Form.useForm();
  const [uploading, setUploading] = useState(false);
  const [manualSubmitting, setManualSubmitting] = useState(false);
  const [proofUrl, setProofUrl] = useState<string>('');
  const [stores, setStores] = useState<Store[]>([]);
  const [users, setUsers] = useState<User[]>([]);
  const [recordUsers, setRecordUsers] = useState<Record<string, User | null>>({});
  const { t, i18n } = useTranslation();
  const { isSuperAdmin } = useAuthStore();
  const reviewer = useAuthStore(state => state.actualUser || state.user);
  const isMobile = typeof window !== 'undefined' ? window.matchMedia('(max-width: 768px)').matches : false;

  useEffect(() => {
    loadRecords();
    loadStores();
    if (isSuperAdmin) loadUsers();
  }, [statusFilter]);

  useEffect(() => {
    let cancelled = false;
    const ids = [...new Set(records.flatMap(record => [
      record.userId,
      ...(!record.verifiedByName && record.verifiedBy && record.verifiedBy !== 'admin' ? [record.verifiedBy] : [])
    ]).filter(Boolean))];
    Promise.all(ids.map(async id => {
      try {
        const user = users.find(user => user.id === id) || await getDocument<User>(GLOBAL_COLLECTIONS.USERS, id);
        return [id, user || null] as const;
      } catch (error) {
        console.error('[ReloadVerification] Failed to load member details:', error);
        return [id, null] as const;
      }
    })).then(entries => {
      if (!cancelled) setRecordUsers(Object.fromEntries(entries));
    });
    return () => { cancelled = true; };
  }, [records, users]);

  const reviewerName = (record: ReloadRecord) => {
    if (record.status === 'pending') return '-';
    return record.verifiedByName || recordUsers[record.verifiedBy || '']?.displayName
      || (record.verifiedBy && record.verifiedBy !== 'admin' ? record.verifiedBy : t('pointsConfig.reloadVerification.reviewerNotRecorded', { defaultValue: 'Not recorded' }));
  };

  const memberPhone = (record: ReloadRecord) => {
    const member = recordUsers[record.userId] || users.find(user => user.id === record.userId);
    return member?.profile?.phone || member?.phone || '-';
  };

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
      const allRecords = await getAllReloadRecords(reloadStatusQuery(statusFilter));
      setRecords(statusFilter === 'all' ? allRecords : allRecords.filter(record => getReloadDisplayStatus(record) === statusFilter));
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

  const handleRevoke = (record: ReloadRecord) => {
    setCurrentRecord(record);
    setRevokeModalVisible(true);
    revokeForm.resetFields();
  };

  const onRevokeSubmit = async (values: any) => {
    if (!currentRecord) return;
    try {
      const result = await revokeReloadRecord(currentRecord.id, values.notes);
      if (result.success) {
        message.success(t('pointsConfig.reloadVerification.revokeSuccess'));
        setRevokeModalVisible(false);
        revokeForm.resetFields();
        loadRecords();
        onRefresh?.();
      } else {
        message.error(result.error || t('pointsConfig.reloadVerification.revokeFailed'));
      }
    } catch (error: any) {
      message.error(error.message || t('pointsConfig.reloadVerification.revokeFailed'));
    }
  };

  const onVerifySubmit = async (values: any) => {
    if (!currentRecord || !reviewer?.id) return;

    setUploading(true);
    try {
      let finalProofUrl = proofUrl;
      
      // 如果有上传的文件，先上传到Cloudinary
      if (values.proof?.length > 0) {
        const file = values.proof[0].originFileObj;
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
        reviewer.id,
        finalProofUrl || undefined,
        values.notes,
        reviewer.displayName
      );

      if (result.success) {
        message.success(t('pointsConfig.reloadVerification.verifySuccess'));
        setVerifyModalVisible(false);
        form.resetFields();
        setProofUrl('');
        loadRecords();
        onRefresh?.();
        
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
    if (!currentRecord || !reviewer?.id) return;

    try {
      const result = await rejectReloadRecord(
        currentRecord.id,
        reviewer.id,
        values.notes,
        reviewer.displayName
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
    if (!reviewer?.id) return;
    setManualSubmitting(true);
    try {
      const selectedUser = users.find(u => u.id === values.userId);
      const result = await createReloadRecord(
        values.userId,
        values.amount,
        selectedUser?.displayName,
        values.storeId,
        undefined,
        { manual: true }
      );

      if (!result.success || !result.recordId) {
        message.error(result.error || t('pointsConfig.reloadVerification.manualCreateFailed'));
        return;
      }

      if (values.autoVerify) {
        const verifyResult = await verifyReloadRecord(
          result.recordId,
          reviewer.id,
          undefined,
          values.notes || `手动充值 by ${reviewer.displayName || reviewer.id}`,
          reviewer.displayName
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

  const renderStatus = (record: ReloadRecord) => {
    const status = getReloadDisplayStatus(record);
    const statusMap: Record<string, { color: string; text: string }> = {
      pending: { color: 'orange', text: t('pointsConfig.reloadVerification.statusPending') },
      completed: { color: 'green', text: t('pointsConfig.reloadVerification.statusCompleted') },
      rejected: { color: 'red', text: t('pointsConfig.reloadVerification.statusRejected') },
      withdrawn: { color: 'default', text: t('pointsConfig.reloadVerification.statusWithdrawed') },
      revoked: { color: 'purple', text: t('pointsConfig.reloadVerification.statusRevoked') }
    };
    const statusInfo = statusMap[status] || { color: 'default', text: status };
    return <Tag color={statusInfo.color}>{statusInfo.text}</Tag>;
  };

  const columns: ColumnsType<ReloadRecord> = [
    {
      title: t('pointsConfig.reloadVerification.time'),
      dataIndex: 'createdAt',
      key: 'createdAt',
      width: 126,
      render: (date: Date) => <div className="reload-verification-desktop-date">
        <span>{dayjs(date).format(i18n.language === 'en-US' ? 'D MMM YYYY' : 'YYYY-MM-DD')}</span>
        <span className="reload-verification-desktop-secondary">{dayjs(date).format('HH:mm')}</span>
      </div>
    },
    {
      title: t('pointsConfig.reloadVerification.user'),
      dataIndex: 'userName',
      key: 'userName',
      width: 160,
      ellipsis: true,
      render: (name: string, record: ReloadRecord) => (
        <div>
          <div className="reload-verification-desktop-ellipsis" title={name || recordUsers[record.userId]?.displayName || record.userId}>{name || recordUsers[record.userId]?.displayName || record.userId}</div>
          <div className="reload-verification-desktop-secondary">{memberPhone(record)}</div>
        </div>
      )
    },
    {
      title: t('common.status'),
      key: 'status',
      width: 112,
      render: (_: unknown, record: ReloadRecord) => renderStatus(record)
    },
    {
      title: t('pointsConfig.reloadVerification.store'),
      dataIndex: 'storeId',
      key: 'storeId',
      width: 148,
      ellipsis: true,
      render: (storeId: string) => {
        const store = stores.find(s => s.id === storeId);
        return <span className="reload-verification-desktop-ellipsis" title={store?.name}>{store?.name || '-'}</span>;
      }
    },
    {
      title: t('pointsConfig.reloadVerification.amount'),
      dataIndex: 'requestedAmount',
      key: 'requestedAmount',
      width: 224,
      render: (amount: number, record: ReloadRecord) => (
        <div className="reload-verification-desktop-payment">
          <div className="reload-verification-desktop-amount"><span>RM</span> {amount}</div>
          {record.membershipOrderId && <>
            <div className="reload-verification-desktop-package">{t(`annualPassPayment.${record.paymentPurpose === 'initial_package' ? 'initialPackageLabel' : 'renewalReloadLabel'}`)}</div>
            <div className="reload-verification-desktop-breakdown">
              <span>{t('pointsConfig.reloadVerification.mobileReload')} RM {record.walletAmount ?? '-'}</span>
              <span>{t('pointsConfig.reloadVerification.mobileAnnualFee')} RM {record.annualFeeAmount ?? '-'}</span>
            </div>
          </>}
          <div className="reload-verification-desktop-secondary">
            {t(record.status === 'completed' ? 'pointsConfig.reloadVerification.pointsEquivalent' : 'pointsConfig.reloadVerification.estimatedPointsEquivalent', { points: netReloadPoints(record) })}
          </div>
        </div>
      )
    },
    {
      title: t('pointsConfig.reloadVerification.reviewer', { defaultValue: 'Reviewed By' }),
      key: 'reviewer',
      width: 132,
      ellipsis: true,
      render: (_: unknown, record: ReloadRecord) => (
        <span className="reload-verification-desktop-ellipsis" title={reviewerName(record)}>{reviewerName(record)}</span>
      )
    },
    {
      title: t('pointsConfig.reloadVerification.adminNotes'),
      dataIndex: 'adminNotes',
      key: 'adminNotes',
      width: 160,
      render: (notes: string, record: ReloadRecord) => {
        const proof = record.verificationProof;
        const notePreview = (
          <Tooltip title={notes || undefined}>
            <div className="reload-verification-desktop-ellipsis">{notes || '-'}</div>
          </Tooltip>
        );
        if (!proof) return notePreview;
        return (
          <div style={{ overflowWrap: 'anywhere' }}>
            {notes && notePreview}
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
            {t('pointsConfig.reloadVerification.proof')}
          </Button>
          </div>
        );
      }
    },
    {
      title: t('pointsConfig.reloadVerification.action'),
      key: 'action',
      width: 96,
      fixed: 'right',
      render: (_: unknown, record: ReloadRecord) => {
        if (record.status === 'pending') return (
          <Space size={8} className="reload-verification-desktop-actions">
            <Tooltip title={t('pointsConfig.reloadVerification.verify')}>
            <Button
              type="primary"
              size="small"
              icon={<CheckOutlined />}
              aria-label={t('pointsConfig.reloadVerification.verify')}
              onClick={() => handleVerify(record)}
            />
            </Tooltip>
            <Tooltip title={t('pointsConfig.reloadVerification.reject')}>
            <Button
              danger
              size="small"
              icon={<CloseOutlined />}
              aria-label={t('pointsConfig.reloadVerification.reject')}
              onClick={() => handleReject(record)}
            />
            </Tooltip>
          </Space>
        );
        if (record.status === 'completed' && isSuperAdmin) return (
          <Space size={8} className="reload-verification-desktop-actions">
            <Tooltip title={t('pointsConfig.reloadVerification.revoke')}>
            <Button
              size="small"
              icon={<RollbackOutlined />}
              aria-label={t('pointsConfig.reloadVerification.revoke')}
              onClick={() => handleRevoke(record)}
              style={{ color: '#faad14', borderColor: '#faad14' }}
            />
            </Tooltip>
          </Space>
        );
        return <span className="reload-verification-desktop-secondary">-</span>;
      }
    }
  ];

  return (
    <>
      <div className="reload-verification-toolbar">
        <Select
          value={statusFilter}
          aria-label={t('common.status')}
          onChange={(value) => setStatusFilter(value)}
          options={[
            { label: t('pointsConfig.reloadVerification.statusAll'), value: 'all' },
            { label: t('pointsConfig.reloadVerification.statusPending'), value: 'pending' },
            { label: t('pointsConfig.reloadVerification.statusCompleted'), value: 'completed' },
            { label: t('pointsConfig.reloadVerification.statusRejected'), value: 'rejected' },
            { label: t('pointsConfig.reloadVerification.statusWithdrawed'), value: 'withdrawn' },
            { label: t('pointsConfig.reloadVerification.statusRevoked'), value: 'revoked' }
          ]}
          className="points-config-form reload-verification-filter"
        />
        <div className="reload-verification-actions">
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
          <Tooltip title={t('common.refresh')}>
          <Button
            className="reload-verification-refresh"
            aria-label={t('common.refresh')}
            icon={<ReloadOutlined />}
            onClick={loadRecords}
            loading={loading}
            style={{
              background: 'rgba(255, 255, 255, 0.1)',
              border: '1px solid rgba(255, 255, 255, 0.2)',
              color: '#FFFFFF'
            }}
          >
            <span className="reload-verification-refresh-label">{t('common.refresh')}</span>
          </Button>
          </Tooltip>
        </div>
      </div>
      {!isMobile ? (
        <div className="points-config-form reload-verification-desktop">
      <Table
        size="small"
        tableLayout="fixed"
        columns={columns}
        dataSource={records}
        rowKey="id"
        loading={loading}
        scroll={{ x: 1158 }}
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
        <div className="reload-verification-mobile-list">
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
              const createdDate = record.createdAt instanceof Date
                ? record.createdAt
                : (record.createdAt as any)?.toDate
                  ? (record.createdAt as any).toDate()
                  : new Date(record.createdAt);

              return (
                <div
                  key={record.id}
                  className="reload-verification-mobile-card"
                >
                  <div className="reload-verification-mobile-header">
                    <div className="reload-verification-mobile-identity">
                      <div className="reload-verification-mobile-name">
                        {record.userName || record.userId.substring(0, 20)}
                      </div>
                      <div className="reload-verification-mobile-secondary">
                        {memberPhone(record)}
                      </div>
                      <time className="reload-verification-mobile-secondary">
                        {dayjs(createdDate).format(i18n.language === 'en-US' ? 'D MMM, YYYY HH:mm' : 'YYYY-MM-DD HH:mm')}
                      </time>
                    </div>
                    <div className="reload-verification-mobile-summary">
                      <div className="reload-verification-mobile-amount">
                        <span>RM</span> {record.requestedAmount}
                      </div>
                      {renderStatus(record)}
                    </div>
                  </div>
                  {record.membershipOrderId && <div className="reload-verification-mobile-package">
                    <div className="reload-verification-mobile-package-name">
                      {t(`annualPassPayment.${record.paymentPurpose === 'initial_package' ? 'initialPackageLabel' : 'renewalReloadLabel'}`)}
                    </div>
                    <div className="reload-verification-mobile-breakdown">
                      <span>{t('pointsConfig.reloadVerification.mobileReload')} <strong>RM {record.walletAmount ?? '-'}</strong></span>
                      <span>{t('pointsConfig.reloadVerification.mobileAnnualFee')} <strong>RM {record.annualFeeAmount ?? '-'}</strong></span>
                    </div>
                  </div>}
                  <div className="reload-verification-mobile-points">
                    {t(record.status === 'completed' ? 'pointsConfig.reloadVerification.pointsEquivalent' : 'pointsConfig.reloadVerification.estimatedPointsEquivalent', { points: netReloadPoints(record) })}
                  </div>
                  <dl className="reload-verification-mobile-details">
                    <dt>{t('pointsConfig.reloadVerification.store')}</dt>
                    <dd>{stores.find(s => s.id === record.storeId)?.name || '-'}</dd>
                    {record.status !== 'pending' && <>
                      <dt>{t('pointsConfig.reloadVerification.reviewer', { defaultValue: 'Reviewed By' })}</dt>
                      <dd>{reviewerName(record)}</dd>
                    </>}
                  </dl>
                  {record.adminNotes && <div className="reload-verification-mobile-notes">{record.adminNotes}</div>}
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
                  {record.status === 'pending' && (
                    <div className="reload-verification-mobile-review-actions">
                      <Button
                        size="small"
                        icon={<CheckOutlined />}
                        onClick={() => handleVerify(record)}
                        style={{
                          flex: 1,
                          background: 'var(--cigar-gradient-gold)',
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
                  {record.status === 'completed' && isSuperAdmin && (
                    <div className="reload-verification-mobile-review-actions">
                      <Button
                        size="small"
                        icon={<RollbackOutlined />}
                        onClick={() => handleRevoke(record)}
                        style={{
                          flex: 1,
                          background: 'rgba(250, 173, 20, 0.15)',
                          border: '1px solid #faad14',
                          color: '#faad14',
                          fontWeight: 700
                        }}
                      >
                        {t('pointsConfig.reloadVerification.revoke')}
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
              <div>{t('pointsConfig.reloadVerification.estimatedPointsEquivalent', { points: netReloadPoints(currentRecord) })}</div>
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

      {/* 撤销充值 Modal（仅 superAdmin/developer） */}
      <Modal
        title={<span style={{ color: '#FFFFFF' }}>{t('pointsConfig.reloadVerification.revokeModalTitle')}</span>}
        open={revokeModalVisible}
        onCancel={() => {
          setRevokeModalVisible(false);
          revokeForm.resetFields();
        }}
        onOk={() => revokeForm.submit()}
        okButtonProps={{
          style: {
            background: '#faad14',
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
            form={revokeForm}
            layout="vertical"
            onFinish={onRevokeSubmit}
            className="points-config-form"
          >
            <div style={{ marginBottom: 16, color: 'rgba(255, 255, 255, 0.85)' }}>
              <div style={{ marginBottom: 8 }}>{t('pointsConfig.reloadVerification.user')}: {currentRecord.userName || currentRecord.userId}</div>
              <div style={{ marginBottom: 8 }}>{t('pointsConfig.reloadVerification.amount')}: {currentRecord.requestedAmount} RM</div>
              <div style={{ color: '#faad14', fontSize: 12 }}>{t('pointsConfig.reloadVerification.revokeWarning', { amount: Math.round(currentRecord.requestedAmount) })}</div>
            </div>
            <Form.Item
              name="notes"
              label={<span style={{ color: 'rgba(255, 255, 255, 0.85)' }}>{t('pointsConfig.reloadVerification.revokeReasonLabel')}</span>}
              rules={[{ required: true, message: t('pointsConfig.reloadVerification.revokeReasonRequired') }]}
            >
              <Input.TextArea
                rows={4}
                placeholder={t('pointsConfig.reloadVerification.revokeReasonPlaceholder')}
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
            layout="horizontal"
            labelAlign="left"
            labelWrap
            colon={false}
            onFinish={onManualCreateSubmit}
            className="points-config-form manual-reload-form"
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
                { type: 'number', min: 0.01, message: t('pointsConfig.reloadVerification.manualCreateAmountMin') }
              ]}
            >
              <InputNumber
                min={0.01}
                precision={2}
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
