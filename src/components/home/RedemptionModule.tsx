// 兑换模块组件
import React, { useState, useEffect } from 'react';
import { Card, Typography, Button, Space, Progress, App } from 'antd';
import { GiftOutlined, ShoppingCartOutlined } from '@ant-design/icons';
import { useAuthStore } from '../../store/modules/auth';
import { getPendingVisitSession } from '../../services/firebase/visitSessions';
import { getUserRedemptionLimits, canUserRedeem, getDailyRedemptions, getTotalRedemptions } from '../../services/firebase/redemption';
import { useNavigate } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import type { RedemptionRecord } from '../../types';

const { Title, Text } = Typography;

interface RedemptionModuleProps {
  style?: React.CSSProperties;
}

export const RedemptionModule: React.FC<RedemptionModuleProps> = ({ style }) => {
  const { t } = useTranslation();
  const { message } = App.useApp();
  const { user } = useAuthStore();
  const navigate = useNavigate();
  const [loading, setLoading] = useState(false);
  const [limits, setLimits] = useState({ dailyLimit: 3, totalLimit: 25 });
  const [dailyCount, setDailyCount] = useState(0);
  const [totalCount, setTotalCount] = useState(0);
  const [cutoffTime, setCutoffTime] = useState('23:00');

  useEffect(() => {
    if (!user?.id) return;

    const loadData = async () => {
      try {
        const userLimits = await getUserRedemptionLimits(user.id);
        setLimits(userLimits);

        const { getRedemptionConfig } = await import('../../services/firebase/redemption');
        const config = await getRedemptionConfig();
        if (config) {
          setCutoffTime(config.cutoffTime);
        }

        // 获取当日兑换记录
        const today = new Date().toISOString().split('T')[0];
        const dailyRedemptions = await getDailyRedemptions(user.id, today);
        setDailyCount(dailyRedemptions.reduce((sum, r) => sum + r.quantity, 0));

        // 获取总兑换记录
        const totalRedemptions = await getTotalRedemptions(user.id);
        setTotalCount(totalRedemptions.reduce((sum, r) => sum + r.quantity, 0));
      } catch (error) {
        console.error('加载兑换数据失败:', error);
      }
    };

    loadData();
    const interval = setInterval(loadData, 60000);

    return () => clearInterval(interval);
  }, [user]);

  const handleRedeem = async () => {
    if (!user?.id) {
      message.warning(t('auth.pleaseLogin'));
      return;
    }

    // 检查是否有pending session
    const session = await getPendingVisitSession(user.id);
    if (!session) {
      message.warning(t('visitTimer.pleaseCheckInFirst'));
      return;
    }

    // 检查是否可以兑换
    const canRedeem = await canUserRedeem(user.id, 1);
    if (!canRedeem.canRedeem) {
      message.warning(canRedeem.reason || t('visitTimer.cannotRedeem'));
      return;
    }

    // 跳转到兑换页面（需要在管理后台完成兑换）
    message.info(t('visitTimer.contactAdminForRedemption'));
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
  const isBeforeCutoff = now < cutoff;

  return (
    <Card
      style={{
        background: '#FFFFFF',
        borderRadius: 12,
        marginTop: 16,
        ...style
      }}
      bodyStyle={{ padding: 16 }}
    >
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16 }}>
        <Title level={4} style={{ margin: 0 }}>
          <GiftOutlined /> Redemption
        </Title>
        <Button type="link" onClick={() => navigate('/redemption-history')}>
          History &gt;
        </Button>
      </div>

      {/* 限额显示 */}
      <Space direction="vertical" size="small" style={{ width: '100%', marginBottom: 16 }}>
        <div style={{ display: 'flex', justifyContent: 'space-between' }}>
          <Text strong>Total: {totalCount}/{limits.totalLimit}</Text>
          <Text>Daily Limit: {limits.dailyLimit}</Text>
        </div>
        <div>
          <Text>Today ({dailyCount}/{limits.dailyLimit})</Text>
        </div>
        
        {/* 进度条 */}
        <Progress
          percent={dailyPercent}
          strokeColor={{
            '0%': '#ffd700',
            '100%': '#c48d3a',
          }}
          showInfo={false}
          style={{ marginTop: 8 }}
        />
      </Space>

      {/* 兑换按钮 */}
      <Button
        type="primary"
        block
        size="large"
        icon={<ShoppingCartOutlined />}
        onClick={handleRedeem}
        disabled={!isBeforeCutoff || dailyRemaining <= 0 || !user.membership?.currentVisitSessionId}
        loading={loading}
        style={{
          background: dailyRemaining > 0 && isBeforeCutoff
            ? 'linear-gradient(135deg, #FDE08D 0%, #C48D3A 100%)'
            : undefined,
          border: 'none',
          color: dailyRemaining > 0 && isBeforeCutoff ? '#111' : undefined,
          height: 48,
          fontSize: 16,
          fontWeight: 600
        }}
      >
        Redeem
      </Button>

      {/* 截止提示 */}
      <Text type="secondary" style={{ fontSize: 12, display: 'block', marginTop: 8, textAlign: 'center' }}>
        *Last call for cigar redemption is at or before {cutoffTime} PM
      </Text>
    </Card>
  );
};

