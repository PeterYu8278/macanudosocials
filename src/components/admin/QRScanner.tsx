// QR码扫描组件 - 用于管理员check-in/check-out
import React, { useEffect, useRef, useState, useCallback, useMemo } from 'react';
import { Modal, Button, App, Space, Typography, Select, Avatar, Tag, Input, InputNumber } from 'antd';
import { QrcodeOutlined, CheckCircleOutlined, UserOutlined, LoginOutlined, LogoutOutlined, ClockCircleOutlined, GiftOutlined, SaveOutlined } from '@ant-design/icons';
import { Html5Qrcode } from 'html5-qrcode';
import { calculateVisitDuration, createVisitSession, completeVisitSession, getPendingVisitSession } from '../../services/firebase/visitSessions';
import { getCigars, getUserById } from '../../services/firebase/firestore';
import { getCurrentHourlyRate } from '../../services/firebase/membershipFee';
import { createRedemptionRecord, getRedemptionRecordsBySession, updateRedemptionRecord } from '../../services/firebase/redemption';
import { getUserByMemberId } from '../../utils/memberId';
import { useAuthStore } from '../../store/modules/auth';
import { useTranslation } from 'react-i18next';
import { getActiveStores } from '../../services/firebase/stores';
import type { Cigar, RedemptionRecord, Store, User, VisitSession } from '../../types';

const { Text } = Typography;

interface QRScannerViewProps {
  active: boolean;
  onSuccess?: () => void;
  onClose?: () => void; // Optional, for "Close" button inside view if needed
}

interface ScannedMember {
  user: User;
  pendingSession: VisitSession | null;
  action: 'checkin' | 'checkout';
  hourlyRate: number;
}

interface VisitPointsPreview {
  currentPoints: number;
  totalVisitPoints: number;
  pointsDueNow: number;
  isSufficient: boolean;
  shortfall: number;
}

const calculateVisitPointsPreview = (
  session: VisitSession,
  user: User,
  hourlyRate: number,
  now: number
): VisitPointsPreview => {
  const currentPoints = Number(user.membership?.points || 0);
  const elapsedMinutes = Math.max(0, Math.floor((now - session.checkInAt.getTime()) / 60000));
  const durationHours = session.checkoutPending?.durationHours ?? calculateVisitDuration(elapsedMinutes);

  let totalVisitPoints = 0;
  let pointsDueNow = 0;

  if (session.checkoutPending?.status === 'awaiting_reload') {
    pointsDueNow = Number(session.checkoutPending.pointsDueNow || 0);
    if (session.dayPass?.isPurchased) {
      totalVisitPoints = Number(session.dayPass.config.cost || 0) + pointsDueNow;
    } else if (session.realtimeDeductionsEnabled) {
      totalVisitPoints = Number(session.realtimePointsDeducted || 0) + pointsDueNow;
    } else {
      totalVisitPoints = pointsDueNow;
    }
  } else if (session.isFirstVisitAfterRenewal) {
    totalVisitPoints = 0;
  } else if (session.dayPass?.isPurchased) {
    const cost = Number(session.dayPass.config.cost || 0);
    const freeHours = Number(session.dayPass.config.freeHours || 0);
    const overtimeRate = Number(session.dayPass.config.hourlyRateAfter || 0);
    const overtimePoints = Math.round(Math.max(0, durationHours - freeHours) * overtimeRate);
    totalVisitPoints = cost + overtimePoints;
    pointsDueNow = overtimePoints;
  } else if (session.realtimeDeductionsEnabled) {
    const alreadyDeducted = Number(session.realtimePointsDeducted || 0);
    const nextDeductionAt = session.nextDeductionAt?.getTime();
    const dueIntervals = nextDeductionAt && now >= nextDeductionAt
      ? 1 + Math.floor((now - nextDeductionAt) / (30 * 60 * 1000))
      : 0;
    pointsDueNow = (hourlyRate / 2) * dueIntervals;
    totalVisitPoints = alreadyDeducted + pointsDueNow;
  } else {
    pointsDueNow = Math.round(durationHours * hourlyRate);
    totalVisitPoints = pointsDueNow;
  }

  const normalizedDueNow = Math.max(0, pointsDueNow);
  return {
    currentPoints,
    totalVisitPoints,
    pointsDueNow: normalizedDueNow,
    isSufficient: currentPoints >= normalizedDueNow,
    shortfall: Math.max(0, normalizedDueNow - currentPoints),
  };
};

