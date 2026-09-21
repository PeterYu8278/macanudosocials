// 测试数据生成页面
import React, { useState } from 'react'
import { Card, Button, Space, Typography, Progress, Alert, Divider, Row, Col, Statistic, App, InputNumber } from 'antd'
import { PlayCircleOutlined, CheckCircleOutlined, LoadingOutlined, WarningOutlined } from '@ant-design/icons'
import { useTranslation } from 'react-i18next'
import { generateBrands } from './generators/brands'
import { generateUsers } from './generators/users'
import { generateCigars } from './generators/cigars'
import { generateInboundOrders } from './generators/inboundOrders'
import { generateEvents } from './generators/events'
import { generateMembershipFeeRecords } from './generators/membershipFeeRecords'
import { generateReloadRecords } from './generators/reloadRecords'
import { generateVisitSessions } from './generators/visitSessions'
import { generateRedemptions } from './generators/redemptions'
import { generateOrders } from './generators/orders'
import { generateOutboundOrders } from './generators/outboundOrders'
import { generateTransactions } from './generators/transactions'
import { generatePointsRecords } from './generators/pointsRecords'

const { Title, Text } = Typography

interface GenerationStage {
  id: string
  name: string
  description: string
  count: number
  status: 'pending' | 'running' | 'completed' | 'error'
  progress: number
  error?: string
}

