import { Alert, Button, Card, Space, Table, Tag, Typography } from 'antd';
import { CloudServerOutlined, DatabaseOutlined, LineChartOutlined, LinkOutlined, WarningOutlined } from '@ant-design/icons';
import { useTranslation } from 'react-i18next';

const { Text, Title } = Typography;

const FIREBASE_USAGE_URL = 'https://console.firebase.google.com/project/macanudosocial/firestore/usage';
const CLOUD_QUOTAS_URL = 'https://console.cloud.google.com/iam-admin/quotas?project=macanudosocial';
const NETLIFY_LOGS_URL = 'https://app.netlify.com/';

export default function SystemMonitoring() {
  const { t } = useTranslation();

  const coverage = [
    {
      key: 'membership',
      icon: <DatabaseOutlined />,
      feature: t('systemMonitoring.membership'),
      source: t('systemMonitoring.sources.membership'),
      signals: t('systemMonitoring.membershipSignals'),
      status: t('systemMonitoring.external'),
    },
    {
      key: 'orders',
      icon: <LineChartOutlined />,
      feature: t('systemMonitoring.orders'),
      source: t('systemMonitoring.sources.orders'),
      signals: t('systemMonitoring.ordersSignals'),
      status: t('systemMonitoring.instrumentationNeeded'),
    },
    {
      key: 'notifications',
      icon: <CloudServerOutlined />,
      feature: t('systemMonitoring.notifications'),
      source: t('systemMonitoring.sources.notifications'),
      signals: t('systemMonitoring.notificationsSignals'),
      status: t('systemMonitoring.instrumentationNeeded'),
    },
    {
      key: 'frontend',
      icon: <LinkOutlined />,
      feature: t('systemMonitoring.frontend'),
      source: t('systemMonitoring.sources.frontend'),
      signals: t('systemMonitoring.frontendSignals'),
      status: t('systemMonitoring.external'),
    },
  ];

  return (
    <div className="system-monitoring-page">
      <Card className="system-monitoring-card">
        <div className="system-monitoring-intro">
          <div>
            <Title level={4} style={{ marginTop: 0 }}>{t('systemMonitoring.title')}</Title>
            <Text type="secondary">{t('systemMonitoring.description')}</Text>
          </div>
          <Tag color="gold" icon={<WarningOutlined />}>{t('systemMonitoring.implementation')}</Tag>
        </div>

        <Alert
          showIcon
          type="info"
          message={t('systemMonitoring.coverage')}
          description={t('systemMonitoring.coverageDescription')}
          style={{ margin: '20px 0' }}
        />

        <Title level={5}>{t('systemMonitoring.externalDashboards')}</Title>
        <Space wrap size={[12, 12]}>
          <Button icon={<DatabaseOutlined />} href={FIREBASE_USAGE_URL} target="_blank" rel="noreferrer">
            {t('systemMonitoring.openFirebaseUsage')}
          </Button>
          <Button icon={<LineChartOutlined />} href={CLOUD_QUOTAS_URL} target="_blank" rel="noreferrer">
            {t('systemMonitoring.openCloudQuotas')}
          </Button>
          <Button icon={<CloudServerOutlined />} href={NETLIFY_LOGS_URL} target="_blank" rel="noreferrer">
            {t('systemMonitoring.openNetlifyLogs')}
          </Button>
        </Space>

        <Title level={5} style={{ marginTop: 28 }}>{t('systemMonitoring.coverage')}</Title>
        <Table
          size="small"
          pagination={false}
          scroll={{ x: 720 }}
          dataSource={coverage}
          columns={[
            {
              title: t('systemMonitoring.feature'),
              dataIndex: 'feature',
              key: 'feature',
              render: (value: string, record: typeof coverage[number]) => <Space>{record.icon}<span>{value}</span></Space>,
            },
            { title: t('systemMonitoring.source'), dataIndex: 'source', key: 'source' },
            { title: t('systemMonitoring.signals'), dataIndex: 'signals', key: 'signals' },
            {
              title: t('systemMonitoring.implementation'),
              dataIndex: 'status',
              key: 'status',
              render: (value: string) => <Tag color={value === t('systemMonitoring.external') ? 'blue' : 'gold'}>{value}</Tag>,
            },
          ]}
        />

        <Title level={5} style={{ marginTop: 28 }}>{t('systemMonitoring.alerts')}</Title>
        <div className="system-monitoring-alerts">
          <Tag color="gold">{t('systemMonitoring.readsWarning')}</Tag>
          <Tag color="red">{t('systemMonitoring.readsCritical')}</Tag>
          <Tag color="orange">{t('systemMonitoring.serverErrors')}</Tag>
          <Tag color="red">{t('systemMonitoring.quotaErrors')}</Tag>
        </div>

        <Text type="secondary" className="system-monitoring-note">{t('systemMonitoring.note')}</Text>
      </Card>
    </div>
  );
}