export const QRScannerView: React.FC<QRScannerViewProps> = ({ active, onSuccess, onClose }) => {
  const { t, i18n } = useTranslation();
  const { user: adminUser } = useAuthStore();
  const scannerRef = useRef<Html5Qrcode | null>(null);
  const isStoppingRef = useRef<boolean>(false);
  const videoTrackRef = useRef<MediaStreamTrack | null>(null);
  const processingRef = useRef(false);
  const storesRef = useRef<Store[]>([]);
  const selectedStoreIdRef = useRef<string | undefined>(undefined);
  const { message } = App.useApp();
  const [processing, setProcessing] = useState(false);
  const [scannedData, setScannedData] = useState<string | null>(null);
  const [cameraError, setCameraError] = useState<string | null>(null);
  const [retrying, setRetrying] = useState(false);
  const [checkInError, setCheckInError] = useState<string | null>(null);
  const [stores, setStores] = useState<Store[]>([]);
  const [selectedStoreId, setSelectedStoreId] = useState<string>();
  const [storesLoading, setStoresLoading] = useState(false);
  const [scannedMember, setScannedMember] = useState<ScannedMember | null>(null);
  const [manualMemberId, setManualMemberId] = useState('');
  const [activeVisitDuration, setActiveVisitDuration] = useState('00:00:00');
  const [durationNow, setDurationNow] = useState(Date.now());
  const [cigars, setCigars] = useState<Cigar[]>([]);
  const [redemptionRecords, setRedemptionRecords] = useState<RedemptionRecord[]>([]);
  const [selectedCigarId, setSelectedCigarId] = useState<string>();
  const [redemptionQuantity, setRedemptionQuantity] = useState(1);
  const [redemptionsLoading, setRedemptionsLoading] = useState(false);
  const [savingRedemption, setSavingRedemption] = useState(false);

  useEffect(() => {
    const checkInAt = scannedMember?.pendingSession?.checkInAt;
    if (!checkInAt) {
      setActiveVisitDuration('00:00:00');
      return;
    }

    const updateDuration = () => {
      const now = Date.now();
      const elapsedSeconds = Math.max(0, Math.floor((now - checkInAt.getTime()) / 1000));
      const hours = Math.floor(elapsedSeconds / 3600);
      const minutes = Math.floor((elapsedSeconds % 3600) / 60);
      const seconds = elapsedSeconds % 60;
      setActiveVisitDuration(
        `${String(hours).padStart(2, '0')}:${String(minutes).padStart(2, '0')}:${String(seconds).padStart(2, '0')}`
      );
      setDurationNow(now);
    };

    updateDuration();
    const interval = window.setInterval(updateDuration, 1000);
    return () => window.clearInterval(interval);
  }, [scannedMember?.pendingSession?.checkInAt]);

  const visitPointsPreview = useMemo(() => {
    if (!scannedMember?.pendingSession) return null;
    return calculateVisitPointsPreview(
      scannedMember.pendingSession,
      scannedMember.user,
      scannedMember.hourlyRate,
      durationNow
    );
  }, [durationNow, scannedMember]);

  useEffect(() => {
    const sessionId = scannedMember?.pendingSession?.id;
    if (!sessionId) {
      setRedemptionRecords([]);
      setSelectedCigarId(undefined);
      setRedemptionQuantity(1);
      return;
    }

    let cancelled = false;
    setRedemptionsLoading(true);
    Promise.all([
      getCigars({ limit: 500 }),
      getRedemptionRecordsBySession(sessionId),
    ])
      .then(([availableCigars, records]) => {
        if (cancelled) return;
        setCigars(availableCigars);
        setRedemptionRecords(records);
      })
      .catch(error => {
        console.error('[QRScanner] Failed to load visit redemptions:', error);
        if (!cancelled) message.error(t('scanner.loadVisitCigarsFailed'));
      })
      .finally(() => {
        if (!cancelled) setRedemptionsLoading(false);
      });

    return () => {
      cancelled = true;
    };
  }, [message, scannedMember?.pendingSession?.id, t]);

  const sessionRedemptions = scannedMember?.pendingSession?.redemptions || [];
  const displayedRedemptions = redemptionRecords.length > 0 ? redemptionRecords : sessionRedemptions;
  const configuredRedemptions = displayedRedemptions.filter(redemption => Boolean(redemption.cigarId?.trim()));
  const pendingRedemption = redemptionRecords.find(redemption => redemption.status === 'pending' || !redemption.cigarId?.trim());
  const canSetVisitCigar = Boolean(
    scannedMember?.pendingSession && (pendingRedemption || configuredRedemptions.length === 0)
  );

  const saveVisitCigar = async () => {
    if (!scannedMember?.pendingSession || !adminUser?.id || !selectedCigarId || savingRedemption) return;

    const cigar = cigars.find(item => item.id === selectedCigarId);
    if (!cigar) {
      message.warning(t('visitSessions.selectCigar'));
      return;
    }

    setSavingRedemption(true);
    try {
      const result = pendingRedemption
        ? await updateRedemptionRecord(
            pendingRedemption.id,
            cigar.id,
            cigar.name,
            redemptionQuantity,
            adminUser.id
          )
        : await createRedemptionRecord(
            scannedMember.user.id,
            scannedMember.pendingSession.id,
            cigar.id,
            cigar.name,
            redemptionQuantity,
            adminUser.id
          );

      if (!result.success) {
        message.error(result.error || t('scanner.saveVisitCigarFailed'));
        return;
      }

      const [records, refreshedSession] = await Promise.all([
        getRedemptionRecordsBySession(scannedMember.pendingSession.id),
        getPendingVisitSession(scannedMember.user.id),
      ]);
      setRedemptionRecords(records);
      if (refreshedSession) {
        setScannedMember(current => current ? { ...current, pendingSession: refreshedSession } : current);
      }
      setSelectedCigarId(undefined);
      setRedemptionQuantity(1);
      message.success(t('scanner.visitCigarSaved'));
    } catch (error: any) {
      console.error('[QRScanner] Failed to save visit cigar:', error);
      message.error(error?.message || t('scanner.saveVisitCigarFailed'));
    } finally {
      setSavingRedemption(false);
    }
  };

  const localizeMemberLookupError = (error?: string) => {
    if (error && /(不存在|not found)/i.test(error)) {
      return t('scanner.memberNotFound');
    }
    return t('scanner.memberLookupFailed');
  };

  const localizeVisitError = (error: string | undefined, fallbackKey: string) => {
    if (!error) return t(fallbackKey);
    if (/(Firestore索引|index.*required)/i.test(error)) return t('scanner.systemConfigurationError');
    if (/(用户不存在|member.*not found)/i.test(error)) return t('scanner.memberNotFound');
    if (/(驻店记录不存在|visit.*not found)/i.test(error)) return t('scanner.visitNotFound');
    if (/(会员状态|开通会员|membership.*inactive)/i.test(error)) return t('scanner.membershipRequired');
    if (/(已有未完成|active visit already exists)/i.test(error)) return t('scanner.activeVisitAlreadyExists');
    if (/(积分不足|insufficient points)/i.test(error)) return t('scanner.insufficientPoints');
    if (/(已完成|已过期|already completed|expired)/i.test(error)) return t('scanner.visitAlreadyClosed');
    if (/(原门店|original store)/i.test(error)) return t('scanner.visitStoreRestricted');
    if (/(雪茄不存在|兑换|库存|redemption|inventory)/i.test(error)) return t('scanner.visitSettlementFailed');
    return t(fallbackKey);
  };

  useEffect(() => {
    if (!active) return;

    setStoresLoading(true);
    getActiveStores()
      .then(activeStores => {
        setStores(activeStores);
        storesRef.current = activeStores;

        if (activeStores.length === 1) {
          setSelectedStoreId(activeStores[0].id);
          selectedStoreIdRef.current = activeStores[0].id;
        } else {
          setSelectedStoreId(undefined);
          selectedStoreIdRef.current = undefined;
        }
      })
      .catch(() => {
        setStores([]);
        storesRef.current = [];
        setSelectedStoreId(undefined);
        selectedStoreIdRef.current = undefined;
        message.error(t('scanner.loadStoresFailed'));
      })
      .finally(() => setStoresLoading(false));
  }, [active, message, t]);

  // 启动扫描
  const startScanning = async (facingMode: 'environment' | 'user' = 'environment') => {
    // Prevent multiple starts
    if (scannerRef.current?.isScanning) return;

    try {
      // Ensure element exists
      if (!document.getElementById('qr-reader-view')) return;

      // Ensure previous instance is cleaned up
      if (scannerRef.current) {
        await stopScanning();
        // 等待停止完成
        await new Promise(resolve => setTimeout(resolve, 100));
      }

      setCameraError(null);
      isStoppingRef.current = false; // 重置停止标志
      const scanner = new Html5Qrcode('qr-reader-view');
      scannerRef.current = scanner;

      await scanner.start(
        { facingMode }, // 使用指定的摄像头
        {
          fps: 10,
          qrbox: { width: 200, height: 200 }
        },
        (decodedText) => {
          // 扫描成功
          handleScanResult(decodedText);
        },
        (errorMessage) => {
          // 扫描错误（忽略，继续扫描）
        }
      );

    } catch (error: any) {
      console.error('Scanner start error:', error);
      
      // 提取错误信息（可能嵌套在 error.message 中）
      const errorString = error?.message || error?.toString() || '';
      const errorName = error?.name || '';
      
      // 处理不同类型的错误
      let errorMessage = t('scanner.cameraError');

      // 检查错误名称或错误消息中是否包含特定错误类型
      if (errorName === 'NotReadableError' || errorString.includes('NotReadableError') || errorString.includes('Could not start video source')) {
        errorMessage = t('scanner.cameraInUse');
      } else if (errorName === 'NotAllowedError' || errorString.includes('NotAllowedError') || errorString.includes('Permission denied')) {
        errorMessage = t('scanner.cameraPermissionDenied');
      } else if (errorName === 'NotFoundError' || errorString.includes('NotFoundError') || errorString.includes('no device')) {
        errorMessage = t('scanner.noCameraFound');
      } else if (errorString.includes('Could not start video source')) {
        errorMessage = t('scanner.videoSourceError');
      } else if (errorString) {
        console.error('[QRScanner] Unrecognized camera error:', errorString);
        errorMessage = t('scanner.cameraStartFailed');
      }
      
      setCameraError(errorMessage);
      
      // 如果后置摄像头失败，尝试前置摄像头
      if (facingMode === 'environment' && !retrying) {
        setRetrying(true);
        setTimeout(async () => {
          try {
            await startScanning('user');
            setRetrying(false);
          } catch (retryError) {
            setRetrying(false);
            message.warning(t('scanner.useManualInput'));
          }
        }, 500);
      } else {
        setRetrying(false);
        // 不显示错误消息，因为已经在 UI 中显示了
      }
    }
  };

  // 停止扫描
  const stopScanning = async () => {
    // 防止重复调用
    if (isStoppingRef.current) {
      return;
    }

    if (!scannerRef.current) {
      return;
    }

    isStoppingRef.current = true;

    try {
      const scanner = scannerRef.current;
      
        // Check if scanner is running before stopping
      if (scanner.isScanning) {
        try {
          await scanner.stop();
        } catch (stopError: any) {
          // 忽略状态转换错误（可能已经在停止过程中）
          if (!stopError?.message?.includes('already under transition') && 
              !stopError?.message?.includes('Cannot transition')) {
            console.error('Scanner stop error:', stopError);
          }
        }
      }
      
      // Only clear if scanner still exists and was initialized
      if (scannerRef.current) {
        try {
          await scannerRef.current.clear();
        } catch (clearError: any) {
          // Ignore clear errors as it might be already cleared or null
          if (!clearError?.message?.includes('Cannot read properties of null')) {
            console.warn('Scanner clear warning:', clearError);
          }
        }
        }
    } catch (error: any) {
      // 忽略状态转换相关的错误
      if (!error?.message?.includes('already under transition') && 
          !error?.message?.includes('Cannot transition') &&
          !error?.message?.includes('Cannot read properties of null')) {
        console.error('Scanner stop error:', error);
      }
    } finally {
      // 清理引用
      videoTrackRef.current = null;
      scannerRef.current = null;
      isStoppingRef.current = false;
    }
  };

  // 解析QR码内容，提取memberId
  const parseQRCode = (qrData: string): string | null => {
    try {
      // 尝试解析JSON格式
      const parsed = JSON.parse(qrData);
      if (parsed.memberId) {
        return parsed.memberId;
      }
    } catch {
      // 如果不是JSON，尝试从URL中提取ref参数
      if (qrData.includes('?ref=')) {
        const url = new URL(qrData);
        return url.searchParams.get('ref');
      }
      // 如果直接是memberId字符串
      if (qrData && qrData.length > 0) {
        return qrData;
      }
    }
    return null;
  };


  // 处理扫描结果
  const handleScanResult = async (qrData: string) => {
    if (processingRef.current) return;
    const currentStoreId = selectedStoreIdRef.current;
    if (!currentStoreId) {
      message.warning(t('scanner.storeRequired'));
      return;
    }

    processingRef.current = true;
    setProcessing(true);
    setScannedData(qrData);
    // 先停止扫描，避免重复扫描
    await stopScanning();

    try {
      const memberId = parseQRCode(qrData);
      if (!memberId) {
        message.error(t('scanner.invalidQRCode'));
        processingRef.current = false;
        setProcessing(false);
        setScannedData(null);
        // 重新启动扫描
        setTimeout(() => {
          startScanning();
        }, 500);
        return;
      }

      const userResult = await getUserByMemberId(memberId);
      if (!userResult.success || !userResult.user) {
        setCheckInError(localizeMemberLookupError(userResult.error));
        processingRef.current = false;
        setProcessing(false);
        setScannedData(null);
        // 重新启动扫描
        setTimeout(() => {
          startScanning();
        }, 800);
        return;
      }

      const userId = userResult.user.id;

      if (!adminUser?.id) {
        message.error(t('scanner.adminNotFound'));
        processingRef.current = false;
        setProcessing(false);
        setScannedData(null);
        // 重新启动扫描
        setTimeout(() => {
          startScanning();
        }, 500);
        return;
      }

      const [fullUser, pendingSession] = await Promise.all([
        getUserById(userId),
        getPendingVisitSession(userId),
      ]);
      if (pendingSession && pendingSession.storeId !== currentStoreId) {
        const selectedStore = storesRef.current.find(store => store.id === currentStoreId);
        setCheckInError(t('scanner.visitStoreMismatch', {
          visitStore: pendingSession.storeName || pendingSession.storeId,
          selectedStore: selectedStore?.name || currentStoreId,
        }));
        processingRef.current = false;
        setProcessing(false);
        setScannedData(null);
        setTimeout(() => startScanning(), 800);
        return;
      }
      const member = fullUser || ({
        id: userId,
        memberId,
        displayName: userResult.user.displayName || memberId,
        email: '',
        role: 'member',
      } as User);

      let hourlyRate = 10;
      if (pendingSession && !pendingSession.isFirstVisitAfterRenewal && !pendingSession.dayPass?.isPurchased) {
        try {
          hourlyRate = await getCurrentHourlyRate(pendingSession.checkInAt);
        } catch (error) {
          console.error('[QRScanner] Failed to load visit hourly rate:', error);
        }
      }

      setScannedMember({
        user: member,
        pendingSession,
        action: pendingSession ? 'checkout' : 'checkin',
        hourlyRate,
      });
      setCheckInError(null);
      processingRef.current = false;
      setProcessing(false);
    } catch (error: any) {
      console.error('[QRScanner] Failed to process member:', error);
      message.error(t('scanner.processFailed'));
      processingRef.current = false;
      setProcessing(false);
      setScannedData(null);
      // 重新启动扫描
      setTimeout(() => {
        startScanning();
      }, 500);
    }
  };

  const resetScanner = () => {
    processingRef.current = false;
    setProcessing(false);
    setScannedData(null);
    setScannedMember(null);
    setCheckInError(null);
    setTimeout(() => startScanning(), 100);
  };

  const confirmVisitAction = async () => {
    if (!scannedMember || !adminUser?.id || processingRef.current) return;

    const currentStoreId = selectedStoreIdRef.current;
    if (scannedMember.action === 'checkin' && !currentStoreId) {
      message.warning(t('scanner.storeRequired'));
      return;
    }

    processingRef.current = true;
    setProcessing(true);
    try {
      if (scannedMember.action === 'checkin') {
        const selectedStore = storesRef.current.find(store => store.id === currentStoreId);
        const result = await createVisitSession(
          scannedMember.user.id,
          adminUser.id,
          currentStoreId!,
          selectedStore?.name || '',
          scannedMember.user.displayName
        );
        if (!result.success) {
          throw new Error(localizeVisitError(result.error, 'scanner.checkinFailed'));
        }
        message.success(t('scanner.checkinSuccess', { sessionId: result.sessionId }));
      } else {
        const result = await completeVisitSession(
          scannedMember.pendingSession!.id,
          adminUser.id,
          scannedMember.pendingSession!.storeId
        );
        if (!result.success) {
          throw new Error(localizeVisitError(result.error, 'common.checkoutFailed'));
        }
        message.success(t('scanner.checkoutSuccess', { points: result.pointsDeducted || 0 }));
      }
      onSuccess?.();
    } catch (error: any) {
      const errorMessage = error?.message || t('scanner.processFailed');
      setCheckInError(errorMessage);
      message.error(errorMessage);
      processingRef.current = false;
      setProcessing(false);
    }
  };

  // 点击屏幕聚焦

  const submitManualInput = async () => {
    const memberId = manualMemberId.trim().toUpperCase();
    if (!memberId) {
      message.warning(t('scanner.memberIdRequired'));
      return;
    }
    setManualMemberId('');
    await handleScanResult(memberId);
  };

  useEffect(() => {
    if (active) {
      // 重置错误状态
      setCameraError(null);
      setRetrying(false);
      setCheckInError(null);
      setScannedMember(null);
      setManualMemberId('');
      processingRef.current = false;
      // 延迟启动，确保DOM已渲染
      setTimeout(() => {
        startScanning();
      }, 100);
    } else {
      stopScanning();
      setCameraError(null);
      setRetrying(false);
      setCheckInError(null);
    }

    return () => {
      stopScanning();
    };
  }, [active]);

  // 重试启动摄像头
  const handleRetry = async () => {
    setRetrying(false);
    setCameraError(null);
    await startScanning('environment');
  };

  return (
    <div style={{
      textAlign: 'center',
      display: 'flex',
      flexDirection: 'column',
      maxHeight: 'calc(100vh - 190px)',
      overflowX: 'hidden',
      overflowY: 'auto',
      paddingRight: 2
    }}>
      {/* Check-in 错误提示 */}
      {checkInError && (
        <div style={{
          padding: '12px 16px',
          background: 'rgba(239, 68, 68, 0.15)',
          border: '1px solid rgba(239, 68, 68, 0.35)',
          borderRadius: '12px',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          gap: '8px',
          marginBottom: 16
        }}>
          <Text style={{ color: '#f87171', fontSize: 13, fontWeight: 500 }}>
            {checkInError}
          </Text>
        </div>
      )}
      
      {(!scannedMember || scannedMember.action === 'checkin') && (
        <div style={{ textAlign: 'left', margin: '0 4px 12px' }}>
          <Text style={{ display: 'block', color: 'rgba(255,255,255,0.85)', marginBottom: 6 }}>
            {t('scanner.store')}
          </Text>
          <Select
            value={selectedStoreId}
            onChange={storeId => {
              setSelectedStoreId(storeId);
              selectedStoreIdRef.current = storeId;
            }}
            options={stores.map(store => ({ value: store.id, label: store.name }))}
            placeholder={t('scanner.selectStore')}
            loading={storesLoading}
            disabled={processing || stores.length === 1}
            style={{ width: '100%' }}
            className="points-config-form"
            popupClassName="points-config-form"
          />
        </div>
      )}

      <div style={{ display: 'flex', flexDirection: 'column', justifyContent: 'center' }}>
        {processing ? (
          <div style={{ padding: '24px 0' }}>
            <CheckCircleOutlined style={{ fontSize: 48, color: '#34d399', marginBottom: 16 }} />
            <Text style={{ display: 'block', color: '#FFFFFF', fontSize: 14 }}>
              {t('scanner.checkingStatus')}
            </Text>
            {scannedData && (
              <Text type="secondary" style={{ display: 'block', marginTop: 8, fontSize: 12, color: 'rgba(255, 255, 255, 0.45)' }}>
                {t('scanner.scannedValue', { value: `${scannedData.substring(0, 30)}...` })}
              </Text>
            )}
          </div>
        ) : scannedMember ? (
          <div style={{ textAlign: 'left', paddingTop: 8 }}>
            <div style={{
              padding: 16,
              border: '1px solid rgba(244, 175, 37, 0.45)',
              borderRadius: 12,
              background: 'rgba(255, 255, 255, 0.04)'
            }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 14 }}>
                <Avatar
                  size={54}
                  src={scannedMember.user.profile?.avatar || scannedMember.user.photoURL}
                  icon={<UserOutlined />}
                  style={{ background: 'linear-gradient(135deg, #FDE08D, #C48D3A)', color: '#111' }}
                />
                <div style={{ minWidth: 0 }}>
                  <Text style={{ display: 'block', color: '#fff', fontSize: 17, fontWeight: 700 }}>
                    {scannedMember.user.displayName || t('scanner.member')}
                  </Text>
                  <Text style={{ color: 'rgba(255,255,255,0.6)' }}>
                    {t('scanner.memberId')}: {scannedMember.user.memberId || '-'}
                  </Text>
                </div>
              </div>

              <Space size={[6, 6]} wrap style={{ marginBottom: 12 }}>
                <Tag color={scannedMember.user.status === 'active' ? 'green' : 'default'}>
                  {t(`scanner.statuses.${scannedMember.user.status || 'active'}`)}
                </Tag>
                <Tag color="gold">{t(`scanner.roles.${scannedMember.user.role}`)}</Tag>
              </Space>

              {(scannedMember.user.email || scannedMember.user.profile?.phone || scannedMember.user.phone) && (
                <div style={{ color: 'rgba(255,255,255,0.72)', fontSize: 13, lineHeight: 1.7, marginBottom: 12 }}>
                  {scannedMember.user.email && <div>{scannedMember.user.email}</div>}
                  {(scannedMember.user.profile?.phone || scannedMember.user.phone) && (
                    <div>{scannedMember.user.profile?.phone || scannedMember.user.phone}</div>
                  )}
                </div>
              )}

              <div style={{
                padding: 12,
                borderRadius: 8,
                background: scannedMember.action === 'checkin'
                  ? 'rgba(82, 196, 26, 0.12)'
                  : 'rgba(250, 173, 20, 0.12)',
                border: `1px solid ${scannedMember.action === 'checkin'
                  ? 'rgba(82, 196, 26, 0.35)'
                  : 'rgba(250, 173, 20, 0.35)'}`
              }}>
                <Text style={{ display: 'block', color: '#fff', fontWeight: 700 }}>
                  {scannedMember.action === 'checkin'
                    ? t('scanner.noActiveVisit')
                    : t('scanner.activeVisitFound')}
                </Text>
                {scannedMember.pendingSession && (
                  <div style={{ marginTop: 4 }}>
                    <Text style={{ display: 'block', color: 'rgba(255,255,255,0.65)', fontSize: 12 }}>
                      {scannedMember.pendingSession.storeName || '-'} · {scannedMember.pendingSession.checkInAt.toLocaleString(i18n.language)}
                    </Text>
                    <Text style={{ display: 'block', color: 'rgba(255,255,255,0.82)', fontSize: 13, marginTop: 6 }}>
                      <ClockCircleOutlined style={{ marginRight: 6 }} />
                      {t('scanner.currentVisitDuration', {
                        defaultValue: t('visitTimer.stayDurationTimer')
                      })}: {' '}
                      <span style={{ color: '#FDE08D', fontFamily: 'monospace', fontWeight: 700 }}>
                        {activeVisitDuration}
                      </span>
                    </Text>
                    {visitPointsPreview && (
                      <div style={{
                        display: 'grid',
                        gridTemplateColumns: 'repeat(2, minmax(0, 1fr))',
                        gap: 8,
                        marginTop: 10,
                        paddingTop: 10,
                        borderTop: '1px solid rgba(255,255,255,0.12)'
                      }}>
                        <div>
                          <Text style={{ display: 'block', color: 'rgba(255,255,255,0.58)', fontSize: 11 }}>
                            {t('scanner.currentPoints')}
                          </Text>
                          <Text style={{ color: '#fff', fontWeight: 700 }}>
                            {visitPointsPreview.currentPoints.toLocaleString(i18n.language)}
                          </Text>
                        </div>
                        <div>
                          <Text style={{ display: 'block', color: 'rgba(255,255,255,0.58)', fontSize: 11 }}>
                            {t('scanner.totalVisitPoints')}
                          </Text>
                          <Text style={{ color: '#FDE08D', fontWeight: 700 }}>
                            {visitPointsPreview.totalVisitPoints.toLocaleString(i18n.language)}
                          </Text>
                        </div>
                        <div style={{ gridColumn: '1 / -1' }}>
                          <Tag color={visitPointsPreview.isSufficient ? 'green' : 'red'} style={{ margin: 0 }}>
                            {visitPointsPreview.isSufficient
                              ? t('scanner.pointsSufficient')
                              : t('scanner.pointsInsufficient', { shortfall: visitPointsPreview.shortfall })}
                          </Tag>
                        </div>
                      </div>
                    )}
                  </div>
                )}
              </div>

              {scannedMember.pendingSession && (
                <div style={{
                  marginTop: 12,
                  padding: 12,
                  borderRadius: 8,
                  border: '1px solid rgba(244, 175, 37, 0.3)',
                  background: 'rgba(0, 0, 0, 0.18)'
                }}>
                  <Text style={{ display: 'block', color: '#FDE08D', fontWeight: 700, marginBottom: 8 }}>
                    <GiftOutlined style={{ marginRight: 6 }} />
                    {t('scanner.visitCigars')}
                  </Text>

                  {configuredRedemptions.length > 0 ? (
                    <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                      {configuredRedemptions.map((redemption, index) => (
                        <div
                          key={('id' in redemption ? redemption.id : redemption.recordId) || `${redemption.cigarId}-${index}`}
                          style={{
                            display: 'flex',
                            justifyContent: 'space-between',
                            gap: 12,
                            color: 'rgba(255,255,255,0.82)',
                            fontSize: 13
                          }}
                        >
                          <span style={{ minWidth: 0, overflowWrap: 'anywhere' }}>{redemption.cigarName}</span>
                          <span style={{ flexShrink: 0, color: '#FDE08D', fontWeight: 700 }}>
                            × {redemption.quantity}
                          </span>
                        </div>
                      ))}
                    </div>
                  ) : (
                    <Text style={{ display: 'block', color: 'rgba(255,255,255,0.5)', fontSize: 12 }}>
                      {redemptionsLoading ? t('common.loading') : t('scanner.noVisitCigarSet')}
                    </Text>
                  )}

                  {canSetVisitCigar && (
                    <div style={{
                      display: 'flex',
                      flexWrap: 'wrap',
                      gap: 8,
                      alignItems: 'center',
                      marginTop: 10,
                      paddingTop: 10,
                      borderTop: '1px solid rgba(255,255,255,0.1)'
                    }}>
                      <Select
                        value={selectedCigarId}
                        onChange={setSelectedCigarId}
                        placeholder={t('visitSessions.selectCigar')}
                        showSearch
                        loading={redemptionsLoading}
                        disabled={savingRedemption}
                        filterOption={(input, option) =>
                          String(option?.label || '').toLowerCase().includes(input.toLowerCase())
                        }
                        options={cigars.map(cigar => ({
                          value: cigar.id,
                          label: `${cigar.name} - RM${cigar.price}`
                        }))}
                        className="points-config-form"
                        popupClassName="points-config-form"
                        style={{ flex: '1 1 190px', minWidth: 0 }}
                      />
                      <InputNumber
                        min={1}
                        max={100}
                        value={redemptionQuantity}
                        onChange={value => setRedemptionQuantity(value || 1)}
                        disabled={savingRedemption}
                        aria-label={t('visitSessions.quantity')}
                        className="points-config-form"
                        style={{ width: 72 }}
                      />
                      <Button
                        icon={<SaveOutlined />}
                        onClick={saveVisitCigar}
                        loading={savingRedemption}
                        disabled={!selectedCigarId || redemptionsLoading}
                        style={{
                          background: selectedCigarId ? 'linear-gradient(to right, #FDE08D, #C48D3A)' : undefined,
                          border: selectedCigarId ? 'none' : undefined,
                          color: selectedCigarId ? '#111' : undefined,
                          fontWeight: 700
                        }}
                      >
                        {t('common.save')}
                      </Button>
                    </div>
                  )}
                </div>
              )}
            </div>

            <Space style={{ display: 'flex', marginTop: 16 }}>
              <Button onClick={resetScanner} disabled={processing || savingRedemption} style={{ flex: 1 }}>
                {t('scanner.scanAgain')}
              </Button>
              <Button
                type="primary"
                icon={scannedMember.action === 'checkin' ? <LoginOutlined /> : <LogoutOutlined />}
                onClick={confirmVisitAction}
                loading={processing}
                disabled={savingRedemption}
                style={{
                  flex: 1,
                  background: 'linear-gradient(to right, #FDE08D, #C48D3A)',
                  border: 'none',
                  color: '#111',
                  fontWeight: 700
                }}
              >
                {scannedMember.action === 'checkin'
                  ? t('scanner.confirmCheckin')
                  : t('scanner.confirmCheckout')}
              </Button>
            </Space>
          </div>
        ) : cameraError ? (
          <div style={{ padding: '24px 0' }}>
            <QrcodeOutlined style={{ fontSize: 48, color: '#f87171', marginBottom: 16 }} />
            <Text type="danger" style={{ display: 'block', padding: '0 20px', color: '#f87171', fontSize: 13 }}>
              {cameraError}
            </Text>
            <Space style={{ marginTop: 20 }}>
              <Button
                type="primary"
                onClick={handleRetry}
                loading={retrying}
                style={{
                  background: 'linear-gradient(to right, #FDE08D, #C48D3A)',
                  border: 'none',
                  color: '#111',
                  fontWeight: 700,
                  borderRadius: 8
                }}
              >
                {t('common.retry')}
              </Button>
            </Space>
          </div>
        ) : (
          <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center' }}>
            <div
              style={{
                position: 'relative',
                width: '240px',
                height: '240px',
                margin: '12px auto',
                borderRadius: '16px',
                overflow: 'hidden',
                border: '2px solid rgba(244, 175, 37, 0.6)',
                boxShadow: '0 0 20px rgba(244, 175, 37, 0.25)',
                background: '#000'
              }}
            >
              <div id="qr-reader-view" style={{ width: '100%', height: '100%' }}></div>
            </div>
            <Text type="secondary" style={{ display: 'block', marginTop: 12, fontSize: 12, color: 'rgba(255, 255, 255, 0.45)' }}>
              {t('scanner.alignQRCode')}
            </Text>
          </div>
        )}
      </div>

      {!scannedMember && <div style={{ marginTop: 24 }}>
        <div style={{ display: 'flex', gap: 8, width: '100%', maxWidth: 420, margin: '0 auto' }}>
          <Input
            value={manualMemberId}
            onChange={event => setManualMemberId(event.target.value.toUpperCase())}
            onPressEnter={submitManualInput}
            placeholder={t('scanner.memberIdPlaceholder', {
              defaultValue: i18n.language.startsWith('zh') ? '输入会员编号' : 'Enter member ID'
            })}
            maxLength={20}
            disabled={processing}
            className="points-config-form"
            style={{ flex: 1, minWidth: 0 }}
          />
          <Button
            onClick={submitManualInput}
            disabled={processing || !manualMemberId.trim()}
            style={{
              flexShrink: 0,
              background: manualMemberId.trim()
                ? 'linear-gradient(to right, #FDE08D, #C48D3A)'
                : 'rgba(255, 255, 255, 0.05)',
              border: manualMemberId.trim() ? 'none' : '1px solid rgba(255, 255, 255, 0.15)',
              color: manualMemberId.trim() ? '#111' : 'rgba(255,255,255,0.45)',
              fontWeight: 700,
              borderRadius: 8
            }}
          >
            {t('scanner.findMember', {
              defaultValue: t('common.search')
            })}
          </Button>
        </div>
        <Space wrap style={{ justifyContent: 'center', marginTop: onClose ? 12 : 0 }}>
          {onClose && (
            <Button
              onClick={onClose}
              disabled={processing}
              style={{
                background: 'rgba(255, 255, 255, 0.05)',
                border: '1px solid rgba(255, 255, 255, 0.15)',
                color: '#FFFFFF',
                borderRadius: 8
              }}
            >
              {t('common.close')}
            </Button>
          )}
        </Space>
      </div>}
    </div>
  );
};

