// Cloudinary 测试组件
import React, { useState } from 'react'
import { Button, Card, App, Space, Typography } from 'antd'
import { useTranslation } from 'react-i18next'
import { UploadOutlined, CheckCircleOutlined } from '@ant-design/icons'
import { useCloudinary } from '../../hooks/useCloudinary'
import ImageUpload from './ImageUpload'

const { Title, Text } = Typography

const CloudinaryTest: React.FC = () => {
  const { upload, uploading, error } = useCloudinary()
  const { t } = useTranslation()
  const { message } = App.useApp()
  const [testImageUrl, setTestImageUrl] = useState<string | null>(null)
  const [testResult, setTestResult] = useState<string | null>(null)

  const testConnection = async () => {
    try {
      // 创建一个简单的测试图片文件
      const canvas = document.createElement('canvas')
      canvas.width = 100
      canvas.height = 100
      const ctx = canvas.getContext('2d')
      if (ctx) {
        ctx.fillStyle = '#FFD700'
        ctx.fillRect(0, 0, 100, 100)
        ctx.fillStyle = '#000'
        ctx.font = '20px Arial'
        ctx.textAlign = 'center'
        ctx.fillText('TEST', 50, 55)
      }
      
      canvas.toBlob(async (blob) => {
        if (blob) {
          const testFile = new File([blob], 'test.png', { type: 'image/png' })
          
          const result = await upload(testFile, {
            folder: 'test'
          })
          
          setTestResult(`${t('cloudinary.testSuccess')}`)
          setTestImageUrl(result.secure_url)
          message.success(t('cloudinary.testSuccess'))
        }
      }, 'image/png')
      } catch (err) {
        setTestResult(`${t('cloudinary.testFail')}`)
        message.error(t('cloudinary.testFail'))
      }
  }

  return (
    <Card title={t('cloudinary.testTitle')} style={{ maxWidth: 600, margin: '20px auto' }}>
      <Space direction="vertical" style={{ width: '100%' }}>
        <div>
          <Title level={4}>{t('cloudinary.connectionTest')}</Title>
          <Button 
            type="primary" 
            icon={<CheckCircleOutlined />}
            onClick={testConnection}
            loading={uploading}
            style={{ marginBottom: 16 }}
          >
            {t('cloudinary.testButton')}
          </Button>
          
          {testResult && (
            <div style={{ 
              padding: '12px', 
              background: testResult.includes(t('cloudinary.testSuccess')) ? '#f6ffed' : '#fff2f0',
              border: `1px solid ${testResult.includes(t('cloudinary.testSuccess')) ? '#b7eb8f' : '#ffccc7'}`,
              borderRadius: '6px',
              marginBottom: 16
            }}>
              <Text style={{ color: testResult.includes(t('cloudinary.testSuccess')) ? '#52c41a' : '#ff4d4f' }}>
                {testResult}
              </Text>
            </div>
          )}
          
          {testImageUrl && (
            <div style={{ marginTop: 16 }}>
              <Text strong>{t('cloudinary.testImageUrl')}</Text>
              <div style={{ 
                wordBreak: 'break-all', 
                fontSize: '12px', 
                color: '#666',
                marginTop: 4
              }}>
                {testImageUrl}
              </div>
              <img 
                src={testImageUrl} 
                alt={t('cloudinary.testImageAlt') as string} 
                style={{ 
                  width: 100, 
                  height: 100, 
                  border: '1px solid #d9d9d9',
                  borderRadius: 4,
                  marginTop: 8
                }} 
              />
            </div>
          )}
        </div>

        <div>
          <Title level={4}>{t('cloudinary.imageUploadTest')}</Title>
            <ImageUpload
              value={testImageUrl || undefined}
              onChange={(url) => setTestImageUrl(url)}
            folder="test"
            maxSize={2 * 1024 * 1024} // 2MB
            width={150}
            height={150}
            showPreview={true}
          />
        </div>

        {error && (
          <div style={{ 
            padding: '12px', 
            background: '#fff2f0',
            border: '1px solid #ffccc7',
            borderRadius: '6px'
          }}>
            <Text style={{ color: '#ff4d4f' }}>
              错误: {error}
            </Text>
          </div>
        )}
      </Space>
    </Card>
  )
}

export default CloudinaryTest
