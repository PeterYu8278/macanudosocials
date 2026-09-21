// 管理后台仪表板（自定义样式版本）
import React, { useEffect, useMemo, useState } from 'react'
import { useFirestoreQuery } from '../../../hooks/useFirestoreQuery'
import { useDetailDrawer } from '../../../hooks/useDetailDrawer'
import { Typography, Button, App, Spin, Modal, Form, Select, Input, Alert, Drawer } from 'antd'
import { ReloadOutlined, PlusOutlined, CloseOutlined } from '@ant-design/icons'
import { useNavigate } from 'react-router-dom'
import dayjs from 'dayjs'
import {
  getUsers,
  getAllOrders,
  getEvents,
  getAllTransactions,
  getCigars
} from '../../../services/firebase/firestore'
import { db } from '../../../config/firebase'
import { GLOBAL_COLLECTIONS } from '../../../config/globalCollections'
import { collection, addDoc } from 'firebase/firestore'
import type { User, Order, Event, Transaction, Cigar, AppConfig, SubscriptionRequest, ReloadRecord, MembershipFeeRecord } from '../../../types'
import { useTranslation } from 'react-i18next'
import { isFeatureVisible } from '../../../services/firebase/featureVisibility'
import { useAuthStore } from '../../../store/modules/auth'
import { getAppConfig } from '../../../services/firebase/appConfig'
import { getAllVisitSessions } from '../../../services/firebase/visitSessions'
import { getAllRoomBookings } from '../../../services/firebase/rooms'
import { getAllReloadRecords } from '../../../services/firebase/reload'
import { getAllMembershipFeeRecords } from '../../../services/firebase/membershipFee'
import OrderDetails from '../Orders/OrderDetails'

const { Title } = Typography
import { createBill } from '../../../services/billplz'

const PlanSelector: React.FC<{ value?: string; onChange?: (val: string) => void; plans: any[]; currentPlanId?: string; memberCount?: number }> = ({ value, onChange, plans, currentPlanId, memberCount = 0 }) => {
  const { t } = useTranslation()
  const isMobile = window.innerWidth < 768;

  if (!plans || plans.length === 0) {
    return (
      <div style={{ padding: 20, textAlign: 'center', color: '#666', border: '1px dashed #444', borderRadius: 12 }}>
        {t("dashboard.noPlansAvailable")}
      </div>
    );
  }

  return (
    <div style={{
      display: isMobile ? 'flex' : 'grid',
      flexDirection: isMobile ? 'row' : 'unset',
      overflowX: isMobile ? 'auto' : 'visible',
      gridTemplateColumns: isMobile ? 'unset' : 'repeat(auto-fit, minmax(200px, 1fr))',
      gap: isMobile ? 8 : 12,
      padding: isMobile ? '0 0 4px' : 0,
      width: '100%',
      maxWidth: '100%'
    }}>
      {plans.map((p: any) => {
        const isSelected = value === p.id;
        const isCurrent = currentPlanId === p.id;
        const isDisabled = p.maxMembers && p.maxMembers > 0 && memberCount > p.maxMembers;
        return (
          <div
            key={p.id}
            onClick={() => !isDisabled && onChange?.(p.id)}
            style={{
              flex: isMobile ? '1 1 0' : 'unset',
              minWidth: isMobile ? '100px' : 'unset',
              padding: isMobile ? '12px 8px' : '16px',
              borderRadius: 12,
              cursor: isDisabled ? 'not-allowed' : 'pointer',
              background: isDisabled ? 'rgba(255,255,255,0.01)' : (isSelected ? 'rgba(253,224,141,0.08)' : 'rgba(255,255,255,0.03)'),
              border: isDisabled ? '1px solid rgba(255,0,0,0.2)' : (isSelected ? '2px solid #FDE08D' : (isCurrent ? '2px solid rgba(82,196,26,0.6)' : '1px solid rgba(255,255,255,0.1)')),
              opacity: isDisabled ? 0.45 : 1,
              transition: 'all 0.2s cubic-bezier(0.4, 0, 0.2, 1)',
              display: 'flex',
              flexDirection: 'column',
              justifyContent: 'space-between',
              boxShadow: isSelected ? '0 0 15px rgba(253,224,141,0.2)' : 'none',
              minHeight: isMobile ? 120 : 140,
              position: 'relative' as const
            }}
            onMouseEnter={(e) => {
              if (!isSelected && !isDisabled) {
                e.currentTarget.style.borderColor = 'rgba(253,224,141,0.5)';
                e.currentTarget.style.background = 'rgba(255,255,255,0.05)';
              }
            }}
            onMouseLeave={(e) => {
              if (!isSelected && !isDisabled) {
                e.currentTarget.style.borderColor = isCurrent ? 'rgba(82,196,26,0.6)' : 'rgba(255,255,255,0.1)';
                e.currentTarget.style.background = 'rgba(255,255,255,0.03)';
              }
            }}
          >
            {isCurrent && (
              <div style={{
                position: 'absolute',
                top: -1,
                right: -1,
                background: '#52c41a',
                color: '#fff',
                fontSize: 9,
                fontWeight: 700,
                padding: '2px 8px',
                borderRadius: '0 10px 0 8px',
                letterSpacing: 0.5
              }}>{t("dashboard.planCurrentBadge")}</div>
            )}
            {isDisabled && (
              <div style={{
                position: 'absolute',
                top: -1,
                left: -1,
                background: '#ff4d4f',
                color: '#fff',
                fontSize: 9,
                fontWeight: 700,
                padding: '2px 8px',
                borderRadius: '10px 0 8px 0',
                letterSpacing: 0.5
              }}>{t("dashboard.planInsufficientBadge")}</div>
            )}
            <div>
              <div style={{ color: isSelected ? '#FDE08D' : '#fff', fontWeight: 800, fontSize: 16, marginBottom: 4 }}>
                {p.name}
              </div>
              <div style={{ color: 'rgba(255,255,255,0.6)', fontSize: 12 }}>
                <span style={{ color: '#aaa' }}>{p.maxMembers || '∞'}</span> {t("dashboard.planMembersLabel")}<br />
                <span style={{ color: '#aaa' }}>{p.validPeriodMonth}</span> {t("dashboard.planMonthsLabel")}
              </div>
            </div>
            <div style={{ textAlign: 'right', marginTop: 12 }}>
              <div style={{
                fontSize: 20,
                fontWeight: 800,
                backgroundImage: 'linear-gradient(to right,#FDE08D,#C48D3A)',
                WebkitBackgroundClip: 'text',
                color: 'transparent'
              }}>
                RM {p.fee}
              </div>
              <div style={{ color: 'rgba(255,255,255,0.3)', fontSize: 9, letterSpacing: 1 }}>{t("dashboard.planAnnualLabel")}</div>
            </div>
          </div>
        );
      })}
    </div>
  );
};

