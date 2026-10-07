import { Select } from 'antd';
import { BgColorsOutlined, SafetyOutlined, MessageOutlined, CreditCardOutlined, ExperimentOutlined, CloudServerOutlined, LineChartOutlined } from '@ant-design/icons';
import { useTranslation } from 'react-i18next';
import { SETTINGS_SECTIONS, type SettingsSection } from './settingsNavigation';
import './settings.css';

const icons = {
  appearance: <BgColorsOutlined />, login: <SafetyOutlined />, communication: <MessageOutlined />,
  payment: <CreditCardOutlined />, ai: <ExperimentOutlined />, environment: <CloudServerOutlined />, monitoring: <LineChartOutlined />,
};

export default function SystemSettingsNav({ section, onChange }: {
  section: SettingsSection; onChange: (section: SettingsSection) => void;
}) {
  const { t } = useTranslation();
  const options = SETTINGS_SECTIONS.map(value => ({ value, label: t(`systemSettings.sections.${value}`) }));
  return <>
    <nav className="system-settings-navigation" aria-label={t('systemSettings.categories')}>
      {options.map(option => <button key={option.value} type="button"
        aria-current={section === option.value ? 'page' : undefined}
        onClick={() => onChange(option.value)}>
        {icons[option.value]}<span>{option.label}</span>
      </button>)}
    </nav>
    <div className="system-settings-mobile-navigation">
      <Select aria-label={t('systemSettings.categories')} value={section} options={options} onChange={onChange} />
    </div>
  </>;
}