interface QRScannerProps {
  visible: boolean;
  onClose: () => void;
  onSuccess?: () => void;
}

export const QRScanner: React.FC<QRScannerProps> = ({ visible, onClose, onSuccess }) => {
  const { t } = useTranslation();

  return (
    <Modal
      title={
        <span style={{ color: '#FFFFFF', fontSize: 17, fontWeight: 700 }}>
          <QrcodeOutlined style={{ marginRight: 8, color: '#FFD700' }} />
          {t('scanner.memberScan')}
        </span>
      }
      open={visible}
      onCancel={onClose}
      footer={null}
      width={420}
      destroyOnClose
      centered
      styles={{
        content: {
          background: 'linear-gradient(180deg, #1f1b14 0%, #15130f 100%)',
          border: '1px solid rgba(244, 175, 37, 0.5)',
          borderRadius: 20,
          padding: 24,
        },
        header: {
          background: 'transparent',
          borderBottom: '1px solid rgba(255, 255, 255, 0.1)',
          paddingBottom: 12,
          marginBottom: 16
        },
        body: {
          background: 'transparent',
        },
        mask: {
          backdropFilter: 'blur(4px)',
        }
      }}
    >
      {/* Pass active=visible to trigger camera start/stop */}
      <QRScannerView
        active={visible}
        onSuccess={() => {
          onSuccess?.();
          onClose();
        }}
        onClose={onClose}
      />
    </Modal>
  );
};

