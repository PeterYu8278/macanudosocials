import { Alert, Typography } from 'antd';
import { useTranslation } from 'react-i18next';
import { useSearchParams } from 'react-router-dom';
import LoungeDebtDetails from '../../../components/admin/LoungeDebtDetails';

export default function LoungeReports() {
  const { t } = useTranslation();
  const [params] = useSearchParams();
  const storeId = params.get('loungeId'), reportId = params.get('reportId');
  return <section>
    <Typography.Title level={3}>{t('loungeOperations.debt.details')}</Typography.Title>
    {storeId && reportId ? <LoungeDebtDetails key={`${storeId}-${reportId}`} storeId={storeId} reportId={reportId}
      reportKind={params.get('reportKind') === 'test' ? 'test' : 'formal'} autoOpen />
      : <Alert type="info" message={t('loungeOperations.debt.openReport')} />}
  </section>;
}