const TrendChart: React.FC<{
  data: Array<{ label: string; value: number }>
  isMobile: boolean
  valueFormatter?: (value: number) => string
  valueUnit?: string
  chartId?: string
}> = ({ data, isMobile, valueFormatter, valueUnit, chartId = 'trend' }) => {
  const { t } = useTranslation()
  const [hoveredPoint, setHoveredPoint] = useState<any>(null);
  if (data.length === 0) return <div style={{ color: 'rgba(255,255,255,0.4)', textAlign: 'center', padding: '40px 0' }}>{t("common.noData")}</div>;

  const maxValue = Math.max(...data.map(d => d.value), 5); // Default min max-value to 5 to avoid flat chart
  
  // Chart dimensions
  const width = 500;
  const height = 220;
  const paddingLeft = 35;
  const paddingRight = 15;
  const paddingTop = 20;
  const paddingBottom = 30;
  
  const chartWidth = width - paddingLeft - paddingRight;
  const chartHeight = height - paddingTop - paddingBottom;
  
  // Coordinates calculation
  const points = data.map((d, index) => {
    const x = paddingLeft + (index / (data.length - 1 || 1)) * chartWidth;
    const y = paddingTop + chartHeight - (d.value / maxValue) * chartHeight;
    return { x, y, label: d.label, value: d.value };
  });

  // Construct SVG path string
  let pathD = '';
  let areaD = '';
  if (points.length > 0) {
    pathD = `M ${points[0].x} ${points[0].y}`;
    areaD = `M ${points[0].x} ${paddingTop + chartHeight} L ${points[0].x} ${points[0].y}`;
    for (let i = 1; i < points.length; i++) {
      // Use smooth Bezier control points or standard line
      const prev = points[i - 1];
      const curr = points[i];
      const cpX1 = prev.x + (curr.x - prev.x) / 3;
      const cpY1 = prev.y;
      const cpX2 = prev.x + 2 * (curr.x - prev.x) / 3;
      const cpY2 = curr.y;
      pathD += ` C ${cpX1} ${cpY1}, ${cpX2} ${cpY2}, ${curr.x} ${curr.y}`;
      areaD += ` C ${cpX1} ${cpY1}, ${cpX2} ${cpY2}, ${curr.x} ${curr.y}`;
    }
    areaD += ` L ${points[points.length - 1].x} ${paddingTop + chartHeight} Z`;
  }

  // Y-axis grid lines (4 lines)
  const gridLines = [];
  for (let i = 0; i <= 4; i++) {
    const ratio = i / 4;
    const y = paddingTop + chartHeight - ratio * chartHeight;
    const val = Math.round(ratio * maxValue);
    gridLines.push({ y, val });
  }

  return (
    <div style={{ position: 'relative', background: 'rgba(255,255,255,0.02)', padding: '16px', borderRadius: 12, border: '1px solid rgba(244,175,37,0.15)', backdropFilter: 'blur(10px)' }}>
      <svg viewBox={`0 0 ${width} ${height}`} width="100%" height="100%" style={{ overflow: 'visible' }}>
        <defs>
          {/* Background area gradient */}
          <linearGradient id={`${chartId}-area-gradient`} x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor="#f4af25" stopOpacity="0.3" />
            <stop offset="100%" stopColor="#f4af25" stopOpacity="0.0" />
          </linearGradient>
          {/* Smooth line gradient */}
          <linearGradient id={`${chartId}-line-gradient`} x1="0" y1="0" x2="1" y2="0">
            <stop offset="0%" stopColor="#FDE08D" />
            <stop offset="100%" stopColor="#C48D3A" />
          </linearGradient>
          {/* Shadow filter for glow effect */}
          <filter id={`${chartId}-glow`} x="-20%" y="-20%" width="140%" height="140%">
            <feDropShadow dx="0" dy="4" stdDeviation="6" floodColor="#f4af25" floodOpacity="0.3" />
          </filter>
        </defs>
        
        {/* Y Axis Grid Lines & Labels */}
        {gridLines.map((gl, index) => (
          <g key={index}>
            <line 
              x1={paddingLeft} 
              y1={gl.y} 
              x2={width - paddingRight} 
              y2={gl.y} 
              stroke="rgba(255, 255, 255, 0.08)" 
              strokeDasharray="4 4" 
            />
            <text 
              x={paddingLeft - 8} 
              y={gl.y + 4} 
              fill="rgba(255, 255, 255, 0.45)" 
              fontSize="10px" 
              textAnchor="end"
              fontFamily="monospace"
            >
              {gl.val}
            </text>
          </g>
        ))}

        {/* X Axis Labels */}
        {points.map((pt, idx) => {
          // Render fewer labels on mobile to avoid overlap
          const showLabel = isMobile 
            ? idx % 3 === 0 || idx === points.length - 1
            : idx % 2 === 0 || idx === points.length - 1;
            
          if (!showLabel) return null;
          return (
            <text
              key={idx}
              x={pt.x}
              y={paddingTop + chartHeight + 16}
              fill="rgba(255, 255, 255, 0.45)"
              fontSize="9px"
              textAnchor="middle"
            >
              {pt.label}
            </text>
          );
        })}

        {/* Shaded Area */}
        {areaD && (
          <path d={areaD} fill={`url(#${chartId}-area-gradient)`} />
        )}

        {/* Curve Path */}
        {pathD && (
          <path 
            d={pathD} 
            fill="none" 
            stroke={`url(#${chartId}-line-gradient)`}
            strokeWidth="3" 
            strokeLinecap="round"
            filter={`url(#${chartId}-glow)`}
          />
        )}

        {/* Data points & Interactive Hover Areas */}
        {points.map((pt, idx) => (
          <g key={idx}>
            {/* Invisible large hover target circle */}
            <circle
              cx={pt.x}
              cy={pt.y}
              r="14"
              fill="transparent"
              style={{ cursor: 'pointer' }}
              onMouseEnter={() => setHoveredPoint(pt)}
              onMouseLeave={() => setHoveredPoint(null)}
            />
            {/* Actual dot */}
            <circle
              cx={pt.x}
              cy={pt.y}
              r={hoveredPoint?.label === pt.label ? 6 : 4}
              fill={hoveredPoint?.label === pt.label ? "#FDE08D" : "#1a160d"}
              stroke="#f4af25"
              strokeWidth={hoveredPoint?.label === pt.label ? 3 : 2}
              style={{ transition: 'all 0.15s ease' }}
            />
          </g>
        ))}
      </svg>
      
      {/* Floating Tooltip HTML */}
      {hoveredPoint && (
        <div style={{
          position: 'absolute',
          left: `${Math.min(Math.max((hoveredPoint.x / width) * 100 - 10, 2), 78)}%`,
          top: `${(hoveredPoint.y / height) * 100 - 22}%`,
          transform: 'translate(-50%, -100%)',
          background: 'rgba(26, 22, 13, 0.95)',
          border: '1px solid rgba(244, 175, 37, 0.6)',
          padding: '6px 10px',
          borderRadius: '6px',
          fontSize: '11px',
          color: '#fff',
          pointerEvents: 'none',
          boxShadow: '0 4px 12px rgba(0,0,0,0.5)',
          zIndex: 10,
          textAlign: 'center',
          whiteSpace: 'nowrap'
        }}>
          <div style={{ color: 'rgba(255,255,255,0.5)', fontSize: '9px', marginBottom: 2 }}>{hoveredPoint.label}</div>
          <div style={{ fontWeight: 'bold' }}>
            {valueFormatter ? valueFormatter(hoveredPoint.value) : hoveredPoint.value}{' '}
            {valueUnit ?? t("dashboard.trendCountUnit")}
          </div>
        </div>
      )}
    </div>
  );
};

type GrowthTrendPoint = {
  label: string
  newUsers: number
  annualPasses: number
}

const GrowthTrendChart: React.FC<{ data: GrowthTrendPoint[]; isMobile: boolean }> = ({ data, isMobile }) => {
  const { t } = useTranslation()
  const [hoveredIndex, setHoveredIndex] = useState<number | null>(null)
  const width = 500
  const height = 220
  const paddingLeft = 35
  const paddingRight = 15
  const paddingTop = 20
  const paddingBottom = 30
  const chartWidth = width - paddingLeft - paddingRight
  const chartHeight = height - paddingTop - paddingBottom
  const maxValue = Math.max(...data.flatMap(point => [point.newUsers, point.annualPasses]), 5)

  const pointFor = (value: number, index: number) => ({
    x: paddingLeft + (index / (data.length - 1 || 1)) * chartWidth,
    y: paddingTop + chartHeight - (value / maxValue) * chartHeight
  })
  const newUserPoints = data.map((point, index) => ({ ...pointFor(point.newUsers, index), value: point.newUsers }))
  const annualPassPoints = data.map((point, index) => ({ ...pointFor(point.annualPasses, index), value: point.annualPasses }))
  const pathFor = (points: Array<{ x: number; y: number }>) => {
    if (points.length === 0) return ''
    let path = `M ${points[0].x} ${points[0].y}`
    for (let index = 1; index < points.length; index++) {
      const previous = points[index - 1]
      const current = points[index]
      const firstControlX = previous.x + (current.x - previous.x) / 3
      const secondControlX = previous.x + (2 * (current.x - previous.x)) / 3
      path += ` C ${firstControlX} ${previous.y}, ${secondControlX} ${current.y}, ${current.x} ${current.y}`
    }
    return path
  }

  return (
    <div style={{ position: 'relative', padding: 16, border: '1px solid rgba(244,175,37,0.15)', borderRadius: 12, background: 'rgba(255,255,255,0.02)' }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 16, marginBottom: 8, flexWrap: 'wrap' }}>
        <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6, color: 'rgba(255,255,255,0.72)', fontSize: 12 }}>
          <span style={{ width: 18, height: 3, borderRadius: 2, background: '#38bdf8' }} />
          {t('dashboard.newUsers')}
        </span>
        <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6, color: 'rgba(255,255,255,0.72)', fontSize: 12 }}>
          <span style={{ width: 18, height: 3, borderRadius: 2, background: '#F4AF25' }} />
          {t('dashboard.annualPassActivated')}
        </span>
      </div>

      <svg viewBox={`0 0 ${width} ${height}`} width="100%" height="100%" style={{ overflow: 'visible' }}>
        {Array.from({ length: 5 }, (_, index) => {
          const ratio = index / 4
          const y = paddingTop + chartHeight - ratio * chartHeight
          return (
            <g key={index}>
              <line x1={paddingLeft} y1={y} x2={width - paddingRight} y2={y} stroke="rgba(255,255,255,0.08)" strokeDasharray="4 4" />
              <text x={paddingLeft - 8} y={y + 4} fill="rgba(255,255,255,0.45)" fontSize="10" textAnchor="end" fontFamily="monospace">
                {Math.round(ratio * maxValue)}
              </text>
            </g>
          )
        })}

        {data.map((point, index) => {
          const showLabel = isMobile
            ? index % Math.max(1, Math.ceil(data.length / 6)) === 0 || index === data.length - 1
            : index % 2 === 0 || index === data.length - 1
          if (!showLabel) return null
          return (
            <text key={point.label} x={newUserPoints[index].x} y={paddingTop + chartHeight + 16} fill="rgba(255,255,255,0.45)" fontSize="9" textAnchor="middle">
              {point.label}
            </text>
          )
        })}

        <path d={pathFor(newUserPoints)} fill="none" stroke="#38bdf8" strokeWidth="3" strokeLinecap="round" />
        <path d={pathFor(annualPassPoints)} fill="none" stroke="#F4AF25" strokeWidth="3" strokeLinecap="round" />

        {data.map((point, index) => {
          const x = newUserPoints[index].x
          const targetWidth = chartWidth / Math.max(data.length - 1, 1)
          return (
            <g key={`${point.label}-${index}`}>
              <rect
                x={x - targetWidth / 2}
                y={paddingTop}
                width={targetWidth}
                height={chartHeight}
                fill="transparent"
                style={{ cursor: 'pointer' }}
                onMouseEnter={() => setHoveredIndex(index)}
                onMouseLeave={() => setHoveredIndex(null)}
              />
              <circle cx={x} cy={newUserPoints[index].y} r={hoveredIndex === index ? 5 : 3.5} fill="#1a160d" stroke="#38bdf8" strokeWidth="2" />
              <circle cx={x} cy={annualPassPoints[index].y} r={hoveredIndex === index ? 5 : 3.5} fill="#1a160d" stroke="#F4AF25" strokeWidth="2" />
            </g>
          )
        })}
      </svg>

      {hoveredIndex !== null && (
        <div style={{ position: 'absolute', left: `${Math.min(Math.max((newUserPoints[hoveredIndex].x / width) * 100, 14), 86)}%`, top: 44, transform: 'translateX(-50%)', padding: '7px 10px', border: '1px solid rgba(244,175,37,0.5)', borderRadius: 6, background: 'rgba(26,22,13,0.96)', color: '#fff', fontSize: 11, pointerEvents: 'none', whiteSpace: 'nowrap', zIndex: 2 }}>
          <div style={{ color: 'rgba(255,255,255,0.5)', fontSize: 9, marginBottom: 3 }}>{data[hoveredIndex].label}</div>
          <div style={{ color: '#38bdf8' }}>{t('dashboard.newUsers')}: {data[hoveredIndex].newUsers}</div>
          <div style={{ color: '#F4AF25' }}>{t('dashboard.annualPassActivated')}: {data[hoveredIndex].annualPasses}</div>
        </div>
      )}
    </div>
  )
}

