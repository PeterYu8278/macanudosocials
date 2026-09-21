// 合并后的驻店计时器和兑换模块组件
import React, { useState, useEffect } from 'react';
import { Card, Typography, Space, message, Image, App, Modal, List, Tag, Row, Col } from 'antd';
import { ClockCircleOutlined, GiftOutlined, ShoppingCartOutlined, ReloadOutlined, WalletOutlined } from '@ant-design/icons';
import { useAuthStore } from '../../store/modules/auth';
import { getPendingVisitSession, processSessionRealtimeDeduction } from '../../services/firebase/visitSessions';
import { getUserRedemptionLimits, canUserRedeem, getDailyRedemptions, getTotalRedemptions, getHourlyRedemptions, getRedemptionConfig, createRedemptionRecord } from '../../services/firebase/redemption';
import { createMembershipFeeRecord, deductMembershipFee, getUserMembershipPeriod } from '../../services/firebase/membershipFee';
import { getUserData } from '../../services/firebase/auth';
import StoreSelect from '../common/StoreSelect';
import { useNavigate } from 'react-router-dom';
import type { VisitSession, AppConfig } from '../../types';
import { getAppConfig } from '../../services/firebase/appConfig';
import { useTranslation } from 'react-i18next';
import dayjs from 'dayjs';

const { Title, Text } = Typography;

interface VisitTimerRedemptionProps {
  style?: React.CSSProperties;
}

