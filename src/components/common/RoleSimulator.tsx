import React, { useState } from 'react'
import { Button, Popover, Select, Tooltip } from 'antd'
import { ExperimentOutlined, UndoOutlined } from '@ant-design/icons'
import { useTranslation } from 'react-i18next'
import { useAuthStore } from '../../store/modules/auth'
import { ROLE_PERMISSIONS } from '../../config/permissions'
import type { UserRole } from '../../types'

export default function RoleSimulator({ activeOnly = false }: { activeOnly?: boolean }) {
  const { actualUser, simulatedRole, setSimulatedRole } = useAuthStore()
  const { t, i18n } = useTranslation()
  const [open, setOpen] = useState(false)
  const zh = i18n.language.startsWith('zh')
  if (actualUser?.role !== 'developer' || (activeOnly && !simulatedRole)) return null

  const label = zh ? '角色模拟器' : 'Role Simulator'
  const selector = (
    <Select
      aria-label={label}
      value={simulatedRole || 'developer'}
      onChange={(role: UserRole) => { setSimulatedRole(role); setOpen(false) }}
      style={{ width: 160 }}
      options={(Object.keys(ROLE_PERMISSIONS) as UserRole[]).map(role => ({
        value: role,
        label: t(`scanner.roles.${role}`, { defaultValue: role }),
      }))}
    />
  )

  if (activeOnly) return (
    <div style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: 8, padding: '8px 12px', background: '#27221a', borderBottom: '1px solid #8c732f', flexShrink: 0 }}>
      <ExperimentOutlined style={{ color: '#FDE08D' }} />
      <span style={{ color: '#FDE08D', fontSize: 13 }}>{label}</span>
      {selector}
      <Tooltip title={zh ? '恢复 Developer' : 'Restore Developer'}>
        <Button aria-label={zh ? '恢复 Developer' : 'Restore Developer'} icon={<UndoOutlined />} onClick={() => setSimulatedRole(null)} />
      </Tooltip>
    </div>
  )

  return (
    <Popover
      title={label}
      trigger="click"
      open={open}
      onOpenChange={setOpen}
      content={(
        <div style={{ maxWidth: 240 }}>
          {selector}
          <p style={{ margin: '10px 0 0', fontSize: 12, color: '#aaa' }}>
            {zh ? '模拟前端角色权限，后端操作仍使用当前登录账号。' : 'Preview frontend permissions. Server actions use your signed-in account.'}
          </p>
        </div>
      )}
    >
      <Button title={label} aria-label={label} icon={<ExperimentOutlined />} style={{ width: 40, height: 40, flexShrink: 0 }} />
    </Popover>
  )
}
