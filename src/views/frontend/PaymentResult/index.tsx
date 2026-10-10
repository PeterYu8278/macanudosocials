import React, { useEffect, useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { Button, Spin, Typography } from 'antd';
import { CheckCircleOutlined, CloseCircleOutlined, LoadingOutlined } from '@ant-design/icons';
import { useTranslation } from 'react-i18next';
import { ROUTES } from '../../../constants/routes';
import { getMembershipPaymentStatus } from '../../../services/membershipActivation';
import { useAuthStore } from '../../../store/modules/auth';
import { getUserData } from '../../../services/firebase/auth';

const { Title, Text } = Typography;

type PaymentState = 'loading' | 'success' | 'failed' | 'pending' | 'credited';

const PaymentResult: React.FC = () => {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const [state, setState] = useState<PaymentState>('loading');
  const [retry, setRetry] = useState(0);
  const { user, setUser } = useAuthStore();
  const membershipOrder = searchParams.get('membershipOrder');

  useEffect(() => {
    if (membershipOrder) {
      let cancelled = false;
      let timer: ReturnType<typeof setTimeout> | undefined;
      let attempts = 0;
      setState('loading');
      const check = async () => {
        try {
          const result = await getMembershipPaymentStatus(membershipOrder);
          if (cancelled) return;
          if (result.status === 'fulfilled' || result.status === 'credited') {
            setState(result.status === 'fulfilled' ? 'success' : 'credited');
            if (user?.id) {
              const freshUser = await getUserData(user.id);
              if (!cancelled && freshUser) setUser(freshUser);
            }
            return;
          }
        } catch { /* A delayed callback or transient backend error is not proof of failed payment. */ }
        if (cancelled) return;
        if (++attempts >= 10) setState('pending');
        else timer = setTimeout(check, 3000);
      };
      void check();
      return () => { cancelled = true; if (timer) clearTimeout(timer); };
    }
    // Billplz appends paid=true/false and id to the redirect_url
    const paid = searchParams.get('paid');
    if (paid === 'true') {
      setState('success');
    } else {
      setState('failed');
    }
  }, [searchParams, membershipOrder, retry, user?.id, setUser]);

  const billId = searchParams.get('id');

  const containerStyle: React.CSSProperties = {
    minHeight: '100vh',
    display: 'flex',
    flexDirection: 'column',
    alignItems: 'center',
    justifyContent: 'center',
    background: '#1a1a1a',
    padding: '24px',
    gap: '24px',
  };

  if (state === 'loading') {
    return (
      <div style={containerStyle}>
        <Spin indicator={<LoadingOutlined style={{ fontSize: 48, color: '#f4af25' }} spin />} />
      </div>
    );
  }

  const isSuccess = state === 'success';

  return (
    <div style={containerStyle}>
      {isSuccess ? (
        <CheckCircleOutlined style={{ fontSize: 72, color: '#52c41a' }} />
      ) : (
        <CloseCircleOutlined style={{ fontSize: 72, color: '#ff4d4f' }} />
      )}

      <Title level={2} style={{ color: '#f8f8f8', margin: 0, textAlign: 'center' }}>
        {state === 'pending' ? t('annualPassPayment.pendingTitle') : state === 'credited' ? t('annualPassPayment.creditedTitle') : isSuccess
          ? t('payment.successTitle', { defaultValue: '支付成功' })
          : t('payment.failedTitle', { defaultValue: '支付失败' })}
      </Title>

      <Text style={{ color: '#c0c0c0', fontSize: 14, textAlign: 'center' }}>
        {state === 'pending' ? t('annualPassPayment.pendingDescription') : state === 'credited' ? t('annualPassPayment.creditedDescription') : isSuccess && membershipOrder ? t('annualPassPayment.successDescription') : isSuccess
          ? t('payment.successDesc', { defaultValue: '您的付款已成功处理，积分将在片刻后更新。' })
          : t('payment.failedDesc', { defaultValue: '支付未完成，请重试或联系客服。' })}
      </Text>

      {billId && (
        <Text style={{ color: '#666', fontSize: 12 }}>
          {t('payment.billId', { defaultValue: '账单号' })}: {billId}
        </Text>
      )}

      <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap', justifyContent: 'center' }}>
        <Button
          type="primary"
          size="large"
          onClick={() => navigate(ROUTES.HOME)}
          style={{
            background: 'linear-gradient(to right, #FDE08D, #C48D3A)',
            border: 'none',
            color: '#000',
            fontWeight: 600,
          }}
        >
          {t('common.backToHome', { defaultValue: '返回首页' })}
        </Button>
        {!isSuccess && (
          <Button
            size="large"
            onClick={() => membershipOrder ? setRetry(value => value + 1) : navigate(-1)}
            style={{ borderColor: '#444', color: '#f8f8f8', background: 'transparent' }}
          >
            {t('common.tryAgain', { defaultValue: '重试' })}
          </Button>
        )}
      </div>
    </div>
  );
};

export default PaymentResult;