export const VisitTimerRedemption: React.FC<VisitTimerRedemptionProps> = ({ style }) => {
  const { user, setUser } = useAuthStore();
  const { t } = useTranslation();
  const navigate = useNavigate();
  const { modal } = App.useApp();
  const [currentSession, setCurrentSession] = useState<VisitSession | null>(null);
  const [duration, setDuration] = useState<string>('00:00:00');
  const [lastCheckIn, setLastCheckIn] = useState<Date | null>(null);
  const [loading, setLoading] = useState(false);
  const [limits, setLimits] = useState({ dailyLimit: 3, totalLimit: 25, hourlyLimit: undefined as number | undefined });
  const [dailyCount, setDailyCount] = useState(0);
  const [totalCount, setTotalCount] = useState(0);
  const [hourlyCount, setHourlyCount] = useState(0);

  const [cutoffTime, setCutoffTime] = useState('23:00');
  const [totalHours, setTotalHours] = useState(0);
  const [canRedeemThisHour, setCanRedeemThisHour] = useState(true);
  const [countdownSeconds, setCountdownSeconds] = useState<number | null>(null); // 倒计时剩余秒数
  const [annualFeeAmount, setAnnualFeeAmount] = useState<number | null>(null); // 年费金额
  const [dayPassConfig, setDayPassConfig] = useState<any>(null);
  const [appConfig, setAppConfig] = useState<AppConfig | null>(null);
  const [historyModalVisible, setHistoryModalVisible] = useState(false);
  const [membershipModalVisible, setMembershipModalVisible] = useState(false);
  const [selectedAccess, setSelectedAccess] = useState<'membership' | 'daypass' | null>(null);
  const [redemptionHistory, setRedemptionHistory] = useState<any[]>([]);
  const [historyLoading, setHistoryLoading] = useState(false);
  const [selectedStoreId, setSelectedStoreId] = useState<string>('');
  const [selectedStoreName, setSelectedStoreName] = useState<string>('');
  const [dailyRedemptions, setDailyRedemptions] = useState<any[]>([]);

  // 加载倒计时状态（从localStorage）
  useEffect(() => {
    if (!user?.id) {
      setCountdownSeconds(null);
      return;
    }

    const storageKey = `redeem_countdown_${user.id}`;
    const savedTimestamp = localStorage.getItem(storageKey);


    if (savedTimestamp) {
      const lastClickTime = parseInt(savedTimestamp, 10);
      const now = Date.now();
      const elapsed = Math.floor((now - lastClickTime) / 1000); // 已过秒数
      const remaining = Math.max(0, 3600 - elapsed); // 1小时 = 3600秒


      if (remaining > 0) {
        setCountdownSeconds(remaining);
      } else {
        // 倒计时已结束，清除localStorage
        localStorage.removeItem(storageKey);
        setCountdownSeconds(null);
      }
    } else {
      setCountdownSeconds(null);
    }
  }, [user?.id]);

  // 倒计时更新
  useEffect(() => {
    if (countdownSeconds === null || countdownSeconds <= 0) {
      return;
    }


    const interval = setInterval(() => {
      setCountdownSeconds(prev => {
        if (prev === null || prev <= 1) {
          // 倒计时结束，清除localStorage
          if (user?.id) {
            const storageKey = `redeem_countdown_${user.id}`;
            localStorage.removeItem(storageKey);
          }
          return null;
        }
        const newValue = prev - 1;
        if (newValue % 60 === 0) {
          // 每分钟记录一次日志
        }
        return newValue;
      });
    }, 1000);

    return () => {
      clearInterval(interval);
    };
  }, [countdownSeconds, user?.id]);

  // 加载驻店会话数据
  useEffect(() => {
    if (!user?.id) {
      setCurrentSession(null);
      setLastCheckIn(user?.membership?.lastCheckInAt || null);
      return;
    }

    const loadSession = async () => {
      const session = await getPendingVisitSession(user.id);
      setCurrentSession(session);
      setLastCheckIn(user.membership?.lastCheckInAt || null);

      // 实时扣费：检查是否到了下一个扣费时间点
      if (session?.realtimeDeductionsEnabled && session.nextDeductionAt && session.id) {
        const now = new Date();
        if (now >= new Date(session.nextDeductionAt)) {
          processSessionRealtimeDeduction(session.id, user.id).catch(e =>
            console.error('[VisitTimerRedemption] 实时扣费失败', e)
          );
        }
      }
    };

    loadSession();
    const interval = setInterval(loadSession, 10000); // 每10秒刷新一次

    return () => clearInterval(interval);
  }, [user]);

  // 计算实时时长
  useEffect(() => {
    if (!currentSession?.checkInAt) {
      setDuration('00:00:00');
      return;
    }

    const updateDuration = () => {
      const now = new Date();
      const checkInAt = currentSession.checkInAt;
      const diffMs = now.getTime() - checkInAt.getTime();
      const hours = Math.floor(diffMs / (1000 * 60 * 60));
      const minutes = Math.floor((diffMs % (1000 * 60 * 60)) / (1000 * 60));
      const seconds = Math.floor((diffMs % (1000 * 60)) / 1000);
      setDuration(`${String(hours).padStart(2, '0')}:${String(minutes).padStart(2, '0')}:${String(seconds).padStart(2, '0')}`);
    };

    updateDuration();
    const interval = setInterval(updateDuration, 1000); // 每秒更新

    return () => clearInterval(interval);
  }, [currentSession]);

  // 获取当前会员期限内的累计驻店时长
  const loadTotalHours = async (): Promise<number> => {
    if (!user?.id) {
      setTotalHours(0);
      return 0;
    }
    const userId = user.id;
    try {
      const { getUserVisitSessions } = await import('../../services/firebase/visitSessions');
      const sessions = await getUserVisitSessions(userId);

      const allHours = sessions
        .filter(s => s.status === 'completed' && s.durationHours && s.checkInType !== 'daypass')
        .reduce((sum, s) => sum + (s.durationHours || 0), 0);
      setTotalHours(allHours);
      return allHours;
    } catch (error) {
      console.error('[loadTotalHours] Error:', error);
      setTotalHours(0);
      return 0;
    }
  };

  // 加载应用配置
  useEffect(() => {
    const loadAppConfig = async () => {
      try {
        const config = await getAppConfig();
        if (config) {
          setAppConfig(config);
        }
      } catch (error) {
        console.error('加载应用配置失败:', error);
      }
    };
    loadAppConfig();
  }, []);

  // 当前会话存在时，优先使用会话中记录的门店
  useEffect(() => {
    if (currentSession?.storeId) {
      setSelectedStoreId(currentSession.storeId);
      setSelectedStoreName(currentSession.storeName || '');
    }
  }, [currentSession?.storeId]);

  // 加载兑换数据和时长数据
  const loadData = async () => {
    if (!user?.id) {
      setTotalHours(0);
      return;
    }
    const userId = user.id;
    try {
      // 加载累计驻店时长
      await loadTotalHours();

      const userLimits = await getUserRedemptionLimits(userId);

      setLimits({
        dailyLimit: userLimits.dailyLimit,
        totalLimit: userLimits.totalLimit,
        hourlyLimit: userLimits.hourlyLimit
      });

      const config = await getRedemptionConfig();
      if (config) {
        setCutoffTime(config.cutoffTime);
      }

      // 获取当日兑换记录（只计算已完成的记录）
      const today = new Date().toISOString().split('T')[0];
      const dailyRedemptionsData = await getDailyRedemptions(userId, today);
      setDailyRedemptions(dailyRedemptionsData);
      const completedDailyRedemptions = dailyRedemptionsData.filter(r => r.status === 'completed');
      const dailyCountValue = completedDailyRedemptions.reduce((sum, r) => sum + r.quantity, 0);
      setDailyCount(dailyCountValue);


      // 获取总兑换记录（只计算已完成的记录）
      const totalRedemptions = await getTotalRedemptions(userId);
      const completedTotalRedemptions = totalRedemptions.filter(r => r.status === 'completed');
      const totalCountValue = completedTotalRedemptions.reduce((sum, r) => sum + r.quantity, 0);
      setTotalCount(totalCountValue);

      // 获取本小时兑换记录（用于检查每小时限制）
      try {
        const now = new Date();
        const hourKey = now.toISOString().split(':')[0]; // YYYY-MM-DDTHH
        const hourlyRedemptions = await getHourlyRedemptions(userId, hourKey);
        const currentHourlyCount = hourlyRedemptions.reduce((sum, r) => sum + r.quantity, 0);
        setHourlyCount(currentHourlyCount);

        // 检查本小时是否还可以兑换（默认每小时只能兑换1次）
        const effectiveHourlyLimit = userLimits.hourlyLimit !== undefined ? userLimits.hourlyLimit : 1;
        setCanRedeemThisHour(currentHourlyCount < effectiveHourlyLimit);

      } catch (error) {
        // 如果获取失败，默认允许兑换（避免因为查询失败而禁用按钮）
        setCanRedeemThisHour(true);
        setHourlyCount(0);
      }

      // 获取 Day Pass 配置
      try {
        const { getPointsConfig } = await import('../../services/firebase/pointsConfig');
        const pointsConfig = await getPointsConfig();
        if (pointsConfig?.dayPass) {
          setDayPassConfig(pointsConfig.dayPass);
        }
      } catch (e) {
        console.error('加载 Day Pass 配置失败:', e);
      }
    } catch (error) {
      // 加载失败，静默处理
    }
  };

  // 加载年费金额
  useEffect(() => {
    const loadAnnualFee = async () => {
      try {
        const { getCurrentAnnualFeeAmount } = await import('../../services/firebase/membershipFee');
        const amount = await getCurrentAnnualFeeAmount();
        setAnnualFeeAmount(amount);
      } catch (error) {
        // 获取年费金额失败，静默处理
      }
    };
    if (user?.id) {
      loadAnnualFee();
    }
  }, [user?.id]);

  // 加载兑换数据和时长数据
  useEffect(() => {
    loadData();
    const interval = setInterval(loadData, 60000); // 每60秒刷新一次

    return () => clearInterval(interval);
  }, [user]);

  // 开通会员
  const handleActivateMembership = async () => {
    if (!user?.id) {
      message.warning(t('auth.pleaseLogin'));
      return;
    }

    if (loading) {
      return;
    }

    setLoading(true);

    try {
      // 先检查是否已存在 pending 状态的年费记录
      const { getUserMembershipFeeRecords } = await import('../../services/firebase/membershipFee');
      const existingRecords = await getUserMembershipFeeRecords(user.id, 10);
      const pendingRecord = existingRecords.find(r => r.status === 'pending' && r.renewalType === 'initial');

      let recordId: string;

      if (pendingRecord) {
        recordId = pendingRecord.id;
      } else {
        const today = new Date();
        const result = await createMembershipFeeRecord(
          user.id,
          today,
          'initial',
          undefined,
          user.displayName,
          selectedStoreId
        );

        if (!result.success || !result.recordId) {
          message.error(result.error || t('visitTimer.createMembershipFeeRecordFailed'));
          setLoading(false);
          return;
        }

        recordId = result.recordId;
      }

      // 立即尝试扣除年费
      const deductResult = await deductMembershipFee(recordId);

      if (deductResult.success) {
        message.success(t('visitTimer.membershipActivateSuccess'));

        // 刷新用户信息
        try {
          const updatedUser = await getUserData(user.id);
          if (updatedUser) {
            setUser(updatedUser);
          }
        } catch (error) {
          // 静默处理
        }

        await loadData();
        setMembershipModalVisible(false);
        setSelectedAccess(null);
      } else {
        message.error(deductResult.error || t('visitTimer.deductFeeFailedRetry'));
      }
    } catch (error: any) {
      message.error(error.message || t('visitTimer.activateMembershipFailedRetry'));
    } finally {
      setLoading(false);
    }
  };
  const handleRedeem = async () => {
    if (!user?.id) {
      message.warning(t('auth.pleaseLogin'));
      return;
    }

    if (loading) {
      return;
    }

    setLoading(true);

    try {
      const session = await getPendingVisitSession(user.id);
      if (!session) {
        message.warning(t('visitTimer.pleaseCheckInFirst'));
        setLoading(false);
        return;
      }

      const canRedeem = await canUserRedeem(user.id, 1);
      if (!canRedeem.canRedeem) {
        message.warning(canRedeem.reason || t('visitTimer.cannotRedeem'));
        setLoading(false);
        return;
      }

      const { createPendingRedemptionRecord } = await import('../../services/firebase/redemption');
      const result = await createPendingRedemptionRecord(user.id, session.id, 1);

      if (result.success) {
        message.success(t('visitTimer.redeemRequestSubmitted'));
        const storageKey = `redeem_countdown_${user.id}`;
        localStorage.setItem(storageKey, Date.now().toString());
        setCountdownSeconds(3600);
      } else {
        message.error(result.error || t('visitTimer.submitRedeemRequestFailed'));
      }
    } catch (error: any) {
      message.error(error.message || t('visitTimer.redeemFailedRetry'));
    } finally {
      setLoading(false);
    }
  };

  const handleBuyDayPass = async () => {
    if (!user?.id) {
      message.warning(t('auth.pleaseLogin'));
      return;
    }
    if (loading) return;

    setLoading(true);
    try {
      const { purchaseDayPass } = await import('../../services/firebase/visitSessions');
      const result = await purchaseDayPass(user.id, selectedStoreId, selectedStoreName, user.displayName, currentSession?.id);
      if (result.success) {
        message.success(t('visitTimer.dayPassPurchaseSuccess'));
        const updatedUser = await getUserData(user.id);
        if (updatedUser) setUser(updatedUser);
        await loadData();
        setMembershipModalVisible(false);
        setSelectedAccess(null);
      } else {
        message.error(result.error || t('visitTimer.purchaseFailed'));
      }
    } catch (error: any) {
      message.error(error.message || t('visitTimer.purchaseFailed'));
    } finally {
      setLoading(false);
    }
  };

  if (!user) {
    return null;
  }

  const dailyRemaining = Math.max(0, limits.dailyLimit - dailyCount);
  const totalRemaining = Math.max(0, limits.totalLimit - totalCount);
  const dailyPercent = limits.dailyLimit > 0 ? (dailyCount / limits.dailyLimit) * 100 : 0;
  const totalPercent = limits.totalLimit > 0 ? (totalCount / limits.totalLimit) * 100 : 0;

  // 检查是否在截止时间之前
  const now = new Date();
  const [cutoffHour, cutoffMinute] = cutoffTime.split(':').map(Number);
  const cutoff = new Date(now);
  cutoff.setHours(cutoffHour, cutoffMinute, 0, 0);
  // 如果当前时间已经过了今天的截止时间，检查是否应该允许兑换
  // 如果当前时间小于截止时间，说明还在今天，允许兑换
  const isBeforeCutoff = now < cutoff;

  // 计算合并后的进度条数据
  const hoursText = formatHours(totalHours);
  // 使用后端返回的限额，而不是前端计算值（确保与里程碑奖励逻辑一致）
  const currentCigarLimit = limits.totalLimit; // 使用 getUserRedemptionLimits 返回的 totalLimit

  // 计算「距下一个里程碑」的进度（每50小时一个里程碑，无上限）
  const prevMilestone = Math.floor(totalHours / 50) * 50; // 上一个已达成的里程碑（0, 50, 100, ...）
  const nextMilestone = prevMilestone + 50; // 下一个待达成的里程碑
  const milestoneProgress = ((totalHours - prevMilestone) / 50) * 100; // 在当前区间内的百分比

  return (
    <Card
      style={{
        background: 'linear-gradient(135deg, rgba(26, 26, 26, 0.95) 0%, rgba(45, 45, 45, 0.95) 100%)',
        border: '1px solid rgba(255, 215, 0, 0.2)',
        borderRadius: 12,
        ...style
      }}
      styles={{ body: { padding: 16 } }}
    >
      <Space direction="vertical" size="middle" style={{ width: '100%' }}>
        {/* 上半部分：计时器区域 */}
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
          {/* 左侧：计时器信息 */}
          <div style={{ flex: 1 }}>
            <Space direction="vertical" size={4} style={{ width: '100%' }}>
              {/* Last Check In - 显示在计时器上面 */}
              {lastCheckIn && (
                <div>
                  <Text style={{ color: '#FFFFFF', fontSize: 12, fontWeight: 600 }}>
                    {t('visitTimer.lastCheckIn')}
                  </Text>
                  <Text style={{ color: '#c0c0c0', fontSize: 11, marginLeft: 8 }}>
                    {dayjs(lastCheckIn).format('YYYY-MM-DD HH:mm:ss')}
                  </Text>
                </div>
              )}

              {/* Stay Duration Timer */}
              <div>
                <Title level={3} style={{ margin: 0, color: '#FFFFFF', fontFamily: 'monospace' }}>
                  {duration}
                </Title>
                <Text style={{ color: '#c0c0c0', fontSize: 12 }}>
                  <ClockCircleOutlined /> {t('visitTimer.stayDurationTimer')}
                </Text>
              </div>
            </Space>
          </div>

          {/* 右侧：Redeem 按钮 */}
          <div style={{ marginLeft: 16, textAlign: 'center' }}>
            {(() => {
              // 计算倒计时显示文本
              const formatCountdown = (seconds: number): string => {
                const hours = Math.floor(seconds / 3600);
                const minutes = Math.floor((seconds % 3600) / 60);
                const secs = seconds % 60;
                return `${String(hours).padStart(2, '0')}:${String(minutes).padStart(2, '0')}:${String(secs).padStart(2, '0')}`;
              };

              // 检查用户会员状态
              const isActiveMember = user?.status === 'active';
              const hasDayPass = currentSession?.dayPass?.isPurchased;

              // 计算显示用的限额
              const displayDailyLimit = hasDayPass ? 1 : (isActiveMember ? limits.dailyLimit : 0);
              // 计算当日已兑换数量（如果是 Day Pass，由于系统会自动创建一个 pending 记录，我们计算所有状态的 Day Pass 记录）
              // 但为了统一逻辑，我们先看看如何获取当日 Day Pass 记录
              const displayDailyCount = isActiveMember ? dailyCount : (hasDayPass ? dailyRedemptions.filter(r => r.isDayPass).length : 0);

              // 如果不是活跃会员且没有购买 Day Pass，显示合并按钮
              if (!isActiveMember && !hasDayPass) {
                return (
                  <>
                    <button
                      type="button"
                      onClick={() => setMembershipModalVisible(true)}
                      disabled={loading}
                      style={{
                        background: appConfig?.colorTheme?.primaryButton
                          ? `linear-gradient(135deg, ${appConfig.colorTheme.primaryButton.startColor} 0%, ${appConfig.colorTheme.primaryButton.endColor} 100%)`
                          : 'linear-gradient(135deg, #FDE08D 0%, #C48D3A 100%)',
                        color: '#111',
                        height: 48,
                        fontSize: 16,
                        fontWeight: 600,
                        minWidth: 140,
                        opacity: loading ? 0.6 : 1,
                        cursor: loading ? 'not-allowed' : 'pointer',
                        display: 'flex',
                        alignItems: 'center',
                        justifyContent: 'center',
                        gap: 8,
                        borderRadius: 6,
                        padding: '0 24px',
                        boxShadow: '0 4px 12px rgba(196, 141, 58, 0.3)'
                      }}
                    >
                      {loading && <span className="anticon-spin" style={{ display: 'inline-block', width: 14, height: 14, border: '2px solid #111', borderTopColor: 'transparent', borderRadius: '50%', animation: 'spin 1s linear infinite' }} />}
                      <GiftOutlined />
                      {t('visitTimer.joinNow')}
                    </button>
                    <Text style={{ fontSize: 13, display: 'block', marginTop: 8, color: '#FFFFFF', textAlign: 'center' }}>
                      {t('visitTimer.dailyLimit')}: 0/0
                    </Text>
                  </>
                );
              }

              // 如果是活跃会员或已购买 Day Pass，显示正常逻辑
              const currentPoints = user?.membership?.points || 0;
              const isLowPoints = currentPoints < 50;

              // 判断按钮状态和显示文本
              let buttonText = t('visitTimer.redeem');
              let isDisabled = true;
              let buttonIcon: React.ReactNode = undefined;
              let buttonOnClick: () => void | Promise<void> = handleRedeem;
              let buttonStyle: React.CSSProperties = {
                background: appConfig?.colorTheme?.primaryButton
                  ? `linear-gradient(135deg, ${appConfig.colorTheme.primaryButton.startColor} 0%, ${appConfig.colorTheme.primaryButton.endColor} 100%)`
                  : 'linear-gradient(135deg, #FDE08D 0%, #C48D3A 100%)',
                border: 'none',
                color: '#111',
                height: 48,
                fontSize: 16,
                fontWeight: 600,
                minWidth: 120
              };

              // 如果是 Day Pass 模式，禁用 Redeem 按钮
              if (hasDayPass) {
                buttonText = t('visitTimer.redeem');
                isDisabled = true;
                buttonStyle.opacity = 0.5;
                buttonIcon = <ShoppingCartOutlined />;
              }
              // 如果积分少于50，显示Reload按钮
              else if (isLowPoints) {
                buttonText = t('visitTimer.reload');
                buttonIcon = <ReloadOutlined />;
                buttonOnClick = () => {
                  navigate('/reload');
                };
                isDisabled = false;
                buttonStyle.opacity = 1;
              }
              // 如果dailyCount >= dailyLimit，显示"No Quota"
              else if (dailyCount >= limits.dailyLimit) {
                buttonText = t('visitTimer.noQuota');
                isDisabled = true;
                buttonStyle.opacity = 0.5;
              }
              // 如果倒计时中，显示倒计时
              else if (countdownSeconds !== null && countdownSeconds > 0) {
                buttonText = formatCountdown(countdownSeconds);
                isDisabled = true;
                buttonStyle.opacity = 0.7;
              }
              // 其他情况，检查是否可以兑换
              else {
                isDisabled = !isBeforeCutoff || !currentSession || loading;
                buttonStyle.opacity = isDisabled ? 0.5 : 1;
                buttonIcon = countdownSeconds === null || countdownSeconds <= 0 ? <ShoppingCartOutlined /> : undefined;
              }

              return (
                <>
                  <button
                    type="button"
                    onClick={buttonOnClick}
                    disabled={isDisabled || loading}
                    style={{
                      ...buttonStyle,
                      cursor: (isDisabled || loading) ? 'not-allowed' : 'pointer',
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'center',
                      gap: 8,
                      borderRadius: 6,
                      padding: '0 16px'
                    }}
                    title={
                      hasDayPass
                        ? t('visitTimer.dayPassIncludesRedemption')
                        : isLowPoints
                          ? t('visitTimer.insufficientPointsTooltip', { currentPoints })
                          : dailyCount >= limits.dailyLimit
                            ? t('visitTimer.dailyQuotaExhausted')
                            : countdownSeconds !== null && countdownSeconds > 0
                              ? t('visitTimer.waitBeforeRedeem', { countdown: formatCountdown(countdownSeconds) })
                              : !currentSession
                                ? t('visitTimer.pleaseCheckInFirst')
                                : !isBeforeCutoff
                                  ? t('visitTimer.cutoffPassedRetry', { cutoffTime })
                                  : undefined
                    }
                  >
                    {loading && <span style={{ display: 'inline-block', width: 16, height: 16, border: '2px solid #111', borderTopColor: 'transparent', borderRadius: '50%', animation: 'spin 1s linear infinite' }} />}
                    {buttonIcon}
                    {buttonText}
                  </button>
                  <Text style={{ fontSize: 13, display: 'block', marginTop: 8, color: '#FFFFFF' }}>
                    {t('visitTimer.dailyLimit')}: {displayDailyCount}/{displayDailyLimit}
                  </Text>
                </>
              );
            })()}
          </div>
        </div>

        {/* 合并后的兑换和时长奖励区域 */}
        <div
          style={{
            background: 'rgba(0, 0, 0, 0.2)',
            border: '1px solid rgba(255, 215, 0, 0.3)',
            borderRadius: 8,
            padding: 16,
            marginTop: 8
          }}
        >
          {/* 合并的进度条区域 */}
          <div>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16 }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                <Title level={5} style={{ margin: 0, color: '#FFFFFF', fontSize: 18, fontWeight: 700 }}>
                  {t('visitTimer.complimentaryCigars')}
                </Title>
              </div>
              <div
                onClick={async () => {
                  setHistoryModalVisible(true);
                  if (user?.id) {
                    setHistoryLoading(true);
                    try {
                      const history = await getTotalRedemptions(user.id);
                      // getTotalRedemptions 已经返回了拍平后的 RedemptionRecord[]
                      const sortedHistory = [...history].sort((a, b) => {
                        const dateA = a.redeemedAt instanceof Date ? a.redeemedAt : new Date(a.redeemedAt);
                        const dateB = b.redeemedAt instanceof Date ? b.redeemedAt : new Date(b.redeemedAt);
                        return dateB.getTime() - dateA.getTime();
                      });
                      setRedemptionHistory(sortedHistory);
                    } catch (error) {
                      message.error(t('visitTimer.loadHistoryFailed'));
                    } finally {
                      setHistoryLoading(false);
                    }
                  }
                }}
                style={{
                  background: 'none',
                  padding: 0,
                  color: '#C48D3A',
                  fontSize: 14,
                  fontWeight: 600,
                  cursor: 'pointer',
                  textDecoration: 'none'
                }}
              >
                {t('visitTimer.history')} &gt;
              </div>
            </div>

            {/* 数据统计行 */}
            <div style={{ marginBottom: 16 }}>
              <div style={{ display: 'flex', alignItems: 'baseline', justifyContent: 'space-between', marginBottom: 12 }}>
                {/* 累计驻店时长 */}
                <div style={{ display: 'flex', alignItems: 'baseline', gap: 6 }}>
                  <Text style={{ fontSize: 12, color: '#9ca3af', fontWeight: 500 }}>{t('visitTimer.accumulated')}</Text>
                  <Text style={{
                    fontSize: 22,
                    fontWeight: 800,
                    backgroundImage: 'linear-gradient(to right, #FDE08D, #C48D3A)',
                    WebkitBackgroundClip: 'text',
                    WebkitTextFillColor: 'transparent',
                    color: 'transparent',
                    display: 'inline-block'
                  }}>{hoursText}</Text>
                  <Text style={{ fontSize: 13, fontWeight: 400, color: '#9ca3af' }}>{t('visitTimer.hours')}</Text>
                </div>
                {/* 雪茄兑换统计 */}
                <div style={{ display: 'flex', alignItems: 'baseline', gap: 4 }}>
                  <Text style={{
                    fontSize: 22,
                    fontWeight: 800,
                    backgroundImage: 'linear-gradient(to right, #FDE08D, #C48D3A)',
                    WebkitBackgroundClip: 'text',
                    WebkitTextFillColor: 'transparent',
                    color: 'transparent',
                    display: 'inline-block'
                  }}>{totalCount}</Text>
                  <Text style={{ fontSize: 13, fontWeight: 400, color: '#9ca3af' }}>/ {currentCigarLimit} {t('visitTimer.cigars')}</Text>
                </div>
              </div>

              {/* 下一个里程碑进度条 */}
              <div style={{ marginBottom: 8 }}>
                {/* 进度条标签行：上一里程碑 ← → 下一里程碑 */}
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 6 }}>
                  <Text style={{ fontSize: 11, color: prevMilestone > 0 ? '#C48D3A' : '#6b7280', fontWeight: 500 }}>
                    {prevMilestone > 0 ? `${prevMilestone}h ✓` : '0h'}
                  </Text>
                  <Text style={{ fontSize: 11, color: '#FDE08D', fontWeight: 600 }}>
                    🏆 {nextMilestone}h
                  </Text>
                </div>
                {/* 进度条 */}
                <div style={{ height: 10, width: '100%', borderRadius: 9999, backgroundColor: '#374151', overflow: 'hidden', position: 'relative' }}>
                  <div
                    style={{
                      height: '100%',
                      borderRadius: 9999,
                      background: 'linear-gradient(90deg, #FDE08D 0%, #C48D3A 100%)',
                      width: `${Math.min(100, milestoneProgress)}%`,
                      transition: 'width 0.5s ease'
                    }}
                  />
                </div>
                {/* 进度文字 */}
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginTop: 4 }}>
                  <Text style={{ fontSize: 11, color: 'rgba(255,255,255,0.4)' }}>
                    {formatHours(totalHours - prevMilestone)} / 50 {t('visitTimer.hours')}
                  </Text>
                  <Text style={{ fontSize: 11, color: 'rgba(255,255,255,0.4)' }}>
                    +25 {t('visitTimer.cigars')}
                  </Text>
                </div>
              </div>
            </div>

            {/* 截止提示 */}
            <div style={{
              display: 'flex',
              alignItems: 'center',
              gap: 8,
              borderRadius: 6,
              backgroundColor: 'rgba(255, 255, 255, 0.05)',
              padding: 8,
              textAlign: 'center'
            }}>
              <span style={{ fontSize: 16, color: '#FDE08D' }}></span>
              <Text style={{ fontSize: 12, color: '#9ca3af' }}>
                {t('redemption.lastCall', { time: cutoffTime })}
              </Text>
            </div>
          </div>
        </div>
      </Space>

      <Modal
        title={
          <Space>
            <GiftOutlined style={{ color: '#FDE08D' }} />
            <span style={{ color: '#FDE08D' }}>{t('redemption.title')}</span>
          </Space>
        }
        open={historyModalVisible}
        onCancel={() => setHistoryModalVisible(false)}
        footer={null}
        width={500}
        centered
        styles={{
          mask: { backdropFilter: 'blur(4px)' },
          content: {
            background: '#1a1612',
            border: '1px solid rgba(244, 175, 37, 0.3)',
            borderRadius: 16
          },
          header: {
            background: 'transparent',
            borderBottom: '1px solid rgba(244, 175, 37, 0.2)',
            paddingBottom: 16
          }
        }}
      >
        <List
          dataSource={redemptionHistory}
          loading={historyLoading}
          pagination={{
            pageSize: 10,
            simple: true,
            size: 'small',
            className: 'dark-pagination'
          }}
          renderItem={(item: any) => {
            const date = item.redeemedAt instanceof Date ? item.redeemedAt : new Date(item.redeemedAt);
            const isCompleted = item.status === 'completed';

            return (
              <List.Item style={{ border: 'none', padding: '6px 0' }}>
                <div style={{
                  width: '100%',
                  background: 'linear-gradient(135deg, rgba(255, 255, 255, 0.05) 0%, rgba(255, 255, 255, 0.02) 100%)',
                  border: '1px solid rgba(244, 175, 37, 0.15)',
                  borderRadius: 12,
                  padding: '12px 16px',
                  display: 'flex',
                  justifyContent: 'space-between',
                  alignItems: 'center',
                  backdropFilter: 'blur(10px)',
                  transition: 'all 0.3s ease'
                }} className="history-card-item">
                  <div style={{ flex: 1 }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 4 }}>
                      <ClockCircleOutlined style={{ color: 'rgba(244, 175, 37, 0.5)', fontSize: 10 }} />
                      <Text style={{ color: 'rgba(255, 255, 255, 0.45)', fontSize: 11 }}>
                        {dayjs(date).format('YYYY-MM-DD HH:mm')}
                      </Text>
                    </div>
                    <div style={{
                      color: '#fff',
                      fontSize: 14,
                      fontWeight: 600,
                      letterSpacing: '0.5px'
                    }}>
                      {item.cigarName || t('redemption.pendingChoice')}
                    </div>
                  </div>

                  <div style={{ textAlign: 'right', display: 'flex', flexDirection: 'column', alignItems: 'flex-end', gap: 6 }}>
                    <div style={{
                      fontSize: 18,
                      fontWeight: 800,
                      color: '#FDE08D',
                      fontFamily: 'monospace',
                      lineHeight: 1
                    }}>
                      x{item.quantity}
                    </div>
                    <Tag
                      style={{
                        borderRadius: 4,
                        margin: 0,
                        fontSize: 10,
                        padding: '0 6px',
                        lineHeight: '18px',
                        background: isCompleted ? 'rgba(212, 175, 55, 0.15)' : 'rgba(24, 144, 255, 0.15)',
                        border: isCompleted ? '1px solid rgba(212, 175, 55, 0.4)' : '1px solid rgba(24, 144, 255, 0.4)',
                        color: isCompleted ? '#FDE08D' : '#1890ff'
                      }}
                    >
                      {isCompleted ? t('redemption.completed') : t('redemption.pending')}
                    </Tag>
                  </div>
                </div>
              </List.Item>
            );
          }}
          locale={{
            emptyText: (
              <div style={{ padding: '40px 0', textAlign: 'center' }}>
                <GiftOutlined style={{ fontSize: 32, color: 'rgba(255,255,255,0.1)', marginBottom: 12 }} />
                <div style={{ color: 'rgba(255,255,255,0.2)', fontSize: 13 }}>{t('redemption.empty')}</div>
              </div>
            )
          }}
        />
        <style>{`
          .dark-pagination .ant-pagination-simple-pager input {
            background: rgba(255, 255, 255, 0.1) !important;
            border: 1px solid rgba(244, 175, 37, 0.3) !important;
            color: #FDE08D !important;
          }
          .dark-pagination .ant-pagination-item-link {
            color: rgba(255, 255, 255, 0.45) !important;
          }
          .history-card-item:hover {
            background: rgba(244, 175, 37, 0.08) !important;
            border-color: rgba(244, 175, 37, 0.4) !important;
            transform: translateY(-2px);
            box-shadow: 0 4px 12px rgba(0, 0, 0, 0.2);
          }
        `}</style>
      </Modal>

      {/* 会员/Day Pass 选择弹窗 */}
      <Modal
        title={<span style={{ color: '#FDE08D', fontWeight: 800, fontSize: 18 }}>{t('visitTimer.chooseAccess')}</span>}
        open={membershipModalVisible}
        onCancel={() => setMembershipModalVisible(false)}
        footer={null}
        width={window.innerWidth < 768 ? '95%' : 600}
        centered
        styles={{
          mask: { backdropFilter: 'blur(8px)' },
          content: {
            background: '#1a1a1a',
            border: '1px solid #C48D3A',
            borderRadius: 16,
            padding: '24px'
          }
        }}
      >
        <div style={{
          marginBottom: 16,
          padding: '12px 16px',
          background: 'rgba(255, 255, 255, 0.05)',
          borderRadius: 12,
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'center',
          border: '1px solid rgba(244, 175, 37, 0.2)',
          marginTop: 16
        }}>
          <span style={{ color: 'rgba(255, 255, 255, 0.6)', fontSize: 14 }}>{t('visitTimer.currentBalance')}</span>
          <span style={{
            color: '#FDE08D',
            fontSize: 18,
            fontWeight: 800,
            textShadow: '0 0 10px rgba(253, 224, 141, 0.3)'
          }}>
            {user?.membership?.points || 0} {t('visitTimer.points')}
          </span>
        </div>

        {/* 门店选择 */}
        <div style={{ marginBottom: 16 }}>
          <div style={{ color: 'rgba(255, 255, 255, 0.6)', fontSize: 14, marginBottom: 8 }}>{t('visitTimer.selectStore')}</div>
          <StoreSelect
            value={selectedStoreId}
            onChange={(id, name) => {
              setSelectedStoreId(id);
              setSelectedStoreName(name);
            }}
            disabled={loading}
            placeholder={t('visitTimer.pleaseSelectStore')}
          />
        </div>

        <div style={{
          display: 'grid',
          gridTemplateColumns: window.innerWidth < 768 ? 'repeat(2, 1fr)' : 'repeat(2, 1fr)',
          gap: 12,
          marginTop: 16
        }}>
          {/* Card 1: Membership */}
          <div
            onClick={() => setSelectedAccess('membership')}
            style={{
              padding: window.innerWidth < 768 ? '16px 12px' : '24px',
              borderRadius: 12,
              cursor: (loading || annualFeeAmount === null) ? 'not-allowed' : 'pointer',
              background: selectedAccess === 'membership' ? 'rgba(253,224,141,0.08)' : 'rgba(255,255,255,0.03)',
              border: selectedAccess === 'membership' ? '2px solid #FDE08D' : '1px solid rgba(255,255,255,0.1)',
              transition: 'all 0.2s cubic-bezier(0.4, 0, 0.2, 1)',
              display: 'flex',
              flexDirection: 'column',
              justifyContent: 'space-between',
              minHeight: window.innerWidth < 768 ? 160 : 200,
              boxShadow: selectedAccess === 'membership' ? '0 0 15px rgba(253,224,141,0.2)' : 'none',
            }}
            className="membership-selection-card"
          >
            <div>
              <div style={{ color: selectedAccess === 'membership' ? '#FDE08D' : '#fff', fontWeight: 800, fontSize: 16, marginBottom: 8 }}>
                {t('visitTimer.annualMembership')}
              </div>
              <div style={{ color: 'rgba(255,255,255,0.6)', fontSize: 11, lineHeight: 1.4, whiteSpace: 'pre-line' }} className="benefit-list">
                {t('visitTimer.benefits.membership')}
              </div>
            </div>
            <div style={{ textAlign: 'right', marginTop: 16 }} className="price-text-container">
              <div style={{
                fontSize: 20,
                fontWeight: 800,
                backgroundImage: 'linear-gradient(to right,#FDE08D,#C48D3A)',
                WebkitBackgroundClip: 'text',
                color: 'transparent'
              }}>
                {annualFeeAmount} {t('visitTimer.points')}
              </div>
              <div style={{ color: 'rgba(255,255,255,0.3)', fontSize: 9, letterSpacing: 1 }}>{t('visitTimer.yearly')}</div>
            </div>
          </div>

          {/* Card 2: Day Pass */}
          <div
            onClick={() => setSelectedAccess('daypass')}
            style={{
              padding: window.innerWidth < 768 ? '16px 12px' : '24px',
              borderRadius: 12,
              cursor: loading ? 'not-allowed' : 'pointer',
              background: selectedAccess === 'daypass' ? 'rgba(253,224,141,0.08)' : 'rgba(255,255,255,0.03)',
              border: selectedAccess === 'daypass' ? '2px solid #FDE08D' : '1px solid rgba(255,255,255,0.1)',
              transition: 'all 0.2s cubic-bezier(0.4, 0, 0.2, 1)',
              display: 'flex',
              flexDirection: 'column',
              justifyContent: 'space-between',
              minHeight: window.innerWidth < 768 ? 160 : 200,
              boxShadow: selectedAccess === 'daypass' ? '0 0 15px rgba(253,224,141,0.2)' : 'none',
            }}
            className="membership-selection-card"
          >
            <div>
              <div style={{ color: selectedAccess === 'daypass' ? '#FDE08D' : '#fff', fontWeight: 800, fontSize: 16, marginBottom: 8 }}>
                {t('visitTimer.dayPass')}
              </div>
              <div style={{ color: 'rgba(255,255,255,0.6)', fontSize: 11, lineHeight: 1.4, whiteSpace: 'pre-line' }} className="benefit-list">
                {t('visitTimer.benefits.dayPass')}
              </div>
            </div>
            <div style={{ textAlign: 'right', marginTop: 16 }} className="price-text-container">
              <div style={{
                fontSize: 20,
                fontWeight: 800,
                backgroundImage: 'linear-gradient(to right,#FDE08D,#C48D3A)',
                WebkitBackgroundClip: 'text',
                color: 'transparent'
              }}>
                {dayPassConfig?.cost || 100} {t('visitTimer.points')}
              </div>
              <div style={{ color: 'rgba(255,255,255,0.3)', fontSize: 9, letterSpacing: 1 }}>{t('visitTimer.oneTime')}</div>
            </div>
          </div>
        </div>

        {/* Action Button Section */}
        {selectedAccess && (() => {
          const currentPoints = user?.membership?.points || 0;
          const cost = selectedAccess === 'membership' ? (annualFeeAmount || 0) : (dayPassConfig?.cost || 100);
          const hasEnoughPoints = currentPoints >= cost;

          return (
            <div style={{ marginTop: 24 }}>
              <button
                type="button"
                onClick={hasEnoughPoints ? (selectedAccess === 'membership' ? handleActivateMembership : handleBuyDayPass) : () => navigate('/reload')}
                disabled={loading}
                style={{
                  width: '100%',
                  height: 48,
                  borderRadius: 12,
                  background: 'linear-gradient(to right,#FDE08D,#C48D3A)',
                  border: 'none',
                  color: '#111',
                  fontWeight: 700,
                  fontSize: 16,
                  cursor: loading ? 'not-allowed' : 'pointer',
                  boxShadow: '0 4px 15px rgba(244,175,37,0.35)',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  gap: 8
                }}
              >
                {loading && <span className="anticon-spin" style={{ display: 'inline-block', width: 14, height: 14, border: '2px solid currentColor', borderTopColor: 'transparent', borderRadius: '50%', animation: 'spin 1s linear infinite' }} />}
                {!hasEnoughPoints && <WalletOutlined />}
                {hasEnoughPoints
                  ? (selectedAccess === 'membership' ? t('visitTimer.confirmActivation') : t('visitTimer.confirmPurchase'))
                  : `${t('visitTimer.reloadPoints')} (${t('visitTimer.short')}: ${cost - currentPoints})`
                }
              </button>
            </div>
          );
        })()}

        <style>{`
          .membership-selection-card {
            transition: all 0.2s cubic-bezier(0.4, 0, 0.2, 1) !important;
          }
          @media (max-width: 575px) {
            .membership-selection-card {
              padding: 12px 10px !important;
              min-height: 180px !important;
            }
            .membership-selection-card .benefit-list {
              font-size: 10px !important;
              line-height: 1.4 !important;
              margin-top: 4px !important;
            }
            .membership-selection-card .price-text-container {
              margin-top: 12px !important;
            }
            .membership-selection-card .price-text-container div:first-child {
              font-size: 16px !important;
            }
          }
          .membership-selection-card:hover {
            background: rgba(253,224,141,0.08) !important;
            transform: translateY(-5px);
            border-color: #FDE08D !important;
            box-shadow: 0 0 15px rgba(253,224,141,0.2) !important;
          }
        `}</style>
      </Modal>
    </Card>
  );
};

// 格式化小时显示（例如：02:32）
function formatHours(hours: number): string {
  return String(Math.floor(hours));
}

