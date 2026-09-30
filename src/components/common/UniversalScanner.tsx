import React, { useState, useEffect } from 'react';
import { Modal, Tabs } from 'antd';
import { QrcodeOutlined, EyeOutlined } from '@ant-design/icons';
import { useTranslation } from 'react-i18next';
import { QRScannerView } from '../admin/QRScanner';
import { AICigarScanner } from '../features/ai/AICigarScanner';
import { useAuthStore } from '../../store/modules/auth';
import { getModalThemeStyles } from '../../config/modalTheme';
import { getFeaturesVisibility } from '../../services/firebase/featureVisibility';

interface UniversalScannerProps {
    visible: boolean;
    onClose: () => void;
    defaultTab?: 'qr' | 'ai';
}

export const UniversalScanner: React.FC<UniversalScannerProps> = ({
    visible,
    onClose,
    defaultTab = 'ai' // Default to AI for members
}) => {
    const { t } = useTranslation();
    const { isAdmin, isDeveloper } = useAuthStore();
    const [activeTab, setActiveTab] = useState<string>(defaultTab);
    const [aiCigarVisible, setAiCigarVisible] = useState<boolean>(true);
    
    // 只有管理员和开发者可以访问扫码功能
    const canAccessQR = isAdmin || isDeveloper;

    // 加载 AI识茄 功能可见性
    useEffect(() => {
        const loadAICigarVisibility = async () => {
            if (isDeveloper) {
                setAiCigarVisible(true);
                return;
            }
            try {
                const visibility = await getFeaturesVisibility();
                setAiCigarVisible(visibility['ai-cigar'] ?? true);
            } catch (error) {
                console.error('[UniversalScanner] 加载功能可见性失败:', error);
                setAiCigarVisible(true); // 默认可见
            }
        };
        loadAICigarVisibility();
    }, [isDeveloper]);

    // Reset tab when opening
    useEffect(() => {
        if (visible) {
            // 根据权限和功能可见性确定初始标签
            let initialTab = defaultTab;
            if (defaultTab === 'qr' && !canAccessQR) {
                initialTab = 'ai';
            }
            if (defaultTab === 'ai' && !aiCigarVisible) {
                initialTab = canAccessQR ? 'qr' : 'ai'; // 如果 AI 不可见，尝试切换到 QR
            }
            setActiveTab(initialTab);
        }
    }, [visible, defaultTab, canAccessQR, aiCigarVisible]);

    // 如果用户切换到没有权限的标签，自动切换回 ai
    useEffect(() => {
        if (activeTab === 'qr' && !canAccessQR) {
            setActiveTab('ai');
        }
        // 如果 AI识茄 功能被隐藏，且当前在 ai 标签，切换到 qr（如果有权限）或其他
        if (activeTab === 'ai' && !aiCigarVisible) {
            if (canAccessQR) {
                setActiveTab('qr');
            } else {
                // 如果两个功能都不可用，关闭弹窗
                onClose();
            }
        }
    }, [activeTab, canAccessQR, aiCigarVisible, onClose]);

    const allItems = [
        {
            key: 'ai',
            label: (
                <span style={{ display: 'inline-flex', alignItems: 'center', gap: '4px' }}>
                    <EyeOutlined style={{ marginRight: 4 }} />
                    {t('scanner.aiIdentify')}
                </span>
            ),
            children: (
                <div style={{ height: 'auto', overflowY: 'auto' }}>
                    {/* Only mount camera when tab is active to save resources */}
                    {activeTab === 'ai' && visible && <AICigarScanner />}
                </div>
            ),
        },
        {
            key: 'qr',
            label: (
                <span style={{ display: 'inline-flex', alignItems: 'center', gap: '4px' }}>
                    <QrcodeOutlined style={{ marginRight: 4 }} />
                    {t('scanner.smartScan')}
                </span>
            ),
            children: (
                <div style={{ height: 'auto', display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>
                    {canAccessQR ? (
                        <QRScannerView
                            active={activeTab === 'qr' && visible}
                            onSuccess={onClose}
                        />
                    ) : (
                        <div style={{ padding: 20, textAlign: 'center', color: '#aaa', display: 'flex', alignItems: 'center', justifyContent: 'center', height: '100%', flexDirection: 'column' }}>
                            <QrcodeOutlined style={{ fontSize: 48, marginBottom: 16 }} />
                            <p>{t('scanner.memberScanComingSoon')}</p>
                        </div>
                    )}
                </div>
            ),
        },
    ];

    // 根据权限和功能可见性过滤标签页
    const items = allItems.filter(item => {
        if (item.key === 'qr') {
            return canAccessQR;
        }
        if (item.key === 'ai') {
            return aiCigarVisible;
        }
        return true;
    });

    const isMobile = typeof window !== 'undefined' ? window.matchMedia('(max-width: 768px)').matches : false;
    const themeStyles = getModalThemeStyles(isMobile);

    return (
        <Modal
            className="universal-scanner-modal"
            title={(
                <Tabs
                    activeKey={activeTab}
                    onChange={setActiveTab}
                    items={[...items].reverse().map(({ key, label }) => ({ key, label }))}
                    style={{ paddingRight: 28 }}
                    className="universal-scanner-tabs"
                />
            )}
            open={visible}
            onCancel={onClose}
            footer={null}
            width={isMobile ? 'calc(100% - 24px)' : 600}
            destroyOnHidden
            styles={{
                ...themeStyles,
                content: { ...themeStyles?.content, padding: isMobile ? 16 : 20 },
                header: { ...themeStyles?.header, borderBottom: 'none', paddingBottom: 0, marginBottom: 12 },
                body: { ...themeStyles?.body, maxHeight: 'calc(85dvh - 80px)' },
            }}
            centered
        >
            {items.find(item => item.key === activeTab)?.children}
        </Modal>
    );
};