const TestDataGenerator: React.FC = () => {
  const { t } = useTranslation()
  const { message } = App.useApp()
  const [stages, setStages] = useState<GenerationStage[]>(() => [
    { id: '1.1', name: t('testData.stage1_1Name'), description: t('testData.stage1_1Desc'), count: 300, status: 'pending', progress: 0 },
    { id: '1.2', name: t('testData.stage1_2Name'), description: t('testData.stage1_2Desc'), count: 10000, status: 'pending', progress: 0 },
    { id: '2.1', name: t('testData.stage2_1Name'), description: t('testData.stage2_1Desc'), count: 3000, status: 'pending', progress: 0 },
    { id: '3.1', name: t('testData.stage3_1Name'), description: t('testData.stage3_1Desc'), count: 5000, status: 'pending', progress: 0 },
    { id: '4.1', name: t('testData.stage4_1Name'), description: t('testData.stage4_1Desc'), count: 2000, status: 'pending', progress: 0 },
    { id: '5.1', name: t('testData.stage5_1Name'), description: t('testData.stage5_1Desc'), count: 10000, status: 'pending', progress: 0 },
    { id: '5.2', name: t('testData.stage5_2Name'), description: t('testData.stage5_2Desc'), count: 20000, status: 'pending', progress: 0 },
    { id: '6.1', name: t('testData.stage6_1Name'), description: t('testData.stage6_1Desc'), count: 200000, status: 'pending', progress: 0 },
    { id: '6.2', name: t('testData.stage6_2Name'), description: t('testData.stage6_2Desc'), count: 400000, status: 'pending', progress: 0 },
    { id: '7.1', name: t('testData.stage7_1Name'), description: t('testData.stage7_1Desc'), count: 30000, status: 'pending', progress: 0 },
    { id: '7.2', name: t('testData.stage7_2Name'), description: t('testData.stage7_2Desc'), count: 200000, status: 'pending', progress: 0 },
    { id: '8.1', name: t('testData.stage8_1Name'), description: t('testData.stage8_1Desc'), count: 200000, status: 'pending', progress: 0 },
    { id: '9.1', name: t('testData.stage9_1Name'), description: t('testData.stage9_1Desc'), count: 100000, status: 'pending', progress: 0 },
    { id: '10.1', name: t('testData.stage10_1Name'), description: t('testData.stage10_1Desc'), count: 0, status: 'pending', progress: 0 },
  ])

  const [totalProgress, setTotalProgress] = useState(0)
  const [isRunning, setIsRunning] = useState(false)

  const updateStage = (id: string, updates: Partial<GenerationStage>) => {
    setStages(prev => prev.map(stage => 
      stage.id === id ? { ...stage, ...updates } : stage
    ))
  }

  const handleGenerate = async (stageId: string) => {
    const stage = stages.find(s => s.id === stageId)
    if (!stage || stage.status === 'running') return

    updateStage(stageId, { status: 'running', progress: 0, error: undefined })
    setIsRunning(true)

    try {
      let result: { success: boolean; count?: number; error?: string; progress?: (progress: number) => void } | undefined

      switch (stageId) {
        case '1.1':
          result = await generateBrands(stage.count, (progress) => {
            updateStage(stageId, { progress })
          })
          break
        case '1.2':
          result = await generateUsers(stage.count, (progress) => {
            updateStage(stageId, { progress })
          })
          break
        case '2.1':
          result = await generateCigars(stage.count, (progress) => {
            updateStage(stageId, { progress })
          })
          break
        case '3.1':
          result = await generateInboundOrders(stage.count, 1000000, (progress) => {
            updateStage(stageId, { progress })
          })
          break
        case '4.1':
          result = await generateEvents(stage.count, (progress) => {
            updateStage(stageId, { progress })
          })
          break
        case '5.1':
          result = await generateMembershipFeeRecords(stage.count, (progress) => {
            updateStage(stageId, { progress })
          })
          break
        case '5.2':
          result = await generateReloadRecords(stage.count, (progress) => {
            updateStage(stageId, { progress })
          })
          break
        case '6.1':
          result = await generateVisitSessions(stage.count, (progress) => {
            updateStage(stageId, { progress })
          })
          break
        case '6.2':
          result = await generateRedemptions(stage.count, (progress) => {
            updateStage(stageId, { progress })
          })
          break
        case '7.1':
          result = await generateOrders('event', stage.count, (progress) => {
            updateStage(stageId, { progress })
          })
          break
        case '7.2':
          result = await generateOrders('redemption', stage.count, (progress) => {
            updateStage(stageId, { progress })
          })
          break
        case '8.1':
          result = await generateOutboundOrders(stage.count, (progress) => {
            updateStage(stageId, { progress })
          })
          break
        case '9.1':
          result = await generateTransactions(stage.count, (progress) => {
            updateStage(stageId, { progress })
          })
          break
        case '10.1':
          result = await generatePointsRecords((progress) => {
            updateStage(stageId, { progress })
          })
          break
        default:
          throw new Error(`Unknown stage: ${stageId}`)
      }

      if (result?.success) {
        updateStage(stageId, {
          status: 'completed',
          progress: 100,
          count: result.count || stage.count
        })
        message.success(t('testData.generateSuccess', { name: stage.name }))
      } else {
        throw new Error(result?.error || t('testData.generateFailed'))
      }
    } catch (error: any) {
      updateStage(stageId, {
        status: 'error',
        error: error.message || t('testData.generateFailed')
      })
      message.error(t('testData.stageGenerateFailed', { name: stage.name, error: error.message }))
    } finally {
      setIsRunning(false)
    }
  }

  const completedCount = stages.filter(s => s.status === 'completed').length
  const totalCount = stages.length
  const totalProgressValue = totalCount > 0 ? (completedCount / totalCount) * 100 : 0

  return (
    <div style={{ padding: '24px', minHeight: '100vh', background: 'transparent' }}>
      <Card
        style={{
          background: 'rgba(26, 26, 26, 0.8)',
          border: '1px solid rgba(255, 215, 0, 0.3)',
          borderRadius: '8px'
        }}
      >
        <Title level={2} style={{ color: '#ffd700', marginBottom: '24px' }}>
          {t('testData.title')}
        </Title>

        <Alert
          message={t('common.warning')}
          description={t('testData.warningDesc')}
          type="warning"
          showIcon
          style={{ marginBottom: '24px' }}
        />

        <Row gutter={16} style={{ marginBottom: '24px' }}>
          <Col span={12}>
            <Statistic
              title={t('testData.totalProgress')}
              value={totalProgressValue}
              precision={1}
              suffix="%"
              valueStyle={{ color: '#ffd700' }}
            />
          </Col>
          <Col span={12}>
            <Statistic
              title={t('testData.completedStages')}
              value={completedCount}
              suffix={`/ ${totalCount}`}
              valueStyle={{ color: '#ffd700' }}
            />
          </Col>
        </Row>

        <Progress 
          percent={totalProgressValue} 
          strokeColor="#ffd700"
          style={{ marginBottom: '24px' }}
        />

        <Divider style={{ borderColor: 'rgba(255, 215, 0, 0.3)' }} />

        <Space direction="vertical" size="large" style={{ width: '100%' }}>
          {stages.map((stage) => (
            <Card
              key={stage.id}
              style={{
                background: 'rgba(15, 15, 15, 0.5)',
                border: '1px solid rgba(255, 215, 0, 0.2)',
                borderRadius: '8px'
              }}
            >
              <Row gutter={16} align="middle">
                <Col span={2}>
                  <Text strong style={{ color: '#ffd700' }}>
                    {stage.id}
                  </Text>
                </Col>
                <Col span={8}>
                  <Text strong style={{ color: '#f8f8f8', fontSize: '16px' }}>
                    {stage.name}
                  </Text>
                  <br />
                  <Text type="secondary" style={{ fontSize: '12px' }}>
                    {stage.description}
                  </Text>
                </Col>
                <Col span={4}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                    <Text style={{ color: '#c0c0c0', fontSize: '12px' }}>{t('testData.quantity')}</Text>
                    <InputNumber 
                      min={0} 
                      value={stage.count} 
                      onChange={(val) => updateStage(stage.id, { count: val || 0 })}
                      disabled={stage.status === 'running' || isRunning || stage.id === '10.1'}
                      style={{ width: '80px', background: 'rgba(255,255,255,0.1)', color: '#fff', borderColor: 'rgba(255,215,0,0.3)' }}
                    />
                  </div>
                </Col>
                <Col span={4}>
                  <Progress
                    percent={stage.progress}
                    size="small"
                    status={
                      stage.status === 'error' ? 'exception' :
                      stage.status === 'completed' ? 'success' : 'active'
                    }
                    strokeColor="#ffd700"
                  />
                </Col>
                <Col span={6} style={{ textAlign: 'right' }}>
                  <Space>
                    {stage.status === 'completed' && (
                      <CheckCircleOutlined style={{ color: '#52c41a', fontSize: '20px' }} />
                    )}
                    {stage.status === 'running' && (
                      <LoadingOutlined style={{ color: '#ffd700', fontSize: '20px' }} />
                    )}
                    {stage.status === 'error' && (
                      <WarningOutlined style={{ color: '#ff4d4f', fontSize: '20px' }} />
                    )}
                    <Button
                      type="primary"
                      icon={<PlayCircleOutlined />}
                      onClick={() => handleGenerate(stage.id)}
                      disabled={stage.status === 'running' || isRunning}
                      style={{
                        background: stage.status === 'completed' 
                          ? 'rgba(82, 196, 26, 0.2)' 
                          : 'linear-gradient(135deg, #ffd700 0%, #c48d3a 100%)',
                        border: 'none',
                        color: '#000'
                      }}
                    >
                      {stage.status === 'completed' ? t('testData.statusCompleted') :
                       stage.status === 'running' ? t('testData.statusRunning') :
                       stage.status === 'error' ? t('testData.statusRetry') : t('testData.statusGenerate')}
                    </Button>
                  </Space>
                </Col>
              </Row>
              {stage.error && (
                <Alert
                  message={stage.error}
                  type="error"
                  showIcon
                  style={{ marginTop: '12px' }}
                />
              )}
            </Card>
          ))}
        </Space>
      </Card>
    </div>
  )
}

export default TestDataGenerator

