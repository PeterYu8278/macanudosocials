// Inventory Management Page
import React, { useEffect, useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Table, Button, Tag, Space, Typography, Input, Select, Modal, Form, InputNumber, Dropdown, Checkbox, Upload, Row, Col, App, Divider, AutoComplete, DatePicker } from 'antd'
import dayjs from 'dayjs'
import { PlusOutlined, EditOutlined, DeleteOutlined, SearchOutlined, WarningOutlined, UploadOutlined, DownloadOutlined, MinusCircleOutlined, FilePdfOutlined, FileImageOutlined, EyeOutlined, ThunderboltOutlined, LoadingOutlined } from '@ant-design/icons'
import type { Cigar, Brand, InboundOrder, OutboundOrder, InventoryMovement, Event, Store } from '../../../types'
import type { UploadFile } from 'antd'
import { getCigars, createDocument, updateDocument, deleteDocument, COLLECTIONS, getAllOrders, getUsers, getBrands, getBrandById, getAllTransactions, getAllInboundOrders, getAllOutboundOrders, getAllInventoryMovements, createInboundOrder, deleteInboundOrder, updateInboundOrder, getInboundOrdersByReferenceNo, createOutboundOrder, deleteOutboundOrder, getEvents } from '../../../services/firebase/firestore'
import { getAllStores } from '../../../services/firebase/stores'
import ImageUpload from '../../../components/common/ImageUpload'
import { getModalTheme, getResponsiveModalConfig, getModalThemeStyles } from '../../../config/modalTheme'
import { useCloudinary } from '../../../hooks/useCloudinary'
import { useDetailDrawer } from '../../../hooks/useDetailDrawer'
import { useFirestoreQuery } from '../../../hooks/useFirestoreQuery'
import { analyzeCigarByName } from '../../../services/gemini/cigarRecognition'
import { CigarRatingBadge } from '../../../components/common/CigarRatingBadge'
import { getAggregatedCigarData, saveRecognitionToCigarDatabase, generateProductName, forceUpdateCigarDatabase, type AggregatedCigarData } from '../../../services/cigar/cigarDataAggregation'
import { collection, getDocs } from 'firebase/firestore'
import { db } from '../../../config/firebase'
import { GLOBAL_COLLECTIONS } from '../../../config/globalCollections'
import { reconcileOrderOutboundMovements } from '../../../utils/inventoryMovementReconciliation'

import { useAuthStore } from '../../../store/modules/auth'
const { Title } = Typography
const { Search } = Input
const { Option } = Select

const DEFAULT_CIGAR_IMAGE = 'data:image/svg+xml;base64,PHN2ZyB3aWR0aD0iODAiIGhlaWdodD0iODAiIHZpZXdCb3g9IjAgMCA4MCA4MCIgZmlsbD0ibm9uZSIgeG1sbnM9Imh0dHA6Ly93d3cudzMub3JnLzIwMDAvc3ZnIj4KPHJlY3Qgd2lkdGg9IjgwIiBoZWlnaHQ9IjgwIiBmaWxsPSIjMzMzMzMzIi8+Cjx0ZXh0IHg9IjQwIiB5PSI0MCIgZm9udC1mYW1pbHk9IkFyaWFsLCBzYW5zLXNlcmlmIiBmb250LXNpemU9IjE0IiBmaWxsPSIjNjY2NjY2IiB0ZXh0LWFuY2hvcj0ibWlkZGxlIiBkeT0iLjNlbSI+Q2lnYXI8L3RleHQ+Cjwvc3ZnPgo='

