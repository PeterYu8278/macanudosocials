// QR码扫描组件 - 用于管理员check-in/check-out
import React, { useEffect, useRef, useState, useCallback } from 'react';
import { Modal, Button, App, Space, Typography } from 'antd';
import { QrcodeOutlined, CheckCircleOutlined } from '@ant-design/icons';
import { Html5Qrcode } from 'html5-qrcode';
import { createVisitSession, completeVisitSession, getPendingVisitSession } from '../../services/firebase/visitSessions';
import { getUserByMemberId } from '../../utils/memberId';
import { useAuthStore } from '../../store/modules/auth';
import { useTranslation } from 'react-i18next';

const { Text } = Typography;

interface QRScannerViewProps {
  active: boolean;
  mode: 'checkin' | 'checkout';
  onModeChange: (mode: 'checkin' | 'checkout') => void;
  onSuccess?: () => void;
  onClose?: () => void; // Optional, for "Close" button inside view if needed
}

export const QRScannerView: React.FC<QRScannerViewProps> = ({ active, mode, onModeChange, onSuccess, onClose }) => {
  const { t } = useTranslation();
  const { user: adminUser } = useAuthStore();
  const scannerRef = useRef<Html5Qrcode | null>(null);
  const isStoppingRef = useRef<boolean>(false);
  const videoTrackRef = useRef<MediaStreamTrack | null>(null);
  const { message } = App.useApp();
  const [processing, setProcessing] = useState(false);
  const [scannedData, setScannedData] = useState<string | null>(null);
  const [cameraError, setCameraError] = useState<string | null>(null);
  const [retrying, setRetrying] = useState(false);
  const [checkInError, setCheckInError] = useState<string | null>(null);

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
        // 尝试从错误消息中提取有用信息
        errorMessage = errorString.length > 100 ? t('scanner.cameraStartFailed') : errorString;
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
    if (processing) return;

    setProcessing(true);
    setScannedData(qrData);
    // 先停止扫描，避免重复扫描
    await stopScanning();

    try {
      const memberId = parseQRCode(qrData);
      if (!memberId) {
        message.error(t('scanner.invalidQRCode'));
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
        setCheckInError(userResult.error || `签到失败：用户不存在`);
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
        setProcessing(false);
        setScannedData(null);
        // 重新启动扫描
        setTimeout(() => {
          startScanning();
        }, 500);
        return;
      }

      if (mode === 'checkin') {
        // Check-in
        const result = await createVisitSession(userId, adminUser.id, adminUser.storeId || '', '', userResult.user.displayName);
        if (result.success) {
          message.success(t('scanner.checkinSuccess', { sessionId: result.sessionId }));
          setCheckInError(null);
          // 延迟关闭，确保消息显示
          setTimeout(() => {
            onSuccess?.();
          }, 500);
        } else {
          const errorMsg = result.error || 'Check-in 失败';
          console.error('[QRScanner] Check-in失败:', errorMsg);
          
          // 统一在页面顶部显示业务逻辑错误，确保醒目
          if (errorMsg.includes('签到失败') || errorMsg.includes('会员状态') || errorMsg.includes('已有未完成') || errorMsg.includes('请先check-out')) {
            setCheckInError(errorMsg);
          } else {
            message.error(errorMsg);
          }
          
          setProcessing(false);
          setScannedData(null);
          // 重新启动扫描
          setTimeout(() => {
            startScanning();
          }, 800); // 稍长一点的延迟，让管理员看清错误
        }
      } else {
        // Check-out
        const pendingSession = await getPendingVisitSession(userId);
        if (!pendingSession) {
          message.error(t('scanner.noActiveSession'));
          setProcessing(false);
          setScannedData(null);
          // 重新启动扫描
          setTimeout(() => {
            startScanning();
          }, 500);
          return;
        }

        const result = await completeVisitSession(pendingSession.id, adminUser.id, adminUser.storeId);
        if (result.success) {
          message.success(t('scanner.checkoutSuccess', { points: result.pointsDeducted || 0 }));
          onSuccess?.();
        } else {
          message.error(result.error || t('common.checkoutFailed'));
          setProcessing(false);
          setScannedData(null);
          // 重新启动扫描
          setTimeout(() => {
            startScanning();
          }, 500);
        }
      }
    } catch (error: any) {
      message.error(error.message || t('scanner.processFailed'));
      setProcessing(false);
      setScannedData(null);
      // 重新启动扫描
      setTimeout(() => {
        startScanning();
      }, 500);
    }
  };

  // 点击屏幕聚焦

  // 手动输入memberId
  const handleManualInput = () => {
    const memberId = prompt(t('scanner.enterMemberNumber'));
    if (memberId) {
      handleScanResult(memberId);
    }
  };

  useEffect(() => {
    if (active) {
      // 重置错误状态
      setCameraError(null);
      setRetrying(false);
      setCheckInError(null);
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
    <div style={{ textAlign: 'center', display: 'flex', flexDirection: 'column', height: '100%', overflow: 'hidden' }}>
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
      
      <div style={{ display: 'flex', flexDirection: 'column', justifyContent: 'center' }}>
        {processing ? (
          <div style={{ padding: '24px 0' }}>
            <CheckCircleOutlined style={{ fontSize: 48, color: '#34d399', marginBottom: 16 }} />
            <Text style={{ display: 'block', color: '#FFFFFF', fontSize: 14 }}>
              {mode === 'checkin' ? t('scanner.checkingStatus') : t('scanner.fetchingRecords')}
            </Text>
            {scannedData && (
              <Text type="secondary" style={{ display: 'block', marginTop: 8, fontSize: 12, color: 'rgba(255, 255, 255, 0.45)' }}>
                扫描到: {scannedData.substring(0, 30)}...
              </Text>
            )}
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
              <Button
                onClick={handleManualInput}
                style={{
                  background: 'rgba(255, 255, 255, 0.05)',
                  border: '1px solid rgba(255, 255, 255, 0.15)',
                  color: '#FFFFFF',
                  borderRadius: 8
                }}
              >
                {t('scanner.manualInput')}
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

      <div style={{ marginTop: 24 }}>
        <Space wrap style={{ justifyContent: 'center' }}>
          <Button 
            onClick={() => {
              onModeChange('checkin');
              setCheckInError(null);
            }} 
            disabled={processing} 
            type={mode === 'checkin' ? 'primary' : 'default'}
            style={mode === 'checkin' ? {
              background: 'linear-gradient(to right, #FDE08D, #C48D3A)',
              border: 'none',
              color: '#111',
              fontWeight: 700,
              borderRadius: 8
            } : {
              background: 'rgba(255, 255, 255, 0.05)',
              border: '1px solid rgba(255, 255, 255, 0.15)',
              color: '#FFFFFF',
              borderRadius: 8
            }}
          >
            Check-in
          </Button>
          <Button 
            onClick={() => {
              onModeChange('checkout');
              setCheckInError(null);
            }} 
            disabled={processing} 
            type={mode === 'checkout' ? 'primary' : 'default'}
            style={mode === 'checkout' ? {
              background: 'linear-gradient(to right, #FDE08D, #C48D3A)',
              border: 'none',
              color: '#111',
              fontWeight: 700,
              borderRadius: 8
            } : {
              background: 'rgba(255, 255, 255, 0.05)',
              border: '1px solid rgba(255, 255, 255, 0.15)',
              color: '#FFFFFF',
              borderRadius: 8
            }}
          >
            Check-out
          </Button>
          <Button 
            onClick={handleManualInput} 
            disabled={processing}
            style={{
              background: 'rgba(255, 255, 255, 0.05)',
              border: '1px solid rgba(255, 255, 255, 0.15)',
              color: '#FFFFFF',
              borderRadius: 8
            }}
          >
            {t('scanner.manualInput')}
          </Button>
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
      </div>
    </div>
  );
};

interface QRScannerProps {
  visible: boolean;
  onClose: () => void;
  mode: 'checkin' | 'checkout';
  onSuccess?: () => void;
}

export const QRScanner: React.FC<QRScannerProps> = ({ visible, onClose, mode: initialMode, onSuccess }) => {
  const { t } = useTranslation();
  const [mode, setQrScannerMode] = useState<'checkin' | 'checkout'>(initialMode);

  useEffect(() => {
    setQrScannerMode(initialMode);
  }, [initialMode]);

  return (
    <Modal
      title={
        <span style={{ color: '#FFFFFF', fontSize: 17, fontWeight: 700 }}>
          <QrcodeOutlined style={{ marginRight: 8, color: '#FFD700' }} />
          {mode === 'checkin' ? t('scanner.checkinScan') : t('scanner.checkoutScan')}
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
        mode={mode}
        onModeChange={setQrScannerMode}
        onSuccess={() => {
          onSuccess?.();
          onClose();
        }}
        onClose={onClose}
      />
    </Modal>
  );
};

