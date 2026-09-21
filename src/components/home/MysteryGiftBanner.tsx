import React, { useState, useEffect } from 'react';
import { Modal, Typography, Space, Progress, App } from 'antd';
import { GiftOutlined, InfoCircleOutlined, UserAddOutlined, CheckCircleOutlined } from '@ant-design/icons';
import { useNavigate } from 'react-router-dom';
import { doc, updateDoc, arrayUnion } from 'firebase/firestore';
import { db } from '../../config/firebase';
import { COLLECTIONS } from '../../services/firebase/firestore';
import { getAppConfig } from '../../services/firebase/appConfig';
import { useAuth } from '../../hooks/useAuth';
import { getSuccessfulReferralCount } from '../../services/firebase/firestore';
import { getUserMembershipPeriod } from '../../services/firebase/membershipFee';
import { useTranslation } from 'react-i18next';
import type { AppConfig } from '../../types';

const { Text } = Typography;

const REFERRAL_MILESTONES = [
  { target: 3 },
  { target: 6 },
  { target: 10 },
  { target: 20 },
  { target: 50 },
] as const;

interface MysteryGiftBannerProps {
  style?: React.CSSProperties;
}

export const MysteryGiftBanner: React.FC<MysteryGiftBannerProps> = ({ style }) => {
  const navigate = useNavigate();
  const { user } = useAuth();
  const { t } = useTranslation();
  const { message } = App.useApp();
  const [appConfig, setAppConfig] = useState<AppConfig | null>(null);
  const [showModal, setShowModal] = useState(false);
  const [referrals, setReferrals] = useState(0);
  const [loading, setLoading] = useState(false);
  const [redeemedMilestones, setRedeemedMilestones] = useState<number[]>([]);
  const [claiming, setClaiming] = useState<number | null>(null);

  useEffect(() => {
    getAppConfig().then(cfg => cfg && setAppConfig(cfg)).catch(() => {});
  }, []);

  useEffect(() => {
    if (!showModal || !user?.id) return;
    setLoading(true);
    const load = async () => {
      try {
        const period = await getUserMembershipPeriod(user.id);
        const count = await getSuccessfulReferralCount(user.id, period?.startDate, period?.endDate);
        setReferrals(count);
        setRedeemedMilestones(user.referral?.redeemedMilestones ?? []);
      } catch {
        // silent
      } finally {
        setLoading(false);
      }
    };
    load();
  }, [showModal, user?.id]);

  const handleClaim = async (target: number) => {
    if (!user?.id) return;
    setClaiming(target);
    try {
      await updateDoc(doc(db, COLLECTIONS.USERS, user.id), {
        'referral.redeemedMilestones': arrayUnion(target),
        updatedAt: new Date(),
      });
      setRedeemedMilestones(prev => [...prev, target]);
      message.success(t('redemptionMechanism.claimSuccess'));
    } catch {
      message.error(t('common.operationFailed', { defaultValue: 'Operation failed' }));
    } finally {
      setClaiming(null);
    }
  };

  const primaryGradient = appConfig?.colorTheme?.primaryButton
    ? `linear-gradient(135deg, ${appConfig.colorTheme.primaryButton.startColor} 0%, ${appConfig.colorTheme.primaryButton.endColor} 100%)`
    : 'linear-gradient(135deg, #FDE08D 0%, #C48D3A 100%)';

  return (
    <>
      <button
        type="button"
        onClick={() => setShowModal(true)}
        style={{
          background: primaryGradient,
          borderRadius: 12,
          marginTop: 16,
          height: 56,
          fontSize: 16,
          fontWeight: 600,
          color: '#111',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          gap: 8,
          width: '100%',
          cursor: 'pointer',
          padding: '0 16px',
          border: 'none',
          ...style,
        }}
      >
        <GiftOutlined style={{ fontSize: 20 }} />
        {t('redemptionMechanism.redeemMysteryGift')}
      </button>

      <Modal
        title={
          <Space>
            <GiftOutlined style={{ color: '#FDE08D' }} />
            <span style={{ color: '#FDE08D' }}>{t('redemptionMechanism.title')}</span>
          </Space>
        }
        open={showModal}
        onCancel={() => setShowModal(false)}
        footer={null}
        styles={{
          mask: { backdropFilter: 'blur(4px)' },
          content: {
            background: '#1a1612',
            border: '1px solid rgba(244, 175, 37, 0.3)',
            borderRadius: 16,
          },
          header: {
            background: 'transparent',
            borderBottom: '1px solid rgba(244, 175, 37, 0.2)',
            paddingBottom: 16,
          },
        }}
        width={400}
        centered
      >
        <div style={{ padding: '8px 0' }}>
          <Space direction="vertical" size="large" style={{ width: '100%' }}>

            {/* 每日限额 */}
            <div style={{ background: 'rgba(255,255,255,0.03)', padding: 12, borderRadius: 8 }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 8 }}>
                <InfoCircleOutlined style={{ color: '#FDE08D' }} />
                <Text strong style={{ color: '#FFF' }}>{t('redemptionMechanism.dailyLimitTitle')}</Text>
              </div>
              <ul style={{ color: 'rgba(255,255,255,0.7)', paddingLeft: 20, margin: 0, fontSize: 13 }}>
                <li>{t('redemptionMechanism.baseLimit')}: <Text style={{ color: '#FDE08D' }}>{t('redemptionMechanism.cigarsPerDay', { count: 3 })}</Text></li>
                <li>{t('redemptionMechanism.waitInterval')}: <Text style={{ color: '#FDE08D' }}>{t('redemptionMechanism.betweenRedemptions', { count: 1 })}</Text></li>
                <li>{t('redemptionMechanism.lastCall')}: <Text style={{ color: '#FDE08D' }}>23:00 PM</Text></li>
              </ul>
            </div>

            {/* 邀请里程碑奖励 */}
            <div style={{ background: 'rgba(255,255,255,0.03)', padding: 12, borderRadius: 8 }}>
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 12 }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                  <UserAddOutlined style={{ color: '#FDE08D' }} />
                  <Text strong style={{ color: '#FFF' }}>{t('redemptionMechanism.referralRewardsTitle')}</Text>
                </div>
                <Text style={{ fontSize: 12, color: '#FDE08D' }}>
                  {t('redemptionMechanism.current')}:{' '}
                  <Text style={{ color: '#FFF', fontWeight: 600 }}>{loading ? '…' : referrals}</Text>{' '}
                  {t('redemptionMechanism.friends')}
                </Text>
              </div>

              <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
                {REFERRAL_MILESTONES.map(({ target }) => {
                  const eligible = referrals >= target;
                  const isRedeemed = redeemedMilestones.includes(target);
                  const pct = Math.min(100, (referrals / target) * 100);

                  return (
                    <div key={target}>
                      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', fontSize: 12, marginBottom: 4 }}>
                        <Text style={{ color: eligible ? '#FDE08D' : 'rgba(255,255,255,0.6)' }}>
                          {t('redemptionMechanism.inviteFriends', { count: target })}
                        </Text>

                        {isRedeemed ? (
                          <span style={{ display: 'flex', alignItems: 'center', gap: 4, color: 'rgba(255,255,255,0.35)', fontSize: 11, fontWeight: 600 }}>
                            <CheckCircleOutlined />
                            {t('redemptionMechanism.redeemed')}
                          </span>
                        ) : (
                          <button
                            type="button"
                            disabled={!eligible || claiming === target}
                            onClick={() => handleClaim(target)}
                            style={{
                              padding: '2px 10px',
                              borderRadius: 6,
                              fontSize: 11,
                              fontWeight: 600,
                              border: 'none',
                              cursor: eligible ? 'pointer' : 'not-allowed',
                              background: eligible
                                ? 'linear-gradient(to right, #FDE08D, #C48D3A)'
                                : 'rgba(255,255,255,0.08)',
                              color: eligible ? '#111' : 'rgba(255,255,255,0.25)',
                              opacity: claiming === target ? 0.6 : 1,
                              transition: 'all 0.2s',
                            }}
                          >
                            {claiming === target ? '…' : t('redemptionMechanism.claimReward')}
                          </button>
                        )}
                      </div>

                      <Progress
                        percent={pct}
                        size="small"
                        showInfo={false}
                        strokeColor={isRedeemed ? 'rgba(255,255,255,0.2)' : eligible ? '#FDE08D' : '#C48D3A'}
                        trailColor="rgba(255,255,255,0.05)"
                      />
                    </div>
                  );
                })}
              </div>
            </div>

            <Text style={{ fontSize: 11, color: 'rgba(255,255,255,0.4)', textAlign: 'center', display: 'block' }}>
              {t('redemptionMechanism.footerNote')}
            </Text>
          </Space>
        </div>
      </Modal>
    </>
  );
};