type QuickActionButtonProps = {
  label: string
  icon: React.ReactNode
  onClick: () => void
  variant?: 'primary' | 'secondary'
  primaryGradient: string
  secondaryBackground: string
  secondaryColor: string
  isMobile: boolean
}

const QuickActionButton: React.FC<QuickActionButtonProps> = ({
  label,
  icon,
  onClick,
  variant = 'secondary',
  primaryGradient,
  secondaryBackground,
  secondaryColor,
  isMobile,
}) => {
  const isPrimary = variant === 'primary'
  const color = isPrimary ? '#111' : secondaryColor

  const buttonStyle: React.CSSProperties = {
    display: 'flex',
    flexDirection: 'column',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    minWidth: 0,
    minHeight: isMobile ? 84 : 92,
    borderRadius: 12,
    padding: isMobile ? '10px 8px' : '12px 10px',
    border: isPrimary ? '1px solid rgba(253,224,141,0.55)' : '1px solid rgba(255,255,255,0.08)',
    background: isPrimary ? primaryGradient : secondaryBackground,
    color,
    fontWeight: 700,
    boxShadow: isPrimary ? '0 4px 15px rgba(244,175,37,0.35)' : 'none',
    cursor: 'pointer',
    transition: 'transform 0.16s ease, border-color 0.16s ease, box-shadow 0.16s ease, background 0.16s ease',
    WebkitTapHighlightColor: 'transparent',
  }

  return (
    <button
      type="button"
      className="dashboard-quick-action"
      onClick={onClick}
      style={buttonStyle}
    >
      <span style={{ display: 'flex', lineHeight: 0, color }}>{icon}</span>
      <span style={{
        maxWidth: '100%',
        color,
        fontSize: isMobile ? 12 : 13,
        lineHeight: 1.25,
        textAlign: 'center',
        overflowWrap: 'anywhere',
      }}>
        {label}
      </span>
    </button>
  )
}

type MetricCardProps = {
  label: string
  value: string
  subText?: string
  extraInfo?: string
  isSubscription?: boolean
  isExpired?: boolean
  actionLabel?: string
  onAction?: () => void
  onClick?: () => void
  isMobile: boolean
}

const MetricCard: React.FC<MetricCardProps> = ({
  label,
  value,
  subText,
  extraInfo,
  isSubscription,
  isExpired,
  actionLabel,
  onAction,
  onClick,
  isMobile,
}) => {
  const Wrapper = onClick ? 'button' : 'div'
  const hasRatioValue = value.includes('/')
  const [primaryValue, secondaryValue] = hasRatioValue ? value.split('/') : [value, '']

  const cardStyle: React.CSSProperties = {
    textAlign: 'center',
    display: 'flex',
    flexDirection: 'column',
    justifyContent: 'center',
    minWidth: 0,
    minHeight: isMobile ? 96 : 110,
    padding: isMobile ? '10px 8px' : 12,
    backgroundColor: 'rgba(255,255,255,0.05)',
    borderRadius: 12,
    border: '1px solid rgba(255,255,255,0.05)',
    position: 'relative',
    cursor: onClick ? 'pointer' : 'default',
    transition: 'all 0.2s ease',
    width: '100%',
    WebkitTapHighlightColor: 'transparent',
  }

  return (
    <Wrapper
      type={onClick ? 'button' : undefined}
      onClick={onClick}
      style={cardStyle}
      className={onClick ? 'dashboard-clickable-card dashboard-metric-card' : 'dashboard-metric-card'}
    >
      <div style={{
        fontSize: isMobile ? 11 : 12,
        color: '#A0A0A0',
        marginBottom: 4,
        lineHeight: 1.25,
        overflowWrap: 'anywhere',
      }}>
        {label}
      </div>

      <div style={{
        fontSize: isMobile ? (isSubscription ? 14 : 18) : (isSubscription ? 18 : 24),
        fontWeight: 800,
        backgroundImage: 'linear-gradient(to right,#FDE08D,#C48D3A)',
        WebkitBackgroundClip: 'text',
        color: 'transparent',
        lineHeight: 1.2,
        display: 'flex',
        alignItems: 'baseline',
        justifyContent: 'center',
        minWidth: 0,
        overflowWrap: 'anywhere',
      }}>
        {hasRatioValue ? (
          <>
            <span>{primaryValue}</span>
            <span style={{
              fontSize: isMobile ? '11px' : '14px',
              color: 'rgba(255,255,255,0.7)',
              WebkitTextFillColor: 'rgba(255,255,255,0.7)',
              marginLeft: 2,
              fontWeight: 500
            }}>
              /{secondaryValue}
            </span>
          </>
        ) : value}
      </div>

      {subText && (
        <div style={{
          fontSize: isMobile ? 10 : 12,
          color: isExpired ? '#ff4d4f' : '#EAEAEA',
          marginTop: isMobile ? 2 : 4,
          fontWeight: 600,
          lineHeight: 1.25,
          overflowWrap: 'anywhere',
        }}>
          {subText}
        </div>
      )}

      {extraInfo && (
        <div style={{
          fontSize: isMobile ? 10 : 11,
          color: '#888',
          marginTop: 2,
          lineHeight: 1.25,
          overflowWrap: 'anywhere',
        }}>
          {extraInfo}
        </div>
      )}

      {isSubscription && actionLabel && onAction && (
        <Button
          size="small"
          type="primary"
          onClick={(e) => {
            e.stopPropagation()
            onAction()
          }}
          style={{
            marginTop: 6,
            fontSize: isMobile ? 10 : 11,
            minHeight: isMobile ? 24 : 22,
            height: 'auto',
            padding: isMobile ? '2px 8px' : '0 12px',
            background: 'linear-gradient(to right,#FDE08D,#C48D3A)',
            color: '#111',
            border: 'none',
            fontWeight: 600,
            width: 'fit-content',
            maxWidth: '100%',
            marginInline: 'auto',
            whiteSpace: 'normal',
            lineHeight: 1.2,
          }}
        >
          {actionLabel}
        </Button>
      )}
    </Wrapper>
  )
}

