import { useState } from 'react';
import { Button } from 'antd';
import { ReloadOutlined } from '@ant-design/icons';
import { useTranslation } from 'react-i18next';
import { applySystemUpdate, useSystemUpdate } from '../../utils/pwa';
import PromptStrip, { type PromptItem } from './PromptStrip';

export default function SystemUpdateBanner({ prompts = [] }: { prompts?: PromptItem[] }) {
  const available = useSystemUpdate();
  const { t } = useTranslation();
  const [updating, setUpdating] = useState(false);
  const [failed, setFailed] = useState(false);

  const update = async () => {
    if (updating) return;
    setUpdating(true);
    setFailed(false);
    try {
      if (await applySystemUpdate()) window.location.reload();
      else setFailed(true);
    } catch { setFailed(true); }
    finally { setUpdating(false); }
  };

  const updatePrompt: PromptItem = {
    id: 'system-update', title: t(failed ? 'systemUpdate.failed' : 'systemUpdate.available'),
    description: t(failed ? 'systemUpdate.failed' : 'systemUpdate.description'),
    icon: <ReloadOutlined />, warning: failed,
    action: <Button size="small" type="primary" icon={<ReloadOutlined />} loading={updating} onClick={() => { void update(); }}>
        {t('systemUpdate.updateNow')}
      </Button>,
  };
  return <PromptStrip items={[...(available ? [updatePrompt] : []), ...prompts]} />;
}