const AdminInventory: React.FC = () => {
  const { t } = useTranslation()
  const { user: currentUser, isSuperAdmin } = useAuthStore()
  const { modal, message } = App.useApp() // Use App.useApp() to get modal instance for React 19 support
  const { data: items, loading: listLoading, error: itemsError, refresh: refreshItems } = useFirestoreQuery<Cigar>(getCigars)
  const { data: orders, refresh: refreshOrders } = useFirestoreQuery<any>(() => getAllOrders(isSuperAdmin ? undefined : currentUser?.storeId), [isSuperAdmin, currentUser?.storeId])
  const { data: users, refresh: refreshUsers } = useFirestoreQuery<any>(getUsers)
  const { data: brandList, refresh: refreshBrandList } = useFirestoreQuery<Brand>(getBrands)
  const { data: transactions, refresh: refreshTransactions } = useFirestoreQuery<any>(() => getAllTransactions(isSuperAdmin ? undefined : currentUser?.storeId), [isSuperAdmin, currentUser?.storeId])
  const { data: events, refresh: refreshEvents } = useFirestoreQuery<Event>(() => getEvents(isSuperAdmin ? undefined : currentUser?.id) as Promise<Event[]>, [isSuperAdmin, currentUser?.id])
  const { data: stores, refresh: refreshStores } = useFirestoreQuery<Store>(getAllStores)
  const { data: inboundOrders, refresh: refreshInboundOrders } = useFirestoreQuery<InboundOrder>(() => getAllInboundOrders(isSuperAdmin ? undefined : currentUser?.storeId), [isSuperAdmin, currentUser?.storeId])
  const { data: outboundOrders, refresh: refreshOutboundOrders } = useFirestoreQuery<OutboundOrder>(() => getAllOutboundOrders(isSuperAdmin ? undefined : currentUser?.storeId), [isSuperAdmin, currentUser?.storeId])
  const { data: inventoryMovements, refresh: refreshInventoryMovements } = useFirestoreQuery<InventoryMovement>(() => getAllInventoryMovements(isSuperAdmin ? undefined : currentUser?.storeId), [isSuperAdmin, currentUser?.storeId])
  const effectiveInventoryMovements = useMemo(
    () => reconcileOrderOutboundMovements(inventoryMovements, orders),
    [inventoryMovements, orders]
  )
  const [loading, setLoading] = useState(false)
  const [creating, setCreating] = useState(false)
  const [editing, setEditing] = useState<Cigar | null>(null)
  const { item: deleting, open: deletingOpen, openDrawer: openDeleteCigar, closeDrawer: closeDeleteCigar } = useDetailDrawer<Cigar>()
  const [adjustingIn, setAdjustingIn] = useState<Cigar | null>(null)
  const [adjustingOut, setAdjustingOut] = useState<Cigar | null>(null)
  const [selectedRowKeys, setSelectedRowKeys] = useState<React.Key[]>([])
  const [form] = Form.useForm()
  const [adjForm] = Form.useForm()
  const [inForm] = Form.useForm()
  const [outForm] = Form.useForm()
  const [activeTab, setActiveTab] = useState<string>('list')
  // New architecture data
  const [viewingReference, setViewingReference] = useState<string | null>(null)
  const [viewingProductLogs, setViewingProductLogs] = useState<string | null>(null)
  const [imageList, setImageList] = useState<any[]>([])
  const [pagination, setPagination] = useState<{ current: number; pageSize: number }>({ current: 1, pageSize: 10 })
  const [cigarImages, setCigarImages] = useState<string[]>([]) // Cigar image list
  const [aiRecognizing, setAiRecognizing] = useState(false) // AI recognition status
  const [cigarDatabaseData, setCigarDatabaseData] = useState<AggregatedCigarData | null>(null) // Data read from cigar_database
  const [cigarDatabaseOptions, setCigarDatabaseOptions] = useState<string[]>([]) // cigar_database product name list
  const [inModalOpen, setInModalOpen] = useState(false)
  const [inStatsOpen, setInStatsOpen] = useState(false)
  const [outStatsOpen, setOutStatsOpen] = useState(false)
  const [outModalOpen, setOutModalOpen] = useState(false)
  const [outStatsExpandedKeys, setOutStatsExpandedKeys] = useState<React.Key[]>([])
  const [inStatsExpandedKeys, setInStatsExpandedKeys] = useState<React.Key[]>([])
  const [inLogsExpandedKeys, setInLogsExpandedKeys] = useState<React.Key[]>([])
  const [editingOrder, setEditingOrder] = useState<InboundOrder | null>(null)
  const [orderEditForm] = Form.useForm()
  const [inSearchKeyword, setInSearchKeyword] = useState('')
  const [inBrandFilter, setInBrandFilter] = useState<string | undefined>()
  const [outSearchKeyword, setOutSearchKeyword] = useState('')
  const [outBrandFilter, setOutBrandFilter] = useState<string | undefined>()
  const { item: deleteTargetOrder, open: deleteConfirmOpen, openDrawer: openDeleteOrder, closeDrawer: closeDeleteOrder } = useDetailDrawer<{ id: string; referenceNo: string; productCount: number }>()

  // File upload related
  const { upload: cloudinaryUpload, uploading: uploadingFile } = useCloudinary()
  const [attachmentFileList, setAttachmentFileList] = useState<UploadFile[]>([])
  const [uploadedAttachments, setUploadedAttachments] = useState<Array<{
    url: string
    type: 'pdf' | 'image'
    filename: string
    uploadedAt: Date
  }>>([])

  // Edit order attachment state
  const [editAttachmentFileList, setEditAttachmentFileList] = useState<UploadFile[]>([])
  const [editUploadedAttachments, setEditUploadedAttachments] = useState<Array<{
    url: string
    type: 'pdf' | 'image'
    filename: string
    uploadedAt: Date
  }>>([])

  const toDateSafe = (val: any): Date | null => {
    if (!val) return null
    let v: any = val
    if (v && typeof v.toDate === 'function') {
      v = v.toDate()
    }
    const d = v instanceof Date ? v : new Date(v)
    return isNaN(d.getTime()) ? null : d
  }

  const formatYMD = (d: Date | null): string => {
    if (!d) return '-'
    const y = d.getFullYear()
    const m = String(d.getMonth() + 1).padStart(2, '0')
    const day = String(d.getDate()).padStart(2, '0')
    return `${y}-${m}-${day}`
  }
  // 记录表分页大小（持久化）
  const [inPageSize, setInPageSize] = useState<number>(() => {
    try { return Number(localStorage.getItem('inventory_in_page_size') || 10) || 10 } catch { return 10 }
  })
  const [outPageSize, setOutPageSize] = useState<number>(() => {
    try { return Number(localStorage.getItem('inventory_out_page_size') || 10) || 10 } catch { return 10 }
  })

  // 品牌管理相关状态
  const [creatingBrand, setCreatingBrand] = useState(false)
  const [editingBrand, setEditingBrand] = useState<Brand | null>(null)
  const [deletingBrand, setDeletingBrand] = useState<Brand | null>(null)
  const [brandForm] = Form.useForm()

  const [keyword, setKeyword] = useState('')
  const [brandFilter, setBrandFilter] = useState<string | undefined>()
  const [originFilter, setOriginFilter] = useState<string | undefined>()
  const [strengthFilter, setStrengthFilter] = useState<string | undefined>()
  const [statusFilter, setStatusFilter] = useState<string | undefined>()
  const [visibleCols, setVisibleCols] = useState<Record<string, boolean>>({
    id: true,
    name: true,
    spec: true,
    price: true,
    stockStatus: true,
    action: true,
  })

  // 加载 cigar_database 产品名称列表
  useEffect(() => {
    const loadCigarDatabaseOptions = async () => {
      try {
        const cigarDbRef = collection(db, GLOBAL_COLLECTIONS.CIGAR_DATABASE);
        const snapshot = await getDocs(cigarDbRef);
        const productNames = snapshot.docs
          .map(doc => doc.data().productName as string)
          .filter(name => name && name.trim())
          .sort();
        setCigarDatabaseOptions(productNames);
      } catch (error) {
        // Silently fail
      }
    };
    loadCigarDatabaseOptions();
  }, []);

  useEffect(() => {
    // 初始化分页（本地持久化）
    try {
      const raw = localStorage.getItem('inventory_pagination')
      if (raw) {
        const saved = JSON.parse(raw)
        if (saved?.current && saved?.pageSize) {
          setPagination({ current: Number(saved.current) || 1, pageSize: Number(saved.pageSize) || 10 })
        }
      }
    } catch { }
  }, [])

  // 统一处理编辑时的数据加载
  useEffect(() => {
    if (!editing) {
      // 重置状态
      setCigarDatabaseData(null)
      return
    }

    // 加载产品数据和 cigar_database 数据
    const loadEditData = async () => {
      try {
        // 从 cigar_database 加载聚合数据（需要 brand 和 name 都存在）
        if (!editing.brand || !editing.name) {
          // 如果缺少必要字段，直接使用产品文档的数据
          setTimeout(() => {
            form.setFieldsValue({
              name: editing.name || '',
              brand: editing.brand || '',
              origin: editing.origin || '',
              size: editing.size || '',
              strength: editing.strength || '',
              price: editing.price || 0,
              reserved: editing.inventory?.reserved ?? 0,
              description: editing.description || '',
              wrapper: editing.construction?.wrapper || '',
              binder: editing.construction?.binder || '',
              filler: editing.construction?.filler || '',
              footTasteNotes: editing.tastingNotes?.foot || [],
              bodyTasteNotes: editing.tastingNotes?.body || [],
              headTasteNotes: editing.tastingNotes?.head || [],
              tags: editing.metadata?.tags || [],
              rating: editing.metadata?.rating || null,
            })
            setCigarImages(editing.images || [])
          }, 0)
          return
        }

        const productName = generateProductName(editing.brand, editing.name)
        const aggregatedData = await getAggregatedCigarData(productName)
        setCigarDatabaseData(aggregatedData)

        // 使用 setTimeout 确保 Modal 已经打开，Form 已经渲染
        setTimeout(() => {
          // 优先使用 cigar_database 的数据，如果没有则使用现有数据
          form.setFieldsValue({
            name: editing.name,
            brand: aggregatedData?.brand || editing.brand,
            origin: aggregatedData?.origin || editing.origin,
            size: editing.size,
            strength: aggregatedData?.strength || editing.strength,
            price: editing.price,
            reserved: editing.inventory?.reserved ?? 0,
            description: aggregatedData?.description || editing.description || '',
            wrapper: aggregatedData?.wrappers?.[0]?.value || editing.construction?.wrapper || '',
            binder: aggregatedData?.binders?.[0]?.value || editing.construction?.binder || '',
            filler: aggregatedData?.fillers?.[0]?.value || editing.construction?.filler || '',
            footTasteNotes: aggregatedData?.footTasteNotes?.map(item => item.value) || editing.tastingNotes?.foot || [],
            bodyTasteNotes: aggregatedData?.bodyTasteNotes?.map(item => item.value) || editing.tastingNotes?.body || [],
            headTasteNotes: aggregatedData?.headTasteNotes?.map(item => item.value) || editing.tastingNotes?.head || [],
            tags: aggregatedData?.flavorProfile?.map(item => item.value) || editing.metadata?.tags || [],
            rating: aggregatedData?.rating ?? editing.metadata?.rating ?? null,
          })
          setCigarImages(editing.images || [])
        }, 0)
      } catch (error) {
        // 如果加载失败，使用产品文档的数据
        console.error('加载 cigar_database 数据失败:', error)
        setCigarDatabaseData(null)

        setTimeout(() => {
          form.setFieldsValue({
            name: editing.name,
            brand: editing.brand,
            origin: editing.origin,
            size: editing.size,
            strength: editing.strength,
            price: editing.price,
            reserved: editing.inventory?.reserved ?? 0,
            description: editing.description || '',
            wrapper: editing.construction?.wrapper || '',
            binder: editing.construction?.binder || '',
            filler: editing.construction?.filler || '',
            footTasteNotes: editing.tastingNotes?.foot || [],
            bodyTasteNotes: editing.tastingNotes?.body || [],
            headTasteNotes: editing.tastingNotes?.head || [],
            tags: editing.metadata?.tags || [],
            rating: editing.metadata?.rating || null,
          })
          setCigarImages(editing.images || [])
        }, 0)
      }
    }

    loadEditData()
  }, [editing, form])

  // 当 cigarDatabaseData 变化时，确保品牌字段被设置到表单中
  useEffect(() => {
    if (cigarDatabaseData?.brand) {
      form.setFieldsValue({ brand: cigarDatabaseData.brand })
    }
  }, [cigarDatabaseData, form])

  const getStrengthColor = (strength?: string) => {
    if (!strength) return 'default'
    switch (strength.toLowerCase()) {
      case 'mild': return 'green'
      case 'mild-medium': return 'lime'
      case 'medium': return 'orange'
      case 'medium-full': return 'volcano'
      case 'full': return 'red'
      default: return 'default'
    }
  }

  const getStrengthText = (strength?: string) => {
    if (!strength) return t('profile.unknown')
    switch (strength.toLowerCase()) {
      case 'mild': return t('shop.mild')
      case 'mild-medium': return t('shop.mildMedium')
      case 'medium': return t('shop.medium')
      case 'medium-full': return t('shop.mediumFull')
      case 'full': return t('shop.full')
      default: return strength // Fallback to raw string
    }
  }

  // 标准雪茄规格名称列表
  const STANDARD_VITOLAS = [
    'Cigarillo', 'Perfecto', 'Rerla', 'Petit Robusto', 'Petit Edmundo', 'Robusto',
    'Torpedo', 'Churchill', 'Corona', 'Petit Corona',
    'Toro', 'Gordo', 'Lancero', 'Panatela', 'Belicoso', 'Pyramid',
    'Culebra', 'Double Corona', 'Short Robusto', 'Toro Extra',
    'Corona Gorda', 'Lonsdale', 'Toro Grande', 'Nub', 'Figurado', 'Salomon',
    'Diadema', 'Presidente', 'Gran Corona',
    'Laguito No.1', 'Laguito No.2', 'Laguito No.3',
    'Especiales', 'Especiales No.2', 'Robusto Extra', 'Toro Grande', 'Gigante'
  ]

  // 提取标准规格名称的辅助函数
  const extractStandardVitola = (text: string): string | null => {
    if (!text) return null

    const normalizedText = text.trim()

    // 特殊处理：Club 10 通常是 Cigarillo
    if (normalizedText.toLowerCase().includes('club') && normalizedText.toLowerCase().includes('10')) {
      return 'Cigarillo'
    }

    // 检查是否完全匹配标准规格名称（不区分大小写）
    for (const vitola of STANDARD_VITOLAS) {
      if (normalizedText.toLowerCase() === vitola.toLowerCase()) {
        return vitola
      }
    }

    // 检查是否包含标准规格名称（不区分大小写）
    for (const vitola of STANDARD_VITOLAS) {
      const regex = new RegExp(`\\b${vitola}\\b`, 'i')
      if (regex.test(normalizedText)) {
        return vitola
      }
    }

    // 如果找不到标准规格，返回null
    return null
  }

  const getStatusColor = (status: string) => {
    switch (status) {
      case 'negative': return 'red'
      case 'normal': return 'green'
      case 'low': return 'orange'
      case 'critical': return 'red'
      default: return 'default'
    }
  }

  const getStatusText = (status: string) => {
    switch (status) {
      case 'negative': return t('inventory.stockNegative')
      case 'normal': return t('inventory.stockNormal')
      case 'low': return t('inventory.stockLow')
      case 'critical': return t('inventory.stockCritical')
      default: return t('profile.unknown')
    }
  }


  // 商品是否存在入/出库记录（存在则禁止删除）
  const hasInventoryHistory = (cigarId: string | undefined) => {
    if (!cigarId) return false
    return inventoryMovements.some(m => m.cigarId === cigarId)
  }

  // Real-time stock calculation based on inbound/outbound logs (cigars only)
  const stockByCigarId = useMemo(() => {
    // Calculation: sum(IN) - sum(OUT) without intermediate zeroing to avoid order dependency
    const map = new Map<string, number>()

    for (const movement of effectiveInventoryMovements) {
      const id = movement.cigarId
      if (!id) continue

      // Only count cigars
      const itemType = movement.itemType
      if (itemType && itemType !== 'cigar') continue

      // Filter out movements from cancelled orders
      if (movement.inboundOrderId) {
        const order = inboundOrders.find(o => o.id === movement.inboundOrderId)
        if (order && order.status === 'cancelled') continue
      }
      if (movement.outboundOrderId) {
        const order = outboundOrders.find(o => o.id === movement.outboundOrderId)
        if (order && order.status === 'cancelled') continue
      }

      const type = movement.type
      const qty = Number.isFinite(movement.quantity) ? Math.floor(movement.quantity) : 0
      const prev = map.get(id) ?? 0
      if (type === 'in') {
        map.set(id, prev + qty)
      } else if (type === 'out') {
        map.set(id, prev - qty)
      }
    }

    return map
  }, [effectiveInventoryMovements, inboundOrders, outboundOrders])

  const getComputedStock = (cigarId?: string) => {
    if (!cigarId) return 0
    const net = stockByCigarId.get(cigarId) ?? 0
    // Allow negative stock to help admins spot anomalies
    return net
  }

  // Total in/out per product (cigars only)
  const totalsByCigarId = useMemo(() => {
    const map = new Map<string, { totalIn: number; totalOut: number }>()

    for (const movement of effectiveInventoryMovements) {
      const id = movement.cigarId
      if (!id) continue

      // Only count cigars
      const itemType = movement.itemType
      if (itemType && itemType !== 'cigar') continue

      // Filter cancelled orders
      if (movement.inboundOrderId) {
        const order = inboundOrders.find(o => o.id === movement.inboundOrderId)
        if (order && order.status === 'cancelled') continue
      }
      if (movement.outboundOrderId) {
        const order = outboundOrders.find(o => o.id === movement.outboundOrderId)
        if (order && order.status === 'cancelled') continue
      }

      const type = movement.type
      const qtyRaw = movement.quantity ?? 0
      const qty = Number.isFinite(qtyRaw) ? Math.max(0, Math.floor(Math.abs(qtyRaw))) : 0
      const prev = map.get(id) || { totalIn: 0, totalOut: 0 }
      if (type === 'in') prev.totalIn += qty
      else if (type === 'out') prev.totalOut += qty
      map.set(id, prev)
    }

    return map
  }, [effectiveInventoryMovements, inboundOrders, outboundOrders])

  const getTotals = (cigarId?: string) => {
    if (!cigarId) return { totalIn: 0, totalOut: 0 }
    return totalsByCigarId.get(cigarId) || { totalIn: 0, totalOut: 0 }
  }

  const filtered = useMemo(() => {
    console.log('[Inventory] items.length=', items.length, 'filters:', { keyword, brandFilter, originFilter, statusFilter, strengthFilter })
    return items.filter(i => {
      const kw = keyword.trim().toLowerCase()
      const passKw = !kw || i.name?.toLowerCase().includes(kw) || i.brand?.toLowerCase().includes(kw)
      const passBrand = !brandFilter || i.brand === brandFilter
      const passOrigin = !originFilter || i.origin === originFilter
      const minStock = ((i as any)?.inventory?.minStock ?? 0)
      const totals = getTotals(i.id)
      const computedStock = totals.totalIn - totals.totalOut
      const status = (computedStock <= minStock) ? 'critical' : (computedStock <= (minStock * 1.5)) ? 'low' : 'normal'
      const passStatus = !statusFilter || status === statusFilter
      const passStrength = !strengthFilter || i.strength === strengthFilter
      return passKw && passBrand && passOrigin && passStatus && passStrength
    })
  }, [items, keyword, brandFilter, originFilter, strengthFilter, statusFilter, stockByCigarId])

  // 过滤条件变化时重置到第1页
  useEffect(() => {
    setPagination(p => ({ ...p, current: 1 }))
  }, [keyword, brandFilter, originFilter, strengthFilter, statusFilter])

  const columnsAll = [
    {
      title: t('inventory.cigarName'),
      dataIndex: 'name',
      key: 'name',
      width: 260,
      render: (name: string, record: any) => {
        // 根据品牌名称找到对应的品牌信息
        const brandInfo = brandList.find(brand => brand.name === record.brand)
        const productImage = record.images && record.images.length > 0 ? record.images[0] : DEFAULT_CIGAR_IMAGE
        return (
          <div style={{ display: 'flex', gap: '12px', alignItems: 'flex-start' }}>
            {/* 产品图像 */}
            <div style={{ position: 'relative', flexShrink: 0 }}>
              <img
                src={productImage}
                alt={name}
                style={{
                  width: '60px',
                  height: '100px',
                  objectFit: 'cover',
                  borderRadius: '8px',
                  border: '2px solid rgba(244, 175, 37, 0.3)',
                  background: 'rgba(255, 255, 255, 0.05)'
                }}
              />
              <CigarRatingBadge rating={record.metadata?.rating} size="small" />
            </div>
            <div style={{ flex: 1, minWidth: 0 }}>
              <div style={{ fontWeight: 'bold' }}>{name}</div>
              <div style={{ fontSize: '12px', color: 'rgba(255, 255, 255, 0.6)', display: 'flex', alignItems: 'center', gap: 4 }}>
                <span>{record.brand}</span>
                {brandInfo?.country && (
                  <span style={{ color: 'rgba(255, 255, 255, 0.6)' }}>- {brandInfo.country}</span>
                )}
                <span>- {record.origin}</span>
              </div>
            </div>
          </div>
        )
      },
    },
    {
      title: t('inventory.spec'),
      key: 'spec',
      width: 50,
      render: (_: any, record: any) => (
        <div>
          <div>{record.size}</div>
          <Tag color={getStrengthColor(record.strength)}>
            {getStrengthText(record.strength)}
          </Tag>
        </div>
      ),
    },
    {
      title: t('inventory.price'),
      dataIndex: 'price',
      key: 'price',
      width: 50,
      render: (price: number) => `RM${price}`,
      sorter: (a: any, b: any) => a.price - b.price,
    },
    {
      title: t('inventory.stockStatus'),
      key: 'stockStatus',
      width: 150,
      render: (_: any, record: any) => {
        const currentStock = getComputedStock((record as any)?.id)
        const isNegative = currentStock < 0

        const { totalIn, totalOut } = getTotals((record as any)?.id)

        return (
          <div style={{ display: 'flex', gap: 12 }}>
            {/* 左侧：总入库和总出库 */}
            <div style={{ flex: 1 }}>
              <div style={{ marginBottom: 4, fontSize: 13 }}>
                <span style={{ color: '#52c41a' }}>
                  {t('inventory.totalIn')}: {totalIn}
                </span>
              </div>

              {/* 分隔线 */}
              <div style={{ borderTop: '1px solid #e8e8e8', margin: '4px 0' }} />

              <div style={{ marginTop: 4 }}>
                <span style={{ color: '#ff4d4f', fontSize: 13 }}>
                  {t('inventory.totalOut')}: {totalOut}
                </span>
              </div>
            </div>

            {/* 右侧：当前库存（大字体，跨越两行） */}
            <div style={{
              display: 'flex',
              flexDirection: 'column',
              alignItems: 'center',
              justifyContent: 'center',
              minWidth: 80,
              borderLeft: '2px solid #e8e8e8',
              paddingLeft: 12
            }}>
              <div style={{
                fontSize: 11,
                color: 'rgba(255, 255, 255, 0.6)',
                marginBottom: 2
              }}>
                {t('inventory.currentStock')}
              </div>
              <div style={{
                fontSize: 24,
                fontWeight: 700,
                color: isNegative ? '#ff4d4f' : '#1890ff',
                lineHeight: 1
              }}>
                {isNegative && <WarningOutlined style={{ marginRight: 4, fontSize: 16 }} />}
                {currentStock}
              </div>
              <div style={{ marginTop: 6 }}>
                <Tag color={getStatusColor(
                  currentStock < 0 ? 'negative' :
                    currentStock <= ((record as any)?.inventory?.minStock ?? 0) ? 'critical' :
                      currentStock <= (((record as any)?.inventory?.minStock ?? 0) * 1.5) ? 'low' :
                        'normal'
                )} style={{ fontSize: 11 }}>
                  {getStatusText(
                    currentStock < 0 ? 'negative' :
                      currentStock <= ((record as any)?.inventory?.minStock ?? 0) ? 'critical' :
                        currentStock <= (((record as any)?.inventory?.minStock ?? 0) * 1.5) ? 'low' :
                          'normal'
                  )}
                </Tag>
              </div>
            </div>
          </div>
        )
      },
    },
    {
      title: t('inventory.actions'),
      key: 'action',
      width: 100,
      render: (_: any, record: any) => (
        <Space size="small" style={{ justifyContent: 'center', width: '100%' }}>
          <Button type="link" icon={<EditOutlined />} size="small" onClick={() => {
            setEditing(record)
          }}>
          </Button>
          <Button type="link" icon={<SearchOutlined />} size="small" onClick={() => {
            setViewingProductLogs((record as any)?.id)
          }}>
          </Button>
        </Space>
      ),
    },
  ]
  const columns = columnsAll.filter(c => visibleCols[c.key as string] !== false)

  const logColumns = [
    { title: t('inventory.time'), dataIndex: 'createdAt', key: 'createdAt', render: (v: any) => formatYMD(toDateSafe(v)) },
    {
      title: t('inventory.product'),
      dataIndex: 'cigarId',
      key: 'cigarId',
      render: (id: string, record: any) => {
        // 优先使用保存的雪茄名称，避免雪茄被删除后无法显示
        return record.cigarName || items.find(i => i.id === id)?.name || id
      }
    },
    { title: t('inventory.type'), dataIndex: 'type', key: 'type', render: (type: string) => type === 'in' ? t('inventory.stockIn') : t('inventory.stockOut') },
    { title: t('inventory.quantity'), dataIndex: 'quantity', key: 'quantity' },
    {
      title: t('inventory.referenceNo'),
      dataIndex: 'referenceNo',
      key: 'referenceNo',
      render: (v: any) => v ? (
        <Button type="link" onClick={() => setViewingReference(v)}>
          {v}
        </Button>
      ) : '-'
    },
    { title: t('inventory.reason'), dataIndex: 'reason', key: 'reason', render: (v: any) => v || '-' },
    { title: t('inventory.operator'), dataIndex: 'operatorId', key: 'operatorId', render: (v: any) => v || '-' },
  ]

  const inLogs = useMemo(() => {
    return inventoryMovements
      .filter(m => m.type === 'in')
      .map(m => {
        // Get operator info
        let operatorId = 'system'
        let price = m.unitPrice

        if (m.inboundOrderId) {
          const order = inboundOrders.find(o => o.id === m.inboundOrderId)
          if (order) {
            operatorId = order.operatorId
            if (price === undefined || price === null || price === 0) {
              const item = order.items.find(it => it.cigarId === m.cigarId)
              if (item?.unitPrice) price = item.unitPrice
            }
          }
        }

        if ((price === undefined || price === null || price === 0) && m.referenceNo) {
          const legacyOrder = orders.find(o => o.id === m.referenceNo)
          if (legacyOrder) {
            const item = legacyOrder.items?.find((it: any) => it.id === m.cigarId || it.cigarId === m.cigarId)
            if (item?.price) price = item.price
            else if (item?.unitPrice) price = item.unitPrice
          }
        }

        return {
          id: m.id,
          cigarId: m.cigarId,
          cigarName: m.cigarName,
          itemType: m.itemType,
          type: m.type,
          quantity: m.quantity,
          unitPrice: price,
          referenceNo: m.referenceNo,
          reason: m.reason,
          operatorId: operatorId,
          createdAt: m.createdAt
        }
      })
  }, [inventoryMovements, inboundOrders, orders])

  const outLogs = useMemo(() => {
    return inventoryMovements
      .filter(m => m.type === 'out')
      .map(m => {
        // Get operator info
        let operatorId = 'system'
        let price = m.unitPrice

        if (m.outboundOrderId) {
          const order = outboundOrders.find(o => o.id === m.outboundOrderId)
          if (order) {
            operatorId = order.operatorId
            if (price === undefined || price === null || price === 0) {
              const item = order.items.find(it => it.cigarId === m.cigarId)
              if (item?.unitPrice) price = item.unitPrice
            }
          }
        }

        if ((price === undefined || price === null || price === 0) && m.referenceNo) {
          const legacyOrder = orders.find(o => o.id === m.referenceNo)
          if (legacyOrder) {
            const item = legacyOrder.items?.find((it: any) => it.id === m.cigarId || it.cigarId === m.cigarId)
            if (item?.price) price = item.price
            else if (item?.unitPrice) price = item.unitPrice
          }
        }

        return {
          id: m.id,
          cigarId: m.cigarId,
          cigarName: m.cigarName,
          itemType: m.itemType,
          type: m.type,
          quantity: m.quantity,
          unitPrice: price,
          referenceNo: m.referenceNo,
          reason: m.reason,
          operatorId: operatorId,
          createdAt: m.createdAt
        }
      })
  }, [inventoryMovements, outboundOrders, orders])

  // Filter inbound logs
  const filteredInLogs = useMemo(() => {
    return inLogs.filter(log => {
      // Brand filter
      if (inBrandFilter) {
        const cigar = items.find(c => c.id === log.cigarId)
        if (cigar?.brand !== inBrandFilter) return false
      }

      // Keyword search
      if (inSearchKeyword) {
        const kw = inSearchKeyword.toLowerCase()
        const cigar = items.find(c => c.id === log.cigarId)
        const cigarName = cigar?.name?.toLowerCase() || ''
        const reason = ((log as any).reason || '').toLowerCase()
        const refNo = ((log as any).referenceNo || '').toLowerCase()

        if (!cigarName.includes(kw) && !reason.includes(kw) && !refNo.includes(kw)) {
          return false
        }
      }

      return true
    })
  }, [inLogs, inSearchKeyword, inBrandFilter, items])

  // Calculate financial match status for inbound orders
  const getInboundReferenceMatchStatus = (referenceNo: string) => {
    if (!referenceNo) return { matched: 0, total: 0, status: 'none' }

    // Get total value from inboundOrders
    const order = inboundOrders.find(o => o.referenceNo === referenceNo)
    const totalValue = order ? (order.totalValue || order.items.reduce((sum, item) => {
      return sum + (Number(item.quantity || 0) * Number(item.unitPrice || 0))
    }, 0)) : 0

    // Find matching transactions for this referenceNo
    const matchedAmount = transactions
      .filter((t: any) => {
        const relatedOrders = (t as any)?.relatedOrders || []
        return relatedOrders.some((ro: any) => ro.orderId === referenceNo)
      })
      .reduce((sum, t: any) => {
        const relatedOrders = (t as any)?.relatedOrders || []
        const refMatch = relatedOrders.find((ro: any) => ro.orderId === referenceNo)
        return sum + (refMatch ? Number(refMatch.amount || 0) : 0)
      }, 0)

    if (totalValue === 0) {
      return { matched: matchedAmount, total: 0, status: 'none' }
    }

    const matchPercentage = (matchedAmount / totalValue) * 100

    if (matchPercentage >= 99) {
      return { matched: matchedAmount, total: totalValue, status: 'fully' }
    } else if (matchedAmount > 0) {
      return { matched: matchedAmount, total: totalValue, status: 'partial' }
    } else {
      return { matched: matchedAmount, total: totalValue, status: 'none' }
    }
  }

  // Group inbound logs by reference No (using inboundOrders directly)
  const inLogsGroupedByReference = useMemo(() => {
    return inboundOrders
      .filter(order => {
        // Brand filter
        if (inBrandFilter) {
          const hasBrand = order.items.some(item => {
            const cigar = items.find(c => c.id === item.cigarId)
            return cigar?.brand === inBrandFilter
          })
          if (!hasBrand) return false
        }

        // Keyword search
        if (inSearchKeyword) {
          const kw = inSearchKeyword.toLowerCase()
          const refNo = order.referenceNo.toLowerCase()
          const reason = order.reason.toLowerCase()
          const hasMatchingProduct = order.items.some(item =>
            item.cigarName.toLowerCase().includes(kw)
          )

          if (!refNo.includes(kw) && !reason.includes(kw) && !hasMatchingProduct) {
            return false
          }
        }

        return true
      })
      .map(order => ({
        id: order.id, // Unique ID for key
        referenceNo: order.referenceNo,
        date: toDateSafe(order.createdAt),
        reason: order.reason,
        logs: order.items.map(item => ({
          id: `${order.id}_${item.cigarId}`,
          cigarId: item.cigarId,
          cigarName: item.cigarName,
          itemType: item.itemType,
          quantity: item.quantity,
          unitPrice: item.unitPrice,
          createdAt: order.createdAt,
          reason: order.reason,
          attachments: order.attachments
        })),
        totalQuantity: order.totalQuantity,
        totalValue: order.totalValue,
        productCount: order.items.length,
        attachments: order.attachments
      }))
      .sort((a, b) => {
        const dateA = a.date?.getTime() || 0;
        const dateB = b.date?.getTime() || 0;
        return dateB - dateA;
      });
  }, [inboundOrders, items, inSearchKeyword, inBrandFilter])

  // Filter outbound logs
  const filteredOutLogs = useMemo(() => {
    return outLogs.filter(log => {
      // Brand filter
      if (outBrandFilter) {
        const cigar = items.find(c => c.id === log.cigarId)
        if (cigar?.brand !== outBrandFilter) return false
      }

      // Keyword search
      if (outSearchKeyword) {
        const kw = outSearchKeyword.toLowerCase()
        const cigar = items.find(c => c.id === log.cigarId)
        const cigarName = cigar?.name?.toLowerCase() || ''
        const reason = ((log as any).reason || '').toLowerCase()
        const refNo = ((log as any).referenceNo || '').toLowerCase()

        if (!cigarName.includes(kw) && !reason.includes(kw) && !refNo.includes(kw)) {
          return false
        }
      }

      return true
    })
  }, [outLogs, outSearchKeyword, outBrandFilter, items])

  // Inbound statistics (with brand and product details)
  const inStats = useMemo(() => {
    const brandMap = new Map<string, {
      quantity: number;
      records: number;
      totalValue: number;
      products: Map<string, { cigar: any; quantity: number; records: number; totalValue: number }>
    }>()

    inLogs.forEach(log => {
      const cigar = items.find(c => c.id === log.cigarId)
      // 如果找不到雪茄且不是雪茄类型，使用类型名称作为品牌
      let brand = cigar?.brand
      if (!brand) {
        if (log.itemType && log.itemType !== 'cigar') {
          brand = t(`inventory.itemType${log.itemType.charAt(0).toUpperCase() + log.itemType.slice(1)}`)
        } else {
          brand = 'Unknown'
        }
      }

      const quantity = Number(log.quantity || 0)
      const unitPrice = Number((log as any).unitPrice || 0)
      const value = quantity * unitPrice

      if (!brandMap.has(brand)) {
        brandMap.set(brand, {
          quantity: 0,
          records: 0,
          totalValue: 0,
          products: new Map()
        })
      }

      const brandData = brandMap.get(brand)!
      brandData.quantity += quantity
      brandData.records += 1
      brandData.totalValue += value

      // 产品级别统计 - 即使 cigar 不在 items 列表中也记录（例如已删除或特殊项目）
      const productKey = log.cigarId || 'unknown'
      if (!brandData.products.has(productKey)) {
        brandData.products.set(productKey, {
          cigar: cigar || { id: log.cigarId, name: log.cigarName || log.cigarId, brand: brand },
          quantity: 0,
          records: 0,
          totalValue: 0
        })
      }
      const productData = brandData.products.get(productKey)!
      productData.quantity += quantity
      productData.records += 1
      productData.totalValue += value
    })

    return Array.from(brandMap.entries())
      .map(([brand, data]) => ({
        brand,
        quantity: data.quantity,
        records: data.records,
        totalValue: data.totalValue,
        products: Array.from(data.products.values()).sort((a, b) => b.quantity - a.quantity)
      }))
      .sort((a, b) => b.quantity - a.quantity)
  }, [inLogs, items])

  // 出库统计
  const outStats = useMemo(() => {
    const brandMap = new Map<string, {
      quantity: number;
      records: number;
      totalValue: number;
      products: Map<string, { cigar: any; quantity: number; records: number; totalValue: number }>
    }>()

    outLogs.forEach(log => {
      const cigar = items.find(c => c.id === log.cigarId)
      // 如果找不到雪茄且不是雪茄类型，使用类型名称作为品牌
      let brand = cigar?.brand
      if (!brand) {
        if (log.itemType && log.itemType !== 'cigar') {
          brand = t(`inventory.itemType${log.itemType.charAt(0).toUpperCase() + log.itemType.slice(1)}`)
        } else {
          brand = 'Unknown'
        }
      }

      const quantity = Number(log.quantity || 0)
      const unitPrice = Number((log as any).unitPrice || 0)
      const value = quantity * unitPrice

      if (!brandMap.has(brand)) {
        brandMap.set(brand, {
          quantity: 0,
          records: 0,
          totalValue: 0,
          products: new Map()
        })
      }

      const brandData = brandMap.get(brand)!
      brandData.quantity += quantity
      brandData.records += 1
      brandData.totalValue += value

      // 产品级别统计 - 即使 cigar 不在 items 列表中也记录（例如已删除或特殊项目）
      const productKey = log.cigarId || 'unknown'
      if (!brandData.products.has(productKey)) {
        brandData.products.set(productKey, {
          cigar: cigar || { id: log.cigarId, name: log.cigarName || log.cigarId, brand: brand },
          quantity: 0,
          records: 0,
          totalValue: 0
        })
      }
      const productData = brandData.products.get(productKey)!
      productData.quantity += quantity
      productData.records += 1
      productData.totalValue += value
    })

    return Array.from(brandMap.entries())
      .map(([brand, data]) => ({
        brand,
        quantity: data.quantity,
        records: data.records,
        totalValue: data.totalValue,
        products: Array.from(data.products.values()).sort((a, b) => b.quantity - a.quantity)
      }))
      .sort((a, b) => b.quantity - a.quantity)
  }, [outLogs, items])

  // 按单号分组的入库记录
  const referenceGroups = useMemo(() => {
    const groups: Record<string, any[]> = {}
    inLogs.forEach(log => {
      const refNo = (log as any).referenceNo
      if (refNo) {
        if (!groups[refNo]) {
          groups[refNo] = []
        }
        groups[refNo].push(log)
      }
    })
    return groups
  }, [inLogs])

  // 当前查看的单号相关记录
  const currentReferenceLogs = useMemo(() => {
    if (!viewingReference) return []
    return referenceGroups[viewingReference] || []
  }, [viewingReference, referenceGroups])

  // 当前查看的单号关联的订单
  const currentReferenceOrder = useMemo(() => {
    if (!viewingReference) return null
    return inboundOrders.find(o => o.referenceNo === viewingReference) ||
      outboundOrders.find(o => o.referenceNo === viewingReference)
  }, [viewingReference, inboundOrders, outboundOrders])

  // 当前查看的产品相关记录
  const currentProductLogs = useMemo(() => {
    if (!viewingProductLogs) return []

    return inventoryMovements
      .filter((movement: InventoryMovement) => movement.cigarId === viewingProductLogs)
      .map((movement: InventoryMovement) => {
        // 获取操作人信息（从关联的订单中获取）
        let operatorId = 'system'
        let price = movement.unitPrice

        if (movement.inboundOrderId) {
          const order = inboundOrders.find(o => o.id === movement.inboundOrderId)
          if (order) {
            operatorId = order.operatorId
            // 如果日志本身没存单价，尝试从入库单中查找
            if (price === undefined || price === null || price === 0) {
              const item = order.items.find(it => it.cigarId === movement.cigarId)
              if (item?.unitPrice) price = item.unitPrice
            }
          }
        } else if (movement.outboundOrderId) {
          const order = outboundOrders.find(o => o.id === movement.outboundOrderId)
          if (order) {
            operatorId = order.operatorId
            // 如果日志本身没存单价，尝试从出库单中查找
            if (price === undefined || price === null || price === 0) {
              const item = order.items.find(it => it.cigarId === movement.cigarId)
              if (item?.unitPrice) price = item.unitPrice
            }
          }
        }

        // 如果还是没找到单价（可能是旧版数据只有 referenceNo），尝试从 orders 中查找
        if ((price === undefined || price === null || price === 0) && movement.referenceNo) {
          const legacyOrder = orders.find(o => o.id === movement.referenceNo)
          if (legacyOrder) {
            const item = legacyOrder.items?.find((it: any) => it.id === movement.cigarId || it.cigarId === movement.cigarId)
            if (item?.price) price = item.price
            else if (item?.unitPrice) price = item.unitPrice
          }
        }

        return {
          id: movement.id,
          cigarId: movement.cigarId,
          cigarName: movement.cigarName,
          itemType: movement.itemType,
          type: movement.type,
          quantity: movement.quantity,
          unitPrice: price,
          referenceNo: movement.referenceNo,
          reason: movement.reason,
          operatorId: operatorId,
          createdAt: movement.createdAt,
          inboundOrderId: movement.inboundOrderId,
          outboundOrderId: movement.outboundOrderId
        }
      })
      .sort((a, b) => {
        const dateA = a.createdAt?.getTime?.() || 0
        const dateB = b.createdAt?.getTime?.() || 0
        return dateB - dateA
      })
  }, [viewingProductLogs, inventoryMovements, inboundOrders, outboundOrders])

  const outFromOrders = useMemo(() => {
    // 将订单按商品拆分为出库行
    const userMap = new Map(users.map((u: any) => [u.id, u]))
    const cigarMap = new Map(items.map((c: any) => [c.id, c]))
    const rows: any[] = []
    for (const o of orders) {
      const createdAt = (o as any).createdAt
      const user = userMap.get(o.userId)
      const source = (o as any).source?.type || 'direct'
      for (const it of (o.items || [])) {
        const cigar = cigarMap.get(it.cigarId)
        rows.push({
          id: `${o.id}_${it.cigarId}`,
          orderId: o.id,
          createdAt,
          user: user ? `${user.displayName} ${(user as any)?.profile?.phone || user.email}` : o.userId,
          cigarName: cigar ? cigar.name : it.cigarId,
          quantity: it.quantity,
          source,
        })
      }
    }
    // 按时间倒序
    return rows.sort((a, b) => {
      const da = toDateSafe(a.createdAt)?.getTime() || 0
      const db = toDateSafe(b.createdAt)?.getTime() || 0
      return db - da
    })
  }, [orders, users, items])

  const outOrderColumns = [
    { title: t('inventory.time'), dataIndex: 'createdAt', key: 'createdAt', render: (v: any) => formatYMD(toDateSafe(v)) },
    { title: t('inventory.orderId'), dataIndex: 'orderId', key: 'orderId' },
    { title: t('inventory.user'), dataIndex: 'user', key: 'user' },
    { title: t('inventory.product'), dataIndex: 'cigarName', key: 'cigarName' },
    { title: t('inventory.quantity'), dataIndex: 'quantity', key: 'quantity' },
    { title: t('inventory.source'), dataIndex: 'source', key: 'source', render: (s: string) => s === 'event' ? t('inventory.event') : t('inventory.directSale') },
  ]

  const isMobile = typeof window !== 'undefined' ? window.matchMedia('(max-width: 768px)').matches : false

  // 统一的出库列表：订单出库 + 手动出库
  const unifiedOutRows = useMemo(() => {
    const userMap = new Map(users.map((u: any) => [u.id, u]))
    const cigarMap = new Map(items.map((c: any) => [c.id, c]))
    const rows: any[] = []
    // 来自订单的出库
    for (const o of orders) {
      const createdAt = (o as any).createdAt
      const user = userMap.get(o.userId)
      const source = (o as any).source?.type || 'direct'
      for (const it of (o.items || [])) {
        const cigar = cigarMap.get(it.cigarId)

        // 应用品牌筛选
        if (outBrandFilter && cigar?.brand !== outBrandFilter) continue

        // 应用搜索筛选
        if (outSearchKeyword) {
          const kw = outSearchKeyword.toLowerCase()
          const cigarName = cigar?.name?.toLowerCase() || ''
          const userName = user ? `${user.displayName} ${(user as any)?.profile?.phone || user.email}`.toLowerCase() : o.userId.toLowerCase()
          const orderId = o.id.toLowerCase()

          if (!cigarName.includes(kw) && !userName.includes(kw) && !orderId.includes(kw)) {
            continue
          }
        }

        // 查找对应的出库订单（通过订单ID匹配出库订单的referenceNo）
        const outboundOrder = outboundOrders.find((outOrder: any) => outOrder.referenceNo === o.id)
        const eventId = (o as any).source?.eventId
        rows.push({
          id: `order_${o.id}_${it.cigarId}`,
          createdAt,
          orderId: o.id,
          referenceNo: undefined,
          outboundOrderId: outboundOrder?.id, // 添加出库订单ID
          user: user ? `${user.displayName} ${(user as any)?.profile?.phone || user.email}` : o.userId,
          cigarName: cigar ? cigar.name : it.cigarId,
          quantity: it.quantity,
          source,
          eventId, // 保存活动ID
        })
      }
    }
    // 来自手动出库日志的出库
    for (const log of filteredOutLogs) {
      const ref = String((log as any).referenceNo || '')
      // 避免重复：订单出库已由 orders 渲染一遍，过滤掉 referenceNo 匹配订单ID的日志
      if (orders.some(o => o.id === ref)) continue
      const cigar = cigarMap.get((log as any).cigarId)
      // 查找对应的出库订单（通过referenceNo匹配或通过inventoryMovements的outboundOrderId）
      const movement = inventoryMovements.find(m => m.id === (log as any).id && m.type === 'out')
      let outboundOrderId = movement?.outboundOrderId
      // 如果没有通过movement找到，尝试通过referenceNo匹配
      if (!outboundOrderId) {
        const outboundOrder = outboundOrders.find((outOrder: any) => outOrder.referenceNo === (log as any).referenceNo)
        outboundOrderId = outboundOrder?.id
      }
      rows.push({
        id: `manual_${(log as any).id || ((log as any).referenceNo || '')}_${(log as any).cigarId}`,
        createdAt: (log as any).createdAt,
        orderId: '-',
        referenceNo: (log as any).referenceNo,
        outboundOrderId: outboundOrderId, // 添加出库订单ID
        user: (log as any).operatorId || '-',
        cigarName: cigar ? cigar.name : (log as any).cigarId,
        quantity: (log as any).quantity,
        source: 'manual',
      })
    }
    // 按时间倒序
    return rows.sort((a, b) => {
      const da = toDateSafe(a.createdAt)?.getTime() || 0
      const db = toDateSafe(b.createdAt)?.getTime() || 0
      return db - da
    })
  }, [orders, users, items, filteredOutLogs, outSearchKeyword, outBrandFilter, outboundOrders, inventoryMovements])

  // 活动映射表（用于快速查找活动名称）
  const eventMap = useMemo(() => {
    const map = new Map<string, Event>()
    events.forEach(event => {
      map.set(event.id, event)
    })
    return map
  }, [events])

  const unifiedOutColumns = [
    { title: t('inventory.time'), dataIndex: 'createdAt', key: 'createdAt', width: 160, render: (v: any) => formatYMD(toDateSafe(v)) },
    { title: t('inventory.orderId'), dataIndex: 'orderId', key: 'orderId', width: 140 },
    { title: t('inventory.referenceNo'), dataIndex: 'referenceNo', key: 'referenceNo', width: 120, render: (v: any) => v || '-' },
    { title: t('inventory.user'), dataIndex: 'user', key: 'user', width: 220 },
    { title: t('inventory.product'), dataIndex: 'cigarName', key: 'cigarName', width: 220 },
    { title: t('inventory.quantity'), dataIndex: 'quantity', key: 'quantity', width: 100 },
    {
      title: t('inventory.source'),
      dataIndex: 'source',
      key: 'source',
      width: 120,
      render: (s: string, record: any) => {
        if (s === 'event' && record.eventId) {
          const event = eventMap.get(record.eventId)
          return event ? event.title : t('inventory.event')
        }
        return s === 'event' ? t('inventory.event') : s === 'direct' ? t('inventory.directSale') : t('inventory.manual')
      }
    },
  ]

  // 产品下拉：按品牌分组，并按品牌与产品名称字母排序（用于入库/出库下拉）
  const groupedCigars = useMemo(() => {
    const brandToList = new Map<string, Cigar[]>()
    items.forEach((c) => {
      const brand = (c as any)?.brand || 'Unknown'
      const list = brandToList.get(brand) || []
      list.push(c)
      brandToList.set(brand, list)
    })
    const sorted = Array.from(brandToList.entries())
      .sort((a, b) => a[0].toLowerCase().localeCompare(b[0].toLowerCase()))
      .map(([brand, list]) => ({
        brand,
        list: list.sort((a, b) => (a.name || '').toLowerCase().localeCompare((b.name || '').toLowerCase())),
      }))
    return sorted
  }, [items])

  const brands = useMemo(() => {
    return Array.from(new Set(items.map(i => i.brand).filter(Boolean))) as string[]
  }, [items])

  const groupedByBrand = useMemo(() => {
    const map: Record<string, { display: string; items: Cigar[] }> = {}
    for (const it of filtered) {
      const raw = (it.brand || t('shop.other')).trim()
      const lower = raw.toLowerCase()
      if (!map[lower]) map[lower] = { display: raw, items: [] }
      map[lower].items.push(it)
    }
    const keys = Object.keys(map).sort((a, b) => map[a].display.localeCompare(map[b].display, undefined, { sensitivity: 'base' }))
    return keys.map(k => ({ key: map[k].display, items: map[k].items.sort((a, b) => (a.name || '').localeCompare(b.name || '')) }))
  }, [filtered])

  return (
    <div
      style={{
        height: isMobile ? '80vh' : 'auto',
        display: 'flex',
        flexDirection: 'column',
        overflow: isMobile ? 'hidden' : 'visible'
      }}
    >
      {/* 自定义标签页 */}
      <div style={{ marginBottom: 12 }}>
        <div style={{ display: 'flex', borderBottom: '1px solid rgba(244,175,37,0.2)' }}>
          {(['list', 'brand', 'in', 'out'] as const).map((tabKey) => {
            const isActive = activeTab === tabKey
            const baseStyle: React.CSSProperties = {
              flex: 1,
              padding: '10px 0',
              fontWeight: 800,
              fontSize: 12,
              outline: 'none',
              borderBottom: isActive ? '2px solid #f4af25' : '2px solid transparent',
              borderTop: 'none',
              borderLeft: 'none',
              borderRight: 'none',
              cursor: 'pointer',
              background: 'none',
            }
            const activeStyle: React.CSSProperties = {
              color: 'transparent',
              background: 'linear-gradient(to right,#FDE08D,#C48D3A)',
              WebkitBackgroundClip: 'text',
            }
            const inactiveStyle: React.CSSProperties = {
              color: '#A0A0A0',
            }
            return (
              <button
                key={tabKey}
                onClick={() => setActiveTab(tabKey)}
                style={{ ...baseStyle, ...(isActive ? activeStyle : inactiveStyle) }}
              >
                {tabKey === 'list' ? t('inventory.product') : tabKey === 'brand' ? t('inventory.brandManagement') : tabKey === 'in' ? t('inventory.stockIn') : t('inventory.stockOut')}
              </button>
            )
          })}
        </div>
        <div>
          {activeTab === 'list' && (
            <div>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                <Space>
                  {selectedRowKeys.length > 1 && (
                    <>
                      <Button
                        onClick={async () => {
                          setLoading(true)
                          try {
                            await Promise.all(selectedRowKeys.map(id => updateDocument(COLLECTIONS.CIGARS, String(id), { status: 'inactive' } as any)))
                            message.success(t('inventory.batchDisabled'))
                            refreshItems()
                            setSelectedRowKeys([])
                          } finally {
                            setLoading(false)
                          }
                        }}
                        style={{
                          background: 'rgba(255, 255, 255, 0.1)',
                          border: '1px solid rgba(255, 255, 255, 0.2)',
                          color: '#FFFFFF'
                        }}
                      >
                        {t('inventory.batchDisable')}
                      </Button>
                      <Button
                        onClick={async () => {

                          const confirmed = window.confirm(t('inventory.batchDeleteConfirmText', { count: selectedRowKeys.length }))

                          if (confirmed) {
                            setLoading(true)
                            try {

                              const ids = selectedRowKeys.map(id => String(id))

                              const blocked = ids.filter(id => hasInventoryHistory(id))
                              const allowed = ids.filter(id => !hasInventoryHistory(id))


                              if (blocked.length > 0) {
                                message.warning(t('inventory.deleteBlockedDueToLogs'))
                              }

                              if (allowed.length === 0) {
                                return
                              }

                              await Promise.all(allowed.map(id => deleteDocument(COLLECTIONS.CIGARS, id)))

                              message.success(t('inventory.batchDeleted'))

                              refreshItems()
                              setSelectedRowKeys([])
                            } catch (error) {
                              message.error(t('inventory.batchDeleteFailed') + ': ' + (error as Error).message)
                            } finally {
                              setLoading(false)
                            }
                          } else {
                          }
                        }}
                        style={{
                          background: 'rgba(255, 77, 79, 0.8)',
                          border: 'none',
                          color: '#FFFFFF',
                          fontWeight: 700
                        }}
                      >
                        {t('inventory.batchDelete')}
                      </Button>
                    </>
                  )}
                </Space>
              </div>

              {!isMobile && (
                <div
                  style={{
                    position: 'sticky',
                    top: 0,
                    zIndex: 100,
                    background: 'rgba(255, 255, 255, 0.05)',
                    backdropFilter: 'blur(8px)',
                    WebkitBackdropFilter: 'blur(8px)',
                    borderBottom: '1px solid rgba(244,175,37,0.2)',
                    border: '1px solid rgba(244,175,37,0.2)',
                    borderRadius: 12,
                    marginBottom: 8,
                    padding: 16
                  }}
                >
                  <Space size="middle" wrap>
                    <Search
                      placeholder={t('inventory.search')}
                      allowClear
                      style={{ width: 300 }}
                      prefix={<SearchOutlined />}
                      value={keyword}
                      onChange={(e) => setKeyword(e.target.value)}
                      className="points-config-form"
                    />
                    <Select
                      placeholder={t('inventory.brand')}
                      style={{ width: 140 }}
                      allowClear
                      value={brandFilter}
                      onChange={setBrandFilter}
                      className="gold-select"
                      popupClassName="gold-select-dropdown"
                    >
                      {Array.from(new Set(items.map(i => i.brand))).sort().map(brand => (
                        <Option key={brand} value={brand}>{brand}</Option>
                      ))}
                    </Select>
                    <Select
                      placeholder={t('inventory.origin')}
                      style={{ width: 140 }}
                      allowClear
                      value={originFilter}
                      onChange={setOriginFilter}
                      className="gold-select"
                      popupClassName="gold-select-dropdown"
                    >
                      {[...new Set(items.map(i => i.origin).filter(Boolean))].map(org => (
                        <Option key={org} value={org}>{org}</Option>
                      ))}
                    </Select>
                    <Select
                      placeholder={t('inventory.strength')}
                      style={{ width: 120 }}
                      allowClear
                      value={strengthFilter}
                      onChange={setStrengthFilter}
                      className="gold-select"
                      popupClassName="gold-select-dropdown"
                    >
                      <Option value="mild">{t('inventory.mild')} </Option>
                      <Option value="mild-medium">{t('inventory.mildMedium')}</Option>
                      <Option value="medium">{t('inventory.medium')}</Option>
                      <Option value="medium-full">{t('inventory.mediumFull')}</Option>
                      <Option value="full">{t('inventory.full')}</Option>
                    </Select>
                    <Select
                      placeholder={t('inventory.stockStatus')}
                      style={{ width: 140 }}
                      allowClear
                      value={statusFilter}
                      onChange={setStatusFilter}
                      className="gold-select"
                      popupClassName="gold-select-dropdown"
                    >
                      <Option value="normal">{t('inventory.stockNormal')}</Option>
                      <Option value="low">{t('inventory.stockLow')}</Option>
                      <Option value="critical">{t('inventory.stockCritical')}</Option>
                    </Select>
                    <Button
                      onClick={() => { setKeyword(''); setBrandFilter(undefined); setOriginFilter(undefined); setStrengthFilter(undefined); setStatusFilter(undefined); setSelectedRowKeys([]) }}
                      style={{
                        background: 'rgba(255, 255, 255, 0.1)',
                        border: '1px solid rgba(255, 255, 255, 0.2)',
                        color: '#FFFFFF'
                      }}
                    >
                      {t('common.resetFilters')}
                    </Button>
                    <button onClick={() => { setCreating(true); form.resetFields(); setCigarImages([]); setCigarDatabaseData(null); }} style={{ display: 'flex', alignItems: 'center', gap: 8, borderRadius: 8, padding: '8px 16px', background: 'linear-gradient(to right,#FDE08D,#C48D3A)', color: '#111', fontWeight: 700, cursor: 'pointer' }}>
                      <PlusOutlined />
                      {t('inventory.addProduct')}
                    </button>
                  </Space>
                </div>
              )}

              {/* Mobile search + pills */}
              {isMobile && (
                <div
                  style={{
                    position: 'sticky',
                    top: 0,
                    zIndex: 100,
                    background: 'rgba(39,35,27,0.65)',
                    backdropFilter: 'blur(8px)',
                    WebkitBackdropFilter: 'blur(8px)',
                    borderBottom: '1px solid rgba(244,175,37,0.2)',
                    display: 'flex', flexDirection: 'column', gap: 12, marginBottom: 8, paddingTop: 8, paddingBottom: 8
                  }}
                >
                  {/* 第一行：搜索栏 + 添加产品 */}
                  <div style={{ display: 'flex', alignItems: 'center', gap: 8, width: '100%', boxSizing: 'border-box' }}>
                    <Search
                      placeholder={t('inventory.search')}
                      allowClear
                      style={{ flex: 1, minWidth: 0 }}
                      prefix={<SearchOutlined style={{ color: '#f4af25' }} />}
                      value={keyword}
                      onChange={(e) => setKeyword(e.target.value)}
                      className="points-config-form"
                    />
                    <button
                      onClick={() => { setCreating(true); form.resetFields(); setCigarImages([]); }}
                      style={{
                        display: 'flex',
                        alignItems: 'center',
                        justifyContent: 'center',
                        gap: 8,
                        borderRadius: 8,
                        padding: '8px 16px',
                        background: 'linear-gradient(to right,#FDE08D,#C48D3A)',
                        color: '#111',
                        fontWeight: 700,
                        cursor: 'pointer',
                        flex: '0 0 calc(33.333% - 6px)',
                        border: 'none',
                        whiteSpace: 'nowrap',
                        boxSizing: 'border-box'
                      }}
                    >
                      <PlusOutlined />
                      {t('inventory.addProduct')}
                    </button>
                  </div>
                  {/* 第二行：品牌筛选 + 库存状态 + 重置筛选（三个元素同宽） */}
                  <div style={{ display: 'flex', alignItems: 'center', gap: 8, width: '100%', boxSizing: 'border-box' }}>
                    <Select
                      placeholder={t('inventory.allBrands')}
                      allowClear
                      value={brandFilter as any}
                      onChange={setBrandFilter}
                      style={{ flex: 1, minWidth: 0 }}
                      className="gold-select"
                      popupClassName="gold-select-dropdown"
                    >
                      {Array.from(new Set(items.map(i => i.brand))).sort().map(brand => (
                        <Option key={brand} value={brand}>{brand}</Option>
                      ))}
                    </Select>
                    <Select
                      placeholder={t('inventory.stockStatus')}
                      allowClear
                      value={statusFilter as any}
                      onChange={setStatusFilter}
                      style={{ flex: 1, minWidth: 0 }}
                      className="gold-select"
                      popupClassName="gold-select-dropdown"
                    >
                      <Option value="normal">{t('inventory.stockNormal')}</Option>
                      <Option value="low">{t('inventory.stockLow')}</Option>
                      <Option value="critical">{t('inventory.stockCritical')}</Option>
                    </Select>
                    <Button
                      onClick={() => { setKeyword(''); setBrandFilter(undefined); setStrengthFilter(undefined); setStatusFilter(undefined); setSelectedRowKeys([]) }}
                      style={{
                        background: 'rgba(255, 255, 255, 0.1)',
                        border: '1px solid rgba(255, 255, 255, 0.2)',
                        color: '#FFFFFF',
                        flex: '0 0 calc(33.333% - 6px)',
                        boxSizing: 'border-box'
                      }}
                    >
                      {t('common.resetFilters')}
                    </Button>
                  </div>
                </div>
              )}

              {/* 主体容器：包含可选的侧边栏和列表容器 */}
              <div style={{ display: 'flex', gap: isMobile ? 0 : 16 }}>
                {/* 桌面端品牌侧边栏 */}
                {!isMobile && (
                  <div
                    className="shop-sidebar"
                    style={{
                      width: '100px',
                      background: 'linear-gradient(180deg, #1a1a1a 0%, #0f0f0f 100%)',
                      borderRight: '1px solid rgba(255, 215, 0, 0.1)',
                      borderRadius: 12,
                      overflowY: 'auto',
                      overflowX: 'hidden',
                      paddingBottom: '20px',
                      height: 'calc(100vh - 260px)',
                      flexShrink: 0
                    }}
                  >
                    {/* 全部分类 */}
                    <div
                      onClick={() => setBrandFilter(undefined)}
                      style={{
                        padding: '16px 12px',
                        cursor: 'pointer',
                        borderLeft: !brandFilter ? '3px solid #F4AF25' : '3px solid transparent',
                        background: !brandFilter ? 'rgba(244, 175, 37, 0.1)' : 'transparent',
                        transition: 'all 0.3s ease'
                      }}
                    >
                      <div style={{ textAlign: 'center' }}>
                        <div style={{
                          fontSize: '12px',
                          fontWeight: 600,
                          color: !brandFilter ? '#F4AF25' : '#c0c0c0',
                          textAlign: 'center',
                          lineHeight: 1.2
                        }}>
                          {t('inventory.allBrands')}
                        </div>
                      </div>
                    </div>

                    {/* 品牌列表 */}
                    {(() => {
                      const activeCigarBrands = new Set(items.map(i => i.brand).filter(Boolean))

                      const cubanBrands = brandList
                        .filter(brand =>
                          brand.status === 'active' &&
                          (brand.country?.toLowerCase() === 'cuba' || brand.country?.toLowerCase() === 'cuban') &&
                          activeCigarBrands.has(brand.name)
                        )
                        .sort((a, b) => a.name.localeCompare(b.name))

                      const newWorldBrands = brandList
                        .filter(brand =>
                          brand.status === 'active' &&
                          brand.country?.toLowerCase() !== 'cuba' &&
                          brand.country?.toLowerCase() !== 'cuban' &&
                          activeCigarBrands.has(brand.name)
                        )
                        .sort((a, b) => a.name.localeCompare(b.name))

                      const renderBrandItem = (brand: Brand) => {
                        const isSelected = brandFilter === brand.name;
                        return (
                          <div
                            key={brand.id || brand.name}
                            onClick={() => setBrandFilter(brand.name)}
                            style={{
                              padding: '16px 12px',
                              cursor: 'pointer',
                              borderLeft: isSelected ? '3px solid #F4AF25' : '3px solid transparent',
                              background: isSelected ? 'rgba(244, 175, 37, 0.1)' : 'transparent',
                              transition: 'all 0.3s ease'
                            }}
                          >
                            <div style={{ textAlign: 'center' }}>
                              <div style={{
                                width: '48px',
                                height: '48px',
                                margin: '0 auto 8px',
                                borderRadius: '50%',
                                backgroundImage: brand.logo ? `url(${brand.logo})` : 'none',
                                backgroundColor: brand.logo ? 'transparent' : 'rgba(255, 255, 255, 0.05)',
                                backgroundSize: 'cover',
                                backgroundPosition: 'center',
                                display: 'flex',
                                alignItems: 'center',
                                justifyContent: 'center',
                                fontSize: '18px',
                                fontWeight: 'bold',
                                color: brand.logo ? 'transparent' : '#F4AF25',
                                border: `2px solid ${isSelected ? '#F4AF25' : 'rgba(244, 175, 37, 0.6)'}`
                              }}>
                                {!brand.logo && brand.name.charAt(0).toUpperCase()}
                              </div>
                              <div style={{
                                fontSize: '11px',
                                fontWeight: 600,
                                color: isSelected ? '#F4AF25' : '#c0c0c0',
                                textAlign: 'center',
                                lineHeight: 1.2,
                                wordWrap: 'break-word'
                              }}>
                                {brand.name}
                              </div>
                            </div>
                          </div>
                        )
                      }

                      return (
                        <>
                          {cubanBrands.length > 0 && (
                            <div>
                              <div style={{
                                position: 'sticky',
                                top: 0,
                                zIndex: 10,
                                padding: '12px 8px',
                                background: 'rgba(139, 69, 19, 0.95)',
                                backdropFilter: 'blur(8px)',
                                borderLeft: '3px solid #8B4513',
                                boxShadow: '0 2px 8px rgba(0, 0, 0, 0.3)'
                              }}>
                                <div style={{
                                  fontSize: '10px',
                                  fontWeight: 'bold',
                                  color: '#F4AF25',
                                  textAlign: 'center',
                                  letterSpacing: '1px'
                                }}>
                                  CUBAN
                                </div>
                              </div>
                              {cubanBrands.map(renderBrandItem)}
                            </div>
                          )}

                          {cubanBrands.length > 0 && newWorldBrands.length > 0 && (
                            <div style={{
                              height: '1px',
                              background: 'linear-gradient(90deg, transparent 0%, rgba(244, 175, 37, 0.6) 50%, transparent 100%)',
                              margin: '12px 0'
                            }} />
                          )}

                          {newWorldBrands.length > 0 && (
                            <div>
                              <div style={{
                                position: 'sticky',
                                top: 0,
                                zIndex: 10,
                                padding: '12px 8px',
                                background: 'rgba(34, 139, 34, 0.95)',
                                backdropFilter: 'blur(8px)',
                                borderLeft: '3px solid #228B22',
                                boxShadow: '0 2px 8px rgba(0, 0, 0, 0.3)'
                              }}>
                                <div style={{
                                  fontSize: '10px',
                                  fontWeight: 'bold',
                                  color: '#F4AF25',
                                  textAlign: 'center',
                                  letterSpacing: '1px'
                                }}>
                                  NEW WORLD
                                </div>
                              </div>
                              {newWorldBrands.map(renderBrandItem)}
                            </div>
                          )}

                          {(() => {
                            const knownBrandNames = new Set(brandList.map(b => b.name))
                            const otherBrands = Array.from(activeCigarBrands)
                              .filter(name => !knownBrandNames.has(name as string))
                              .sort()

                            if (otherBrands.length === 0) return null;

                            return (
                              <div>
                                {(cubanBrands.length > 0 || newWorldBrands.length > 0) && (
                                  <div style={{
                                    height: '1px',
                                    background: 'linear-gradient(90deg, transparent 0%, rgba(244, 175, 37, 0.6) 50%, transparent 100%)',
                                    margin: '12px 0'
                                  }} />
                                )}
                                <div style={{
                                  position: 'sticky',
                                  top: 0,
                                  zIndex: 10,
                                  padding: '12px 8px',
                                  background: 'rgba(80, 80, 80, 0.95)',
                                  backdropFilter: 'blur(8px)',
                                  borderLeft: '3px solid #505050',
                                  boxShadow: '0 2px 8px rgba(0, 0, 0, 0.3)'
                                }}>
                                  <div style={{
                                    fontSize: '10px',
                                    fontWeight: 'bold',
                                    color: '#F4AF25',
                                    textAlign: 'center',
                                    letterSpacing: '1px'
                                  }}>
                                    OTHERS
                                  </div>
                                </div>
                                {otherBrands.map(brandName => renderBrandItem({
                                  id: brandName as string,
                                  name: brandName as string,
                                  status: 'active'
                                } as Brand))}
                              </div>
                            )
                          })()}
                        </>
                      )
                    })()}
                  </div>
                )}

                {/* 列表滚动容器：仅列表滚动 */}
                <div
                  style={{
                    flex: 1,
                    minWidth: 0,
                    overflowY: 'auto',
                    overflowX: 'hidden',
                    maxHeight: isMobile ? 'calc(100vh - 300px)' : 'calc(100vh - 260px)',
                    paddingTop: 8,
                    paddingBottom: 16
                  }}
                >
                  {!isMobile ? (
                    <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
                      {groupedByBrand.map(group => (
                        <div key={group.key} style={{ border: '1px solid rgba(244,175,37,0.2)', borderRadius: 12, overflow: 'hidden', background: 'rgba(255, 255, 255, 0.05)', backdropFilter: 'blur(10px)' }}>
                          <div style={{ padding: '8px 12px', background: 'linear-gradient(to right, #FDE08D, #C48D3A)', display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                            <div style={{ fontWeight: 700, color: '#000' }}>{group.key}</div>
                            <div style={{ fontSize: 12, color: 'rgba(0, 0, 0, 0.6)' }}>{t('inventory.productTypes')}: {group.items.length}</div>
                          </div>
                          <div style={{ padding: 12 }}>
                            <div className="points-config-form">
                              <Table
                                columns={columns}
                                dataSource={group.items}
                                rowKey="id"
                                size="small"
                                loading={listLoading || loading}
                                rowSelection={{ selectedRowKeys, onChange: setSelectedRowKeys, preserveSelectedRowKeys: true }}
                                pagination={false}
                                style={{
                                  background: 'transparent'
                                }}
                              />
                            </div>
                          </div>
                        </div>
                      ))}
                      {groupedByBrand.length === 0 && !listLoading && (
                        <div style={{ textAlign: 'center', padding: '24px 0' }}>
                          {itemsError ? (
                            <div style={{ color: '#ff4d4f' }}>加载失败: {itemsError}</div>
                          ) : (
                            <div style={{ color: 'rgba(255, 255, 255, 0.6)' }}>{t('common.noData')}</div>
                          )}
                        </div>
                      )}
                    </div>
                  ) : (
                    <div style={{ display: 'flex', flexDirection: 'column', gap: 24 }}>
                      {groupedByBrand.map(group => (
                        <div key={group.key} style={{ border: '1px solid rgba(244,175,37,0.2)', borderRadius: 16, overflow: 'hidden', background: 'rgba(0,0,0,0.2)', boxShadow: '0 10px 30px rgba(0,0,0,0.25)' }}>
                          <div style={{ padding: 12, background: 'linear-gradient(to right, #FDE08D, #C48D3A)' }}>
                            <div style={{ fontSize: 18, fontWeight: 700, color: '#000' }}>{group.key}</div>
                          </div>
                          <div style={{ padding: 12, display: 'flex', flexDirection: 'column', gap: 12 }}>
                            {group.items.map(record => (
                              <div key={record.id} style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                                {/* 产品名称（顶部，全宽） */}
                                <div style={{ fontWeight: 700, color: '#fff', fontSize: 16, marginBottom: 4 }}>{record.name}</div>

                                {/* 图片、信息和按钮（水平布局） */}
                                <div style={{ display: 'flex', alignItems: 'flex-start', gap: 12 }}>
                                  <div style={{ position: 'relative', flexShrink: 0 }}>
                                    <div style={{ width: 60, height: 80, borderRadius: 10, overflow: 'hidden', background: 'rgba(255,255,255,0.08)' }}>
                                      <img
                                        src={(record as any).images && (record as any).images.length > 0 ? (record as any).images[0] : DEFAULT_CIGAR_IMAGE}
                                        alt={record.name}
                                        style={{
                                          width: '100%',
                                          height: '100%',
                                          objectFit: 'cover'
                                        }}
                                      />
                                    </div>
                                    <CigarRatingBadge rating={(record as any).metadata?.rating} size="small" />
                                  </div>
                                  <div style={{ flex: 1 }}>
                                    <div style={{ fontSize: 12, color: 'rgba(224,214,196,0.6)', display: 'flex', flexWrap: 'wrap', gap: 4, alignItems: 'center' }}>
                                      {record.size && <span>{record.size}</span>}
                                      {record.size && record.origin && <span>|</span>}
                                      {record.origin && <span>{record.origin}</span>}
                                      {(record.size || record.origin) && record.strength && <span>|</span>}
                                      {record.strength && (
                                        <Tag color={getStrengthColor(record.strength)} style={{ margin: 0, fontSize: 11, padding: '0 4px', lineHeight: '18px' }}>
                                          {getStrengthText(record.strength)}
                                        </Tag>
                                      )}
                                    </div>
                                    <div style={{ fontWeight: 700, color: '#f4af25', marginTop: 2 }}>RM{record.price?.toLocaleString?.() || record.price}</div>
                                    <div style={{ display: 'flex', alignItems: 'center', gap: 12, fontSize: 12, marginTop: 4 }}>
                                      {(() => {
                                        const { totalIn, totalOut } = getTotals((record as any)?.id); return (
                                          <>
                                            <span style={{ color: 'rgba(224,214,196,0.8)' }}>{t('inventory.totalIn')}: <span style={{ color: '#fff' }}>{totalIn}</span></span>
                                            <span style={{ color: 'rgba(224,214,196,0.8)' }}>{t('inventory.totalOut')}: <span style={{ color: '#fff' }}>{totalOut}</span></span>
                                          </>
                                        )
                                      })()}
                                    </div>
                                  </div>
                                  <div style={{ display: 'flex', flexDirection: 'column', gap: 8, alignItems: 'flex-end' }}>
                                    {/* 按钮区域（水平排列） */}
                                    <div style={{ display: 'flex', flexDirection: 'row', alignItems: 'center' }}>
                                      <button
                                        style={{
                                          padding: '4px 8px',
                                          borderRadius: 6,
                                          background: 'linear-gradient(to right,#FDE08D,#C48D3A)',
                                          color: '#111',
                                          fontWeight: 600,
                                          fontSize: 12,
                                          cursor: 'pointer',
                                          transition: 'all 0.2s ease',
                                          border: '1px solid transparent',
                                          whiteSpace: 'nowrap',
                                          flexShrink: 0
                                        }}
                                        onClick={() => {
                                          setEditing(record)
                                        }}
                                      >
                                        {t('common.edit')}
                                      </button>
                                    </div>
                                    {/* 库存数量（可点击查看详情，用颜色表示状态，字体高度与价格+总入库/出库的总高度一致） */}
                                    <div
                                      style={{
                                        textAlign: 'right',
                                        display: 'flex',
                                        alignItems: 'center',
                                        minHeight: 40,
                                        cursor: 'pointer',
                                        transition: 'opacity 0.2s ease'
                                      }}
                                      onClick={() => {
                                        setViewingProductLogs((record as any)?.id)
                                      }}
                                      onMouseEnter={(e) => {
                                        e.currentTarget.style.opacity = '0.8'
                                      }}
                                      onMouseLeave={(e) => {
                                        e.currentTarget.style.opacity = '1'
                                      }}
                                    >
                                      {(() => {
                                        const computed = getComputedStock((record as any)?.id)
                                        const min = ((record as any)?.inventory?.minStock ?? 0)
                                        const st = (computed <= min) ? 'critical' : (computed <= (min * 1.5)) ? 'low' : 'normal'
                                        const color = st === 'normal' ? '#16a34a' : st === 'low' ? '#f59e0b' : '#ef4444'
                                        return (
                                          <span style={{
                                            color,
                                            fontSize: 38,
                                            fontWeight: 700,
                                            lineHeight: 1
                                          }}>
                                            {computed}
                                          </span>
                                        )
                                      })()}
                                    </div>
                                  </div>
                                </div>
                              </div>
                            ))}
                          </div>
                        </div>
                      ))}
                      {groupedByBrand.length === 0 && !listLoading && (
                        <div style={{ textAlign: 'center', padding: '24px 0' }}>
                          {itemsError ? (
                            <div style={{ color: '#ff4d4f' }}>加载失败: {itemsError}</div>
                          ) : (
                            <div style={{ color: 'rgba(255, 255, 255, 0.6)' }}>{t('common.noData')}</div>
                          )}
                        </div>
                      )}
                    </div>
                  )}
                </div>
              </div>
            </div>
          )}
          {activeTab === 'brand' && (
            <div>

              {/* 筛选区（置顶）：搜索框 + 添加品牌（同排显示） */}
              <div
                style={{
                  position: 'sticky',
                  top: 0,
                  zIndex: 100,
                  background: 'rgba(39,35,27,0.65)',
                  backdropFilter: 'blur(8px)',
                  WebkitBackdropFilter: 'blur(8px)',
                  borderBottom: '1px solid rgba(244,175,37,0.2)',
                  display: 'flex', gap: 12, marginBottom: 8, alignItems: 'center', paddingTop: 8, paddingBottom: 8
                }}
              >
                <div style={{ flex: 1 }}>
                  <Search
                    placeholder={t('inventory.searchBrand')}
                    value={keyword}
                    onChange={(e) => setKeyword(e.target.value)}
                    allowClear
                    style={{ flex: 1 }}
                  />
                </div>

                {/* 添加品牌按钮（同排） */}
                <button
                  onClick={() => setCreatingBrand(true)}
                  className="cigar-btn-gradient"
                  style={{
                    height: 40,
                    borderRadius: 8,
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    gap: 8,
                    padding: '0 16px',
                    cursor: 'pointer',
                    fontSize: 14,
                    whiteSpace: 'nowrap'
                  }}
                >
                  <PlusOutlined style={{ fontSize: 18 }} />
                  <span>{t('inventory.addBrand')}</span>
                </button>
              </div>

              {/* 添加品牌按钮单独区块已移除 */}

              {/* 品牌列表（滚动容器） */}
              <div
                style={{
                  overflowY: 'auto',
                  overflowX: 'hidden',
                  maxHeight: isMobile ? 'calc(100vh - 200px)' : 'calc(100vh - 230px)',
                  paddingTop: 8,
                  paddingBottom: 100,
                  display: 'flex', flexDirection: 'column', gap: 16
                }}
              >
                {brandList.length === 0 ? (
                  <div style={{
                    textAlign: 'center',
                    padding: '60px 0',
                    color: 'rgba(255,255,255,0.6)'
                  }}>
                    <div style={{ fontSize: '48px', marginBottom: '16px' }}></div>
                    <div style={{ fontSize: '16px', marginBottom: '8px' }}>{t('inventory.noBrandsFound')}</div>
                    <div style={{ fontSize: '14px' }}>{t('inventory.addFirstBrand')}</div>
                  </div>
                ) : (
                  brandList
                    .filter(brand => !keyword || brand.name.toLowerCase().includes(keyword.toLowerCase()))
                    .sort((a, b) => a.name.toLowerCase().localeCompare(b.name.toLowerCase()))
                    .map((brand) => {
                      const productCount = items.filter(item => item.brand === brand.name).length
                      return (
                        <div
                          key={brand.id}
                          style={{
                            borderRadius: '12px',
                            background: 'rgba(255,255,255,0.05)',
                            backdropFilter: 'blur(20px)',
                            border: '1px solid rgba(255,255,255,0.1)',
                            padding: '16px',
                            transition: 'all 0.3s ease',
                            cursor: 'pointer'
                          }}
                          onMouseEnter={(e) => {
                            e.currentTarget.style.background = 'rgba(255,255,255,0.08)'
                          }}
                          onMouseLeave={(e) => {
                            e.currentTarget.style.background = 'rgba(255,255,255,0.05)'
                          }}
                        >
                          <div style={{
                            display: 'flex',
                            alignItems: 'flex-start',
                            justifyContent: 'space-between',
                            gap: '16px'
                          }}>
                            <div style={{ flex: 1 }}>
                              <div style={{
                                display: 'flex',
                                alignItems: 'center',
                                gap: '12px'
                              }}>
                                {brand.logo ? (
                                  <img
                                    src={brand.logo}
                                    alt={brand.name}
                                    style={{
                                      width: '50px',
                                      height: '50px',
                                      borderRadius: '8px',
                                      objectFit: 'cover',
                                      border: '2px solid rgba(244,175,37,0.3)'
                                    }}
                                    onError={(e) => {
                                      e.currentTarget.style.display = 'none'
                                    }}
                                  />
                                ) : (
                                  <div style={{
                                    width: '50px',
                                    height: '50px',
                                    borderRadius: '8px',
                                    background: 'linear-gradient(135deg, rgba(244,175,37,0.2), rgba(224,153,15,0.2))',
                                    border: '2px solid rgba(244,175,37,0.3)',
                                    display: 'flex',
                                    alignItems: 'center',
                                    justifyContent: 'center',
                                    fontSize: '16px',
                                    fontWeight: 'bold',
                                    color: '#f4af25'
                                  }}>
                                    {brand.name.charAt(0).toUpperCase()}
                                  </div>
                                )}
                                <div>
                                  <h3 style={{
                                    fontWeight: 'bold',
                                    background: 'linear-gradient(to right,#FDE08D,#C48D3A)',
                                    WebkitBackgroundClip: 'text',
                                    color: 'transparent',
                                    fontSize: '16px',
                                    margin: '0 0 4px 0'
                                  }}>
                                    {brand.name}
                                  </h3>
                                  {isMobile ? (
                                    <div style={{
                                      display: 'flex',
                                      flexDirection: 'column',
                                      gap: 4,
                                      fontSize: '12px',
                                      color: 'rgba(255,255,255,0.7)'
                                    }}>
                                      <div style={{ display: 'flex', alignItems: 'center', gap: 4, whiteSpace: 'nowrap' }}>
                                        <svg
                                          style={{ color: '#f4af25' }}
                                          fill="none"
                                          height="14"
                                          stroke="currentColor"
                                          strokeLinecap="round"
                                          strokeLinejoin="round"
                                          strokeWidth="2"
                                          viewBox="0 0 24 24"
                                          width="14"
                                        >
                                          <path d="M20 10c0 6-8 12-8 12s-8-6-8-12a8 8 0 0 1 16 0Z"></path>
                                          <circle cx="12" cy="10" r="3"></circle>
                                        </svg>
                                        <span style={{ overflow: 'hidden', textOverflow: 'ellipsis' }}>
                                          {t('inventory.origin')}: {brand.country || '-'}
                                        </span>
                                      </div>
                                      <div style={{ display: 'flex', alignItems: 'center', gap: 4, whiteSpace: 'nowrap' }}>
                                        <svg
                                          style={{ color: '#f4af25' }}
                                          fill="none"
                                          height="14"
                                          stroke="currentColor"
                                          strokeLinecap="round"
                                          strokeLinejoin="round"
                                          strokeWidth="2"
                                          viewBox="0 0 24 24"
                                          width="14"
                                        >
                                          <path d="M21 16V8a2 2 0 0 0-1-1.73l-7-4a2 2 0 0 0-2 0l-7 4A2 2 0 0 0 3 8v8a2 2 0 0 0 1 1.73l7 4a2 2 0 0 0 2 0l7-4A2 2 0 0 0 21 16z"></path>
                                          <polyline points="3.27 6.96 12 12.01 20.73 6.96"></polyline>
                                          <line x1="12" x2="12" y1="22.08" y2="12"></line>
                                        </svg>
                                        <span style={{ overflow: 'hidden', textOverflow: 'ellipsis' }}>
                                          {t('inventory.productTypes')}: {productCount}
                                        </span>
                                      </div>
                                    </div>
                                  ) : (
                                    <div style={{
                                      display: 'flex',
                                      alignItems: 'center',
                                      gap: '16px',
                                      fontSize: '12px',
                                      color: 'rgba(255,255,255,0.7)'
                                    }}>
                                      <div style={{ display: 'flex', alignItems: 'center', gap: '4px' }}>
                                        <svg
                                          style={{ color: '#f4af25' }}
                                          fill="none"
                                          height="14"
                                          stroke="currentColor"
                                          strokeLinecap="round"
                                          strokeLinejoin="round"
                                          strokeWidth="2"
                                          viewBox="0 0 24 24"
                                          width="14"
                                        >
                                          <path d="M20 10c0 6-8 12-8 12s-8-6-8-12a8 8 0 0 1 16 0Z"></path>
                                          <circle cx="12" cy="10" r="3"></circle>
                                        </svg>
                                        <span>{t('inventory.origin')}: {brand.country || '-'}</span>
                                      </div>
                                      <div style={{ display: 'flex', alignItems: 'center', gap: '4px' }}>
                                        <svg
                                          style={{ color: '#f4af25' }}
                                          fill="none"
                                          height="14"
                                          stroke="currentColor"
                                          strokeLinecap="round"
                                          strokeLinejoin="round"
                                          strokeWidth="2"
                                          viewBox="0 0 24 24"
                                          width="14"
                                        >
                                          <path d="M21 16V8a2 2 0 0 0-1-1.73l-7-4a2 2 0 0 0-2 0l-7 4A2 2 0 0 0 3 8v8a2 2 0 0 0 1 1.73l7 4a2 2 0 0 0 2 0l7-4A2 2 0 0 0 21 16z"></path>
                                          <polyline points="3.27 6.96 12 12.01 20.73 6.96"></polyline>
                                          <line x1="12" x2="12" y1="22.08" y2="12"></line>
                                        </svg>
                                        <span>{t('inventory.productTypes')}: {productCount}</span>
                                      </div>
                                    </div>
                                  )}
                                </div>
                              </div>
                            </div>
                            <div style={{ display: 'flex', gap: '8px' }}>
                              <Button
                                onClick={() => setEditingBrand(brand)}
                                style={{
                                  width: '40px',
                                  height: '40px',
                                  borderRadius: '50%',
                                  background: 'linear-gradient(to right,#FDE08D,#C48D3A)',
                                  border: 'none',
                                  color: 'black',
                                  display: 'flex',
                                  alignItems: 'center',
                                  justifyContent: 'center',
                                  boxShadow: '0 4px 15px 0 rgba(244,175,37,0.3)',
                                  cursor: 'pointer',
                                  transition: 'all 0.3s ease'
                                }}
                                onMouseEnter={(e) => {
                                  e.currentTarget.style.transform = 'scale(1.05)'
                                  e.currentTarget.style.boxShadow = '0 6px 20px 0 rgba(244,175,37,0.4)'
                                }}
                                onMouseLeave={(e) => {
                                  e.currentTarget.style.transform = 'scale(1)'
                                  e.currentTarget.style.boxShadow = '0 4px 15px 0 rgba(244,175,37,0.3)'
                                }}
                              >
                                <EditOutlined style={{ fontSize: '18px' }} />
                              </Button>
                              <Button
                                onClick={async () => {

                                  const confirmed = window.confirm(t('inventory.deleteBrandConfirmText', { name: brand.name }))

                                  if (confirmed) {
                                    try {
                                      setLoading(true)

                                      const result = await deleteDocument(COLLECTIONS.BRANDS, brand.id)

                                      if (result.success) {
                                        message.success(t('inventory.brandDeleted'))
                                        refreshBrandList()
                                      } else {
                                        message.error(t('inventory.brandDeleteFailed'))
                                      }
                                    } catch (error) {
                                      message.error(t('inventory.brandDeleteFailed') + ': ' + (error as Error).message)
                                    } finally {
                                      setLoading(false)
                                    }
                                  } else {
                                  }
                                }}
                                style={{
                                  width: '40px',
                                  height: '40px',
                                  borderRadius: '50%',
                                  background: 'linear-gradient(to right, #ff6b6b, #ee5a52)',
                                  border: 'none',
                                  color: 'white',
                                  display: 'flex',
                                  alignItems: 'center',
                                  justifyContent: 'center',
                                  boxShadow: '0 4px 15px 0 rgba(255,107,107,0.3)',
                                  cursor: 'pointer',
                                  transition: 'all 0.3s ease'
                                }}
                                onMouseEnter={(e) => {
                                  e.currentTarget.style.transform = 'scale(1.05)'
                                  e.currentTarget.style.boxShadow = '0 6px 20px 0 rgba(255,107,107,0.4)'
                                }}
                                onMouseLeave={(e) => {
                                  e.currentTarget.style.transform = 'scale(1)'
                                  e.currentTarget.style.boxShadow = '0 4px 15px 0 rgba(255,107,107,0.3)'
                                }}
                              >
                                <DeleteOutlined style={{ fontSize: '18px' }} />
                              </Button>
                            </div>
                          </div>
                        </div>
                      )
                    })
                )}
              </div>
            </div>
          )}
          {activeTab === 'in' && (
            <div>
              {/* 搜索和筛选（置顶） - 两行布局 */}
              <div
                style={{
                  position: 'sticky',
                  top: 0,
                  zIndex: 100,
                  background: 'rgba(255, 255, 255, 0.05)',
                  backdropFilter: 'blur(8px)',
                  WebkitBackdropFilter: 'blur(8px)',
                  border: '1px solid rgba(244,175,37,0.2)',
                  borderRadius: 12,
                  display: 'flex', flexDirection: 'column', gap: 12, marginBottom: 8, padding: 16
                }}
              >
                {/* 第一行：搜索框 */}
                <div style={{ display: 'flex', gap: 12, alignItems: 'center' }}>
                  <Search
                    placeholder={t('inventory.searchInLogs')}
                    value={inSearchKeyword}
                    onChange={(e) => setInSearchKeyword(e.target.value)}
                    style={{ flex: 1 }}
                    allowClear
                    className="points-config-form"
                  />
                </div>

                {/* 第二行：品牌筛选 + 入库统计 + 创建入库 */}
                <div style={{ display: 'flex', gap: 12, alignItems: 'center' }}>
                  <Select
                    placeholder={t('inventory.filterByBrand')}
                    value={inBrandFilter}
                    onChange={setInBrandFilter}
                    style={{ flex: 1 }}
                    allowClear
                    className="gold-select"
                    popupClassName="gold-select-dropdown"
                  >
                    {Array.from(new Set(items.map(i => i.brand))).sort().map(brand => (
                      <Option key={brand} value={brand}>{brand}</Option>
                    ))}
                  </Select>
                  <button
                    onClick={() => setInStatsOpen(true)}
                    style={{
                      padding: '6px 14px',
                      borderRadius: 8,
                      border: '1px solid rgba(244, 175, 37, 0.6)',
                      background: 'rgba(244, 175, 37, 0.1)',
                      color: '#f4af25',
                      cursor: 'pointer',
                      fontSize: 14,
                      fontWeight: 600,
                      whiteSpace: 'nowrap'
                    }}
                  >
                    {t('inventory.inStats')}
                  </button>
                  <button
                    onClick={() => setInModalOpen(true)}
                    className="cigar-btn-gradient"
                    style={{ padding: '6px 14px', borderRadius: 8, whiteSpace: 'nowrap' }}
                  >
                    {t('inventory.inStock')}
                  </button>
                </div>
              </div>

              {/* 入库列表渲染在后文（我们将在实际列表处包裹滚动容器） */}

              <Modal
                title={editingOrder ? t('inventory.editInboundOrder') : t('inventory.inStockRecord')}
                open={inModalOpen || !!editingOrder}
                onCancel={() => {
                  setInModalOpen(false)
                  setEditingOrder(null)
                  inForm.resetFields()
                  orderEditForm.resetFields()
                  setAttachmentFileList([])
                  setUploadedAttachments([])
                  setEditAttachmentFileList([])
                  setEditUploadedAttachments([])
                }}
                footer={null}
                {...getResponsiveModalConfig(isMobile, true, 900)}
                style={{ top: 20 }}
                styles={{
                  ...getModalThemeStyles(isMobile, true),
                  body: {
                    background: 'rgba(24, 22, 17, 0.95)',
                    maxHeight: 'calc(100vh - 180px)',
                    overflowY: 'auto',
                    overflowX: 'hidden',
                    paddingBottom: 16
                  }
                }}
                afterOpenChange={(open) => {
                  if (open && editingOrder) {
                    // 编辑模式：初始化表单和附件
                    const existingDate = editingOrder.createdAt
                      ? dayjs((editingOrder.createdAt as any)?.toDate?.() || editingOrder.createdAt)
                      : dayjs()
                    inForm.setFieldsValue({
                      storeId: editingOrder.storeId,
                      referenceNo: editingOrder.referenceNo,
                      reason: editingOrder.reason,
                      movementDate: existingDate,
                      items: editingOrder.items.map(item => ({
                        ...item,
                        customName: item.itemType !== 'cigar' ? item.cigarName : undefined
                      }))
                    })

                    const existingAttachments = editingOrder.attachments || []
                    setUploadedAttachments(existingAttachments)
                    setAttachmentFileList(
                      existingAttachments.map((att, idx) => ({
                        uid: `existing-${idx}`,
                        name: att.filename,
                        status: 'done' as const,
                        url: att.url
                      }))
                    )
                  }
                }}
              >
                <Form form={inForm} layout="vertical" className="dark-theme-form" onFinish={async (values: { storeId?: string; referenceNo?: string; reason?: string; movementDate?: any; items: { itemType?: string; cigarId?: string; customName?: string; quantity: number; unitPrice?: number }[] }) => {
                  const lines = (values.items || []).filter(it => it?.quantity > 0 && (it?.cigarId || it?.customName))
                  if (lines.length === 0) { message.warning(t('inventory.pleaseAddAtLeastOneInStockDetail')); return }

                  // 检查单号
                  if (!values.referenceNo || !values.referenceNo.trim()) {
                    message.error(t('inventory.pleaseInputReferenceNo'))
                    return
                  }

                  setLoading(true)
                  try {
                    const orderItems = []
                    let totalQuantity = 0
                    let totalValue = 0

                    for (const line of lines) {
                      const lineItemType = line.itemType || 'cigar'
                      const qty = Math.max(1, Math.floor(line.quantity || 1))
                      let cigarId = ''
                      let cigarName = ''

                      if (lineItemType === 'cigar') {
                        const target = items.find(i => i.id === line.cigarId) as any
                        if (!target) continue
                        cigarId = target.id
                        cigarName = target.name
                      } else {
                        if (!line.customName || !line.customName.trim()) continue
                        const prefixMap: { [key: string]: string } = {
                          'activity': 'ACTIVITY:',
                          'gift': 'GIFT:',
                          'service': 'SERVICE:',
                          'other': 'OTHER:'
                        }
                        const prefix = prefixMap[lineItemType] || 'OTHER:'
                        cigarId = line.cigarId || `${prefix}${Date.now()}_${Math.random().toString(36).substr(2, 9)}`
                        cigarName = line.customName.trim()
                      }

                      const orderItem: any = {
                        cigarId,
                        cigarName,
                        itemType: lineItemType as any,
                        quantity: qty
                      }

                      if (line.unitPrice != null) {
                        const unitPrice = Number(line.unitPrice)
                        orderItem.unitPrice = unitPrice
                        orderItem.subtotal = unitPrice * qty
                      }

                      orderItems.push(orderItem)
                      totalQuantity += qty
                      if (orderItem.subtotal) {
                        totalValue += orderItem.subtotal
                      }
                    }

                    // 确定分配的门店
                    let assignedStoreId = currentUser?.storeId;
                    if (isSuperAdmin || currentUser?.role === 'developer') {
                      assignedStoreId = values.storeId;
                    }

                    // 检查是否是编辑模式
                    // Resolve the movement date (default to now if not set)
                    const movementDate: Date = values.movementDate
                      ? (values.movementDate as any).toDate()
                      : new Date()

                    if (editingOrder) {
                      // 编辑模式：更新现有订单
                      const updateData = {
                        referenceNo: values.referenceNo.trim(),
                        reason: values.reason || t('inventory.inStock'),
                        items: orderItems,
                        totalQuantity,
                        totalValue,
                        attachments: uploadedAttachments.length > 0 ? uploadedAttachments : undefined,
                        // 保留原有状态，除非需要更改
                        status: editingOrder.status,
                        // 保留原有类型和操作员
                        type: editingOrder.type,
                        operatorId: editingOrder.operatorId,
                        storeId: assignedStoreId,
                        createdAt: movementDate
                      }

                      // 更新订单
                      await updateInboundOrder(editingOrder.id, updateData)

                      // 删除旧的 inventory_movements
                      const oldMovements = inventoryMovements.filter(m => m.inboundOrderId === editingOrder.id)
                      await Promise.all(oldMovements.map(m => deleteDocument(COLLECTIONS.INVENTORY_MOVEMENTS, m.id)))

                      // 创建新的 inventory_movements 以匹配更新后的订单
                      const createdAt = movementDate
                      for (const item of orderItems) {
                        await createDocument(COLLECTIONS.INVENTORY_MOVEMENTS, {
                          cigarId: item.cigarId,
                          cigarName: item.cigarName,
                          itemType: item.itemType,
                          type: 'in' as const,
                          quantity: item.quantity,
                          referenceNo: values.referenceNo.trim(),
                          orderType: 'inbound' as const,
                          inboundOrderId: editingOrder.id,
                          reason: values.reason || t('inventory.inStock'),
                          unitPrice: item.unitPrice,
                          storeId: assignedStoreId,
                          createdAt: createdAt
                        })
                      }

                      message.success(t('common.success'))
                    } else {
                      // 创建模式：创建新订单
                      const inboundOrderData: Omit<InboundOrder, 'id' | 'updatedAt'> = {
                        referenceNo: values.referenceNo.trim(),
                        type: 'purchase',
                        reason: values.reason || t('inventory.inStock'),
                        items: orderItems,
                        totalQuantity,
                        totalValue,
                        attachments: uploadedAttachments.length > 0 ? uploadedAttachments : undefined,
                        status: 'completed',
                        operatorId: 'system',
                        storeId: assignedStoreId,
                        createdAt: movementDate
                      }

                      await createInboundOrder(inboundOrderData)
                      message.success(t('inventory.inStockSuccess'))
                    }

                    inForm.resetFields()
                    refreshItems()
                    refreshInboundOrders()
                    refreshInventoryMovements()
                    setInModalOpen(false)
                    setEditingOrder(null)
                    setAttachmentFileList([])
                    setUploadedAttachments([])
                  } finally {
                    setLoading(false)
                  }
                }}>
                  <div style={{ width: '100%', overflow: 'hidden' }}>
                    {/* 左右分栏布局 */}
                    <Row gutter={16}>
                      {/* 左侧：门店、单号和原因 */}
                      <Col span={12}>
                        {(isSuperAdmin || currentUser?.role === 'developer') ? (
                          <Form.Item label={t('common.store')} name="storeId" rules={[{ required: true, message: t('common.pleaseSelectStore') }]} style={{ marginBottom: 12 }}>
                            <Select
                              placeholder={t('common.pleaseSelectStore')}
                              options={stores.map(store => ({ label: store.name, value: store.id }))}
                            />
                          </Form.Item>
                        ) : (
                          <Form.Item label={t('common.store')} style={{ marginBottom: 12 }}>
                            <Input disabled value={stores.find(s => s.id === currentUser?.storeId)?.name || currentUser?.storeId || t('common.defaultStore')} />
                          </Form.Item>
                        )}
                        <Form.Item label={t('inventory.referenceNo')} name="referenceNo" style={{ marginBottom: 12 }}>
                          <Input placeholder={t('inventory.pleaseInputReferenceNo')} />
                        </Form.Item>
                        <Form.Item label={t('inventory.reason')} name="reason" style={{ marginBottom: 12 }}>
                          <Input placeholder={t('inventory.forExample') + t('inventory.purchaseInStock')} />
                        </Form.Item>
                        <Form.Item
                          label="Stock Movement Date"
                          name="movementDate"
                          initialValue={dayjs()}
                          style={{ marginBottom: 12 }}
                        >
                          <DatePicker
                            style={{ width: '100%' }}
                            format="YYYY-MM-DD"
                            allowClear={false}
                            className="points-config-form"
                          />
                        </Form.Item>
                      </Col>

                      {/* 右侧：附件上传 */}
                      <Col span={12}>
                        <Form.Item label={t('inventory.attachments')} style={{ marginBottom: 12 }}>
                          <Upload
                            accept=".pdf,.jpg,.jpeg,.png"
                            fileList={attachmentFileList}
                            beforeUpload={(file) => {
                              const isPDF = file.type === 'application/pdf'
                              const isImage = file.type.startsWith('image/')
                              if (!isPDF && !isImage) {
                                message.error(t('inventory.supportedFormats'))
                                return Upload.LIST_IGNORE
                              }
                              const isLt10M = file.size / 1024 / 1024 < 10
                              if (!isLt10M) {
                                message.error(t('inventory.maxFileSize'))
                                return Upload.LIST_IGNORE
                              }
                              return false
                            }}
                            onChange={async (info) => {
                              setAttachmentFileList(info.fileList)

                              const file = info.file
                              if (file.originFileObj && file.status === undefined) {
                                try {
                                  const uploadResult = await cloudinaryUpload(file.originFileObj, {
                                    folder: 'inventory_documents'
                                  })

                                  const isPDF = file.type === 'application/pdf'
                                  const newAttachment = {
                                    url: uploadResult.secure_url,
                                    type: (isPDF ? 'pdf' : 'image') as 'pdf' | 'image',
                                    filename: file.name,
                                    uploadedAt: new Date()
                                  }

                                  setUploadedAttachments(prev => [...prev, newAttachment])

                                  setAttachmentFileList(prev =>
                                    prev.map(f =>
                                      f.uid === file.uid
                                        ? { ...f, status: 'done', url: uploadResult.secure_url }
                                        : f
                                    )
                                  )

                                  message.success(t('inventory.uploadSuccess'))
                                } catch (error) {
                                  message.error(t('inventory.uploadFailed'))
                                  setAttachmentFileList(prev => prev.filter(f => f.uid !== file.uid))
                                }
                              }
                            }}
                            onRemove={(file) => {
                              const fileUrl = file.url
                              if (fileUrl) {
                                setUploadedAttachments(prev => prev.filter(att => att.url !== fileUrl))
                              }
                            }}
                            listType="picture"
                            maxCount={1}
                          >
                            <Button icon={<UploadOutlined />} loading={uploadingFile}>
                              {t('inventory.uploadOrderDocument')}
                            </Button>
                          </Upload>
                          <div style={{ fontSize: 12, color: '#8c8c8c', marginTop: 4 }}>
                            {t('inventory.supportedFormats')} · {t('inventory.maxFileSize')}
                          </div>
                        </Form.Item>
                      </Col>
                    </Row>

                    <Form.List name="items" initialValue={[{ itemType: 'cigar', cigarId: undefined, quantity: 1 }]}>
                      {(fields, { add, remove }) => (
                        <div>
                          {/* 电脑端表头 */}
                          {!isMobile && fields.length > 0 && (
                            <Row gutter={12} style={{ marginBottom: 6, paddingLeft: 12, paddingRight: 72, color: 'rgba(255, 255, 255, 0.45)', fontSize: 12, fontWeight: 500 }}>
                              <Col flex="120px">{t('inventory.itemType')}</Col>
                              <Col flex="auto">{t('inventory.product')}</Col>
                              <Col flex="100px">{t('inventory.quantity')}</Col>
                              <Col flex="120px">{t('inventory.unitPrice')}</Col>
                            </Row>
                          )}

                          {fields.map((field, index) => {
                            const { key, name, fieldKey, ...restField } = field
                            return (
                              <div key={key} style={{
                                marginBottom: isMobile ? 16 : 10,
                                padding: isMobile ? 16 : 10,
                                border: '1px solid rgba(255, 255, 255, 0.08)',
                                borderRadius: isMobile ? 12 : 8,
                                background: 'rgba(255, 255, 255, 0.02)',
                                transition: 'all 0.3s'
                              }}>
                                {/* 电脑端：一行显示所有字段 */}
                                {!isMobile ? (
                                  <Row gutter={12} align="middle">
                                    <Col flex="120px">
                                      <Form.Item
                                        {...restField}
                                        name={[name, 'itemType']}
                                        fieldKey={fieldKey}
                                        initialValue="cigar"
                                        style={{ marginBottom: 0 }}
                                      >
                                        <Select
                                          placeholder={t('inventory.selectItemType')}
                                          onChange={() => {
                                            const currentValues = inForm.getFieldValue('items')
                                            if (currentValues && currentValues[name]) {
                                              currentValues[name].cigarId = undefined
                                              currentValues[name].customName = undefined
                                              inForm.setFieldsValue({ items: currentValues })
                                            }
                                          }}
                                        >
                                          <Option value="cigar">{t('inventory.itemTypeCigar')}</Option>
                                          <Option value="activity">{t('inventory.itemTypeActivity')}</Option>
                                          <Option value="gift">{t('inventory.itemTypeGift')}</Option>
                                          <Option value="service">💼 {t('inventory.itemTypeService')}</Option>
                                          <Option value="other">📦 {t('inventory.itemTypeOther')}</Option>
                                        </Select>
                                      </Form.Item>
                                    </Col>

                                    <Col flex="auto">
                                      <Form.Item noStyle shouldUpdate={(prevValues, currentValues) => {
                                        const prev = prevValues.items?.[name]?.itemType
                                        const curr = currentValues.items?.[name]?.itemType
                                        return prev !== curr
                                      }}>
                                        {({ getFieldValue }) => {
                                          const itemType = getFieldValue(['items', name, 'itemType']) || 'cigar'

                                          return itemType === 'cigar' ? (
                                            <Form.Item
                                              {...restField}
                                              name={[name, 'cigarId']}
                                              fieldKey={fieldKey}
                                              rules={[{ required: true, message: t('inventory.pleaseSelectProduct') }]}
                                              style={{ marginBottom: 0 }}
                                            >
                                              <Select
                                                placeholder={t('inventory.pleaseSelectProduct')}
                                                showSearch
                                                optionFilterProp="children"
                                                filterOption={(input, option) => {
                                                  const kw = (input || '').toLowerCase()
                                                  const text = String((option?.children as any) || '').toLowerCase()
                                                  return text.includes(kw)
                                                }}
                                              >
                                                {groupedCigars.map(group => (
                                                  <Select.OptGroup key={group.brand} label={group.brand}>
                                                    {group.list.map(i => (
                                                      <Option key={i.id} value={i.id}>{i.name} - RM{i.price}（{t('inventory.stock')}：{getComputedStock(i.id)}）</Option>
                                                    ))}
                                                  </Select.OptGroup>
                                                ))}
                                              </Select>
                                            </Form.Item>
                                          ) : (
                                            <Form.Item
                                              {...restField}
                                              name={[name, 'customName']}
                                              fieldKey={fieldKey}
                                              rules={[{ required: true, message: t('inventory.itemNameRequired') }]}
                                              style={{ marginBottom: 0 }}
                                            >
                                              <Input placeholder={t('inventory.itemNamePlaceholder')} />
                                            </Form.Item>
                                          )
                                        }}
                                      </Form.Item>
                                    </Col>

                                    <Col flex="100px">
                                      <Form.Item
                                        {...restField}
                                        name={[name, 'quantity']}
                                        fieldKey={fieldKey}
                                        rules={[{ required: true, message: t('inventory.pleaseInputQuantity') }]}
                                        style={{ marginBottom: 0 }}
                                      >
                                        <InputNumber min={1} placeholder={t('inventory.quantity')} style={{ width: '100%' }} />
                                      </Form.Item>
                                    </Col>

                                    <Col flex="120px">
                                      <Form.Item
                                        {...restField}
                                        name={[name, 'unitPrice']}
                                        fieldKey={fieldKey}
                                        style={{ marginBottom: 0 }}
                                      >
                                        <InputNumber min={0} step={0.01} placeholder={t('inventory.price')} style={{ width: '100%' }} />
                                      </Form.Item>
                                    </Col>

                                    <Col flex="60px" style={{ textAlign: 'right' }}>
                                      {fields.length > 1 && (
                                        <Button
                                          type="link"
                                          danger
                                          size="small"
                                          icon={<MinusCircleOutlined />}
                                          onClick={() => remove(name)}
                                          style={{ padding: 0 }}
                                        >
                                          {t('common.delete')}
                                        </Button>
                                      )}
                                    </Col>
                                  </Row>
                                ) : (
                                  <>
                                    {/* 移动端：卡片布局，顶部显示产品序号与删除按钮 */}
                                    <div style={{
                                      display: 'flex',
                                      justifyContent: 'space-between',
                                      alignItems: 'center',
                                      marginBottom: 12,
                                      borderBottom: '1px solid rgba(255, 255, 255, 0.08)',
                                      paddingBottom: 8
                                    }}>
                                      <span style={{ fontWeight: 600, color: 'rgba(255, 255, 255, 0.85)', fontSize: 13 }}>
                                        {t('inventory.product')} #{index + 1}
                                      </span>
                                      {fields.length > 1 && (
                                        <Button
                                          type="link"
                                          danger
                                          size="small"
                                          icon={<MinusCircleOutlined />}
                                          onClick={() => remove(name)}
                                          style={{ padding: 0, height: 'auto', display: 'flex', alignItems: 'center' }}
                                        >
                                          {t('common.delete')}
                                        </Button>
                                      )}
                                    </div>

                                    <Row gutter={[12, 12]}>
                                      {/* 类型选择 */}
                                      <Col span={24}>
                                        <div style={{ fontSize: 11, color: 'rgba(255, 255, 255, 0.45)', marginBottom: 4 }}>
                                          {t('inventory.itemType')}
                                        </div>
                                        <Form.Item
                                          {...restField}
                                          name={[name, 'itemType']}
                                          fieldKey={fieldKey}
                                          initialValue="cigar"
                                          style={{ marginBottom: 0 }}
                                        >
                                          <Select
                                            placeholder={t('inventory.selectItemType')}
                                            onChange={() => {
                                              const currentValues = inForm.getFieldValue('items')
                                              if (currentValues && currentValues[name]) {
                                                currentValues[name].cigarId = undefined
                                                currentValues[name].customName = undefined
                                                inForm.setFieldsValue({ items: currentValues })
                                              }
                                            }}
                                          >
                                            <Option value="cigar">🎯 {t('inventory.itemTypeCigar')}</Option>
                                            <Option value="activity">🎪 {t('inventory.itemTypeActivity')}</Option>
                                            <Option value="gift">🎁 {t('inventory.itemTypeGift')}</Option>
                                            <Option value="service">💼 {t('inventory.itemTypeService')}</Option>
                                            <Option value="other">📦 {t('inventory.itemTypeOther')}</Option>
                                          </Select>
                                        </Form.Item>
                                      </Col>

                                      {/* 产品/名称选择 */}
                                      <Col span={24}>
                                        <Form.Item noStyle shouldUpdate={(prevValues, currentValues) => {
                                          const prev = prevValues.items?.[name]?.itemType
                                          const curr = currentValues.items?.[name]?.itemType
                                          return prev !== curr
                                        }}>
                                          {({ getFieldValue }) => {
                                            const itemType = getFieldValue(['items', name, 'itemType']) || 'cigar'
                                            const label = itemType === 'cigar' ? t('inventory.product') : t('inventory.customItemName')
                                            
                                            return (
                                              <>
                                                <div style={{ fontSize: 11, color: 'rgba(255, 255, 255, 0.45)', marginBottom: 4 }}>
                                                  {label}
                                                </div>
                                                {itemType === 'cigar' ? (
                                                  <Form.Item
                                                    {...restField}
                                                    name={[name, 'cigarId']}
                                                    fieldKey={fieldKey}
                                                    rules={[{ required: true, message: t('inventory.pleaseSelectProduct') }]}
                                                    style={{ marginBottom: 0 }}
                                                  >
                                                    <Select
                                                      placeholder={t('inventory.pleaseSelectProduct')}
                                                      showSearch
                                                      optionFilterProp="children"
                                                      filterOption={(input, option) => {
                                                        const kw = (input || '').toLowerCase()
                                                        const text = String((option?.children as any) || '').toLowerCase()
                                                        return text.includes(kw)
                                                      }}
                                                    >
                                                      {groupedCigars.map(group => (
                                                        <Select.OptGroup key={group.brand} label={group.brand}>
                                                          {group.list.map(i => (
                                                            <Option key={i.id} value={i.id}>{i.name} - RM{i.price}（{t('inventory.stock')}：{getComputedStock(i.id)}）</Option>
                                                          ))}
                                                        </Select.OptGroup>
                                                      ))}
                                                    </Select>
                                                  </Form.Item>
                                                ) : (
                                                  <Form.Item
                                                    {...restField}
                                                    name={[name, 'customName']}
                                                    fieldKey={fieldKey}
                                                    rules={[{ required: true, message: t('inventory.itemNameRequired') }]}
                                                    style={{ marginBottom: 0 }}
                                                  >
                                                    <Input placeholder={t('inventory.itemNamePlaceholder')} />
                                                  </Form.Item>
                                                )}
                                              </>
                                            )
                                          }}
                                        </Form.Item>
                                      </Col>

                                      {/* 数量与单价并排 */}
                                      <Col span={12}>
                                        <div style={{ fontSize: 11, color: 'rgba(255, 255, 255, 0.45)', marginBottom: 4 }}>
                                          {t('inventory.quantity')}
                                        </div>
                                        <Form.Item
                                          {...restField}
                                          name={[name, 'quantity']}
                                          fieldKey={fieldKey}
                                          rules={[{ required: true, message: t('inventory.pleaseInputQuantity') }]}
                                          style={{ marginBottom: 0 }}
                                        >
                                          <InputNumber min={1} placeholder={t('inventory.quantity')} style={{ width: '100%' }} />
                                        </Form.Item>
                                      </Col>

                                      <Col span={12}>
                                        <div style={{ fontSize: 11, color: 'rgba(255, 255, 255, 0.45)', marginBottom: 4 }}>
                                          {t('inventory.unitPrice')}
                                        </div>
                                        <Form.Item
                                          {...restField}
                                          name={[name, 'unitPrice']}
                                          fieldKey={fieldKey}
                                          style={{ marginBottom: 0 }}
                                        >
                                          <InputNumber min={0} step={0.01} placeholder={t('inventory.price')} style={{ width: '100%' }} />
                                        </Form.Item>
                                      </Col>
                                    </Row>
                                  </>
                                )}
                              </div>
                            )
                          })}
                          <Form.Item style={{ marginBottom: 0 }}>
                            <Button type="dashed" onClick={() => add({ itemType: 'cigar', quantity: 1 })} icon={<PlusOutlined />} style={{ width: '100%' }}>
                              {t('inventory.addDetail')}
                            </Button>
                          </Form.Item>
                        </div>
                      )}
                    </Form.List>

                    <Form.Item style={{ marginTop: 16, marginBottom: 0 }}>
                      <Space>
                        <Button onClick={() => {
                          setInModalOpen(false)
                          setEditingOrder(null)
                          inForm.resetFields()
                          setAttachmentFileList([])
                          setUploadedAttachments([])
                        }}>{t('common.cancel')}</Button>
                        <Button type="primary" htmlType="submit" loading={loading}>
                          {editingOrder ? t('inventory.saveModifications') : t('inventory.confirmInStock')}
                        </Button>
                      </Space>
                    </Form.Item>
                  </div>
                </Form>
              </Modal>
              {/* 入库列表（滚动容器） */}
              <div
                style={{
                  overflowY: 'auto',
                  overflowX: 'hidden',
                  maxHeight: isMobile ? 'calc(100vh - 210px)' : 'calc(100vh - 240px)',
                  paddingTop: 8,
                  paddingBottom: 84
                }}
              >
                {!isMobile ? (
                  <div className="points-config-form">
                    <Table
                      style={{ marginTop: 1, background: 'transparent' }}
                      dataSource={inLogsGroupedByReference}
                      rowKey={(record) => record.id || `ref-${record.referenceNo}` || 'no-ref'}
                      pagination={{
                        pageSize: inPageSize,
                        showSizeChanger: true,
                        showQuickJumper: false,
                        pageSizeOptions: ['5', '10', '20', '50'],
                        onChange: (_page, size) => {
                          const next = size || inPageSize
                          setInPageSize(next)
                          try { localStorage.setItem('inventory_in_page_size', String(next)) } catch { }
                        }
                      }}
                      expandable={{
                        expandedRowKeys: inLogsExpandedKeys,
                        onExpandedRowsChange: (keys) => setInLogsExpandedKeys([...keys]),
                        expandedRowRender: (record: any) => (
                          <div className="points-config-form">
                            <Table
                              dataSource={record.logs}
                              rowKey="id"
                              pagination={false}
                              size="small"
                              showHeader={true}
                              style={{ marginLeft: 20, background: 'transparent' }}
                              columns={[
                                {
                                  title: t('inventory.product'),
                                  dataIndex: 'cigarId',
                                  key: 'cigarId',
                                  render: (id: string, rec: any) => {
                                    const cigar = items.find(i => i.id === id)
                                    const itemType = rec.itemType || 'cigar'
                                    const itemTypeIcons: { [key: string]: string } = {
                                      'cigar': '🎯',
                                      'activity': '🎪',
                                      'gift': '🎁',
                                      'service': '💼',
                                      'other': '📦'
                                    }
                                    const itemTypeColors: { [key: string]: string } = {
                                      'cigar': '#52c41a',
                                      'activity': '#722ed1',
                                      'gift': '#faad14',
                                      'service': '#1890ff',
                                      'other': '#8c8c8c'
                                    }
                                    const icon = itemTypeIcons[itemType] || ''
                                    const color = itemTypeColors[itemType] || '#52c41a'
                                    const displayName = rec.cigarName || cigar?.name || id

                                    return (
                                      <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}>
                                        <span style={{ marginRight: 4 }}>{icon}</span>
                                        <span style={{ color: itemType !== 'cigar' ? color : undefined }}>
                                          {displayName}
                                        </span>
                                        {itemType !== 'cigar' && (
                                          <span style={{
                                            padding: '1px 6px',
                                            fontSize: 10,
                                            fontWeight: 600,
                                            background: `${color}20`,
                                            color: color,
                                            borderRadius: 4,
                                            border: `1px solid ${color}40`,
                                            whiteSpace: 'nowrap'
                                          }}>
                                            {t(`inventory.itemType${itemType.charAt(0).toUpperCase() + itemType.slice(1)}` as any)}
                                          </span>
                                        )}
                                      </span>
                                    )
                                  }
                                },
                                {
                                  title: t('inventory.quantity'),
                                  dataIndex: 'quantity',
                                  key: 'quantity',
                                  render: (qty: number) => (
                                    <span style={{ color: '#52c41a', fontWeight: 600 }}>+{qty}</span>
                                  )
                                },
                                {
                                  title: t('inventory.unitPrice'),
                                  dataIndex: 'unitPrice',
                                  key: 'unitPrice',
                                  render: (price: number) => price ? `RM ${price.toFixed(2)}` : '-'
                                },
                                {
                                  title: t('inventory.totalValue'),
                                  key: 'totalValue',
                                  render: (_: any, rec: any) => {
                                    const val = Number(rec.quantity || 0) * Number(rec.unitPrice || 0)
                                    return val > 0 ? `RM ${val.toFixed(2)}` : '-'
                                  }
                                },
                                {
                                  title: t('inventory.time'),
                                  dataIndex: 'createdAt',
                                  key: 'createdAt',
                                  render: (v: any) => {
                                    const d = toDateSafe(v)
                                    return d ? d.toLocaleString('zh-CN', {
                                      month: '2-digit',
                                      day: '2-digit',
                                      hour: '2-digit',
                                      minute: '2-digit'
                                    }) : '-'
                                  }
                                },
                                {
                                  title: t('inventory.attachments'),
                                  key: 'attachments',
                                  width: 120,
                                  render: (_: any, rec: any) => {
                                    const attachments = rec.attachments || []
                                    if (attachments.length === 0) {
                                      return <span style={{ color: 'rgba(255, 255, 255, 0.6)' }}>-</span>
                                    }
                                    return (
                                      <Space size="small">
                                        {attachments.map((att: any, idx: number) => {
                                          const isPDF = att.type === 'pdf'
                                          return (
                                            <Button
                                              key={idx}
                                              type="link"
                                              size="small"
                                              icon={isPDF ? <FilePdfOutlined /> : <FileImageOutlined />}
                                              onClick={() => window.open(att.url, '_blank')}
                                              title={att.filename}
                                            >
                                              {isPDF ? 'PDF' : t('common.image')}
                                            </Button>
                                          )
                                        })}
                                      </Space>
                                    )
                                  }
                                },
                                // ✅ 新架构：移除产品级别的编辑/删除（订单应不可变）
                                // 如需修改，请使用"取消订单"或"创建反向订单"
                              ]}
                            />
                          </div>
                        ),
                        columnWidth: 60,
                        columnTitle: (
                          <div style={{ display: 'flex', justifyContent: 'center' }}>
                            <button
                              onClick={() => {
                                if (inLogsExpandedKeys.length > 0) {
                                  setInLogsExpandedKeys([])
                                } else {
                                  setInLogsExpandedKeys(inLogsGroupedByReference.map(g => g.id || `ref-${g.referenceNo}` || 'no-ref'))
                                }
                              }}
                              style={{
                                padding: '2px 8px',
                                fontSize: 12,
                                background: 'rgba(244, 175, 37, 0.1)',
                                border: '1px solid rgba(244, 175, 37, 0.6)',
                                borderRadius: 4,
                                color: '#f4af25',
                                cursor: 'pointer',
                                fontWeight: 600
                              }}
                            >
                              {inLogsExpandedKeys.length > 0 ? t('inventory.collapseAll') : t('inventory.expandAll')}
                            </button>
                          </div>
                        )
                      }}
                      columns={[
                        {
                          title: t('inventory.referenceNo'),
                          dataIndex: 'referenceNo',
                          key: 'referenceNo',
                          render: (refNo: string) => (
                            <span style={{
                              fontFamily: 'monospace',
                              fontWeight: 600,
                              color: refNo === t('inventory.unassignedReference') ? 'rgba(255, 255, 255, 0.6)' : '#1890ff'
                            }}>
                              {refNo}
                            </span>
                          )
                        },
                        {
                          title: t('inventory.time'),
                          dataIndex: 'date',
                          key: 'date',
                          render: (date: Date | null) => formatYMD(date),
                          sorter: (a: any, b: any) => {
                            const dateA = a.date?.getTime() || 0;
                            const dateB = b.date?.getTime() || 0;
                            return dateA - dateB;
                          }
                        },
                        {
                          title: t('inventory.totalQuantity'),
                          dataIndex: 'totalQuantity',
                          key: 'totalQuantity',
                          render: (qty: number) => (
                            <span style={{ color: '#52c41a', fontWeight: 600 }}>+{qty}</span>
                          )
                        },
                        {
                          title: t('inventory.totalValue'),
                          dataIndex: 'totalValue',
                          key: 'totalValue',
                          render: (val: number) => val > 0 ? `RM ${val.toFixed(2)}` : '-'
                        },
                        {
                          title: t('inventory.reason'),
                          dataIndex: 'reason',
                          key: 'reason',
                          render: (reason: string) => reason || '-'
                        },
                        {
                          title: t('common.status'),
                          key: 'orderStatus',
                          width: 100,
                          render: (_: any, group: any) => {
                            const order = inboundOrders.find(o => o.referenceNo === group.referenceNo)
                            if (!order) return null

                            if (order.status === 'completed') {
                              return <Tag color="success">✓ {t('common.completed')}</Tag>
                            } else if (order.status === 'cancelled') {
                              return <Tag color="error">✕ {t('common.cancelled')}</Tag>
                            } else if (order.status === 'pending') {
                              return <Tag color="warning">⏳ {t('common.pending')}</Tag>
                            }
                            return null
                          }
                        },
                        {
                          title: t('inventory.paymentStatus'),
                          key: 'paymentStatus',
                          width: 120,
                          render: (_: any, group: any) => {
                            const status = getInboundReferenceMatchStatus(group.referenceNo)

                            if (status.status === 'none' || status.total === 0) {
                              return <Tag color="default">{t('inventory.unpaid')}</Tag>
                            } else if (status.status === 'fully') {
                              return (
                                <Tag color="success">
                                  ✓ {t('inventory.fullyPaid')}
                                </Tag>
                              )
                            } else if (status.status === 'partial') {
                              return (
                                <Tag color="warning">
                                  {t('inventory.partiallyPaid')} ({Math.round((status.matched / status.total) * 100)}%)
                                </Tag>
                              )
                            }
                            return null
                          }
                        },
                        {
                          title: t('inventory.actions'),
                          key: 'actions',
                          width: 150,
                          render: (_: any, group: any) => (
                            <Space size="small">
                              {/* 编辑订单 */}
                              <Button
                                type="link"
                                icon={<EditOutlined />}
                                size="small"
                                onClick={() => {
                                  // 使用 group.id 直接查找订单，而不是通过 referenceNo
                                  const order = inboundOrders.find(o => o.id === group.id)

                                  if (order) {
                                    setEditingOrder(order)
                                    orderEditForm.setFieldsValue({
                                      referenceNo: order.referenceNo,
                                      reason: order.reason,
                                      items: order.items,
                                      notes: order.notes
                                    })
                                  } else {
                                    message.error(t('inventory.orderNotFound'))
                                  }
                                }}
                              >
                                {t('inventory.edit')}
                              </Button>

                              {/* 取消订单（标记为cancelled，不删除） */}
                              <Button
                                type="link"
                                size="small"
                                style={{ color: '#faad14' }}
                                onClick={() => {

                                  Modal.confirm({
                                    title: t('inventory.cancelConfirmTitle'),
                                    content: (
                                      <p>{t('inventory.cancelConfirmContent', { ref: group.referenceNo })}</p>
                                    ),
                                    okText: t('common.confirm'),
                                    cancelText: t('common.back'),
                                    onOk: async () => {
                                      setLoading(true)
                                      try {
                                        // 使用 group.id 直接查找订单，而不是通过 referenceNo
                                        const order = inboundOrders.find(o => o.id === group.id)

                                        if (order) {
                                          await updateInboundOrder(order.id, { status: 'cancelled' })
                                          message.success(t('inventory.orderCancelled'))
                                          refreshInboundOrders()
                                        } else {
                                          message.error(t('inventory.orderNotFound'))
                                        }
                                      } catch (error: any) {
                                        message.error(t('common.error') + ': ' + error.message)
                                      } finally {
                                        setLoading(false)
                                      }
                                    },
                                    onCancel: () => {
                                    }
                                  })
                                }}
                              >
                                {t('inventory.cancel')}
                              </Button>

                              {/* 反向订单（退货/红冲） */}
                              <Button
                                type="link"
                                size="small"
                                style={{ color: '#ff7a45' }}
                                onClick={() => {

                                  Modal.confirm({
                                    title: t('inventory.returnConfirmTitle'),
                                    content: (
                                      <p>{t('inventory.returnConfirmContent', { ref: group.referenceNo })}</p>
                                    ),
                                    okText: t('common.confirm'),
                                    cancelText: t('common.cancel'),
                                    onOk: async () => {
                                      setLoading(true)
                                      try {
                                        // 使用 group.id 直接查找订单，而不是通过 referenceNo
                                        const order = inboundOrders.find(o => o.id === group.id)

                                        if (!order) {
                                          message.error(t('inventory.orderNotFound'))
                                          return
                                        }

                                        // 创建反向订单（退货）
                                        const returnReferenceNo = `RETURN-${group.referenceNo}-${Date.now()}`
                                        const returnOrderData: Omit<InboundOrder, 'id' | 'updatedAt'> = {
                                          referenceNo: returnReferenceNo,
                                          type: 'return',
                                          reason: t('inventory.returnReason', { referenceNo: group.referenceNo }),
                                          items: order.items.map(item => ({
                                            ...item,
                                            quantity: -item.quantity
                                          })),
                                          totalQuantity: -order.totalQuantity,
                                          totalValue: -order.totalValue,
                                          status: 'completed',
                                          operatorId: currentUser?.displayName || 'system',
                                          storeId: currentUser?.storeId,
                                          createdAt: new Date()
                                        }

                                        await createInboundOrder(returnOrderData)
                                        message.success(t('inventory.returnOrderCreated'))
                                        refreshInboundOrders()
                                        refreshInventoryMovements()
                                      } catch (error: any) {
                                        message.error(t('common.error') + ': ' + error.message)
                                      } finally {
                                        setLoading(false)
                                      }
                                    },
                                    onCancel: () => {
                                    }
                                  })
                                }}
                              >
                                🔄 {t('inventory.return')}
                              </Button>

                              {/* 删除订单 */}
                              <Button
                                type="link"
                                icon={<DeleteOutlined />}
                                size="small"
                                danger
                                onClick={() => {

                                  // 使用受控的 Modal 替代 modal.confirm，以解决 React 19 兼容性问题
                                  openDeleteOrder({
                                    id: group.id,
                                    referenceNo: group.referenceNo,
                                    productCount: group.productCount
                                  })
                                }}
                              />
                            </Space>
                          )
                        }
                      ]}
                    />
                  </div>
                ) : (
                  <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
                    {inLogsGroupedByReference.map((group: any) => {
                      const isExpanded = inLogsExpandedKeys.includes(group.id || `ref-${group.referenceNo}` || 'no-ref')
                      return (
                        <div
                          key={group.id || `ref-${group.referenceNo}` || 'no-ref'}
                          style={{
                            borderRadius: 16,
                            background: 'rgba(0, 0, 0, 0.2)',
                            border: '1px solid rgba(244, 175, 37, 0.6)',
                            overflow: 'hidden',
                            boxShadow: '0 10px 30px rgba(0, 0, 0, 0.25)'
                          }}
                        >
                          {/* 单号头部 */}
                          <div
                            onClick={() => {
                              const key = group.id || `ref-${group.referenceNo}` || 'no-ref'
                              if (isExpanded) {
                                setInLogsExpandedKeys(prev => prev.filter(k => k !== key))
                              } else {
                                setInLogsExpandedKeys(prev => [...prev, key])
                              }
                            }}
                            style={{
                              padding: 12,
                              background: 'rgba(0, 0, 0, 0.3)',
                              cursor: 'pointer',
                              display: 'flex',
                              justifyContent: 'space-between',
                              alignItems: 'center'
                            }}
                          >
                            <div style={{ flex: 1 }}>
                              <div style={{
                                display: 'flex',
                                alignItems: 'center',
                                gap: 6,
                                marginBottom: 4,
                                flexWrap: 'wrap'
                              }}>
                                <div style={{
                                  fontSize: 16,
                                  fontWeight: 700,
                                  color: '#fff',
                                  fontFamily: 'monospace'
                                }}>
                                  {group.referenceNo}
                                </div>
                                {(() => {
                                  const order = inboundOrders.find(o => o.referenceNo === group.referenceNo)
                                  if (order) {
                                    if (order.status === 'cancelled') {
                                      return (
                                        <span style={{
                                          padding: '2px 6px',
                                          fontSize: 10,
                                          fontWeight: 600,
                                          background: 'rgba(255, 77, 79, 0.2)',
                                          color: '#ff4d4f',
                                          borderRadius: 4,
                                          border: '1px solid rgba(255, 77, 79, 0.4)'
                                        }}>
                                          ✕ {t('common.cancelled')}
                                        </span>
                                      )
                                    } else if (order.status === 'pending') {
                                      return (
                                        <span style={{
                                          padding: '2px 6px',
                                          fontSize: 10,
                                          fontWeight: 600,
                                          background: 'rgba(250, 173, 20, 0.2)',
                                          color: '#faad14',
                                          borderRadius: 4,
                                          border: '1px solid rgba(250, 173, 20, 0.4)'
                                        }}>
                                          ⏳ {t('common.pending')}
                                        </span>
                                      )
                                    }
                                  }
                                  return null
                                })()}
                                {(() => {
                                  const status = getInboundReferenceMatchStatus(group.referenceNo)
                                  if (status.status === 'fully') {
                                    return (
                                      <span style={{
                                        padding: '2px 6px',
                                        fontSize: 10,
                                        fontWeight: 600,
                                        background: 'rgba(82, 196, 26, 0.2)',
                                        color: '#52c41a',
                                        borderRadius: 4,
                                        border: '1px solid rgba(82, 196, 26, 0.5)'
                                      }}>
                                        ✓ {t('inventory.fullyPaid')}
                                      </span>
                                    )
                                  } else if (status.status === 'partial') {
                                    return (
                                      <span style={{
                                        padding: '2px 6px',
                                        fontSize: 10,
                                        fontWeight: 600,
                                        background: 'rgba(250, 173, 20, 0.2)',
                                        color: '#faad14',
                                        borderRadius: 4,
                                        border: '1px solid rgba(250, 173, 20, 0.4)'
                                      }}>
                                        {t('inventory.partiallyPaid')} {Math.round((status.matched / status.total) * 100)}%
                                      </span>
                                    )
                                  } else if (status.total > 0) {
                                    return (
                                      <span style={{
                                        padding: '2px 6px',
                                        fontSize: 10,
                                        fontWeight: 600,
                                        background: 'rgba(255,255,255,0.1)',
                                        color: 'rgba(255,255,255,0.6)',
                                        borderRadius: 4,
                                        border: '1px solid rgba(255,255,255,0.2)'
                                      }}>
                                        {t('inventory.unpaid')}
                                      </span>
                                    )
                                  }
                                  return null
                                })()}
                              </div>
                              <div style={{
                                fontSize: 12,
                                color: 'rgba(255,255,255,0.7)',
                                marginTop: 4
                              }}>
                                {formatYMD(group.date)} · {group.productCount} {t('inventory.types')} · <span style={{ color: '#52c41a', fontWeight: 600 }}>+{group.totalQuantity}</span> {t('inventory.sticks')}
                                {(() => {
                                  const status = getInboundReferenceMatchStatus(group.referenceNo)
                                  if (status.total > 0) {
                                    return (
                                      <span style={{ color: '#f4af25', fontWeight: 700 }}>
                                        {' · RM '}{status.total.toFixed(2)}
                                      </span>
                                    )
                                  }
                                  return ''
                                })()}
                              </div>
                            </div>
                            <div style={{
                              fontSize: 20,
                              fontWeight: 700,
                              color: '#f4af25',
                              marginLeft: 8
                            }}>
                              {isExpanded ? '▲' : '▼'}
                            </div>
                          </div>

                          {/* 展开的产品列表 */}
                          {isExpanded && (
                            <div style={{ padding: 12, display: 'flex', flexDirection: 'column', gap: 8 }}>
                              {/* 操作按钮组 */}
                              <div style={{ display: 'flex', gap: 6, marginBottom: 8 }}>
                                {/* 编辑订单按钮 */}
                                <button
                                  onClick={(e) => {
                                    e.stopPropagation()
                                    // 使用 group.id 直接查找订单，而不是通过 referenceNo
                                    const order = inboundOrders.find(o => o.id === group.id)

                                    if (order) {
                                      setEditingOrder(order)
                                      orderEditForm.setFieldsValue({
                                        referenceNo: order.referenceNo,
                                        reason: order.reason,
                                        items: order.items,
                                        notes: order.notes
                                      })
                                    } else {
                                      message.error(t('inventory.orderNotFound'))
                                    }
                                  }}
                                  style={{
                                    flex: 1,
                                    padding: '8px 12px',
                                    borderRadius: 8,
                                    background: 'linear-gradient(to right, #FDE08D, #C48D3A)',
                                    color: '#111',
                                    fontSize: 12,
                                    fontWeight: 700,
                                    cursor: 'pointer',
                                    border: 'none'
                                  }}
                                >
                                  {t('inventory.edit')}
                                </button>

                                {/* 取消订单按钮 */}
                                <button
                                  onClick={(e) => {
                                    e.stopPropagation()

                                    Modal.confirm({
                                      title: t('inventory.cancelConfirmTitle'),
                                      content: (
                                        <p>{t('inventory.cancelConfirmContent', { ref: group.referenceNo })}</p>
                                      ),
                                      okText: t('common.confirm'),
                                      cancelText: t('common.back'),
                                      onOk: async () => {
                                        setLoading(true)
                                        try {
                                          // 使用 group.id 直接查找订单，而不是通过 referenceNo
                                          const order = inboundOrders.find(o => o.id === group.id)

                                          if (order) {
                                            await updateInboundOrder(order.id, { status: 'cancelled' })
                                            message.success(t('inventory.orderCancelled'))
                                            refreshInboundOrders()
                                          } else {
                                            message.error(t('inventory.orderNotFound'))
                                          }
                                        } catch (error: any) {
                                          message.error(t('common.error') + ': ' + error.message)
                                        } finally {
                                          setLoading(false)
                                        }
                                      },
                                      onCancel: () => {
                                      }
                                    })
                                  }}
                                  style={{
                                    flex: 1,
                                    padding: '8px 12px',
                                    borderRadius: 8,
                                    background: 'rgba(255, 255, 255, 0.1)',
                                    color: '#faad14',
                                    fontSize: 12,
                                    fontWeight: 600,
                                    cursor: 'pointer',
                                    border: '1px solid rgba(255, 255, 255, 0.2)'
                                  }}
                                >
                                  {t('inventory.cancel')}
                                </button>

                                {/* 退货按钮 */}
                                <button
                                  onClick={(e) => {
                                    e.stopPropagation()

                                    Modal.confirm({
                                      title: t('inventory.returnConfirmTitle'),
                                      content: (
                                        <p>{t('inventory.returnConfirmContent', { ref: group.referenceNo })}</p>
                                      ),
                                      okText: t('common.confirm'),
                                      cancelText: t('common.cancel'),
                                      onOk: async () => {
                                        setLoading(true)
                                        try {
                                          // 使用 group.id 直接查找订单，而不是通过 referenceNo
                                          const order = inboundOrders.find(o => o.id === group.id)

                                          if (!order) {
                                            message.error(t('inventory.orderNotFound'))
                                            return
                                          }

                                          const returnReferenceNo = `RETURN-${group.referenceNo}-${Date.now()}`
                                          const returnOrderData: Omit<InboundOrder, 'id' | 'updatedAt'> = {
                                            referenceNo: returnReferenceNo,
                                            type: 'return',
                                            reason: t('inventory.returnReason', { referenceNo: group.referenceNo }),
                                            items: order.items.map(item => ({
                                              ...item,
                                              quantity: -item.quantity
                                            })),
                                            totalQuantity: -order.totalQuantity,
                                            totalValue: -order.totalValue,
                                            status: 'completed',
                                            operatorId: currentUser?.displayName || 'system',
                                            storeId: currentUser?.storeId,
                                            createdAt: new Date()
                                          }

                                          await createInboundOrder(returnOrderData)
                                          message.success(t('inventory.returnOrderCreated'))
                                          refreshInboundOrders()
                                          refreshInventoryMovements()
                                        } catch (error: any) {
                                          message.error(t('common.error') + ': ' + error.message)
                                        } finally {
                                          setLoading(false)
                                        }
                                      },
                                      onCancel: () => {
                                      }
                                    })
                                  }}
                                  style={{
                                    flex: 1,
                                    padding: '8px 12px',
                                    borderRadius: 8,
                                    background: 'rgba(255, 255, 255, 0.1)',
                                    color: '#ff7a45',
                                    fontSize: 12,
                                    fontWeight: 600,
                                    cursor: 'pointer',
                                    border: '1px solid rgba(255, 255, 255, 0.2)'
                                  }}
                                >
                                  🔄 {t('inventory.return')}
                                </button>

                                {/* 删除订单按钮 */}
                                <button
                                  onClick={(e) => {
                                    e.stopPropagation()

                                    // 使用受控的 Modal 替代 modal.confirm，以解决 React 19 兼容性问题
                                    openDeleteOrder({
                                      id: group.id,
                                      referenceNo: group.referenceNo,
                                      productCount: group.productCount
                                    })
                                  }}
                                  style={{
                                    flex: 1,
                                    padding: '8px 12px',
                                    borderRadius: 8,
                                    background: 'rgba(255, 255, 255, 0.1)',
                                    color: '#ff4d4f',
                                    fontSize: 12,
                                    fontWeight: 600,
                                    cursor: 'pointer',
                                    border: '1px solid rgba(255, 255, 255, 0.2)'
                                  }}
                                >
                                  {t('common.delete')}
                                </button>
                              </div>
                              {group.logs.map((log: any) => {
                                const cigar = items.find(i => i.id === log.cigarId)
                                const itemValue = Number(log.quantity || 0) * Number(log.unitPrice || 0)
                                const logItemType = log.itemType || 'cigar'
                                const itemTypeIconMap: { [key: string]: string } = {
                                  'cigar': '🎯', 'activity': '🎪', 'gift': '🎁', 'service': '💼', 'other': '📦'
                                }
                                const itemTypeColorMap: { [key: string]: string } = {
                                  'cigar': '#52c41a', 'activity': '#722ed1', 'gift': '#faad14', 'service': '#1890ff', 'other': '#8c8c8c'
                                }
                                const typeIcon = itemTypeIconMap[logItemType] || '📦'
                                const typeColor = itemTypeColorMap[logItemType] || '#52c41a'
                                const displayName = log.cigarName || cigar?.name || log.cigarId
                                return (
                                  <div
                                    key={log.id}
                                    style={{
                                      display: 'flex',
                                      alignItems: 'flex-start',
                                      gap: 12,
                                      padding: 12,
                                      background: 'rgba(255,255,255,0.03)',
                                      borderRadius: 12,
                                      border: '1px solid rgba(255, 255, 255, 0.1)'
                                    }}
                                  >
                                    {/* 左侧图片占位 */}
                                    <div style={{
                                      width: 80,
                                      height: 80,
                                      borderRadius: 10,
                                      overflow: 'hidden',
                                      background: 'rgba(255, 255, 255, 0.08)',
                                      flexShrink: 0,
                                      display: 'flex',
                                      alignItems: 'center',
                                      justifyContent: 'center',
                                      fontSize: logItemType !== 'cigar' ? 28 : undefined
                                    }}>
                                      {logItemType !== 'cigar' ? (
                                        <span>{typeIcon}</span>
                                      ) : (
                                        <div style={{
                                          width: '100%',
                                          height: '100%',
                                          background: 'linear-gradient(135deg, rgba(255, 255, 255, 0.08), rgba(255, 255, 255, 0.02))'
                                        }} />
                                      )}
                                    </div>

                                    {/* 右侧信息 */}
                                    <div style={{ flex: 1 }}>
                                      {/* 产品名称 + 类型标签 */}
                                      <div style={{
                                        display: 'flex',
                                        alignItems: 'center',
                                        gap: 6,
                                        marginBottom: 4
                                      }}>
                                        <div style={{
                                          fontSize: 15,
                                          fontWeight: 700,
                                          color: logItemType !== 'cigar' ? typeColor : '#fff'
                                        }}>
                                          {displayName}
                                        </div>
                                        {logItemType !== 'cigar' && (
                                          <span style={{
                                            padding: '1px 6px',
                                            fontSize: 10,
                                            fontWeight: 600,
                                            background: `${typeColor}20`,
                                            color: typeColor,
                                            borderRadius: 4,
                                            border: `1px solid ${typeColor}40`,
                                            whiteSpace: 'nowrap'
                                          }}>
                                            {t(`inventory.itemType${logItemType.charAt(0).toUpperCase() + logItemType.slice(1)}` as any)}
                                          </span>
                                        )}
                                      </div>

                                      {/* SKU (仅雪茄产品显示) */}
                                      {logItemType === 'cigar' && (
                                        <div style={{
                                          fontSize: 12,
                                          color: 'rgba(224, 214, 196, 0.6)',
                                          marginBottom: 6
                                        }}>
                                          {cigar?.size || ''} {cigar?.size ? '|' : ''} SKU: {log.cigarId}
                                        </div>
                                      )}

                                      {/* 单价 */}
                                      <div style={{
                                        fontSize: 14,
                                        fontWeight: 700,
                                        color: '#f4af25',
                                        marginBottom: 6
                                      }}>
                                        RM {log.unitPrice?.toFixed(2) || '0.00'}
                                      </div>

                                      {/* 数量和小计 */}
                                      <div style={{
                                        display: 'flex',
                                        alignItems: 'center',
                                        gap: 12,
                                        fontSize: 12
                                      }}>
                                        <span style={{ color: '#52c41a', fontWeight: 600 }}>
                                          +{log.quantity} {t('inventory.sticks')}
                                        </span>
                                        <span style={{ color: 'rgba(224, 214, 196, 0.6)' }}>·</span>
                                        <span style={{ color: 'rgba(224, 214, 196, 0.8)' }}>
                                          {t('inventory.subtotal')}: <span style={{ color: '#fff', fontWeight: 600 }}>RM {itemValue.toFixed(2)}</span>
                                        </span>
                                      </div>
                                    </div>
                                  </div>
                                )
                              })}

                              {/* 单号汇总 */}
                              <div style={{
                                marginTop: 4,
                                padding: 10,
                                background: 'rgba(82, 196, 26, 0.1)',
                                borderRadius: 8,
                                border: '1px solid rgba(82, 196, 26, 0.3)'
                              }}>
                                <div style={{
                                  display: 'flex',
                                  justifyContent: 'space-between',
                                  fontSize: 12,
                                  color: '#fff',
                                  fontWeight: 600
                                }}>
                                  <div>{t('inventory.summary')}</div>
                                  <div style={{ color: '#52c41a' }}>
                                    +{group.totalQuantity} {t('inventory.sticks')}
                                    {group.totalValue > 0 ? ` · RM ${group.totalValue.toFixed(2)}` : ''}
                                  </div>
                                </div>
                                {group.reason && group.reason !== '-' && (
                                  <div style={{
                                    marginTop: 4,
                                    fontSize: 11,
                                    color: 'rgba(255,255,255,0.6)'
                                  }}>
                                    {group.reason}
                                  </div>
                                )}
                              </div>
                            </div>
                          )}
                        </div>
                      )
                    })}
                    {inLogsGroupedByReference.length === 0 && (
                      <div style={{
                        padding: 40,
                        textAlign: 'center',
                        color: 'rgba(255,255,255,0.4)',
                        fontSize: 14
                      }}>
                        {t('common.noData')}
                      </div>
                    )}
                  </div>
                )}
              </div>
            </div>
          )}
          {activeTab === 'out' && (
            <div>
              {/* 搜索和筛选（置顶） - 两行布局（与入库一致） */}
              <div
                style={{
                  position: 'sticky',
                  top: 0,
                  zIndex: 100,
                  background: 'rgba(255, 255, 255, 0.05)',
                  backdropFilter: 'blur(8px)',
                  WebkitBackdropFilter: 'blur(8px)',
                  border: '1px solid rgba(244,175,37,0.2)',
                  borderRadius: 12,
                  display: 'flex', flexDirection: 'column', gap: 12, marginBottom: 8, padding: 16
                }}
              >
                {/* 第一行：搜索框 */}
                <div style={{ display: 'flex', gap: 12, alignItems: 'center' }}>
                  <Search
                    placeholder={t('inventory.searchOutLogs')}
                    value={outSearchKeyword}
                    onChange={(e) => setOutSearchKeyword(e.target.value)}
                    style={{ flex: 1 }}
                    allowClear
                    className="points-config-form"
                  />
                </div>

                {/* 第二行：品牌筛选 + 出库统计 + 创建出库 */}
                <div style={{ display: 'flex', gap: 12, alignItems: 'center' }}>
                  <Select
                    placeholder={t('inventory.filterByBrand')}
                    value={outBrandFilter}
                    onChange={setOutBrandFilter}
                    style={{ flex: 1 }}
                    allowClear
                    className="gold-select"
                    popupClassName="gold-select-dropdown"
                  >
                    {Array.from(new Set(items.map(i => i.brand))).sort().map(brand => (
                      <Option key={brand} value={brand}>{brand}</Option>
                    ))}
                  </Select>
                  <button
                    onClick={() => setOutStatsOpen(true)}
                    style={{
                      padding: '6px 14px',
                      borderRadius: 8,
                      border: '1px solid rgba(244, 175, 37, 0.6)',
                      background: 'rgba(244, 175, 37, 0.1)',
                      color: '#f4af25',
                      cursor: 'pointer',
                      fontSize: 14,
                      fontWeight: 600,
                      whiteSpace: 'nowrap'
                    }}
                  >
                    {t('inventory.outStats')}
                  </button>
                  <button
                    onClick={() => setOutModalOpen(true)}
                    className="cigar-btn-gradient"
                    style={{ padding: '6px 14px', borderRadius: 8, whiteSpace: 'nowrap' }}
                  >
                    {t('inventory.createOutStock')}
                  </button>
                </div>
              </div>

              {/* 出库创建弹窗 */}
              <Modal
                title={t('inventory.createOutStock')}
                open={outModalOpen}
                onCancel={() => setOutModalOpen(false)}
                footer={null}
                {...getResponsiveModalConfig(isMobile, true, 720)}
                styles={{
                  body: {
                    overflowX: 'hidden',
                    paddingBottom: 16
                  }
                }}
              >
                <Form form={outForm} layout="vertical" className="dark-theme-form" onFinish={async (values: { referenceNo?: string; reason?: string; movementDate?: any; items: { cigarId: string; quantity: number }[] }) => {
                  const lines = (values.items || []).filter(it => it?.cigarId && it?.quantity > 0)
                  if (lines.length === 0) { message.warning(t('inventory.pleaseAddAtLeastOneOutStockDetail')); return }

                  // 检查单号
                  if (!values.referenceNo || !values.referenceNo.trim()) {
                    message.error(t('inventory.pleaseInputReferenceNo'))
                    return
                  }

                  setLoading(true)
                  try {
                    const orderItems = []
                    let totalQuantity = 0
                    let totalValue = 0

                    for (const line of lines) {
                      const target = items.find(i => i.id === line.cigarId) as any
                      if (!target) continue
                      const qty = Math.max(1, Math.floor(line.quantity || 1))

                      const orderItem = {
                        cigarId: target.id,
                        cigarName: target.name,
                        itemType: 'cigar' as const,
                        quantity: qty,
                        unitPrice: target.price,
                        subtotal: qty * target.price
                      }

                      orderItems.push(orderItem)
                      totalQuantity += qty
                      totalValue += orderItem.subtotal
                    }

                    // Resolve the movement date (default to now if not set)
                    const movementDate: Date = values.movementDate
                      ? (values.movementDate as any).toDate()
                      : new Date()

                    const outboundOrderData: Omit<OutboundOrder, 'id' | 'updatedAt'> = {
                      referenceNo: values.referenceNo.trim(),
                      type: 'other',
                      reason: values.reason || t('inventory.outStock'),
                      items: orderItems,
                      totalQuantity,
                      totalValue,
                      status: 'completed',
                      operatorId: 'system',
                      createdAt: movementDate
                    }

                    await createOutboundOrder(outboundOrderData)
                    message.success(t('inventory.outStockSuccess'))
                    outForm.resetFields()
                    setOutModalOpen(false)
                    refreshItems()
                    refreshOutboundOrders()
                    refreshInventoryMovements()
                  } finally {
                    setLoading(false)
                  }
                }}>
                  <div style={{ width: '100%', overflow: 'hidden' }}>
                    {/* 单号、原因和日期变动 */}
                    <Row gutter={16}>
                      <Col span={12}>
                        <Form.Item label={t('inventory.referenceNo')} name="referenceNo" style={{ marginBottom: 12 }}>
                          <Input placeholder={t('inventory.pleaseInputReferenceNo')} />
                        </Form.Item>
                        <Form.Item label={t('inventory.reason')} name="reason" style={{ marginBottom: 12 }}>
                          <Input placeholder={t('inventory.forExample') + t('inventory.salesOutStock')} />
                        </Form.Item>
                      </Col>
                      <Col span={12}>
                        <Form.Item
                          label="Stock Movement Date"
                          name="movementDate"
                          initialValue={dayjs()}
                          style={{ marginBottom: 12 }}
                        >
                          <DatePicker
                            style={{ width: '100%' }}
                            format="YYYY-MM-DD"
                            allowClear={false}
                            className="points-config-form"
                          />
                        </Form.Item>
                      </Col>
                    </Row>

                    {/* 产品列表 */}
                    <Form.List name="items" initialValue={[{ cigarId: undefined, quantity: 1 }]}>
                      {(fields, { add, remove }) => (
                        <div>
                          {fields.map((field) => {
                            const { key, name, fieldKey, ...restField } = field
                            return (
                              <div key={key} style={{
                                marginBottom: 12,
                                padding: 10,
                                border: '1px solid rgba(255, 255, 255, 0.1)',
                                borderRadius: 8,
                                background: 'rgba(0, 0, 0, 0.2)'
                              }}>
                                {/* 第一行：产品选择 */}
                                <Row gutter={12} style={{ marginBottom: 8 }}>
                                  <Col flex="auto">
                                    <Form.Item
                                      {...restField}
                                      name={[name, 'cigarId']}
                                      fieldKey={fieldKey}
                                      rules={[{ required: true, message: t('inventory.pleaseSelectProduct') }]}
                                      style={{ marginBottom: 0 }}
                                    >
                                      <Select
                                        placeholder={t('inventory.pleaseSelectProduct')}
                                        showSearch
                                        optionFilterProp="children"
                                        filterOption={(input, option) => {
                                          const kw = (input || '').toLowerCase()
                                          const text = String((option?.children as any) || '').toLowerCase()
                                          return text.includes(kw)
                                        }}
                                      >
                                        {groupedCigars.map(group => (
                                          <Select.OptGroup key={group.brand} label={group.brand}>
                                            {group.list.map(i => (
                                              <Option key={i.id} value={i.id}>{i.name} - RM{i.price}（{t('inventory.stock')}：{getComputedStock(i.id)}）</Option>
                                            ))}
                                          </Select.OptGroup>
                                        ))}
                                      </Select>
                                    </Form.Item>
                                  </Col>
                                </Row>

                                {/* 第二行：数量 + 删除 */}
                                <Row gutter={12} align="middle">
                                  <Col flex="120px">
                                    <Form.Item
                                      {...restField}
                                      name={[name, 'quantity']}
                                      rules={[{ required: true, message: t('inventory.pleaseInputQuantity') }]}
                                      style={{ marginBottom: 0 }}
                                    >
                                      <InputNumber min={1} placeholder={t('inventory.quantity')} style={{ width: '100%' }} />
                                    </Form.Item>
                                  </Col>
                                  <Col flex="auto">
                                    {fields.length > 1 && (
                                      <Button
                                        type="link"
                                        danger
                                        size="small"
                                        icon={<MinusCircleOutlined />}
                                        onClick={() => remove(name)}
                                      >
                                        {t('common.delete')}
                                      </Button>
                                    )}
                                  </Col>
                                </Row>
                              </div>
                            )
                          })}
                          <Form.Item style={{ marginBottom: 0 }}>
                            <Button type="dashed" onClick={() => add({ quantity: 1 })} icon={<PlusOutlined />} style={{ width: '100%' }}>
                              {t('inventory.addDetail')}
                            </Button>
                          </Form.Item>
                        </div>
                      )}
                    </Form.List>

                    <Form.Item style={{ marginTop: 16, marginBottom: 0 }}>
                      <Space>
                        <Button onClick={() => {
                          setOutModalOpen(false)
                          outForm.resetFields()
                        }}>{t('common.cancel')}</Button>
                        <Button type="primary" htmlType="submit" loading={loading}>
                          {t('inventory.confirmOutStock')}
                        </Button>
                      </Space>
                    </Form.Item>
                  </div>
                </Form>
              </Modal>

              {/* 出库列表（滚动容器） */}
              <div
                style={{
                  overflowY: 'auto',
                  overflowX: 'hidden',
                  maxHeight: isMobile ? 'calc(100vh - 210px)' : 'calc(100vh - 240px)',
                  paddingTop: 8,
                  paddingBottom: 84
                }}
              >
                {!isMobile ? (
                  <div className="points-config-form">
                    <Table
                      columns={unifiedOutColumns}
                      dataSource={unifiedOutRows}
                      rowKey="id"
                      style={{
                        background: 'transparent'
                      }}
                      pagination={{
                        pageSize: outPageSize,
                        showSizeChanger: true,
                        showQuickJumper: false,
                        pageSizeOptions: ['5', '10', '20', '50'],
                        onChange: (_page, size) => {
                          const next = size || outPageSize
                          setOutPageSize(next)
                          try { localStorage.setItem('inventory_out_page_size', String(next)) } catch { }
                        }
                      }}
                    />
                  </div>
                ) : (
                  <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
                    {unifiedOutRows.map((log: any) => {
                      const cigar = items.find(i => i.id === log.cigarId)
                      const user = users.find((u: any) => u.id === log.userId)
                      const userName = user?.displayName || user?.email || log.userId || '-'
                      return (
                        <div key={log.id} style={{
                          borderRadius: 12,
                          border: '1px solid rgba(255,255,255,0.1)',
                          background: 'rgba(255,255,255,0.05)',
                          padding: 12,
                          backdropFilter: 'blur(6px)'
                        }}>
                          <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: 12 }}>
                            <div style={{ flex: 1 }}>
                              <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                                <div style={{ fontWeight: 700, color: '#f0f0f0' }}>{cigar?.name || log.cigarId}</div>
                                <span style={{ borderRadius: 999, background: 'rgba(255, 77, 79, 0.2)', padding: '2px 8px', fontSize: 12, color: '#ff4d4f' }}>
                                  -{log.quantity}
                                </span>
                              </div>
                              <div style={{ marginTop: 4, fontSize: 12, color: '#aaa' }}>
                                {t('inventory.referenceNo')}: {log.referenceNo || '-'}
                              </div>
                              <div style={{ marginTop: 4, fontSize: 12, color: '#aaa' }}>
                                {log.source === 'event' && log.eventId ? (
                                  (() => {
                                    const event = eventMap.get(log.eventId)
                                    return event ? (
                                      <span>{t('inventory.source')}: {event.title}</span>
                                    ) : (
                                      <span>{t('inventory.activityOrderOutbound')}: {userName}</span>
                                    )
                                  })()
                                ) : log.source === 'direct' ? (
                                  <span>{t('inventory.source')}: {t('inventory.directSale')}</span>
                                ) : log.source === 'manual' ? (
                                  <span>{t('inventory.source')}: {t('inventory.manual')}</span>
                                ) : (
                                  <span>{t('inventory.reason')}: {log.reason || '-'}</span>
                                )}
                              </div>
                              <div style={{ marginTop: 6, fontSize: 11, color: '#888' }}>
                                {formatYMD(toDateSafe(log.createdAt))}
                              </div>
                            </div>
                          </div>
                        </div>
                      )
                    })}
                    {unifiedOutRows.length === 0 && (
                      <div style={{ color: 'rgba(255, 255, 255, 0.6)', textAlign: 'center', padding: '24px 0' }}>{t('common.noData')}</div>
                    )}
                  </div>
                )}
              </div>
            </div>
          )}
        </div>
      </div>

      {/* 创建/编辑 弹窗 */}
      <Modal
        title={editing ? t('common.edit') : t('common.add')}
        open={creating || !!editing}
        onCancel={() => {
          setCreating(false);
          setEditing(null);
          form.resetFields();
          setCigarDatabaseData(null); // 重置 cigar_database 数据
        }}
        {...getResponsiveModalConfig(isMobile, true, 600)}
        footer={isMobile ? (
          <div style={{ padding: '8px 0' }}>
            <button disabled={loading} onClick={() => form.submit()} style={{ width: '100%', padding: '12px', borderRadius: 8, background: 'linear-gradient(to right,#FDE08D,#C48D3A)', color: '#111', fontWeight: 600, cursor: 'pointer', transition: 'all 0.2s ease', opacity: loading ? 0.6 : 1, boxShadow: '0 4px 15px -5px rgba(244,175,37,0.5)' }}>{t('common.save')}</button>
          </div>
        ) : (
          <div style={{ display: 'flex', justifyContent: 'space-between', width: '100%' }}>
            <Space>
              {editing && (
                <>
                  <Button danger onClick={() => {
                    const productId = (editing as any)?.id
                    const productName = (editing as any)?.name || ''

                    if (hasInventoryHistory(productId)) {
                      // 显示有库存记录的提示窗
                      const relatedMovements = inventoryMovements.filter(m => m.cigarId === productId)
                      const inCount = relatedMovements.filter(m => m.type === 'in').length
                      const outCount = relatedMovements.filter(m => m.type === 'out').length

                      Modal.info({
                        title: t('inventory.deleteBlocked'),
                        content: (
                          <div>
                            <p>{t('inventory.deleteBlockedDueToLogs')}</p>
                            <p><strong>{productName}</strong> {t('inventory.hasInventoryRecords')}:</p>
                            <ul style={{ marginLeft: 20 }}>
                              <li>{t('inventory.inStockRecords')}: {inCount} {t('inventory.records')}</li>
                              <li>{t('inventory.outStockRecords')}: {outCount} {t('inventory.records')}</li>
                            </ul>
                            <p style={{ color: '#ff4d4f', marginTop: 12 }}>
                              {t('inventory.deleteBlockedExplanation')}
                            </p>
                          </div>
                        ),
                        okText: t('common.understood'),
                      })
                      return
                    }

                    // 使用受控 Modal 替代 modal.confirm，以解决 React 19 兼容性问题
                    openDeleteCigar(editing)
                  }}>{t('common.delete')}</Button>
                </>
              )}
            </Space>
            <Space>
              <Button onClick={() => {
                setCreating(false);
                setEditing(null);
                form.resetFields();
                setCigarImages([]);
                setCigarDatabaseData(null); // 重置 cigar_database 数据
              }}>{t('common.cancel')}</Button>
              <button disabled={loading} onClick={() => form.submit()} style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '8px 16px', borderRadius: 8, background: 'linear-gradient(to right,#FDE08D,#C48D3A)', color: '#111', fontWeight: 600, cursor: 'pointer', transition: 'all 0.2s ease', opacity: loading ? 0.6 : 1 }}>{t('common.confirm')}</button>
            </Space>
          </div>
        )}
      >
        <Form form={form} layout="horizontal" labelCol={{ flex: isMobile ? '100px' : '150px' }} wrapperCol={{ flex: 'auto' }} className="dark-theme-form" onFinish={async (values: any) => {
          setLoading(true)
          try {
            // 根据品牌名称找到对应的品牌ID
            const selectedBrand = brandList.find(brand => brand.name === values.brand)

            // 构建构造信息（基于表单值）
            const construction: any = {};
            if (values.wrapper) construction.wrapper = values.wrapper;
            if (values.binder) construction.binder = values.binder;
            if (values.filler) construction.filler = values.filler;

            // 构建品吸笔记（基于表单值）
            const tastingNotes: any = {};
            if (values.footTasteNotes && values.footTasteNotes.length > 0) tastingNotes.foot = Array.isArray(values.footTasteNotes) ? values.footTasteNotes : [];
            if (values.bodyTasteNotes && values.bodyTasteNotes.length > 0) tastingNotes.body = Array.isArray(values.bodyTasteNotes) ? values.bodyTasteNotes : [];
            if (values.headTasteNotes && values.headTasteNotes.length > 0) tastingNotes.head = Array.isArray(values.headTasteNotes) ? values.headTasteNotes : [];

            // Rating优先级：手动输入（values.rating） > 原有值
            let finalRating = 0;
            if (values.rating !== null && values.rating !== undefined) {
              finalRating = values.rating;
            } else if (editing?.metadata?.rating !== null && editing?.metadata?.rating !== undefined) {
              finalRating = editing.metadata.rating;
            }

            // 标签（基于表单值）
            let tags: string[] = [];
            if (Array.isArray(values.tags) && values.tags.length > 0) {
              tags = values.tags;
            }

            const metadata: any = {
              rating: finalRating,
              reviews: editing?.metadata?.reviews ?? 0,
              tags: tags,
            };

            // 完全使用表单输入值（方案 B 放开编辑权）
            const brand = values.brand || '';
            const finalSelectedBrand = brandList.find(b => b.name === brand) || selectedBrand;
            const description = values.description || '';
            const origin = values.origin || finalSelectedBrand?.country || '';
            const strength = values.strength || '';

            // 强制更新智库数据
            try {
              if (values.name && brand) {
                await forceUpdateCigarDatabase({
                  name: values.name,
                  brand: brand,
                  origin: origin,
                  strength: strength,
                  description: description,
                  rating: finalRating,
                  wrapper: construction.wrapper,
                  binder: construction.binder,
                  filler: construction.filler,
                  flavorProfile: tags,
                  footTasteNotes: tastingNotes.foot,
                  bodyTasteNotes: tastingNotes.body,
                  headTasteNotes: tastingNotes.head,
                });
              }
            } catch (e) {
              console.error('更新智库数据失败', e);
            }

            const payload: Partial<Cigar> = {
              name: values.name,
              brand: brand,
              brandId: finalSelectedBrand?.id, // 添加品牌ID关联
              origin: origin,
              size: values.size,
              strength: strength,
              price: values.price,
              sku: (editing as any)?.sku, // 保留原有SKU值
              description: description,
              images: cigarImages,
              inventory: {
                // 库存实时由日志计算，不写入 stock 字段
                minStock: editing?.inventory?.minStock ?? 0, // 保留原有最小库存值
                reserved: editing?.inventory?.reserved ?? 0,
                stock: editing?.inventory?.stock ?? 0,
              } as any,
              metadata,
              updatedAt: new Date(),
            } as any;

            // 添加构造信息（如果有）
            if (Object.keys(construction).length > 0) {
              payload.construction = construction;
            }

            // 添加品吸笔记（如果有）
            if (Object.keys(tastingNotes).length > 0) {
              payload.tastingNotes = tastingNotes;
            }
            if (editing) {
              const res = await updateDocument<Cigar>(COLLECTIONS.CIGARS, editing.id, payload)
              if (res.success) message.success(t('common.saved'))
            } else {
              await createDocument<Cigar>(COLLECTIONS.CIGARS, { ...payload, createdAt: new Date() } as any)
              message.success(t('common.created'))
            }
            refreshItems()
            setCreating(false)
            setEditing(null)
            form.resetFields()
            setCigarImages([])
            setCigarDatabaseData(null) // 重置 cigar_database 数据
          } finally {
            setLoading(false)
          }
        }}>
          <Form.Item label={t('inventory.image')} name="images">
            <div>
              <style>{`
                .cigar-modal-upload .ant-upload.ant-upload-select-picture-card,
                .cigar-modal-upload .ant-upload-list-picture-card .ant-upload-list-item,
                .cigar-modal-upload .ant-upload-list-picture-card .ant-upload-list-item::before {
                  width: 104px !important;
                  height: 104px !important;
                }
              `}</style>
              <Upload
                listType="picture-card"
                className="cigar-modal-upload"
                fileList={cigarImages.map((url, idx) => ({
                  uid: `image-${idx}`,
                  name: `image-${idx + 1}.jpg`,
                  status: 'done' as const,
                  url: url
                }))}

                beforeUpload={async (file) => {
                  try {
                    const result = await cloudinaryUpload(file, { folder: 'cigars' });
                    setCigarImages(prev => [...prev, result.secure_url]);
                    return false; // 阻止自动上传
                  } catch (error) {
                    message.error(t('inventory.imageUploadFailed'));
                    return false;
                  }
                }}
                onRemove={(file) => {
                  const index = cigarImages.findIndex((url, idx) => `image-${idx}` === file.uid);
                  if (index !== -1) {
                    setCigarImages(prev => prev.filter((_, i) => i !== index));
                  }
                }}
                accept="image/*"
              >
                {cigarImages.length < 5 && (
                  <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center' }}>
                    <PlusOutlined style={{ color: '#FFFFFF' }} />
                    <div style={{ marginTop: 8, color: '#FFFFFF' }}>{t('inventory.upload')}</div>
                  </div>
                )}
              </Upload>
              <div style={{ fontSize: 12, color: '#8c8c8c', marginTop: 8 }}>
                {t('inventory.maxImagesCount')}
              </div>
            </div>
          </Form.Item>
          <Form.Item
            label={<span>{t('inventory.productName')} <span style={{ color: '#ff4d4f' }}>*</span></span>}
            required={false}
            style={{ marginBottom: 0 }}
          >
            <Space.Compact style={{ width: '100%' }}>
              <Form.Item
                name="name"
                noStyle
                rules={[{ required: true, message: t('common.pleaseInputName') }]}
              >
                <AutoComplete
                  options={cigarDatabaseOptions.map(name => ({ value: name, label: name }))}
                  filterOption={(inputValue, option) =>
                    option?.value.toLowerCase().includes(inputValue.toLowerCase()) || false
                  }
                  onSelect={async (value: string) => {
                    if (!value || editing) return; // 只在创建模式下自动查询

                    // 用户选择了下拉选项，从 cigar_database 查询数据
                    try {
                      const aggregatedData = await getAggregatedCigarData(value);

                      if (aggregatedData) {
                        setCigarDatabaseData(aggregatedData);

                        // 自动填充表单字段
                        const updates: any = {};

                        if (aggregatedData.brand) updates.brand = aggregatedData.brand;
                        if (aggregatedData.origin) updates.origin = aggregatedData.origin;
                        if (aggregatedData.strength) updates.strength = aggregatedData.strength;
                        if (aggregatedData.description) updates.description = aggregatedData.description;
                        if (aggregatedData.wrappers?.[0]?.value) updates.wrapper = aggregatedData.wrappers[0].value;
                        if (aggregatedData.binders?.[0]?.value) updates.binder = aggregatedData.binders[0].value;
                        if (aggregatedData.fillers?.[0]?.value) updates.filler = aggregatedData.fillers[0].value;
                        if (aggregatedData.footTasteNotes?.length) updates.footTasteNotes = aggregatedData.footTasteNotes.map(item => item.value);
                        if (aggregatedData.bodyTasteNotes?.length) updates.bodyTasteNotes = aggregatedData.bodyTasteNotes.map(item => item.value);
                        if (aggregatedData.headTasteNotes?.length) updates.headTasteNotes = aggregatedData.headTasteNotes.map(item => item.value);
                        if (aggregatedData.flavorProfile?.length) updates.tags = aggregatedData.flavorProfile.map(item => item.value);
                        if (aggregatedData.rating !== null && aggregatedData.rating !== undefined) updates.rating = aggregatedData.rating;

                        form.setFieldsValue(updates);

                        message.success(t('inventory.uploadSuccess', { name: value, count: aggregatedData.totalRecognitions }));
                      }
                    } catch (error) {
                      // 查询失败，允许手动输入
                      setCigarDatabaseData(null);
                    }
                  }}
                  onBlur={async (e: any) => {
                    const productName = e.target.value?.trim();
                    if (!productName || editing) return; // 只在创建模式下自动查询

                    // 用户手动输入后失焦，从 cigar_database 查询数据
                    try {
                      const aggregatedData = await getAggregatedCigarData(productName);

                      if (aggregatedData) {
                        setCigarDatabaseData(aggregatedData);

                        // 自动填充表单字段
                        const updates: any = {};

                        if (aggregatedData.brand) updates.brand = aggregatedData.brand;
                        if (aggregatedData.origin) updates.origin = aggregatedData.origin;
                        if (aggregatedData.strength) updates.strength = aggregatedData.strength;
                        if (aggregatedData.description) updates.description = aggregatedData.description;
                        if (aggregatedData.wrappers?.[0]?.value) updates.wrapper = aggregatedData.wrappers[0].value;
                        if (aggregatedData.binders?.[0]?.value) updates.binder = aggregatedData.binders[0].value;
                        if (aggregatedData.fillers?.[0]?.value) updates.filler = aggregatedData.fillers[0].value;
                        if (aggregatedData.footTasteNotes?.length) updates.footTasteNotes = aggregatedData.footTasteNotes.map(item => item.value);
                        if (aggregatedData.bodyTasteNotes?.length) updates.bodyTasteNotes = aggregatedData.bodyTasteNotes.map(item => item.value);
                        if (aggregatedData.headTasteNotes?.length) updates.headTasteNotes = aggregatedData.headTasteNotes.map(item => item.value);
                        if (aggregatedData.flavorProfile?.length) updates.tags = aggregatedData.flavorProfile.map(item => item.value);
                        if (aggregatedData.rating !== null && aggregatedData.rating !== undefined) updates.rating = aggregatedData.rating;

                        form.setFieldsValue(updates);

                        message.success(t('inventory.uploadSuccess', { name: productName, count: aggregatedData.totalRecognitions }));
                      } else {
                        // 未找到数据，清空 cigarDatabaseData 以允许手动输入
                        setCigarDatabaseData(null);
                      }
                    } catch (error) {
                      // 查询失败，允许手动输入
                      setCigarDatabaseData(null);
                    }
                  }}
                  placeholder={t('inventory.inputOrSelectProductName')}
                  style={{ flex: 1 }}
                />
              </Form.Item>
              <Button
                type="default"
                icon={aiRecognizing ? <LoadingOutlined /> : <ThunderboltOutlined />}
                loading={aiRecognizing}
                onClick={async (e) => {
                  e.preventDefault()
                  e.stopPropagation()
                  const productName = form.getFieldValue('name')
                  if (!productName || !productName.trim()) {
                    message.warning(t('inventory.pleaseInputProductName'))
                    return
                  }

                  // 获取品牌信息（如果已选择）
                  const selectedBrand = form.getFieldValue('brand')
                  const brandName = selectedBrand && typeof selectedBrand === 'string'
                    ? selectedBrand.trim()
                    : undefined

                  setAiRecognizing(true)
                  try {
                    const result = await analyzeCigarByName(productName.trim(), brandName)

                    // 填充表单字段
                    const updates: any = {}

                    // 规格提取逻辑（优先使用AI返回的size字段，并识别标准规格名称）
                    let extractedSize: string | null = null

                    // 辅助函数：从文本中提取标准规格
                    const tryExtractFromText = (text: string): string | null => {
                      if (!text) return null
                      return extractStandardVitola(text.trim())
                    }

                    // 1. 优先使用AI返回的size字段
                    if (result.size && result.size.trim()) {
                      extractedSize = tryExtractFromText(result.size)
                    }

                    // 2. 如果AI没有返回size或提取失败，从result.name中提取（移除品牌名称）
                    if (!extractedSize && result.name) {
                      const brandMatch = result.name.match(new RegExp(`^${result.brand}\\s+(.+)`, 'i'))
                      if (brandMatch && brandMatch[1]) {
                        extractedSize = tryExtractFromText(brandMatch[1])
                      } else if (result.name.includes(' ')) {
                        const parts = result.name.split(' ')
                        if (parts.length > 1) {
                          extractedSize = tryExtractFromText(parts.slice(1).join(' '))
                        }
                      }
                    }

                    // 3. 如果仍然没有提取到，从原始产品名称中提取
                    if (!extractedSize) {
                      // 先尝试整个产品名称
                      extractedSize = tryExtractFromText(productName.trim())

                      // 如果还是没找到，尝试逐个单词匹配
                      if (!extractedSize) {
                        const productNameParts = productName.trim().split(/\s+/)
                        for (const part of productNameParts) {
                          extractedSize = tryExtractFromText(part)
                          if (extractedSize) break
                        }
                      }
                    }

                    // 设置规格
                    if (extractedSize) {
                      updates.size = extractedSize
                    }

                    // 强度（转换格式）
                    const strengthMap: Record<string, string> = {
                      'Mild': 'mild',
                      'Mild-Medium': 'mild-medium',
                      'Medium': 'medium',
                      'Medium-Full': 'medium-full',
                      'Full': 'full',
                      'Unknown': 'medium'
                    }
                    if (result.strength) {
                      updates.strength = strengthMap[result.strength] || 'medium'
                    }

                    // 描述
                    if (result.description) {
                      updates.description = result.description
                    }

                    // 构造信息
                    if (result.wrapper) {
                      updates.wrapper = result.wrapper
                    }
                    if (result.binder) {
                      updates.binder = result.binder
                    }
                    if (result.filler) {
                      updates.filler = result.filler
                    }

                    // 品吸笔记
                    if (result.footTasteNotes && result.footTasteNotes.length > 0) {
                      updates.footTasteNotes = result.footTasteNotes
                    }
                    if (result.bodyTasteNotes && result.bodyTasteNotes.length > 0) {
                      updates.bodyTasteNotes = result.bodyTasteNotes
                    }
                    if (result.headTasteNotes && result.headTasteNotes.length > 0) {
                      updates.headTasteNotes = result.headTasteNotes
                    }

                    // 风味特征（标签）
                    if (result.flavorProfile && result.flavorProfile.length > 0) {
                      updates.tags = result.flavorProfile
                    }

                    // 品牌（优先使用AI识别的品牌）
                    if (result.brand) {
                      updates.brand = result.brand
                    }

                    // 产地（直接填充识别到的产地）
                    if (result.origin) {
                      updates.origin = result.origin
                    }

                    // 评分
                    if (result.rating !== undefined && result.rating !== null) {
                      updates.rating = result.rating
                    }

                    // 批量设置表单值
                    form.setFieldsValue(updates)

                    // 保存到 cigar_database（AI识笳按钮仅保存到 cigar_database，不保存到 cigars）
                    try {
                      await saveRecognitionToCigarDatabase(result)

                      // 重新加载聚合数据
                      const fullProductName = generateProductName(result.brand, result.name)
                      const aggregatedData = await getAggregatedCigarData(fullProductName)

                      if (aggregatedData) {
                        setCigarDatabaseData(aggregatedData)

                        // 如果在编辑模式，使用聚合数据覆盖表单字段
                        if (editing) {
                          const dbUpdates: any = {}

                          if (aggregatedData.brand) dbUpdates.brand = aggregatedData.brand
                          if (aggregatedData.origin) dbUpdates.origin = aggregatedData.origin
                          if (aggregatedData.strength) dbUpdates.strength = aggregatedData.strength
                          if (aggregatedData.description) dbUpdates.description = aggregatedData.description
                          if (aggregatedData.wrappers?.[0]?.value) dbUpdates.wrapper = aggregatedData.wrappers[0].value
                          if (aggregatedData.binders?.[0]?.value) dbUpdates.binder = aggregatedData.binders[0].value
                          if (aggregatedData.fillers?.[0]?.value) dbUpdates.filler = aggregatedData.fillers[0].value
                          if (aggregatedData.footTasteNotes?.length) dbUpdates.footTasteNotes = aggregatedData.footTasteNotes.map(item => item.value)
                          if (aggregatedData.bodyTasteNotes?.length) dbUpdates.bodyTasteNotes = aggregatedData.bodyTasteNotes.map(item => item.value)
                          if (aggregatedData.headTasteNotes?.length) dbUpdates.headTasteNotes = aggregatedData.headTasteNotes.map(item => item.value)
                          if (aggregatedData.flavorProfile?.length) dbUpdates.tags = aggregatedData.flavorProfile.map(item => item.value)
                          if (aggregatedData.rating !== null && aggregatedData.rating !== undefined) dbUpdates.rating = aggregatedData.rating

                          form.setFieldsValue(dbUpdates)
                        }
                      }

                      message.success(t('inventory.aiRecognitionSuccess', { confidence: Math.round(result.confidence * 100) }))
                    } catch (dbError: any) {
                      message.error(t('inventory.saveToDbFailed', { error: dbError.message || t('common.unknownError') }))
                    }
                  } catch (error: any) {
                    message.error(t('inventory.aiRecognitionFailed', { error: error.message || t('common.unknownError') }))
                  } finally {
                    setAiRecognizing(false)
                  }
                }}
                style={{
                  color: '#f4af25'
                }}
                title={t('inventory.aiRecognitionTitle')}
              >
                {isMobile ? '' : t('inventory.aiRecognitionTitle')}
              </Button>
            </Space.Compact>
          </Form.Item>
          <Form.Item label={<span>{t('inventory.brand')} <span style={{ color: '#ff4d4f' }}>*</span></span>} name="brand" required={false} rules={[{ required: true, message: t('common.pleaseInputBrand') }]}>
            <Select
              placeholder={t('inventory.pleaseSelectBrand')}
              showSearch
              allowClear={false}
              filterOption={(input, option) => {
                // 使用 option.value（品牌名称）进行筛选
                const brandName = String(option?.value || '')
                const inputLower = input.toLowerCase()

                // 筛选品牌名称
                if (brandName.toLowerCase().includes(inputLower)) {
                  return true
                }

                // 同时筛选国家（查找对应的品牌对象）
                const brand = brandList.find(b => b.name === brandName)
                if (brand?.country && brand.country.toLowerCase().includes(inputLower)) {
                  return true
                }

                return false
              }}
              onChange={(val) => {
                const b = brandList.find(brand => brand.name === val)
                if (b?.country) {
                  try { form.setFieldsValue({ origin: b.country }) } catch { }
                }
              }}
              getPopupContainer={(triggerNode) => triggerNode.parentElement || document.body}
            >
              {brandList
                .filter(brand => brand.status === 'active')
                .sort((a, b) => a.name.localeCompare(b.name))
                .map(brand => (
                  <Option key={brand.id} value={brand.name}>
                    <Space align="center">
                      {brand.logo && (
                        <img
                          src={brand.logo}
                          alt={brand.name}
                          style={{ width: 20, height: 20, borderRadius: 2, display: 'block' }}
                        />
                      )}
                      <span>{brand.name}</span>
                      <span style={{ color: 'rgba(255, 255, 255, 0.6)', fontSize: '12px' }}>({brand.country})</span>
                    </Space>
                  </Option>
                ))}
            </Select>
          </Form.Item>
          <Form.Item label={<span>{t('inventory.origin')} <span style={{ color: '#ff4d4f' }}>*</span></span>} name="origin" required={false} rules={[{ required: true, message: t('common.pleaseInputOrigin') }]}>
            <Input />
          </Form.Item>
          <Form.Item label={<span>{isMobile ? t('inventory.specification') : t('inventory.size')} <span style={{ color: '#ff4d4f' }}>*</span></span>} name="size" required={false} rules={[{ required: true, message: t('common.pleaseInputSize') }]}>
            <Input />
          </Form.Item>
          <Form.Item label={<span>{t('inventory.strength')} <span style={{ color: '#ff4d4f' }}>*</span></span>} name="strength" required={false} rules={[{ required: true, message: t('common.pleaseSelectStrength') }]}>
            <Select>
              <Option value="mild">{t('inventory.mild')}</Option>
              <Option value="mild-medium">{t('inventory.mildMedium')}</Option>
              <Option value="medium">{t('inventory.medium')}</Option>
              <Option value="medium-full">{t('inventory.mediumFull')}</Option>
              <Option value="full">{t('inventory.full')}</Option>
            </Select>
          </Form.Item>

          <Form.Item label={t('inventory.rating')} name="rating">
            <InputNumber
              min={0}
              max={100}
              step={0.1}
              style={{ width: '100%' }}
              placeholder="0-100"
            />
          </Form.Item>

          <Form.Item label={<span>{t('inventory.price')} <span style={{ color: '#ff4d4f' }}>*</span></span>} name="price" required={false} rules={[{ required: true, message: t('common.pleaseInputPrice') }]}>
            <InputNumber min={0} style={{ width: '100%' }} />
          </Form.Item>

          <Form.Item label={t('common.description')} name="description">
            <Input.TextArea rows={3} placeholder={t('inventory.descriptionPlaceholder')} />
          </Form.Item>

          <div style={{
            margin: '16px 0',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            gap: '12px'
          }}>
            <div style={{
              flex: 1,
              height: '1px',
              background: 'linear-gradient(to right, transparent, #FDE08D, #C48D3A)'
            }} />
            <span style={{
              background: 'linear-gradient(to right, #FDE08D, #C48D3A)',
              WebkitBackgroundClip: 'text',
              backgroundClip: 'text',
              color: 'transparent',
              fontWeight: 600,
              whiteSpace: 'nowrap'
            }}>
              {t('inventory.constructionInfo')}
            </span>
            <div style={{
              flex: 1,
              height: '1px',
              background: 'linear-gradient(to left, transparent, #FDE08D, #C48D3A)'
            }} />
          </div>

          <Form.Item label={t('inventory.wrapper')} name="wrapper">
            <Input placeholder={t('inventory.wrapperPlaceholder')} />
          </Form.Item>

          <Form.Item label={t('inventory.binder')} name="binder">
            <Input placeholder={t('inventory.binderPlaceholder')} />
          </Form.Item>

          <Form.Item label={t('inventory.filler')} name="filler">
            <Input placeholder={t('inventory.fillerPlaceholder')} />
          </Form.Item>

          <div style={{
            margin: '16px 0',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            gap: '12px'
          }}>
            <div style={{
              flex: 1,
              height: '1px',
              background: 'linear-gradient(to right, transparent, #FDE08D, #C48D3A)'
            }} />
            <span style={{
              background: 'linear-gradient(to right, #FDE08D, #C48D3A)',
              WebkitBackgroundClip: 'text',
              backgroundClip: 'text',
              color: 'transparent',
              fontWeight: 600,
              whiteSpace: 'nowrap'
            }}>
              {t('inventory.tastingNotes')}
            </span>
            <div style={{
              flex: 1,
              height: '1px',
              background: 'linear-gradient(to left, transparent, #FDE08D, #C48D3A)'
            }} />
          </div>

          <Form.Item
            label={t('inventory.footNotes')}
            name="footTasteNotes"
            labelCol={isMobile ? { span: 24 } : undefined}
            wrapperCol={isMobile ? { span: 24 } : undefined}
          >
            <Select
              mode="tags"
              placeholder={t('inventory.tastingNotesPlaceholder')}
              style={{ width: '100%' }}
              tokenSeparators={[',']}
            />
          </Form.Item>

          <Form.Item
            label={t('inventory.bodyNotes')}
            name="bodyTasteNotes"
            labelCol={isMobile ? { span: 24 } : undefined}
            wrapperCol={isMobile ? { span: 24 } : undefined}
          >
            <Select
              mode="tags"
              placeholder={t('inventory.tastingNotesPlaceholder')}
              style={{ width: '100%' }}
              tokenSeparators={[',']}
            />
          </Form.Item>

          <Form.Item
            label={t('inventory.headNotes')}
            name="headTasteNotes"
            labelCol={isMobile ? { span: 24 } : undefined}
            wrapperCol={isMobile ? { span: 24 } : undefined}
          >
            <Select
              mode="tags"
              placeholder={t('inventory.tastingNotesPlaceholder')}
              style={{ width: '100%' }}
              tokenSeparators={[',']}
            />
          </Form.Item>


          <div style={{
            margin: '16px 0',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            gap: '12px'
          }}>
            <div style={{
              flex: 1,
              height: '1px',
              background: 'linear-gradient(to right, transparent, #FDE08D, #C48D3A)'
            }} />
            <span style={{
              background: 'linear-gradient(to right, #FDE08D, #C48D3A)',
              WebkitBackgroundClip: 'text',
              backgroundClip: 'text',
              color: 'transparent',
              fontWeight: 600,
              whiteSpace: 'nowrap'
            }}>
              {t('inventory.otherInfo')}
            </span>
            <div style={{
              flex: 1,
              height: '1px',
              background: 'linear-gradient(to left, transparent, #FDE08D, #C48D3A)'
            }} />
          </div>

          <Form.Item
            label={t('inventory.flavorProfile')}
            name="tags"
            labelCol={isMobile ? { span: 24 } : undefined}
            wrapperCol={isMobile ? { span: 24 } : undefined}
          >
            <Select
              mode="tags"
              placeholder={t('inventory.flavorProfilePlaceholder')}
              style={{ width: '100%' }}
              tokenSeparators={[',']}
            />
          </Form.Item>
        </Form>
      </Modal>

      {/* 入库/出库 弹窗 */}
      <Modal
        title={adjustingIn ? `${t('inventory.inStock')} - ${(adjustingIn as any)?.name}` : adjustingOut ? `${t('inventory.outStock')} - ${(adjustingOut as any)?.name}` : ''}
        open={!!adjustingIn || !!adjustingOut}
        onCancel={() => { setAdjustingIn(null); setAdjustingOut(null) }}
        onOk={() => adjForm.submit()}
        confirmLoading={loading}
      >
        <Form form={adjForm} layout="vertical" onFinish={async (values: { quantity: number; reason?: string; referenceNo?: string }) => {
          const target = adjustingIn || adjustingOut
          if (!target) return
          const qty = Math.max(1, Math.floor(values.quantity || 1))
          const isInbound = !!adjustingIn

          setLoading(true)
          try {
            const referenceNo = values.referenceNo || `ADJ-${Date.now()}`
            const orderItem = {
              cigarId: (target as any).id,
              cigarName: (target as any).name,
              itemType: 'cigar' as const,
              quantity: qty,
              unitPrice: (target as any).price,
              subtotal: qty * (target as any).price
            }

            if (isInbound) {
              const inboundOrderData: Omit<InboundOrder, 'id' | 'updatedAt'> = {
                referenceNo,
                type: 'adjustment',
                reason: values.reason || t('inventory.inStock'),
                items: [orderItem],
                totalQuantity: qty,
                totalValue: orderItem.subtotal,
                status: 'completed',
                operatorId: currentUser?.displayName || 'system',
                storeId: currentUser?.storeId,
                createdAt: new Date()
              }
              await createInboundOrder(inboundOrderData)
            } else {
              const outboundOrderData: Omit<OutboundOrder, 'id' | 'updatedAt'> = {
                referenceNo,
                type: 'other',
                reason: values.reason || t('inventory.outStock'),
                items: [orderItem],
                totalQuantity: qty,
                totalValue: orderItem.subtotal,
                status: 'completed',
                operatorId: currentUser?.displayName || 'system',
                storeId: currentUser?.storeId,
                createdAt: new Date()
              }
              await createOutboundOrder(outboundOrderData)
            }

            message.success(t('inventory.stockUpdated'))
            refreshItems()
            refreshInboundOrders()
            refreshOutboundOrders()
            refreshInventoryMovements()
            setAdjustingIn(null)
            setAdjustingOut(null)
          } finally {
            setLoading(false)
          }
        }}>
          <Form.Item label={t('inventory.quantity')} name="quantity" rules={[{ required: true, message: t('common.pleaseInputQuantity') }]}>
            <InputNumber min={1} style={{ width: '100%' }} />
          </Form.Item>
          {adjustingIn && (
            <Form.Item label={t('inventory.referenceNo')} name="referenceNo">
              <Input placeholder={t('inventory.pleaseInputReferenceNo')} />
            </Form.Item>
          )}
          <Form.Item label={t('inventory.reason')} name="reason">
            <Input />
          </Form.Item>
        </Form>
      </Modal>

      {/* 删除确认 - 使用受控 Modal 替代 modal.confirm 以解决 React 19 兼容性问题 */}
      <Modal
        title={t('common.deleteProduct')}
        open={deletingOpen}
        onCancel={closeDeleteCigar}
        onOk={async () => {
          if (!deleting) return

          setLoading(true)
          try {
            const productId = (deleting as any).id
            const res = await deleteDocument(COLLECTIONS.CIGARS, productId)

            if (res.success) {
              message.success(t('common.deleted'))
              refreshItems()
              setSelectedRowKeys([])
              // 如果正在编辑被删除的产品，重置编辑状态
              if (editing && (editing as any).id === productId) {
                setEditing(null)
                form.resetFields()
                setCigarImages([])
                setCigarDatabaseData(null)
              }
            } else {
              message.error(t('common.deleteFailed'))
            }
          } catch (error) {
            message.error(t('common.deleteFailed') + ': ' + (error as Error).message)
          } finally {
            setLoading(false)
            closeDeleteCigar()
          }
        }}
        okButtonProps={{ danger: true }}
        confirmLoading={loading}
        {...getResponsiveModalConfig(isMobile, true, 520)}
        styles={getModalThemeStyles(isMobile, true)}
        zIndex={2000}
      >
        <div style={{ color: '#FFFFFF' }}>
          {t('common.confirmDeleteProduct')} {(deleting as any)?.name}？{t('common.thisOperationCannotBeUndone')}
        </div>
      </Modal>

      {/* 单号详情弹窗 */}
      <Modal
        title={`${t('inventory.referenceNo')} - ${viewingReference}`}
        open={!!viewingReference}
        onCancel={() => setViewingReference(null)}
        footer={null}
        width={800}
      >
        <div className="points-config-form">
          <Table
            columns={[
              { title: t('inventory.time'), dataIndex: 'createdAt', key: 'createdAt', render: (v: any) => { const d = toDateSafe(v); return d ? d.toLocaleString() : '-' } },
              { title: t('inventory.product'), dataIndex: 'cigarId', key: 'cigarId', render: (id: string) => items.find(i => i.id === id)?.name || id },
              { title: t('inventory.quantity'), dataIndex: 'quantity', key: 'quantity' },
              { title: t('inventory.reason'), dataIndex: 'reason', key: 'reason', render: (v: any) => v || '-' },
              { title: t('inventory.operator'), dataIndex: 'operatorId', key: 'operatorId', render: (v: any) => v || '-' },
            ]}
            dataSource={currentReferenceLogs}
            rowKey="id"
            pagination={false}
            size="small"
            style={{
              background: 'transparent'
            }}
          />
        </div>
        <div style={{
          marginTop: 16,
          padding: 12,
          background: 'rgba(255, 255, 255, 0.05)',
          borderRadius: 12,
          border: '1px solid rgba(244,175,37,0.2)',
          backdropFilter: 'blur(10px)',
          display: 'flex',
          flexDirection: 'column',
          gap: '8px'
        }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
            <span style={{ color: 'rgba(255, 255, 255, 0.65)', fontWeight: 'bold' }}>{t('inventory.referenceNo')}</span>
            <span style={{ color: '#FFFFFF', fontWeight: 'bold', fontFamily: 'monospace' }}>{viewingReference}</span>
          </div>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
            <span style={{ color: 'rgba(255, 255, 255, 0.65)' }}>{t('inventory.totalProductTypes')}</span>
            <span style={{ color: 'rgba(255, 255, 255, 0.85)' }}>{currentReferenceLogs.length} {t('inventory.types')}</span>
          </div>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
            <span style={{ color: 'rgba(255, 255, 255, 0.65)' }}>{t('inventory.totalInStockQuantity')}</span>
            <span style={{ color: 'rgba(255, 255, 255, 0.85)' }}>{currentReferenceLogs.reduce((sum, log) => sum + (log.quantity || 0), 0)} {t('inventory.sticks')}</span>
          </div>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginTop: 8, borderTop: '1px solid rgba(255,255,255,0.1)', paddingTop: 8 }}>
            <span style={{ color: 'rgba(255, 255, 255, 0.65)', whiteSpace: 'nowrap', marginRight: 16 }}>{t('inventory.notes')}</span>
            <span style={{ color: 'rgba(255, 255, 255, 0.85)', textAlign: 'right', whiteSpace: 'pre-wrap' }}>{currentReferenceOrder?.notes || '-'}</span>
          </div>
        </div>
      </Modal>

      {/* 产品出入库记录弹窗 */}
      <Modal
        title={`${t('inventory.productLogs')} - ${items.find(i => i.id === viewingProductLogs)?.name || viewingProductLogs}`}
        open={!!viewingProductLogs}
        onCancel={() => setViewingProductLogs(null)}
        footer={null}
        width={isMobile ? '100%' : 900}
        style={isMobile ? { top: 0, paddingBottom: 0, maxHeight: '100vh' } : {}}
        styles={(() => {
          const baseStyles = getModalThemeStyles(isMobile, true);
          return {
            ...baseStyles,
            body: {
              ...(baseStyles?.body || {}),
              ...(isMobile ? { padding: '12px', maxHeight: 'calc(100vh - 55px)', overflow: 'auto' } : {})
            }
          };
        })()}
      >
        {!isMobile ? (
          // 电脑端 - 使用表格
          <>
            <div className="points-config-form">
              <Table
                columns={[
                  {
                    title: t('inventory.time'),
                    dataIndex: 'createdAt',
                    key: 'createdAt',
                    render: (v: any) => {
                      const d = toDateSafe(v);
                      return d ? d.toLocaleString() : '-'
                    },
                    sorter: (a: any, b: any) => {
                      const da = toDateSafe(a.createdAt)?.getTime() || 0
                      const db = toDateSafe(b.createdAt)?.getTime() || 0
                      return da - db
                    }
                  },
                  {
                    title: t('inventory.type'),
                    dataIndex: 'type',
                    key: 'type',
                    render: (type: string) => {
                      const color = type === 'in' ? 'green' : type === 'out' ? 'red' : 'blue'
                      const text = type === 'in' ? t('inventory.stockIn') : type === 'out' ? t('inventory.stockOut') : t('inventory.adjustment')
                      return <Tag color={color}>{text}</Tag>
                    },
                    filters: [
                      { text: t('inventory.stockIn'), value: 'in' },
                      { text: t('inventory.stockOut'), value: 'out' },
                      { text: t('inventory.adjustment'), value: 'adjustment' }
                    ],
                    onFilter: (value: any, record: any) => record.type === value
                  },
                  {
                    title: t('inventory.quantity'),
                    dataIndex: 'quantity',
                    key: 'quantity',
                    render: (quantity: number, record: any) => {
                      const color = record.type === 'in' ? 'green' : record.type === 'out' ? 'red' : 'blue'
                      const prefix = record.type === 'in' ? '+' : record.type === 'out' ? '-' : ''
                      return <span style={{ color: color === 'green' ? '#52c41a' : color === 'red' ? '#ff4d4f' : '#1890ff' }}>
                        {prefix}{quantity}
                      </span>
                    },
                    sorter: (a: any, b: any) => a.quantity - b.quantity
                  },
                  {
                    title: t('inventory.unitPrice'),
                    dataIndex: 'unitPrice',
                    key: 'unitPrice',
                    render: (price: number) => price ? `RM${price.toFixed(2)}` : '-'
                  },
                  {
                    title: t('inventory.referenceNo'),
                    dataIndex: 'referenceNo',
                    key: 'referenceNo',
                    render: (v: any) => v || '-'
                  },
                  {
                    title: t('inventory.reason'),
                    dataIndex: 'reason',
                    key: 'reason',
                    render: (v: any) => v || '-'
                  },
                  {
                    title: t('inventory.customer'),
                    dataIndex: 'userId',
                    key: 'userId',
                    render: (userId: string, record: any) => {
                      // 1. 优先使用记录中直接保存的 userName
                      if (record.userName) return record.userName;

                      // 2. 如果有 userId，从 users 列表查找
                      if (userId) {
                        const user = users.find(u => u.id === userId);
                        if (user?.displayName) return user.displayName;
                      }

                      // 3. 尝试从 referenceNo 查找订单关联的用户
                      if (record.referenceNo) {
                        const order = orders.find(o => o.id === record.referenceNo);
                        if (order?.userId) {
                          const user = users.find(u => u.id === order.userId);
                          if (user?.displayName) return user.displayName;
                          return order.userId;
                        }
                      }

                      // 4. 都没有则显示 -
                      return '-';
                    }
                  },
                  {
                    title: t('inventory.operator'),
                    dataIndex: 'operatorId',
                    key: 'operatorId',
                    render: (v: any) => v || '-'
                  },
                ]}
                dataSource={currentProductLogs}
                rowKey="id"
                pagination={{
                  pageSize: 10,
                  showSizeChanger: true,
                  showQuickJumper: true,
                  showTotal: (total, range) => t('common.paginationTotal', { start: range[0], end: range[1], total })
                }}
                size="small"
                style={{
                  background: 'transparent'
                }}
              />
            </div>
            <div style={{
              marginTop: 16,
              padding: 12,
              background: 'rgba(255, 255, 255, 0.05)',
              borderRadius: 12,
              border: '1px solid rgba(244,175,37,0.2)',
              backdropFilter: 'blur(10px)'
            }}>
              <div style={{ fontWeight: 'bold', marginBottom: 8, color: '#FFFFFF' }}>{t('inventory.summary')}</div>
              <div style={{ display: 'grid', gridTemplateColumns: isMobile ? '1fr' : '1fr 1fr', gap: '8px 24px' }}>
                <div style={{ color: 'rgba(255, 255, 255, 0.85)' }}>{t('inventory.totalRecords')}: {currentProductLogs.length} {t('inventory.records')}</div>
                <div style={{ color: 'rgba(255, 255, 255, 0.85)' }}>{t('inventory.currentStock')}: {getComputedStock(viewingProductLogs || '')} {t('inventory.sticks')}</div>

                <div style={{ borderTop: '1px solid rgba(255,255,255,0.05)', gridColumn: '1 / -1', margin: '4px 0' }} />

                <div>
                  <div style={{ color: 'rgba(255, 255, 255, 0.85)' }}>{t('inventory.totalInStock')}: {currentProductLogs.filter(log => log.type === 'in').reduce((sum, log) => sum + (log.quantity || 0), 0)} {t('inventory.sticks')}</div>
                  <div style={{ color: '#52c41a', fontWeight: 600, fontSize: 13 }}>{t('inventory.totalInValue')}: RM{currentProductLogs.filter(log => log.type === 'in').reduce((sum, log) => sum + ((log.quantity || 0) * (log.unitPrice || 0)), 0).toFixed(2)}</div>
                </div>

                <div>
                  <div style={{ color: 'rgba(255, 255, 255, 0.85)' }}>{t('inventory.totalOutStock')}: {currentProductLogs.filter(log => log.type === 'out').reduce((sum, log) => sum + (log.quantity || 0), 0)} {t('inventory.sticks')}</div>
                  <div style={{ color: '#ff4d4f', fontWeight: 600, fontSize: 13 }}>{t('inventory.totalOutValue')}: RM{currentProductLogs.filter(log => log.type === 'out').reduce((sum, log) => sum + ((log.quantity || 0) * (log.unitPrice || 0)), 0).toFixed(2)}</div>
                </div>
              </div>
            </div>
          </>
        ) : (
          // 手机端 - 使用卡片式布局
          <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
            {/* 统计摘要 */}
            <div style={{
              padding: 16,
              background: 'linear-gradient(135deg, rgba(244,175,37,0.1) 0%, rgba(244,175,37,0.05) 100%)',
              borderRadius: 12,
              border: '1px solid rgba(244,175,37,0.2)'
            }}>
              <div style={{
                fontSize: 14,
                fontWeight: 700,
                color: '#f4af25',
                marginBottom: 12,
                display: 'flex',
                alignItems: 'center',
                gap: 6
              }}>
                {t('inventory.summary')}
              </div>
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12, fontSize: 12 }}>
                <div>
                  <div style={{ color: 'rgba(255,255,255,0.6)', marginBottom: 4 }}>{t('inventory.totalRecords')}</div>
                  <div style={{ fontSize: 18, fontWeight: 700, color: '#fff' }}>{currentProductLogs.length}</div>
                </div>
                <div>
                  <div style={{ color: 'rgba(255,255,255,0.6)', marginBottom: 4 }}>{t('inventory.currentStock')}</div>
                  <div style={{ fontSize: 18, fontWeight: 700, color: '#f4af25' }}>{getComputedStock(viewingProductLogs || '')}</div>
                </div>
                <div>
                  <div style={{ color: 'rgba(255,255,255,0.6)', marginBottom: 4 }}>{t('inventory.totalInStock')}</div>
                  <div style={{ fontSize: 16, fontWeight: 600, color: '#52c41a' }}>
                    +{currentProductLogs.filter(log => log.type === 'in').reduce((sum, log) => sum + (log.quantity || 0), 0)}
                  </div>
                  <div style={{ fontSize: 11, color: '#52c41a', opacity: 0.8 }}>
                    RM{currentProductLogs.filter(log => log.type === 'in').reduce((sum, log) => sum + ((log.quantity || 0) * (log.unitPrice || 0)), 0).toFixed(2)}
                  </div>
                </div>
                <div>
                  <div style={{ color: 'rgba(255,255,255,0.6)', marginBottom: 4 }}>{t('inventory.totalOutStock')}</div>
                  <div style={{ fontSize: 16, fontWeight: 600, color: '#ff4d4f' }}>
                    -{currentProductLogs.filter(log => log.type === 'out').reduce((sum, log) => sum + (log.quantity || 0), 0)}
                  </div>
                  <div style={{ fontSize: 11, color: '#ff4d4f', opacity: 0.8 }}>
                    RM{currentProductLogs.filter(log => log.type === 'out').reduce((sum, log) => sum + ((log.quantity || 0) * (log.unitPrice || 0)), 0).toFixed(2)}
                  </div>
                </div>
              </div>
            </div>

            {/* 记录列表 */}
            <div style={{ fontSize: 12, color: 'rgba(255,255,255,0.6)', marginTop: 4 }}>
              {t('inventory.recentRecords')} ({currentProductLogs.length})
            </div>

            {currentProductLogs.length === 0 ? (
              <div style={{
                padding: 40,
                textAlign: 'center',
                color: 'rgba(255,255,255,0.4)',
                fontSize: 14
              }}>
                {t('common.noData')}
              </div>
            ) : (
              currentProductLogs.map((log: any) => {
                const isIn = log.type === 'in'
                const isOut = log.type === 'out'
                const typeColor = isIn ? '#52c41a' : isOut ? '#ff4d4f' : '#1890ff'
                const typeText = isIn ? t('inventory.stockIn') : isOut ? t('inventory.stockOut') : t('inventory.adjustment')
                const d = toDateSafe(log.createdAt)

                // 获取客户名称
                let customerName = '-'
                if (log.userName) {
                  customerName = log.userName
                } else if (log.userId) {
                  const user = users.find(u => u.id === log.userId)
                  if (user?.displayName) customerName = user.displayName
                } else if (log.referenceNo) {
                  const order = orders.find(o => o.id === log.referenceNo)
                  if (order?.userId) {
                    const user = users.find(u => u.id === order.userId)
                    if (user?.displayName) customerName = user.displayName
                  }
                }

                return (
                  <div
                    key={log.id}
                    style={{
                      padding: 12,
                      background: 'rgba(255,255,255,0.05)',
                      borderRadius: 10,
                      border: `1px solid ${typeColor}33`,
                      position: 'relative'
                    }}
                  >
                    {/* 类型标签 */}
                    <div style={{
                      position: 'absolute',
                      top: -8,
                      right: 12,
                      padding: '2px 8px',
                      background: typeColor,
                      color: '#fff',
                      fontSize: 11,
                      fontWeight: 600,
                      borderRadius: 4,
                      boxShadow: '0 2px 4px rgba(0,0,0,0.2)'
                    }}>
                      {typeText}
                    </div>

                    {/* 数量与单价 - 突出显示 */}
                    <div style={{
                      display: 'flex',
                      justifyContent: 'space-between',
                      alignItems: 'baseline',
                      marginBottom: 8,
                      marginTop: 4
                    }}>
                      <div style={{
                        fontSize: 24,
                        fontWeight: 700,
                        color: typeColor,
                      }}>
                        {isIn ? '+' : isOut ? '-' : ''}{log.quantity}
                      </div>
                      {log.unitPrice && (
                        <div style={{
                          fontSize: 14,
                          fontWeight: 600,
                          color: '#f4af25'
                        }}>
                          RM{log.unitPrice.toFixed(2)}
                        </div>
                      )}
                    </div>

                    {/* 信息网格 */}
                    <div style={{ display: 'flex', flexDirection: 'column', gap: 6, fontSize: 12 }}>
                      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                        <span style={{ color: 'rgba(255,255,255,0.5)' }}>⏰ {t('inventory.time')}</span>
                        <span style={{ color: '#fff', fontWeight: 500 }}>
                          {d ? d.toLocaleString('zh-CN', {
                            month: '2-digit',
                            day: '2-digit',
                            hour: '2-digit',
                            minute: '2-digit'
                          }) : '-'}
                        </span>
                      </div>

                      {log.reason && (
                        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                          <span style={{ color: 'rgba(255,255,255,0.5)' }}>{t('inventory.reason')}</span>
                          <span style={{ color: '#fff', fontWeight: 500, textAlign: 'right', flex: 1, marginLeft: 8 }}>
                            {log.reason}
                          </span>
                        </div>
                      )}

                      {log.referenceNo && (
                        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                          <span style={{ color: 'rgba(255,255,255,0.5)' }}>🔖 {t('inventory.referenceNo')}</span>
                          <span style={{
                            color: '#f4af25',
                            fontWeight: 500,
                            fontSize: 11,
                            fontFamily: 'monospace'
                          }}>
                            {log.referenceNo}
                          </span>
                        </div>
                      )}

                      {customerName !== '-' && (
                        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                          <span style={{ color: 'rgba(255,255,255,0.5)' }}>👤 {t('inventory.customer')}</span>
                          <span style={{ color: '#fff', fontWeight: 500 }}>{customerName}</span>
                        </div>
                      )}

                      {log.operatorId && (
                        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                          <span style={{ color: 'rgba(255,255,255,0.5)' }}>👨‍💼 {t('inventory.operator')}</span>
                          <span style={{ color: 'rgba(255,255,255,0.7)', fontSize: 11 }}>{log.operatorId}</span>
                        </div>
                      )}
                    </div>
                  </div>
                )
              })
            )}
          </div>
        )}
      </Modal>

      {/* 品牌管理 - 添加/编辑品牌 */}
      <Modal
        title={editingBrand ? t('inventory.editBrand') : t('inventory.addBrand')}
        open={creatingBrand || !!editingBrand}
        onCancel={() => {
          setCreatingBrand(false)
          setEditingBrand(null)
          brandForm.resetFields()
        }}
        onOk={() => brandForm.submit()}
        confirmLoading={loading}
        {...getResponsiveModalConfig(isMobile, true, 600)}
      >
        <Form
          form={brandForm}
          layout="vertical"
          className="dark-theme-form"
          onFinish={async (values) => {
            setLoading(true)
            try {
              const brandData = {
                name: values.name,
                description: values.description || '',
                logo: values.logo || '',
                website: values.website || '',
                country: values.country,
                foundedYear: values.foundedYear ? parseInt(values.foundedYear) : undefined,
                status: values.status || 'active',
                metadata: {
                  totalProducts: 0,
                  totalSales: 0,
                  rating: 0,
                  tags: [],
                },
              }

              if (editingBrand) {
                const result = await updateDocument(COLLECTIONS.BRANDS, editingBrand.id, brandData)
                if (result.success) {
                  message.success(t('inventory.brandUpdated'))
                  refreshBrandList()
                  setEditingBrand(null)
                  brandForm.resetFields()
                } else {
                  message.error(t('inventory.brandUpdateFailed'))
                }
              } else {
                const result = await createDocument(COLLECTIONS.BRANDS, brandData)
                if (result.success) {
                  message.success(t('inventory.brandCreated'))
                  refreshBrandList()
                  setCreatingBrand(false)
                  brandForm.resetFields()
                } else {
                  message.error(t('inventory.brandCreateFailed'))
                }
              }
            } finally {
              setLoading(false)
            }
          }}
          initialValues={editingBrand ? {
            name: editingBrand.name,
            description: editingBrand.description,
            logo: editingBrand.logo,
            website: editingBrand.website,
            country: editingBrand.country,
            foundedYear: editingBrand.foundedYear,
            status: editingBrand.status,
          } : {
            status: 'active'
          }}
        >
          <Form.Item
            label={t('inventory.brandName')}
            name="name"
            rules={[{ required: true, message: t('inventory.brandNameRequired') }]}
          >
            <Input placeholder={t('inventory.pleaseInputBrandName')} />
          </Form.Item>

          <Form.Item
            label={t('inventory.brandDescription')}
            name="description"
          >
            <Input.TextArea
              rows={3}
              placeholder={t('inventory.pleaseInputBrandDescription')}
            />
          </Form.Item>

          <Form.Item
            label={t('inventory.brandLogo')}
            name="logo"
          >
            <ImageUpload
              folder="brands"
              maxSize={2 * 1024 * 1024} // 2MB
              width={120}
              height={120}
              showPreview={true}
            />
          </Form.Item>

          <Form.Item
            label={t('inventory.brandWebsite')}
            name="website"
            rules={[
              {
                pattern: /^https?:\/\/.+/,
                message: t('inventory.brandWebsiteInvalid')
              }
            ]}
          >
            <Input placeholder="https://example.com" />
          </Form.Item>

          <Form.Item
            label={t('inventory.brandCountry')}
            name="country"
            rules={[{ required: true, message: t('inventory.brandCountryRequired') }]}
          >
            <Input placeholder={t('inventory.pleaseInputBrandCountry')} />
          </Form.Item>

          <Form.Item
            label={t('inventory.foundedYear')}
            name="foundedYear"
            rules={[
              {
                pattern: /^\d{4}$/,
                message: t('inventory.foundedYearInvalid')
              }
            ]}
          >
            <Input placeholder="1990" />
          </Form.Item>

          <Form.Item
            label={t('inventory.brandStatus')}
            name="status"
          >
            <Select>
              <Option value="active">{t('inventory.active')}</Option>
              <Option value="inactive">{t('inventory.inactive')}</Option>
            </Select>
          </Form.Item>
        </Form>
      </Modal>

      {/* 品牌管理 - 删除确认 */}
      <Modal
        title={t('inventory.confirmDeleteBrand')}
        open={!!deletingBrand}
        onCancel={() => setDeletingBrand(null)}
        onOk={async () => {
          if (!deletingBrand) return
          setLoading(true)
          try {
            const result = await deleteDocument(COLLECTIONS.BRANDS, deletingBrand.id)
            if (result.success) {
              message.success(t('inventory.brandDeleted'))
              refreshBrandList()
            } else {
              message.error(t('inventory.brandDeleteFailed'))
            }
          } finally {
            setLoading(false)
            setDeletingBrand(null)
          }
        }}
        okButtonProps={{ danger: true }}
      >
        {t('inventory.deleteBrandContent', { name: deletingBrand?.name })}
      </Modal>

      {/* 入库统计弹窗 */}
      <Modal
        title={t('inventory.inStatsTitle')}
        open={inStatsOpen}
        onCancel={() => setInStatsOpen(false)}
        footer={null}
        {...getResponsiveModalConfig(isMobile, true, 800)}
      >
        <div style={getModalTheme().content as React.CSSProperties}>
          {/* 入库总体统计 */}
          <div style={{
            marginBottom: 20,
            padding: '24px',
            background: 'linear-gradient(135deg, rgba(255, 255, 255, 0.08) 0%, rgba(255, 255, 255, 0.03) 100%)',
            borderRadius: '16px',
            border: '1px solid rgba(244, 175, 37, 0.3)',
            backdropFilter: 'blur(12px)',
            boxShadow: '0 8px 32px rgba(0, 0, 0, 0.4)'
          }}>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 16 }}>
              <div style={{ textAlign: 'center', borderRight: '1px solid rgba(255, 255, 255, 0.1)' }}>
                <div style={{ fontSize: 12, color: 'rgba(255, 255, 255, 0.5)', marginBottom: 4, textTransform: 'uppercase', letterSpacing: '0.5px' }}>{t('inventory.totalRecords')}</div>
                <div style={{ fontSize: 24, fontWeight: 800, color: '#FFFFFF' }}>
                  {inLogs.length}
                </div>
              </div>
              <div style={{ textAlign: 'center', borderRight: '1px solid rgba(255, 255, 255, 0.1)' }}>
                <div style={{ fontSize: 12, color: 'rgba(255, 255, 255, 0.5)', marginBottom: 4, textTransform: 'uppercase', letterSpacing: '0.5px' }}>{t('inventory.totalInStock')}</div>
                <div style={{ fontSize: 24, fontWeight: 800, color: '#52c41a' }}>
                  {inLogs.reduce((sum, log) => sum + Number(log.quantity || 0), 0)} <span style={{ fontSize: 14, fontWeight: 400, opacity: 0.7 }}>{t('inventory.sticks')}</span>
                </div>
              </div>
              <div style={{ textAlign: 'center' }}>
                <div style={{ fontSize: 12, color: 'rgba(255, 255, 255, 0.5)', marginBottom: 4, textTransform: 'uppercase', letterSpacing: '0.5px' }}>{t('inventory.totalValue')}</div>
                <div style={{ fontSize: 24, fontWeight: 800, color: '#f4af25' }}>
                  <span style={{ fontSize: 14, marginRight: 2 }}>RM</span>
                  {inLogs.reduce((sum, log) => sum + (Number(log.quantity || 0) * Number((log as any).unitPrice || 0)), 0).toFixed(2)}
                </div>
              </div>
            </div>
          </div>

          {/* 品牌入库统计表格 */}
          <div className="points-config-form">
            <Table
              dataSource={inStats}
              rowKey="brand"
              pagination={false}
              size="small"
              style={{
                background: 'transparent'
              }}
              expandable={{
                columnWidth: 60,
                columnTitle: (
                  <div style={{ display: 'flex', justifyContent: 'center' }}>
                    <button
                      onClick={() => {
                        if (inStatsExpandedKeys.length > 0) {
                          setInStatsExpandedKeys([])
                        } else {
                          setInStatsExpandedKeys(inStats.map(s => s.brand))
                        }
                      }}
                      style={{
                        padding: '2px 8px',
                        borderRadius: 4,
                        border: '1px solid rgba(255, 255, 255, 0.2)',
                        background: 'rgba(255, 255, 255, 0.1)',
                        cursor: 'pointer',
                        fontSize: 16,
                        fontWeight: 600,
                        color: 'rgba(255, 255, 255, 0.6)',
                        lineHeight: 1,
                        minWidth: 28,
                        height: 28
                      }}
                      title={inStatsExpandedKeys.length > 0 ? t('inventory.collapseAll') : t('inventory.expandAll')}
                    >
                      {inStatsExpandedKeys.length > 0 ? '-' : '+'}
                    </button>
                  </div>
                ),
                expandedRowKeys: inStatsExpandedKeys,
                onExpandedRowsChange: (keys) => setInStatsExpandedKeys([...keys]),
                expandedRowRender: (record: any) => (
                  <div className="points-config-form">
                    <Table
                      dataSource={record.products}
                      rowKey={(p: any) => p.cigar.id}
                      pagination={false}
                      size="small"
                      showHeader={true}
                      style={{ marginLeft: 20, background: 'transparent' }}
                      columns={[
                        {
                          title: t('inventory.productName'),
                          dataIndex: 'cigar',
                          key: 'name',
                          render: (cigar: any) => (
                            <div style={{ paddingLeft: 8 }}>
                              <div style={{ fontWeight: 500 }}>{cigar.name}</div>
                            </div>
                          )
                        },
                        {
                          title: t('inventory.inQuantity'),
                          dataIndex: 'quantity',
                          key: 'quantity',
                          width: 150,
                          align: 'right' as const,
                          render: (quantity: number) => (
                            <span style={{ color: '#52c41a' }}>{quantity} {t('inventory.sticks')}</span>
                          )
                        },
                        {
                          title: t('inventory.recordCount'),
                          dataIndex: 'records',
                          key: 'records',
                          width: 120,
                          align: 'center' as const,
                          render: (records: number) => <span>{records}</span>
                        },
                        {
                          title: t('inventory.totalValue'),
                          dataIndex: 'totalValue',
                          key: 'totalValue',
                          width: 150,
                          align: 'right' as const,
                          render: (value: number) => (
                            <span style={{ color: '#1890ff' }}>RM{value.toFixed(2)}</span>
                          )
                        }
                      ]}
                    />
                  </div>
                ),
                rowExpandable: (record: any) => record.products && record.products.length > 0,
              }}
              columns={[
                {
                  title: t('inventory.brand'),
                  dataIndex: 'brand',
                  key: 'brand',
                  render: (brand: string, record: any) => (
                    <span style={{ fontWeight: 600 }}>
                      {brand} ({record.products?.length || 0} {t('inventory.products')})
                    </span>
                  )
                },
                {
                  title: t('inventory.inQuantity'),
                  dataIndex: 'quantity',
                  key: 'quantity',
                  width: 150,
                  align: 'right' as const,
                  render: (quantity: number) => (
                    <span style={{ fontWeight: 600, color: '#52c41a' }}>{quantity} {t('inventory.sticks')}</span>
                  )
                },
                {
                  title: t('inventory.recordCount'),
                  dataIndex: 'records',
                  key: 'records',
                  width: 120,
                  align: 'center' as const,
                  render: (records: number) => (
                    <span>{records}</span>
                  )
                },
                {
                  title: t('inventory.totalValue'),
                  dataIndex: 'totalValue',
                  key: 'totalValue',
                  width: 150,
                  align: 'right' as const,
                  render: (value: number) => (
                    <span style={{ fontWeight: 600, color: '#1890ff' }}>RM{value.toFixed(2)}</span>
                  )
                }
              ]}
            />
          </div>
        </div>
      </Modal>

      {/* 出库统计弹窗 */}
      <Modal
        title={t('inventory.outStatsTitle')}
        open={outStatsOpen}
        onCancel={() => setOutStatsOpen(false)}
        footer={null}
        {...getResponsiveModalConfig(isMobile, true, 800)}
      >
        <div style={getModalTheme().content as React.CSSProperties}>
          {/* 出库总体统计 */}
          <div style={{
            marginBottom: 20,
            padding: '24px',
            background: 'linear-gradient(135deg, rgba(255, 255, 255, 0.08) 0%, rgba(255, 255, 255, 0.03) 100%)',
            borderRadius: '16px',
            border: '1px solid rgba(244, 175, 37, 0.3)',
            backdropFilter: 'blur(12px)',
            boxShadow: '0 8px 32px rgba(0, 0, 0, 0.4)'
          }}>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 16 }}>
              <div style={{ textAlign: 'center', borderRight: '1px solid rgba(255, 255, 255, 0.1)' }}>
                <div style={{ fontSize: 12, color: 'rgba(255, 255, 255, 0.5)', marginBottom: 4, textTransform: 'uppercase', letterSpacing: '0.5px' }}>{t('inventory.totalRecords')}</div>
                <div style={{ fontSize: 24, fontWeight: 800, color: '#FFFFFF' }}>
                  {outLogs.length}
                </div>
              </div>
              <div style={{ textAlign: 'center', borderRight: '1px solid rgba(255, 255, 255, 0.1)' }}>
                <div style={{ fontSize: 12, color: 'rgba(255, 255, 255, 0.5)', marginBottom: 4, textTransform: 'uppercase', letterSpacing: '0.5px' }}>{t('inventory.totalOutStock')}</div>
                <div style={{ fontSize: 24, fontWeight: 800, color: '#ff4d4f' }}>
                  {outLogs.reduce((sum, log) => sum + Number(log.quantity || 0), 0)} <span style={{ fontSize: 14, fontWeight: 400, opacity: 0.7 }}>{t('inventory.sticks')}</span>
                </div>
              </div>
              <div style={{ textAlign: 'center' }}>
                <div style={{ fontSize: 12, color: 'rgba(255, 255, 255, 0.5)', marginBottom: 4, textTransform: 'uppercase', letterSpacing: '0.5px' }}>{t('inventory.totalValue')}</div>
                <div style={{ fontSize: 24, fontWeight: 800, color: '#f4af25' }}>
                  <span style={{ fontSize: 14, marginRight: 2 }}>RM</span>
                  {outLogs.reduce((sum, log) => sum + (Number(log.quantity || 0) * Number((log as any).unitPrice || 0)), 0).toFixed(2)}
                </div>
              </div>
            </div>
          </div>

          {/* 品牌出库统计表格（可展开产品明细） */}
          <div className="points-config-form">
            <Table
              dataSource={outStats}
              rowKey="brand"
              pagination={false}
              size="small"
              style={{
                background: 'transparent'
              }}
              expandable={{
                columnWidth: 60,
                columnTitle: (
                  <div style={{ display: 'flex', justifyContent: 'center' }}>
                    <button
                      onClick={() => {
                        if (outStatsExpandedKeys.length > 0) {
                          setOutStatsExpandedKeys([])
                        } else {
                          setOutStatsExpandedKeys(outStats.map(s => s.brand))
                        }
                      }}
                      style={{
                        padding: '2px 8px',
                        borderRadius: 4,
                        border: '1px solid rgba(255, 255, 255, 0.2)',
                        background: 'rgba(255, 255, 255, 0.1)',
                        cursor: 'pointer',
                        fontSize: 16,
                        fontWeight: 600,
                        color: 'rgba(255, 255, 255, 0.6)',
                        lineHeight: 1,
                        minWidth: 28,
                        height: 28
                      }}
                      title={outStatsExpandedKeys.length > 0 ? t('inventory.collapseAll') : t('inventory.expandAll')}
                    >
                      {outStatsExpandedKeys.length > 0 ? '-' : '+'}
                    </button>
                  </div>
                ),
                expandedRowKeys: outStatsExpandedKeys,
                onExpandedRowsChange: (keys) => setOutStatsExpandedKeys([...keys]),
                expandedRowRender: (record: any) => (
                  <div className="points-config-form">
                    <Table
                      dataSource={record.products}
                      rowKey={(p: any) => p.cigar.id}
                      pagination={false}
                      size="small"
                      showHeader={true}
                      style={{ marginLeft: 20, background: 'transparent' }}
                      columns={[
                        {
                          title: t('inventory.productName'),
                          dataIndex: 'cigar',
                          key: 'name',
                          render: (cigar: any) => (
                            <div style={{ paddingLeft: 8 }}>
                              <div style={{ fontWeight: 500 }}>{cigar.name}</div>
                            </div>
                          )
                        },
                        {
                          title: t('inventory.outQuantity'),
                          dataIndex: 'quantity',
                          key: 'quantity',
                          width: 150,
                          align: 'right' as const,
                          render: (quantity: number) => (
                            <span style={{ color: '#f5222d' }}>{quantity} {t('inventory.sticks')}</span>
                          )
                        },
                        {
                          title: t('inventory.recordCount'),
                          dataIndex: 'records',
                          key: 'records',
                          width: 120,
                          align: 'center' as const,
                          render: (records: number) => <span>{records}</span>
                        },
                        {
                          title: t('inventory.totalValue'),
                          dataIndex: 'totalValue',
                          key: 'totalValue',
                          width: 150,
                          align: 'right' as const,
                          render: (value: number) => (
                            <span style={{ fontWeight: 600, color: '#f4af25' }}>RM{value.toFixed(2)}</span>
                          )
                        }
                      ]}
                    />
                  </div>
                ),
                rowExpandable: (record: any) => record.products && record.products.length > 0,
              }}
              columns={[
                {
                  title: t('inventory.brand'),
                  dataIndex: 'brand',
                  key: 'brand',
                  render: (brand: string, record: any) => (
                    <span style={{ fontWeight: 600 }}>
                      {brand} ({record.products?.length || 0} {t('inventory.products')})
                    </span>
                  )
                },
                {
                  title: t('inventory.outQuantity'),
                  dataIndex: 'quantity',
                  key: 'quantity',
                  width: 150,
                  align: 'right' as const,
                  render: (quantity: number) => (
                    <span style={{ fontWeight: 600, color: '#f5222d' }}>{quantity} {t('inventory.sticks')}</span>
                  )
                },
                {
                  title: t('inventory.recordCount'),
                  dataIndex: 'records',
                  key: 'records',
                  width: 120,
                  align: 'center' as const,
                  render: (records: number) => (
                    <span>{records}</span>
                  )
                },
                {
                  title: t('inventory.totalValue'),
                  dataIndex: 'totalValue',
                  key: 'totalValue',
                  width: 150,
                  align: 'right' as const,
                  render: (value: number) => (
                    <span style={{ fontWeight: 600, color: '#f4af25' }}>RM{value.toFixed(2)}</span>
                  )
                }
              ]}
            />
          </div>
        </div>
      </Modal>

      {/* 订单编辑Modal */}
      <Modal
        title={t('inventory.editInboundOrder')}
        open={!!editingOrder}
        onCancel={() => {
          setEditingOrder(null)
          orderEditForm.resetFields()
          setEditAttachmentFileList([])
          setEditUploadedAttachments([])
        }}
        width={800}
        footer={null}
        afterOpenChange={(open) => {
          if (open && editingOrder) {
            // 初始化附件列表
            const existingAttachments = editingOrder.attachments || []
            setEditUploadedAttachments(existingAttachments)
            setEditAttachmentFileList(
              existingAttachments.map((att, idx) => ({
                uid: `existing-${idx}`,
                name: att.filename,
                status: 'done' as const,
                url: att.url
              }))
            )
          }
        }}
      >
        <Form
          form={orderEditForm}
          layout="vertical"
          onFinish={async (values) => {
            if (!editingOrder) return

            setLoading(true)
            try {
              // 处理所有项目，为非雪茄类型生成 cigarId
              const processedItems = (values.items || []).map((item: any) => {
                const lineItemType = item.itemType || 'cigar'
                let cigarId = item.cigarId
                let cigarName = item.cigarName

                // 非雪茄类型需要生成 cigarId
                if (lineItemType !== 'cigar' && !cigarId) {
                  const prefixMap: { [key: string]: string } = {
                    'activity': 'ACTIVITY:',
                    'gift': 'GIFT:',
                    'service': 'SERVICE:',
                    'other': 'OTHER:'
                  }
                  const prefix = prefixMap[lineItemType] || 'OTHER:'
                  cigarId = `${prefix}${Date.now()}_${Math.random().toString(36).substr(2, 9)}`
                }

                return {
                  cigarId,
                  cigarName: cigarName || '',
                  itemType: lineItemType,
                  quantity: Number(item.quantity),
                  ...(item.unitPrice != null && {
                    unitPrice: Number(item.unitPrice),
                    subtotal: Number(item.quantity) * Number(item.unitPrice)
                  })
                }
              })

              // 重新计算汇总
              const totalQuantity = processedItems.reduce((sum: number, item: any) =>
                sum + (Number(item.quantity) || 0), 0
              )
              const totalValue = processedItems.reduce((sum: number, item: any) => {
                const qty = Number(item.quantity) || 0
                const price = Number(item.unitPrice) || 0
                return sum + (qty * price)
              }, 0)

              // 更新订单
              await updateInboundOrder(editingOrder.id, {
                referenceNo: values.referenceNo,
                reason: values.reason,
                items: processedItems,
                totalQuantity,
                totalValue,
                notes: values.notes,
                attachments: editUploadedAttachments.length > 0 ? editUploadedAttachments : undefined
              })

              // 同步更新 inventory_movements
              // 先删除旧的 movements
              const oldMovements = inventoryMovements.filter(m =>
                m.inboundOrderId === editingOrder.id
              )
              for (const m of oldMovements) {
                await deleteDocument(COLLECTIONS.INVENTORY_MOVEMENTS, m.id)
              }

              // 创建新的 movements（使用处理后的项目数据）
              for (const item of processedItems) {
                const movement = {
                  cigarId: item.cigarId,
                  cigarName: item.cigarName,
                  itemType: item.itemType,
                  type: 'in' as const,
                  quantity: Number(item.quantity),
                  referenceNo: values.referenceNo,
                  orderType: 'inbound' as const,
                  inboundOrderId: editingOrder.id,
                  reason: values.reason,
                  unitPrice: item.unitPrice ? Number(item.unitPrice) : undefined,
                  createdAt: editingOrder.createdAt
                }
                await createDocument(COLLECTIONS.INVENTORY_MOVEMENTS, movement)
              }

              message.success(t('inventory.orderUpdatedSuccess'))
              setEditingOrder(null)
              orderEditForm.resetFields()
              setEditAttachmentFileList([])
              setEditUploadedAttachments([])
              refreshInboundOrders()
              refreshInventoryMovements()
            } catch (error: any) {
              message.error(t('inventory.orderUpdateFailed', { error: error.message }))
            } finally {
              setLoading(false)
            }
          }}
        >
          {/* 左右分栏布局 */}
          <Row gutter={24}>
            {/* 左侧：单号和原因 */}
            <Col span={12}>
              <Form.Item
                label={t('inventory.referenceNo')}
                name="referenceNo"
                rules={[{ required: true, message: t('inventory.pleaseInputOrderNo') }]}
              >
                <Input placeholder={t('inventory.orderNoPlaceholder')} />
              </Form.Item>

              <Form.Item
                label={t('inventory.reason')}
                name="reason"
              >
                <Input placeholder={t('inventory.reasonPlaceholder')} />
              </Form.Item>

              <Form.Item
                label={t('inventory.notes')}
                name="notes"
              >
                <Input.TextArea rows={3} placeholder={t('inventory.notesPlaceholder')} />
              </Form.Item>
            </Col>

            {/* 右侧：附件上传 */}
            <Col span={12}>
              <Form.Item label={t('inventory.attachments')}>
                <Upload
                  accept=".pdf,.jpg,.jpeg,.png"
                  fileList={editAttachmentFileList}
                  beforeUpload={(file) => {
                    const isPDF = file.type === 'application/pdf'
                    const isImage = file.type.startsWith('image/')
                    if (!isPDF && !isImage) {
                      message.error(t('inventory.supportedFormats'))
                      return Upload.LIST_IGNORE
                    }
                    const isLt10M = file.size / 1024 / 1024 < 10
                    if (!isLt10M) {
                      message.error(t('inventory.maxFileSize'))
                      return Upload.LIST_IGNORE
                    }
                    return false
                  }}
                  onChange={async (info) => {
                    setEditAttachmentFileList(info.fileList)

                    const file = info.file
                    if (file.originFileObj && file.status === undefined) {
                      try {
                        const uploadResult = await cloudinaryUpload(file.originFileObj, {
                          folder: 'inventory_documents'
                        })

                        const isPDF = file.type === 'application/pdf'
                        const newAttachment = {
                          url: uploadResult.secure_url,
                          type: (isPDF ? 'pdf' : 'image') as 'pdf' | 'image',
                          filename: file.name,
                          uploadedAt: new Date()
                        }

                        setEditUploadedAttachments(prev => [...prev, newAttachment])

                        setEditAttachmentFileList(prev =>
                          prev.map(f =>
                            f.uid === file.uid
                              ? { ...f, status: 'done', url: uploadResult.secure_url }
                              : f
                          )
                        )

                        message.success(t('inventory.uploadSuccess'))
                      } catch (error) {
                        message.error(t('inventory.uploadFailed'))
                        setEditAttachmentFileList(prev => prev.filter(f => f.uid !== file.uid))
                      }
                    }
                  }}
                  onRemove={(file) => {
                    const fileUrl = file.url
                    if (fileUrl) {
                      setEditUploadedAttachments(prev => prev.filter(att => att.url !== fileUrl))
                    }
                  }}
                  listType="picture"
                  maxCount={5}
                >
                  <Button icon={<UploadOutlined />} loading={uploadingFile}>
                    {t('inventory.uploadOrderDocument')}
                  </Button>
                </Upload>
                <div style={{ fontSize: 12, color: '#8c8c8c', marginTop: 4 }}>
                  {t('inventory.supportedFormats')} · {t('inventory.maxFileSize')}
                </div>
              </Form.Item>
            </Col>
          </Row>

          <Form.List name="items">
            {(fields, { add, remove }) => (
              <>
                <div style={{ marginBottom: 12, display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                  <h4 style={{ margin: 0, fontSize: '16px' }}>{t('inventory.productList')}</h4>
                  <Button
                    type="dashed"
                    onClick={() => add({ itemType: 'cigar', quantity: 1 })}
                    icon={<PlusOutlined />}
                    size="small"
                  >
                    {t('inventory.addProduct')}
                  </Button>
                </div>

                {fields.map((field, index) => {
                  const { key, ...restField } = field
                  return (
                    <div
                      key={key}
                      style={{
                        marginBottom: 8,
                        padding: 10,
                        border: '1px solid rgba(255, 255, 255, 0.1)',
                        borderRadius: 8,
                        background: 'rgba(0, 0, 0, 0.2)'
                      }}
                    >
                      <Form.Item
                        {...restField}
                        name={[field.name, 'cigarName']}
                        hidden
                      >
                        <Input />
                      </Form.Item>

                      {/* 产品标题、类型选择、产品/名称、数量、单价、删除按钮 */}
                      <Row gutter={12} align="middle" style={{ marginBottom: 8 }}>
                        <Col flex="80px">
                          <span style={{ fontWeight: 600, color: 'rgba(255, 255, 255, 0.6)' }}>{t('inventory.productIndex', { index: index + 1 })}</span>
                        </Col>
                        <Col flex="120px">
                          <Form.Item
                            {...restField}
                            name={[field.name, 'itemType']}
                            initialValue="cigar"
                            style={{ marginBottom: 0 }}
                          >
                            <Select
                              placeholder={t('inventory.selectItemType')}
                              onChange={() => {
                                const currentItems = orderEditForm.getFieldValue('items') || []
                                if (currentItems[index]) {
                                  currentItems[index].cigarId = undefined
                                  currentItems[index].cigarName = undefined
                                  currentItems[index].customName = undefined
                                  orderEditForm.setFieldsValue({ items: currentItems })
                                }
                              }}
                            >
                              <Select.Option value="cigar">🎯 {t('inventory.itemTypeCigar')}</Select.Option>
                              <Select.Option value="activity">🎪 {t('inventory.itemTypeActivity')}</Select.Option>
                              <Select.Option value="gift">🎁 {t('inventory.itemTypeGift')}</Select.Option>
                              <Select.Option value="service">💼 {t('inventory.itemTypeService')}</Select.Option>
                              <Select.Option value="other">📦 {t('inventory.itemTypeOther')}</Select.Option>
                            </Select>
                          </Form.Item>
                        </Col>
                        <Col flex="auto">
                          <Form.Item noStyle shouldUpdate={(prevValues, currentValues) => {
                            const prev = prevValues.items?.[index]?.itemType
                            const curr = currentValues.items?.[index]?.itemType
                            return prev !== curr
                          }}>
                            {({ getFieldValue }) => {
                              const currentItemType = getFieldValue(['items', field.name, 'itemType']) || 'cigar'

                              return currentItemType === 'cigar' ? (
                                <Form.Item
                                  {...restField}
                                  name={[field.name, 'cigarId']}
                                  rules={[{ required: true, message: t('inventory.pleaseSelectProduct') }]}
                                  style={{ marginBottom: 0 }}
                                >
                                  <Select
                                    showSearch
                                    placeholder={t('inventory.selectCigarProduct')}
                                    optionFilterProp="children"
                                    onChange={(value) => {
                                      const cigar = items.find(c => c.id === value)
                                      if (cigar) {
                                        const currentItems = orderEditForm.getFieldValue('items') || []
                                        currentItems[index] = {
                                          ...currentItems[index],
                                          cigarId: value,
                                          cigarName: cigar.name,
                                          itemType: 'cigar'
                                        }
                                        orderEditForm.setFieldsValue({ items: currentItems })
                                      }
                                    }}
                                  >
                                    {items.map((cigar: any) => (
                                      <Select.Option key={cigar.id} value={cigar.id}>
                                        {cigar.name}
                                      </Select.Option>
                                    ))}
                                  </Select>
                                </Form.Item>
                              ) : (
                                <Form.Item
                                  {...restField}
                                  name={[field.name, 'cigarName']}
                                  rules={[{ required: true, message: t('inventory.itemNameRequired') }]}
                                  style={{ marginBottom: 0 }}
                                >
                                  <Input placeholder={t('inventory.itemNamePlaceholder')} />
                                </Form.Item>
                              )
                            }}
                          </Form.Item>
                        </Col>
                      </Row>
                      <Row gutter={12} align="middle">
                        <Col flex="80px" />
                        <Col flex="100px">
                          <Form.Item
                            {...restField}
                            name={[field.name, 'quantity']}
                            rules={[{ required: true, message: t('inventory.pleaseInputQuantity') }]}
                            style={{ marginBottom: 0 }}
                          >
                            <InputNumber
                              placeholder={t('inventory.quantity')}
                              min={1}
                              style={{ width: '100%' }}
                            />
                          </Form.Item>
                        </Col>
                        <Col flex="100px">
                          <Form.Item
                            {...restField}
                            name={[field.name, 'unitPrice']}
                            style={{ marginBottom: 0 }}
                          >
                            <InputNumber
                              placeholder={t('inventory.unitPrice')}
                              min={0}
                              precision={2}
                              style={{ width: '100%' }}
                            />
                          </Form.Item>
                        </Col>
                        <Col flex="60px">
                          <Button
                            type="link"
                            danger
                            size="small"
                            onClick={() => remove(field.name)}
                            style={{ padding: 0 }}
                          >
                            {t('common.delete')}
                          </Button>
                        </Col>
                      </Row>
                    </div>
                  )
                })}
              </>
            )}
          </Form.List>

          <Form.Item style={{ marginTop: 24, marginBottom: 0 }}>
            <Space>
              <Button type="primary" htmlType="submit" loading={loading}>
                {t('common.saveChanges')}
              </Button>
              <Button onClick={() => {
                setEditingOrder(null)
                orderEditForm.resetFields()
                setEditAttachmentFileList([])
                setEditUploadedAttachments([])
              }}>
                {t('common.cancel')}
              </Button>
            </Space>
          </Form.Item>
        </Form>
      </Modal>

      {/* 删除确认对话框 - 使用受控 Modal 替代 modal.confirm 以解决 React 19 兼容性问题 */}
      <Modal
        title={t('inventory.deleteReferenceGroup')}
        open={deleteConfirmOpen}
        onOk={async () => {
          if (!deleteTargetOrder) return


          setLoading(true)
          try {
            // 使用 deleteTargetOrder.id 直接查找订单
            const order = inboundOrders.find(o => o.id === deleteTargetOrder.id)
            if (order && order.id) {
              await deleteInboundOrder(order.id)
              message.success(t('inventory.deleteSuccess'))
              // 刷新数据
              refreshInboundOrders()
              refreshInventoryMovements()
              closeDeleteOrder()
            } else {
              message.error(t('inventory.orderNotFound'))
              closeDeleteOrder()
            }
          } catch (error: any) {
            message.error(t('common.deleteFailed') + ': ' + (error.message || String(error)))
          } finally {
            setLoading(false)
          }
        }}
        onCancel={closeDeleteOrder}
        okText={t('common.confirm')}
        cancelText={t('common.cancel')}
        okType="danger"
        confirmLoading={loading}
      >
        {deleteTargetOrder && (
          <div>
            {t('inventory.deleteReferenceGroupConfirm', {
              referenceNo: deleteTargetOrder.referenceNo,
              count: deleteTargetOrder.productCount
            })}
          </div>
        )}
      </Modal>
    </div>
  )
}

export default AdminInventory