const AdminDashboard: React.FC = () => {
  const navigate = useNavigate()
  const { t } = useTranslation()
  const { message } = App.useApp()
  const { user, isSuperAdmin } = useAuthStore()
  const startOfMonth = useMemo(() => {
    const now = new Date()
    return new Date(now.getFullYear(), now.getMonth(), 1)
  }, [])

  const { data: users, loading: usersLoading, refresh: refreshUsers } = useFirestoreQuery<User>(
    () => getUsers()
  )
  const { data: orders, refresh: refreshOrders } = useFirestoreQuery<Order>(
    () => getAllOrders(isSuperAdmin ? undefined : user?.storeId, { limit: 100 }),
    [isSuperAdmin, user?.storeId]
  )
  const { data: events, loading: eventsLoading, refresh: refreshEvents } = useFirestoreQuery<Event>(
    () => getEvents(isSuperAdmin ? undefined : user?.id),
    [isSuperAdmin, user?.id]
  )
  const { data: transactions, refresh: refreshTransactions } = useFirestoreQuery<Transaction>(
    () => getAllTransactions(isSuperAdmin ? undefined : user?.storeId, { startDate: startOfMonth, limit: 500 }),
    [isSuperAdmin, user?.storeId]
  )
  const { data: cigars, refresh: refreshCigars } = useFirestoreQuery<Cigar>(getCigars)
  const { data: visitSessions, refresh: refreshVisitSessions } = useFirestoreQuery<any>(
    () => getAllVisitSessions(undefined, isSuperAdmin ? undefined : user?.storeId),
    [isSuperAdmin, user?.storeId]
  )
  const { data: roomBookings, refresh: refreshRoomBookings } = useFirestoreQuery<any>(
    () => getAllRoomBookings(isSuperAdmin ? undefined : user?.storeId),
    [isSuperAdmin, user?.storeId]
  )
  const { data: reloadRecords, loading: reloadRecordsLoading, refresh: refreshReloadRecords } = useFirestoreQuery<ReloadRecord>(
    () => getAllReloadRecords('completed')
  )
  const { data: annualPassRecords, loading: annualPassRecordsLoading, refresh: refreshAnnualPassRecords } = useFirestoreQuery<MembershipFeeRecord>(
    () => getAllMembershipFeeRecords('paid')
  )

  const refreshAll = () => {
    refreshUsers()
    refreshOrders()
    refreshEvents()
    refreshTransactions()
    refreshCigars()
    refreshVisitSessions()
    refreshRoomBookings()
    refreshReloadRecords()
    refreshAnnualPassRecords()
  }
  const [trendDrawerVisible, setTrendDrawerVisible] = useState(false)
  const [trendType, setTrendType] = useState<'members' | 'bookings'>('members')
  const [trendPeriod, setTrendPeriod] = useState<'daily' | 'monthly' | 'yearly'>('daily')
  const [reloadTrendPeriod, setReloadTrendPeriod] = useState<'days30' | 'months12'>('days30')
  const [growthTrendPeriod, setGrowthTrendPeriod] = useState<'days30' | 'months12'>('days30')
  const [inventoryFeatureVisible, setInventoryFeatureVisible] = useState<boolean>(true)
  const [eventsAdminFeatureVisible, setEventsAdminFeatureVisible] = useState<boolean>(true)
  const [ordersFeatureVisible, setOrdersFeatureVisible] = useState<boolean>(true)
  const [appConfig, setAppConfig] = useState<AppConfig | null>(null)
  const [showRenewModal, setShowRenewModal] = useState(false)
  const [renewLoading, setRenewLoading] = useState(false)
  const { item: viewing, open: drawerOpen, openDrawer, closeDrawer } = useDetailDrawer<Order>()
  const [isEditingInView, setIsEditingInView] = useState(false)
  const [isMobile, setIsMobile] = useState<boolean>(() => {
    if (typeof window === 'undefined') return false
    return window.innerWidth < 768
  })

  useEffect(() => {
    const update = () => setIsMobile(window.innerWidth < 768)
    update()
    window.addEventListener('resize', update)
    return () => window.removeEventListener('resize', update)
  }, [])

  // 检查功能可见性（developer 不受限制）
  useEffect(() => {
    const checkFeatureVisibility = async () => {
      if (user?.role === 'developer') {
        // developer 不受限制，所有功能都可见
        setInventoryFeatureVisible(true)
        setEventsAdminFeatureVisible(true)
        setOrdersFeatureVisible(true)
      } else {
        const [inventoryVisible, eventsAdminVisible, ordersVisible] = await Promise.all([
          isFeatureVisible('inventory'),
          isFeatureVisible('events-admin'),
          isFeatureVisible('orders')
        ])
        setInventoryFeatureVisible(inventoryVisible)
        setEventsAdminFeatureVisible(eventsAdminVisible)
        setOrdersFeatureVisible(ordersVisible)
      }
    }
    checkFeatureVisibility()
  }, [user?.role])

  // 加载应用配置
  useEffect(() => {
    loadAppConfig()
  }, [])

  const loadAppConfig = async () => {
    try {
      const config = await getAppConfig()
      if (config) {
        setAppConfig(config)
      }
    } catch (error) {
      console.error('加载应用配置失败:', error)
    }
  }

  // 统计数据计算
  const totalUsers = users.length
  const totalOrders = orders.length
  const activeEvents = events.filter(e => e.status === 'ongoing').length
  const totalRevenue = transactions.filter(t => t.amount > 0).reduce((sum, t) => sum + t.amount, 0)

  // 当下驻店总人数
  const currentCheckedIn = visitSessions.filter(s => s.status === 'pending').length
  // 房间预定数量（有效订单：confirmed 或 checked_in）
  const activeBookingsCount = roomBookings.filter(b => b.status === 'confirmed' || b.status === 'checked_in').length

  const getTrendData = () => {
    const dataMap = new Map<string, number>()
    
    if (trendType === 'members') {
      // 聚合驻店签到人数
      visitSessions.forEach(s => {
        const dateObj = s.checkInAt instanceof Date ? s.checkInAt : new Date(s.checkInAt)
        if (!dateObj || isNaN(dateObj.getTime())) return
        
        if (trendPeriod === 'daily') {
          const key = dayjs(dateObj).format('YYYY-MM-DD')
          dataMap.set(key, (dataMap.get(key) || 0) + 1)
        } else if (trendPeriod === 'monthly') {
          const key = dayjs(dateObj).format('YYYY-MM')
          dataMap.set(key, (dataMap.get(key) || 0) + 1)
        } else if (trendPeriod === 'yearly') {
          const key = dayjs(dateObj).format('YYYY')
          dataMap.set(key, (dataMap.get(key) || 0) + 1)
        }
      })
    } else {
      // 聚合房间预订数
      roomBookings.forEach(b => {
        if (b.status === 'cancelled') return
        const bookingDateStr = b.date // YYYY-MM-DD
        if (!bookingDateStr) return
        
        if (trendPeriod === 'daily') {
          const key = bookingDateStr
          dataMap.set(key, (dataMap.get(key) || 0) + 1)
        } else if (trendPeriod === 'monthly') {
          const key = bookingDateStr.substring(0, 7) // YYYY-MM
          dataMap.set(key, (dataMap.get(key) || 0) + 1)
        } else if (trendPeriod === 'yearly') {
          const key = bookingDateStr.substring(0, 4) // YYYY
          dataMap.set(key, (dataMap.get(key) || 0) + 1)
        }
      })
    }

    const list: Array<{ label: string; value: number }> = []
    if (trendPeriod === 'daily') {
      // 过去15天
      for (let i = 14; i >= 0; i--) {
        const d = dayjs().subtract(i, 'day')
        const key = d.format('YYYY-MM-DD')
        const label = d.format('DD MMM')
        list.push({ label, value: dataMap.get(key) || 0 })
      }
    } else if (trendPeriod === 'monthly') {
      // 过去12个月
      for (let i = 11; i >= 0; i--) {
        const m = dayjs().subtract(i, 'month')
        const key = m.format('YYYY-MM')
        const label = m.format('MMM YY')
        list.push({ label, value: dataMap.get(key) || 0 })
      }
    } else if (trendPeriod === 'yearly') {
      // 过去5年
      const currentYear = dayjs().year()
      for (let i = 4; i >= 0; i--) {
        const y = currentYear - i
        const key = String(y)
        const label = String(y)
        list.push({ label, value: dataMap.get(key) || 0 })
      }
    }
    
    return list
  }

  const reloadTrendData = useMemo(() => {
    const totals = new Map<string, number>()

    reloadRecords.forEach(record => {
      const rawDate = record.verifiedAt || record.createdAt
      const date = rawDate instanceof Date ? rawDate : new Date(rawDate)
      if (Number.isNaN(date.getTime())) return

      const key = reloadTrendPeriod === 'days30'
        ? dayjs(date).format('YYYY-MM-DD')
        : dayjs(date).format('YYYY-MM')
      totals.set(key, (totals.get(key) || 0) + Number(record.requestedAmount || 0))
    })

    if (reloadTrendPeriod === 'days30') {
      return Array.from({ length: 30 }, (_, index) => {
        const date = dayjs().subtract(29 - index, 'day')
        return {
          label: date.format('DD MMM'),
          value: totals.get(date.format('YYYY-MM-DD')) || 0
        }
      })
    }

    return Array.from({ length: 12 }, (_, index) => {
      const month = dayjs().subtract(11 - index, 'month')
      return {
        label: month.format('MMM YY'),
        value: totals.get(month.format('YYYY-MM')) || 0
      }
    })
  }, [reloadRecords, reloadTrendPeriod])

  const reloadTrendTotal = reloadTrendData.reduce((sum, item) => sum + item.value, 0)

  const growthTrendData = useMemo(() => {
    const newUsers = new Map<string, number>()
    const annualPasses = new Map<string, number>()
    const customerRoles = new Set(['guest', 'member', 'vip'])
    const dateKey = (date: Date) => growthTrendPeriod === 'days30'
      ? dayjs(date).format('YYYY-MM-DD')
      : dayjs(date).format('YYYY-MM')
    const toDate = (value: any): Date | null => {
      if (!value) return null
      const date = value?.toDate ? value.toDate() : value instanceof Date ? value : new Date(value)
      return Number.isNaN(date.getTime()) ? null : date
    }

    users.forEach(currentUser => {
      if (!customerRoles.has(currentUser.role)) return
      const createdAt = toDate(currentUser.createdAt)
      if (!createdAt) return
      const key = dateKey(createdAt)
      newUsers.set(key, (newUsers.get(key) || 0) + 1)
    })

    const firstActivationByUser = new Map<string, Date>()
    annualPassRecords.forEach(record => {
      if (record.status !== 'paid' || record.renewalType !== 'initial') return
      const activatedAt = toDate(record.deductedAt || record.createdAt)
      if (!activatedAt) return
      const existing = firstActivationByUser.get(record.userId)
      if (!existing || activatedAt < existing) firstActivationByUser.set(record.userId, activatedAt)
    })
    firstActivationByUser.forEach(activatedAt => {
      const key = dateKey(activatedAt)
      annualPasses.set(key, (annualPasses.get(key) || 0) + 1)
    })

    if (growthTrendPeriod === 'days30') {
      return Array.from({ length: 30 }, (_, index) => {
        const date = dayjs().subtract(29 - index, 'day')
        const key = date.format('YYYY-MM-DD')
        return {
          label: date.format('DD MMM'),
          newUsers: newUsers.get(key) || 0,
          annualPasses: annualPasses.get(key) || 0
        }
      })
    }

    return Array.from({ length: 12 }, (_, index) => {
      const month = dayjs().subtract(11 - index, 'month')
      const key = month.format('YYYY-MM')
      return {
        label: month.format('MMM YY'),
        newUsers: newUsers.get(key) || 0,
        annualPasses: annualPasses.get(key) || 0
      }
    })
  }, [users, annualPassRecords, growthTrendPeriod])

  // 本月数据
  const currentMonth = dayjs().format('YYYY-MM')
  const monthlyOrders = orders.filter(o => dayjs(o.createdAt).format('YYYY-MM') === currentMonth).length
  const monthlyRevenue = transactions
    .filter(t => t.amount > 0 && dayjs(t.createdAt).format('YYYY-MM') === currentMonth)
    .reduce((sum, t) => sum + t.amount, 0)

  // 安全日期转换函数
  const getOrderDate = (order: any) => {
    if (!order?.createdAt) return new Date(0)
    if (typeof order.createdAt.toDate === 'function') return order.createdAt.toDate()
    return new Date(order.createdAt)
  }

  // 分别计算最新5个完成的订单和最新5个未完成的订单
  const completedOrders = orders
    .filter(o => o.status === 'delivered')
    .sort((a, b) => getOrderDate(b).getTime() - getOrderDate(a).getTime())
    .slice(0, 5)
    .map(order => ({
      ...order,
      user: users.find(u => u.id === order.userId)?.displayName || t('dashboard.unknownUser')
    }))

  const pendingOrders = orders
    .filter(o => o.status !== 'delivered')
    .sort((a, b) => getOrderDate(b).getTime() - getOrderDate(a).getTime())
    .slice(0, 5)
    .map(order => ({
      ...order,
      user: users.find(u => u.id === order.userId)?.displayName || t('dashboard.unknownUser')
    }))
  const [activeTab, setActiveTab] = useState<'completed' | 'pending'>('pending')

  const getOrderPaymentStatus = (order: Order) => {
    // 1) 积分支付或金额为 0 的订单自动视为已付
    if (order.payment?.method === 'points' || Number(order.total || 0) === 0) {
      return { label: t('dashboard.paid'), color: '#52c41a', bg: 'rgba(82,196,26,0.15)' };
    }
    const orderTotal = Number(order.total || 0);
    const matchedAmount = transactions
      .filter(t => (t as any)?.relatedOrders?.some((ro: any) => ro.orderId === order.id))
      .reduce((sum, t) => {
        const orderMatch = (t as any)?.relatedOrders?.find((ro: any) => ro.orderId === order.id);
        return sum + (orderMatch ? Number(orderMatch.amount || 0) : 0);
      }, 0);

    if (matchedAmount >= orderTotal) {
      return { label: t('dashboard.paid'), color: '#52c41a', bg: 'rgba(82,196,26,0.15)' };
    } else if (matchedAmount > 0) {
      return { label: `${t('dashboard.partialPaid')} (RM${matchedAmount.toFixed(2)})`, color: '#fa8c16', bg: 'rgba(250,140,22,0.15)' };
    } else {
      return { label: t('dashboard.unpaid'), color: '#ff4d4f', bg: 'rgba(255,77,79,0.15)' };
    }
  };

  // 低库存统计
  const lowStockCount = cigars.reduce((count, c) => {
    const stock = (c as any)?.inventory?.stock ?? 0
    const min = (c as any)?.inventory?.minStock ?? 0
    return count + (stock <= min ? 1 : 0)
  }, 0)

  const handleRenewSubmit = async (values: any) => {
    try {
      setRenewLoading(true)
      const plan = appConfig?.subscription?.plans?.find(p => p.id === values.planId)

      const currentPlanId = appConfig?.subscription?.planId || appConfig?.subscription?.plan;
      const isUpgrade = currentPlanId && currentPlanId !== values.planId;

      const requestData: any = {
        planId: values.planId,
        planName: plan?.name || values.planId,
        validPeriodMonth: plan?.validPeriodMonth || 12,
        requestedBy: user?.displayName || user?.id || 'Admin',
        status: 'pending',
        createdAt: new Date(),
        updatedAt: new Date(),
        adminNotes: values.adminNotes || '',
        paymentMethod: 'manual',
        requestType: isUpgrade ? 'upgrade' : 'renewal',
        ...(isUpgrade && currentPlanId ? { previousPlanId: currentPlanId } : {})
      }

      // 检查平台 Billplz 是否启用
      const platformBillplz = appConfig?.paymentPlatform?.billplz;
      if (platformBillplz?.enabled && platformBillplz?.apiKey && platformBillplz?.collectionId) {
        const fee = plan?.fee || 0;
        if (fee > 0) {
          const billResponse = await createBill(
            fee,
            `Subscription Activation: ${plan?.name || values.planId}`,
            user?.displayName || 'Admin',
            user?.email || '',
            user?.phone || '',
            true // usePlatformConfig
          );

          if (billResponse.success && billResponse.data?.url) {
            // 关联 Billplz ID 并设置支付方式为在线
            requestData.billplzId = billResponse.data.id;
            requestData.paymentMethod = 'online';

            await addDoc(collection(db, GLOBAL_COLLECTIONS.SUBSCRIPTION_REQUESTS), requestData);

            message.loading(t('dashboard.redirectingToPayment'), 2);
            setTimeout(() => {
              window.location.href = billResponse.data!.url;
            }, 1000);
            return;
          } else {
            console.warn('Failed to create Billplz bill, falling back to manual request:', billResponse.error);
          }
        }
      }

      await addDoc(collection(db, GLOBAL_COLLECTIONS.SUBSCRIPTION_REQUESTS), requestData)

      message.success(t('dashboard.activationRequestSubmitted'))
      setShowRenewModal(false)
    } catch (error) {
      console.error('Failed to submit renewal request:', error)
      message.error(t('dashboard.submitRequestFailed'))
    } finally {
      setRenewLoading(false)
    }
  }


  return (
    <div style={{ minHeight: '100vh', marginBottom: 100 }}>
      <style>{`
        .dashboard-order-card {
          cursor: pointer;
          transition: all 0.2s ease;
        }
        .dashboard-order-card:hover {
          background: rgba(255, 255, 255, 0.1) !important;
          transform: translateY(-1px);
        }
        .dashboard-order-card:focus-visible {
          outline: 2px solid rgba(253, 224, 141, 0.9);
          outline-offset: 3px;
        }
        .dashboard-clickable-card {
          transition: all 0.2s cubic-bezier(0.4, 0, 0.2, 1) !important;
        }
        .dashboard-clickable-card:hover {
          background: rgba(244, 175, 37, 0.1) !important;
          border-color: rgba(244, 175, 37, 0.4) !important;
          transform: translateY(-2px);
          box-shadow: 0 4px 12px rgba(244, 175, 37, 0.1);
        }
        .dashboard-clickable-card:focus-visible {
          border-color: rgba(253, 224, 141, 0.75) !important;
          box-shadow: 0 0 0 3px rgba(253, 224, 141, 0.28), 0 4px 12px rgba(244, 175, 37, 0.14);
        }
        .dashboard-metric-card {
          appearance: none;
          font: inherit;
        }
      `}</style>
      {/* 顶部 */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12 }}>

      </div>

      <h1 style={{ fontSize: 22, fontWeight: 800, backgroundImage: 'linear-gradient(to right,#FDE08D,#C48D3A)', WebkitBackgroundClip: 'text', color: 'transparent', marginBottom: 12 }}>{t('dashboard.overview')}</h1>

      {/* 概览卡片 */}
      <div style={isMobile ? {
        backgroundColor: 'rgba(57, 51, 40, 0.5)',
        backdropFilter: 'blur(10px)',
        borderRadius: 12,
        padding: '12px',
        border: '1px solid rgba(244, 175, 37, 0.3)',
        display: 'grid',
        gridTemplateColumns: 'repeat(auto-fit, minmax(124px, 1fr))',
        gap: '10px',
        marginBottom: 16
      } : {
        display: 'grid',
        gridTemplateColumns: 'repeat(auto-fit, minmax(160px, 1fr))',
        gap: 12,
        marginBottom: 16
      }}>
        {(() => {
          const { isActive, planId, plan, expiryDate, plans } = appConfig?.subscription || {};
          const currentPlan = plans?.find((p: any) => p.id === (planId || plan)) || { name: (planId || plan || 'Free').toUpperCase(), maxMembers: 50 };

          let statusValue = currentPlan.name;
          let subText = '';
          let isExpired = false;
          let daysLeft = 999;

          if (!isActive && appConfig?.subscription) {
            statusValue = t('dashboard.subscriptionInactive');
            isExpired = true;
          } else if (expiryDate) {
            try {
              const exp = (expiryDate as any).toDate ? (expiryDate as any).toDate() : new Date(expiryDate as any);
              if (!isNaN(exp.getTime())) {
                daysLeft = Math.max(0, Math.ceil((exp.getTime() - new Date().getTime()) / (1000 * 60 * 60 * 24)));
                isExpired = daysLeft === 0;
                const dateStr = dayjs(exp).format('YYYY-MM-DD');
                subText = `Exp: ${dateStr}`;
              }
            } catch (e) {
              console.warn('Invalid expiry date format', e);
            }
          }

          const isOverlimit = totalUsers > (currentPlan.maxMembers || 50);
          const currentPlanIndex = plans?.findIndex((p: any) => p.id === (planId || plan)) ?? -1;
          const hasHigherPlan = plans && currentPlanIndex >= 0 && currentPlanIndex < plans.length - 1;
          const showButton = isOverlimit || isExpired || daysLeft <= 30 || hasHigherPlan;

          const cards: Array<{
            label: string;
            value: string;
            subText?: string;
            isSubscription?: boolean;
            isExpired?: boolean;
            extraInfo?: string;
            showButton?: boolean;
            actionLabel?: string;
            onClick?: () => void;
          }> = [
            { label: t('dashboard.totalMembers'), value: `${totalUsers}/${currentPlan.maxMembers || 50}` },
            {
              label: t('dashboard.subscriptionLabel'),
              value: statusValue,
              subText,
              isSubscription: true,
              isExpired: isExpired || !isActive,
              showButton,
              actionLabel: isOverlimit || hasHigherPlan ? t('dashboard.planUpgrade') : (isExpired ? t('dashboard.planActivate') : t('dashboard.planRenew'))
            },
            { label: t('dashboard.currentCheckedInMembers'), value: currentCheckedIn.toString(), onClick: () => { setTrendType('members'); setTrendPeriod('daily'); setTrendDrawerVisible(true); } },
            { label: t('dashboard.activeRoomBookings'), value: activeBookingsCount.toString(), onClick: () => { setTrendType('bookings'); setTrendPeriod('daily'); setTrendDrawerVisible(true); } },
            { label: t('dashboard.monthlyOrders'), value: monthlyOrders.toLocaleString() },
            isSuperAdmin ? { label: t('dashboard.monthlyRevenue'), value: `RM${monthlyRevenue.toLocaleString()}` } : null
          ].filter(Boolean) as any[];

          return cards.map((card: any, idx) => (
            <MetricCard
              key={idx}
              label={card.label}
              value={card.value}
              subText={card.subText}
              extraInfo={card.extraInfo}
              isSubscription={card.isSubscription}
              isExpired={card.isExpired}
              actionLabel={card.showButton ? card.actionLabel : undefined}
              onAction={card.showButton ? () => setShowRenewModal(true) : undefined}
              onClick={card.onClick}
              isMobile={isMobile}
            />
          ));
        })()}
      </div>

      {/* Subscription Renewal Modal */}
      <Modal
        title={<span style={{ color: '#FDE08D' }}>{t("dashboard.subscriptionModalTitle")}</span>}
        open={showRenewModal}
        onCancel={() => setShowRenewModal(false)}
        footer={null}
        centered
        width={window.innerWidth < 768 ? '95%' : 800}
        styles={{ content: { background: '#1a1a1a', border: '1px solid #C48D3A' } }}
      >
        <Form layout="vertical" onFinish={handleRenewSubmit}>
          <Form.Item
            name="planId"
            label={<span style={{ color: '#ccc' }}>{t("dashboard.choosePlan")}</span>}
            rules={[{ required: true, message: t("dashboard.pleaseSelectPlan") }]}
            initialValue={appConfig?.subscription?.planId || appConfig?.subscription?.plan || 'basic'}
          >
            <PlanSelector plans={appConfig?.subscription?.plans || []} currentPlanId={appConfig?.subscription?.planId || appConfig?.subscription?.plan} memberCount={totalUsers} />
          </Form.Item>

          <Form.Item name="adminNotes" label={<span style={{ color: '#ccc' }}>{t("dashboard.notesOptional")}</span>}>
            <Input.TextArea placeholder={t("dashboard.notesPlaceholder")} />
          </Form.Item>

          <Alert
            message={t("dashboard.activationProcess")}
            description={t("dashboard.activationProcessDesc")}
            type="info"
            showIcon
            style={{ marginBottom: 16, background: 'rgba(255,255,255,0.05)', border: '1px solid #C48D3A' }}
          />

          <div style={{ textAlign: 'right' }}>
            <Button onClick={() => setShowRenewModal(false)} style={{ marginRight: 8, background: 'transparent', color: '#fff', border: '1px solid #444' }}>{t("common.cancel")}</Button>
            <Button type="primary" htmlType="submit" loading={renewLoading} style={{ background: 'linear-gradient(to right,#FDE08D,#C48D3A)', color: '#111', border: 'none', fontWeight: 600 }}>
              {t("dashboard.submitRequest")}
            </Button>
          </div>
        </Form>
      </Modal>

      {/* Reload trend */}
      <section style={{ marginBottom: 16, paddingInline: 8 }}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12, marginBottom: 10, flexWrap: 'wrap' }}>
          <div>
            <h2 style={{ display: 'flex', alignItems: 'center', gap: 8, margin: 0, fontSize: 16, fontWeight: 800, color: '#EAEAEA' }}>
              <ReloadOutlined style={{ color: '#E7B54A' }} />
              {t('dashboard.reloadTrend')}
            </h2>
            <div style={{ marginTop: 3, color: 'rgba(255,255,255,0.5)', fontSize: 12 }}>
              {t('dashboard.reloadTotal')}:{' '}
              <span style={{ color: '#FDE08D', fontWeight: 700 }}>
                RM{reloadTrendTotal.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
              </span>
            </div>
          </div>

          <div style={{ display: 'flex', padding: 4, borderRadius: 8, background: 'rgba(255,255,255,0.05)' }}>
            {(['days30', 'months12'] as const).map(period => {
              const active = reloadTrendPeriod === period
              return (
                <button
                  key={period}
                  type="button"
                  onClick={() => setReloadTrendPeriod(period)}
                  style={{
                    minHeight: 32,
                    padding: '6px 12px',
                    border: 'none',
                    borderRadius: 6,
                    background: active ? 'linear-gradient(to right, #FDE08D, #C48D3A)' : 'transparent',
                    color: active ? '#111' : 'rgba(255,255,255,0.62)',
                    fontSize: 12,
                    fontWeight: 700,
                    cursor: 'pointer'
                  }}
                >
                  {period === 'days30' ? t('dashboard.last30Days') : t('dashboard.last12Months')}
                </button>
              )
            })}
          </div>
        </div>

        {reloadRecordsLoading ? (
          <div style={{ minHeight: 220, display: 'flex', alignItems: 'center', justifyContent: 'center' }}><Spin /></div>
        ) : (
          <TrendChart
            data={reloadTrendData}
            isMobile={isMobile}
            chartId="reload"
            valueFormatter={value => `RM${value.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`}
            valueUnit=""
          />
        )}
      </section>

      {/* Customer growth trend */}
      <section style={{ marginBottom: 16, paddingInline: 8 }}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12, marginBottom: 10, flexWrap: 'wrap' }}>
          <h2 style={{ margin: 0, fontSize: 16, fontWeight: 800, color: '#EAEAEA' }}>
            {t('dashboard.customerGrowthTrend')}
          </h2>

          <div style={{ display: 'flex', padding: 4, borderRadius: 8, background: 'rgba(255,255,255,0.05)' }}>
            {(['days30', 'months12'] as const).map(period => {
              const active = growthTrendPeriod === period
              return (
                <button
                  key={period}
                  type="button"
                  onClick={() => setGrowthTrendPeriod(period)}
                  style={{
                    minHeight: 32,
                    padding: '6px 12px',
                    border: 'none',
                    borderRadius: 6,
                    background: active ? 'linear-gradient(to right, #FDE08D, #C48D3A)' : 'transparent',
                    color: active ? '#111' : 'rgba(255,255,255,0.62)',
                    fontSize: 12,
                    fontWeight: 700,
                    cursor: 'pointer'
                  }}
                >
                  {period === 'days30' ? t('dashboard.last30Days') : t('dashboard.last12Months')}
                </button>
              )
            })}
          </div>
        </div>

        {usersLoading || annualPassRecordsLoading ? (
          <div style={{ minHeight: 220, display: 'flex', alignItems: 'center', justifyContent: 'center' }}><Spin /></div>
        ) : (
          <GrowthTrendChart data={growthTrendData} isMobile={isMobile} />
        )}
      </section>

      {/* 快速操作 */}
      <div style={{ marginBottom: 16 }}>
        <style>
          {`
            .dashboard-quick-action:hover {
              transform: translateY(-1px);
              border-color: rgba(253, 224, 141, 0.45) !important;
            }

            .dashboard-quick-action:focus-visible {
              box-shadow: 0 0 0 3px rgba(253, 224, 141, 0.32), 0 4px 15px rgba(244, 175, 37, 0.24) !important;
              border-color: rgba(253, 224, 141, 0.75) !important;
            }

            .dashboard-quick-action:active {
              transform: translateY(0);
            }
          `}
        </style>
        <h2 style={{ fontSize: 16, fontWeight: 800, color: '#EAEAEA', paddingInline: 8 }}>{t('dashboard.quickActions')}</h2>
        <div style={{
          marginTop: 8,
          display: 'grid',
          gridTemplateColumns: `repeat(auto-fit, minmax(${isMobile ? 128 : 150}px, 1fr))`,
          gap: isMobile ? 10 : 12,
          paddingInline: 8,
        }}>
          {(() => {
            const primaryGradient = appConfig?.colorTheme?.primaryButton
              ? `linear-gradient(to right, ${appConfig.colorTheme.primaryButton.startColor}, ${appConfig.colorTheme.primaryButton.endColor})`
              : 'linear-gradient(to right,#FDE08D,#C48D3A)'
            const secondaryBackground = appConfig?.colorTheme?.secondaryButton?.backgroundColor || 'rgba(255,255,255,0.05)'
            const secondaryColor = appConfig?.colorTheme?.secondaryButton?.textColor || '#EAEAEA'
            const quickActionSharedProps = {
              primaryGradient,
              secondaryBackground,
              secondaryColor,
              isMobile,
            }

            return (
              <>
                {eventsAdminFeatureVisible && (
                  <QuickActionButton
                    {...quickActionSharedProps}
                    variant="primary"
                    label={t('dashboard.event')}
                    onClick={() => navigate('/admin/events')}
                    icon={<svg width="24" height="24" viewBox="0 0 20 20" fill="currentColor" xmlns="http://www.w3.org/2000/svg"><path d="M10 2a1 1 0 011 1v6h6a1 1 0 110 2h-6v6a1 1 0 11-2 0v-6H3a1 1 0 110-2h6V3a1 1 0 011-1z" /></svg>}
                  />
                )}
                {ordersFeatureVisible && (
                  <QuickActionButton
                    {...quickActionSharedProps}
                    label={t('dashboard.orders')}
                    onClick={() => navigate('/admin/orders')}
                    icon={<svg width="24" height="24" viewBox="0 0 20 20" fill="currentColor" xmlns="http://www.w3.org/2000/svg"><path clipRule="evenodd" d="M3 3a1 1 0 00-1 1v12a1 1 0 001 1h14a1 1 0 001-1V4a1 1 0 00-1-1H3zm12 11H5V5h10v9z" fillRule="evenodd"></path><path d="M9 7a1 1 0 100 2h2a1 1 0 100-2H9z"></path></svg>}
                  />
                )}
                <QuickActionButton
                  {...quickActionSharedProps}
                  label={t('dashboard.user')}
                  onClick={() => navigate('/admin/users')}
                  icon={<svg width="24" height="24" viewBox="0 0 20 20" fill="currentColor" xmlns="http://www.w3.org/2000/svg"><path clipRule="evenodd" d="M10 9a3 3 0 100-6 3 3 0 000 6zm-7 9a7 7 0 1114 0H3z" fillRule="evenodd"></path></svg>}
                />
                {inventoryFeatureVisible && (
                  <QuickActionButton
                    {...quickActionSharedProps}
                    label={t('dashboard.inventory')}
                    onClick={() => navigate('/admin/inventory')}
                    icon={<svg width="24" height="24" viewBox="0 0 20 20" fill="currentColor" xmlns="http://www.w3.org/2000/svg"><path d="M5 8a1 1 0 011-1h8a1 1 0 110 2H6a1 1 0 01-1-1z"></path><path clipRule="evenodd" d="M3 3a1 1 0 011-1h12a1 1 0 011 1v14a1 1 0 01-1 1H4a1 1 0 01-1-1V3zm2 2v10h10V5H5z" fillRule="evenodd"></path></svg>}
                  />
                )}
              </>
            )
          })()}
        </div>
      </div>

      {/* 订单标签页 - 仅在订单管理功能可见时显示 */}
      {ordersFeatureVisible && (
        <div style={{ marginBottom: 16, paddingInline: 8 }}>
          <div style={{ display: 'flex', borderBottom: '1px solid rgba(244,175,37,0.2)' }}>
            {(['pending', 'completed'] as const).map((tabKey) => {
              const isActive = activeTab === tabKey
              const baseStyle: React.CSSProperties = {
                flex: 1,
                padding: '10px 0',
                fontWeight: 800,
                fontSize: 12,
                borderBottom: '2px solid transparent',
                cursor: 'pointer',
                background: 'transparent',
                border: 'none',
                position: 'relative' as const,
              }
              const activeStyle: React.CSSProperties = {
                color: 'transparent',
                backgroundImage: 'linear-gradient(to right,#FDE08D,#C48D3A)',
                WebkitBackgroundClip: 'text',
              }
              const inactiveStyle: React.CSSProperties = {
                color: '#A0A0A0',
                background: 'transparent',
              }
              return (
                <button
                  key={tabKey}
                  type="button"
                  onClick={() => setActiveTab(tabKey)}
                  style={{ ...baseStyle, ...(isActive ? activeStyle : inactiveStyle) }}
                >
                  {tabKey === 'completed' ? t('dashboard.completedOrders') : t('dashboard.pendingOrders')}
                  {isActive && (
                    <div style={{
                      position: 'absolute',
                      bottom: 0,
                      left: 0,
                      right: 0,
                      height: '2px',
                      background: 'linear-gradient(to right,#FDE08D,#C48D3A)',
                      borderRadius: '1px'
                    }} />
                  )}
                </button>
              )
            })}
          </div>
          <div style={{ marginTop: 12 }}>
            {(activeTab === 'completed' ? completedOrders : pendingOrders).map((order) => (
              <button key={order.id} type="button" className="dashboard-order-card" onClick={() => openDrawer(order)} style={{ display: 'flex', alignItems: 'center', gap: 12, padding: 12, borderRadius: 12, background: 'rgba(255,255,255,0.05)', marginBottom: 8, border: 'none', width: '100%', color: 'inherit', font: 'inherit', textAlign: 'left' }}>
                <div style={{ width: 48, height: 48, borderRadius: 9999, background: 'rgba(45,39,26,0.5)', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                  <img alt="avatar" src="https://lh3.googleusercontent.com/aida-public/AB6AXuCqh6yOfMjU5qQSoCZPZvRqAiz-okAgrdu0FpYXfw5uHOQsuU4n9sXB0tgWxKp0S0CeRoIfGobj8db5AYyR99MzIRYRhGQ6FTM8hDdbqiekQypZbWKI-hdGzfS2pxYZNJ6bYvPj6CXp9XlDHxFyPDtN3i6CETf5OL_Cwg7QBM79IF0fAn-CPEBxheKV9HTDuDr0eao0xcYzNAf_ho8FNb9cgnap5ZOygDZktOCV_aV3y2MBiYrxtLFdefqLos7npLS50yvMaM7cH9MK" style={{ width: 48, height: 48, borderRadius: 9999 }} />
                </div>
                <div style={{ flex: 1 }}>
                  <div style={{ fontWeight: 700, color: '#EAEAEA' }}>{order.user}</div>
                  <div style={{ fontSize: 12, color: '#A0A0A0' }}>{t('dashboard.orderNumber')} #{String(order.id).slice(0, 20)}</div>
                </div>
                <div style={{ textAlign: 'right', display: 'flex', flexDirection: 'column', alignItems: 'flex-end', gap: 4 }}>
                  <div style={{ fontWeight: 800, color: '#FDE08D' }}>RM{order.total.toFixed(2)}</div>
                  <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', justifyContent: 'flex-end' }}>
                    <span style={{ fontSize: 11, padding: '2px 6px', borderRadius: 4, background: order.status === 'delivered' ? 'rgba(34,197,94,0.15)' : 'rgba(239,68,68,0.15)', color: order.status === 'delivered' ? '#22c55e' : '#ef4444' }}>
                      {order.status === 'delivered' ? t('dashboard.completed') : t('dashboard.pending')}
                    </span>
                    {activeTab === 'pending' && (() => {
                      const payStatus = getOrderPaymentStatus(order);
                      return (
                        <span style={{ fontSize: 11, padding: '2px 6px', borderRadius: 4, background: payStatus.bg, color: payStatus.color }}>
                          {payStatus.label}
                        </span>
                      );
                    })()}
                  </div>
                </div>
              </button>
            ))}
            {(activeTab === 'completed' ? completedOrders : pendingOrders).length === 0 && (
              <div style={{ color: '#999', textAlign: 'center', padding: '20px 0' }}>{t('dashboard.noCompletedOrders')}</div>
            )}
          </div>
        </div>
      )}

      {/* 最近活动 - 仅在活动管理功能可见时显示 */}
      {eventsAdminFeatureVisible && (
        <div style={{ marginBottom: 16 }}>
          <h2 style={{ fontSize: 16, fontWeight: 800, color: '#EAEAEA', paddingInline: 8 }}>{t('dashboard.recentActivities')}</h2>
          <div style={{ marginTop: 8, borderRadius: 12, padding: 12, background: 'rgba(255,255,255,0.05)' }}>
            {eventsLoading ? (
              <div style={{ textAlign: 'center', padding: '24px 0' }}><Spin /></div>
            ) : events.length > 0 ? (
              <div style={{ display: 'flex', alignItems: 'flex-start', gap: 12 }}>
                <img alt="event" src="https://lh3.googleusercontent.com/aida-public/AB6AXuCqZ66H4cXQr5mFjjZyArt6LdIb2BIhk4GF2JHKx2UCbrmxHNifoFkgto2LG8dL9qzuUPUV1f-BSFt8puUWcvCTY9TDHmgNLRVDHbY5AQDcoEfpA2UCkA7yw2LW8wyULzH1uKlNeWPJWxeQz9OJLA1t1bX9m6isA9rQp2vMKu50gx-ykzHIEFQYiHCFdw6JtNhTVBYbcmO0OXa-tiLBaQCRrKo2931k70O13w9CwSQqcROyUsbO70ENYAHrnobDtbOq44lMixgFghpH" style={{ width: 96, height: 96, objectFit: 'cover', borderRadius: 8 }} />
                <div style={{ flex: 1 }}>
                  <div style={{ fontWeight: 800, color: '#EAEAEA' }}>{events[0].title}</div>
                  <div style={{ fontSize: 12, color: '#A0A0A0', marginTop: 4 }}>
                    {(() => {
                      const startDate = (events[0].schedule.startDate as any)?.toDate ? (events[0].schedule.startDate as any).toDate() : events[0].schedule.startDate
                      return startDate ? dayjs(startDate).format('YYYY-MM-DD') : t('dashboard.noTimeSet')
                    })()}
                  </div>
                  <div style={{ fontSize: 12, color: '#A0A0A0', marginTop: 4 }}>
                    {t('dashboard.registeredCount', {
                      registered: ((events[0] as any).participants?.registered || []).length,
                      max: (events[0] as any).participants?.maxParticipants || 0
                    })}
                  </div>
                </div>
              </div>
            ) : (
              <div style={{ color: '#999', textAlign: 'center', padding: '20px 0' }}>{t('dashboard.noEventData')}</div>
            )}
          </div>
        </div>
      )}

      {/* 库存状态 - 仅在库存管理功能可见时显示 */}
      {inventoryFeatureVisible && (
        <div>
          <h2 style={{ fontSize: 16, fontWeight: 800, color: '#EAEAEA', paddingInline: 8 }}>{t('dashboard.stockStatus')}</h2>
          <div style={{ marginTop: 8, display: 'flex', alignItems: 'center', justifyContent: 'space-between', borderRadius: 12, padding: 12, background: 'rgba(255,255,255,0.05)' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
              <div style={{ width: 48, height: 48, borderRadius: 9999, background: 'rgba(239,68,68,0.2)', display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#ef4444' }}>!</div>
              <div>
                <div style={{ fontWeight: 700, color: '#EAEAEA' }}>{t('dashboard.lowStockWarning')}</div>
                <div style={{ fontSize: 12, color: '#A0A0A0' }}>{t('dashboard.lowStockCount', { count: lowStockCount })}</div>
              </div>
            </div>
            <div style={{ color: '#A0A0A0' }}>&gt;</div>
          </div>
        </div>
      )}
      {/* 订单详情抽屉 */}
      <Drawer
        open={drawerOpen}
        onClose={() => { closeDrawer(); setIsEditingInView(false) }}
        width={isMobile ? '100%' : 820}
        styles={{
          body: { padding: 0, background: '#1a160d' },
          header: { background: '#1a160d', borderBottom: '1px solid rgba(244,175,37,0.2)' }
        }}
        title={
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
            <span style={{ color: '#f4af25', fontWeight: 800 }}>
              {t('ordersAdmin.orderNo')}: {viewing?.id}
            </span>
          </div>
        }
        closable={false}
        extra={
          <Button
            type="text"
            icon={<CloseOutlined style={{ color: '#fff' }} />}
            onClick={() => { closeDrawer(); setIsEditingInView(false) }}
          />
        }
      >
        {viewing && (
          <OrderDetails
            order={viewing}
            users={users}
            cigars={cigars}
            transactions={transactions}
            isMobile={isMobile}
            isEditingInView={isEditingInView}
            onClose={() => { closeDrawer(); setIsEditingInView(false) }}
            onEditToggle={() => setIsEditingInView(v => !v)}
            onOrderUpdate={refreshAll}
          />
        )}
      </Drawer>

      {/* 趋势图表抽屉 */}
      <Drawer
        open={trendDrawerVisible}
        onClose={() => setTrendDrawerVisible(false)}
        width={isMobile ? '100%' : 560}
        styles={{
          body: { padding: '24px', background: '#1a160d', color: '#fff' },
          header: { background: '#1a160d', borderBottom: '1px solid rgba(244,175,37,0.2)' }
        }}
        title={
          <div style={{ color: '#f4af25', fontWeight: 800, fontSize: 16 }}>
            {trendType === 'members' ? t('dashboard.trendTitleCheckedIn') : t('dashboard.trendTitleBookings')}
          </div>
        }
        closable={false}
        extra={
          <Button
            type="text"
            icon={<CloseOutlined style={{ color: '#fff' }} />}
            onClick={() => setTrendDrawerVisible(false)}
          />
        }
      >
        <div style={{ display: 'flex', flexDirection: 'column', gap: '20px' }}>
          {/* 日期粒度切换按钮 */}
          <div style={{ display: 'flex', background: 'rgba(255,255,255,0.05)', borderRadius: '8px', padding: '4px', alignSelf: 'flex-start' }}>
            {(['daily', 'monthly', 'yearly'] as const).map((period) => {
              const isActive = trendPeriod === period;
              return (
                <button
                  key={period}
                  type="button"
                  onClick={() => setTrendPeriod(period)}
                  style={{
                    padding: '6px 16px',
                    borderRadius: '6px',
                    border: 'none',
                    fontWeight: 700,
                    fontSize: '12px',
                    cursor: 'pointer',
                    background: isActive ? 'linear-gradient(to right, #FDE08D, #C48D3A)' : 'transparent',
                    color: isActive ? '#111' : 'rgba(255, 255, 255, 0.6)',
                    transition: 'all 0.2s ease',
                  }}
                >
                  {period === 'daily' ? t('dashboard.periodDay') : period === 'monthly' ? t('dashboard.periodMonth') : t('dashboard.periodYear')}
                </button>
              );
            })}
          </div>

          {/* 趋势折线图 */}
          <div style={{ marginTop: '8px' }}>
            <TrendChart data={getTrendData()} isMobile={isMobile} />
          </div>

          {/* 数据明细列表 */}
          <div style={{ marginTop: '12px' }}>
            <h3 style={{ color: '#f4af25', fontSize: '14px', fontWeight: 800, marginBottom: '12px' }}>{t("dashboard.dataDetails")}</h3>
            <div style={{ display: 'flex', flexDirection: 'column', gap: '8px', maxHeight: '300px', overflowY: 'auto', paddingRight: '4px' }}>
              {getTrendData().slice().reverse().map((item, idx) => (
                <div 
                  key={idx} 
                  style={{ 
                    display: 'flex', 
                    justifyContent: 'space-between', 
                    alignItems: 'center', 
                    padding: '10px 14px', 
                    background: 'rgba(255,255,255,0.03)', 
                    borderRadius: '8px',
                    border: '1px solid rgba(255,255,255,0.02)'
                  }}
                >
                  <span style={{ fontSize: '13px', color: 'rgba(255,255,255,0.7)' }}>{item.label}</span>
                  <span style={{ fontSize: '14px', fontWeight: 800, color: '#FDE08D' }}>
                    {item.value} <span style={{ fontSize: '11px', fontWeight: 'normal', color: 'rgba(255,255,255,0.5)' }}>{t("dashboard.trendCountUnit")}</span>
                  </span>
                </div>
              ))}
            </div>
          </div>
        </div>
      </Drawer>
    </div>
  )
}

export default AdminDashboard
