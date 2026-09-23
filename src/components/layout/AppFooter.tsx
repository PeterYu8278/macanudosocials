// 应用底部组件 - Cigar Club黑金主题
import React, { useState, useEffect } from 'react'
import { Layout, Typography, Space, Divider } from 'antd'
import { HeartOutlined, GithubOutlined, MailOutlined } from '@ant-design/icons'
import { useTranslation } from 'react-i18next'
import { getAppConfig } from '../../services/firebase/appConfig'
import type { AppConfig } from '../../types'

const { Footer } = Layout
const { Text, Link } = Typography

const AppFooter: React.FC = () => {
  const { t } = useTranslation()
  const [appConfig, setAppConfig] = useState<AppConfig | null>(null)

  // 加载应用配置
  useEffect(() => {
    const loadAppConfig = async () => {
      const config = await getAppConfig()
      if (config) {
        setAppConfig(config)
      }
    }
    loadAppConfig()
  }, [])

  // 如果配置为隐藏 Footer，则不渲染
  if (appConfig?.hideFooter) {
    return null
  }

  return (
    <Footer style={{ 
      textAlign: 'center', 
      background: 'linear-gradient(135deg, #0f0f0f 0%, #1a1a1a 100%)',
      borderTop: '2px solid #ffd700',
      boxShadow: '0 -2px 8px rgba(0, 0, 0, 0.3)',
      position: 'relative',
      marginTop: 'auto'
    }}>
      {/* 背景装饰 */}
      <div style={{
        position: 'absolute',
        top: 0,
        left: 0,
        right: 0,
        bottom: 0,
        background: 'linear-gradient(90deg, rgba(255, 215, 0, 0.03) 0%, transparent 50%, rgba(255, 215, 0, 0.03) 100%)',
        pointerEvents: 'none'
      }} />
      
      <div style={{ position: 'relative', zIndex: 1 }}>
        <Space direction="vertical" size="large">
          {/* 品牌信息 */}
          <div>
            <Text style={{
              background: 'linear-gradient(135deg, #ffd700 0%, #ffed4e 100%)',
              WebkitBackgroundClip: 'text',
              WebkitTextFillColor: 'transparent',
              backgroundClip: 'text',
              fontSize: '18px',
              fontWeight: 700,
              letterSpacing: '2px'
            }}>
              {appConfig?.appName || 'MS'}
            </Text>
            <div style={{ marginTop: '8px' }}>
              <Text style={{ color: '#c0c0c0', fontSize: '14px' }}>
                {t('footer.tagline')}
              </Text>
            </div>
          </div>
          
          {/* 分割线 */}
          <Divider style={{ 
            background: 'linear-gradient(90deg, transparent 0%, #333333 50%, transparent 100%)',
            border: 'none',
            height: '1px',
            margin: '0px'
          }} />
          
          {/* 链接区域 */}
          <Space size="large" wrap>
            <Link 
              href="#" 
              target="_blank"
              style={{ 
                color: '#c0c0c0',
                fontSize: '14px',
                transition: 'color 0.3s ease'
              }}
              className="footer-link"
            >
              <GithubOutlined style={{ marginRight: '4px' }} />
              {t('footer.privacyPolicy')}
            </Link>
            <Link 
              href="#" 
              target="_blank"
              style={{ 
                color: '#c0c0c0',
                fontSize: '14px',
                transition: 'color 0.3s ease'
              }}
              className="footer-link"
            >
              {t('footer.termsOfService')}
            </Link>
            <Link 
              href="#" 
              target="_blank"
              style={{ 
                color: '#c0c0c0',
                fontSize: '14px',
                transition: 'color 0.3s ease'
              }}
              className="footer-link"
            >
              <MailOutlined style={{ marginRight: '4px' }} />
              {t('footer.contactUs')}
            </Link>
          </Space>
          
          {/* 版权信息 */}
          <div>
            <Text style={{ 
              color: '#999999', 
              fontSize: '12px',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              gap: '4px'
            }}>
              {t('footer.copyright')} 
              <HeartOutlined style={{ color: '#ffd700' }} /> 
              {t('footer.byJepVentures')}
            </Text>
          </div>
        </Space>
      </div>
      
    </Footer>
  )
}

export default AppFooter
