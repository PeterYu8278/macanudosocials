import React, { useEffect, useMemo, useRef, useState } from 'react'
import { Button, Card, Col, Form, Input, Row, Space, App, Divider } from 'antd'
import { useTranslation } from 'react-i18next'
import dayjs from 'dayjs'
import type { AppConfig, InvoiceTemplateConfig, Order, OrderInvoiceMeta } from '@/types'
import { getAppConfig, updateAppConfig } from '@/services/firebase/appConfig'
import { useAuthStore } from '@/store/modules/auth'
import { openInvoicePdfPreview, generateInvoicePdfAndDownload } from '@/utils/invoicePdfRenderer'
import InvoiceA4Render from './InvoiceA4Render'

type FormValues = {
  sellerName: string
  sellerRegNo: string
  sellerAddressLines: string
  sellerPhone: string
  sellerFax: string
  bankName: string
  bankAccountNo: string
  notes: string

  currencySymbol: string
  invoiceTitle: string
  thNo: string
  thDesc: string
  thQty: string
  thPrice: string
  thAmount: string
}

const splitLines = (text: string) =>
  String(text || '')
    .split(/\r?\n/g)
    .map(s => s.trim())
    .filter(Boolean)

const joinLines = (lines?: string[]) => (Array.isArray(lines) ? lines.join('\n') : '')

const defaultTemplate: InvoiceTemplateConfig = {
  version: 2,
  labels: {
    invoiceTitle: 'INVOICE',
  },
  table: {
    headers: {
      no: 'No',
      description: 'Description',
      qty: 'Qty',
      priceUnit: 'Price/Unit',
      amount: 'Amount',
    },
    currencySymbol: 'RM',
  },
}

const mergeTemplate = (tpl?: InvoiceTemplateConfig | null): InvoiceTemplateConfig => {
  if (!tpl) return defaultTemplate
  return {
    ...defaultTemplate,
    ...tpl,
    labels: { ...defaultTemplate.labels, ...(tpl.labels || {}) },
    table: { ...defaultTemplate.table, ...(tpl.table || {}), headers: { ...defaultTemplate.table?.headers, ...(tpl.table?.headers || {}) } },
  }
}

const InvoiceTemplateEditor: React.FC = () => {
  const { t } = useTranslation()
  const { message } = App.useApp()
  const { user } = useAuthStore()
  const [form] = Form.useForm<FormValues>()
  const [loading, setLoading] = useState(false)
  const [appConfig, setAppConfig] = useState<AppConfig | null>(null)
  const didHydrateRef = useRef(false)
  const retryTimerRef = useRef<number | null>(null)

  useEffect(() => {
    const load = async () => {
      if (didHydrateRef.current) return
      const cfg = await getAppConfig()
      if (!cfg) {
        if (retryTimerRef.current) window.clearTimeout(retryTimerRef.current)
        retryTimerRef.current = window.setTimeout(load, 3000)
        return
      }
      didHydrateRef.current = true
      setAppConfig(cfg)
      const tpl = mergeTemplate(cfg.invoiceTemplate)
      const inv = cfg.invoice || {}
      if (!form.isFieldsTouched(true)) {
        form.setFieldsValue({
          sellerName: inv.sellerName || 'JEP Ventures Sdn Bhd',
          sellerRegNo: inv.sellerRegNo || '',
          sellerAddressLines: joinLines(inv.sellerAddressLines),
          sellerPhone: inv.sellerPhone || '',
          sellerFax: inv.sellerFax || '',
          bankName: inv.bankName || '',
          bankAccountNo: inv.bankAccountNo || '',
          notes: joinLines(inv.notes),
          currencySymbol: String(tpl.table?.currencySymbol || 'RM'),
          invoiceTitle: String(tpl.labels?.invoiceTitle || 'INVOICE'),
          thNo: String(tpl.table?.headers?.no || 'No'),
          thDesc: String(tpl.table?.headers?.description || 'Description'),
          thQty: String(tpl.table?.headers?.qty || 'Qty'),
          thPrice: String(tpl.table?.headers?.priceUnit || 'Price/Unit'),
          thAmount: String(tpl.table?.headers?.amount || 'Amount'),
        })
      }
    }
    load()
    return () => {
      if (retryTimerRef.current) window.clearTimeout(retryTimerRef.current)
    }
  }, [form])

  const buildConfig = async () => {
    const v = await form.validateFields()
    const invoice: NonNullable<AppConfig['invoice']> = {
      sellerName: v.sellerName?.trim() || undefined,
      sellerRegNo: v.sellerRegNo?.trim() || undefined,
      sellerAddressLines: splitLines(v.sellerAddressLines),
      sellerPhone: v.sellerPhone?.trim() || undefined,
      sellerFax: v.sellerFax?.trim() || undefined,
      bankName: v.bankName?.trim() || undefined,
      bankAccountNo: v.bankAccountNo?.trim() || undefined,
      notes: splitLines(v.notes),
    }
    const invoiceTemplate: InvoiceTemplateConfig = {
      version: 2,
      labels: { invoiceTitle: v.invoiceTitle?.trim() || 'INVOICE' },
      table: {
        currencySymbol: v.currencySymbol?.trim() || 'RM',
        headers: {
          no: v.thNo?.trim() || 'No',
          description: v.thDesc?.trim() || 'Description',
          qty: v.thQty?.trim() || 'Qty',
          priceUnit: v.thPrice?.trim() || 'Price/Unit',
          amount: v.thAmount?.trim() || 'Amount',
        },
      },
    }
    return { invoice, invoiceTemplate }
  }

  const previewPayload = useMemo(() => {
    const now = new Date()
    return {
      order: {
        id: 'ORDER_SAMPLE_001',
        userId: 'sample',
        items: [
          { cigarId: 'SAMPLE1', name: 'PREMIUM SAMPLE ITEM 1', quantity: 2, price: 150 },
          { cigarId: 'SAMPLE2', name: 'DELUXE SAMPLE ITEM 2', quantity: 1, price: 300 },
        ],
        total: 600,
        status: 'confirmed' as const,
        payment: { method: 'bank_transfer' },
        shipping: { address: 'DUMMY ADDRESS LINE 1\nDUMMY ADDRESS LINE 2' },
        createdAt: now,
        updatedAt: now,
      },
      invoice: {
        invoiceNo: 'IV-SAMPLE',
        invoiceDate: now,
        invoiceTo: { name: 'VALUED CUSTOMER', address: 'CUSTOMER RESIDENCE\nSTREET 123', phone: '012-3456789' },
        terms: 'CASH',
        yourRef: 'PO-98765',
        ourDoNo: 'DO-12345',
        generatedAt: now,
        generatedBy: user?.id || '',
      }
    }
  }, [user?.id])

  const w = Form.useWatch([], form)

  const designerPreview = useMemo(() => {
    const v = form.getFieldsValue()
    return {
      seller: {
        name: v.sellerName || 'JEP Ventures Sdn Bhd',
        regNo: v.sellerRegNo || undefined,
        addressLines: splitLines(v.sellerAddressLines),
        phone: v.sellerPhone || undefined,
        fax: v.sellerFax || undefined,
        logoUrl: appConfig?.logoUrl,
      },
      invoice: {
        invoiceNo: previewPayload.invoice.invoiceNo,
        invoiceDate: dayjs(previewPayload.invoice.invoiceDate).format('DD MMM YYYY'),
        terms: previewPayload.invoice.terms,
        yourRef: previewPayload.invoice.yourRef,
        ourDoNo: previewPayload.invoice.ourDoNo,
        invoiceTo: {
          name: previewPayload.invoice.invoiceTo.name,
          address: previewPayload.invoice.invoiceTo.address,
          phone: previewPayload.invoice.invoiceTo.phone,
        },
        page: '1 of 1',
      },
      order: {
        items: previewPayload.order.items.map(it => ({ name: it.name, qty: it.quantity, unit: it.price })),
        total: previewPayload.order.total,
        currencySymbol: v.currencySymbol || 'RM',
        totalWords: 'RINGGIT MALAYSIA : SIX HUNDRED ONLY',
      },
      labels: {
        invoiceTitle: v.invoiceTitle || 'INVOICE',
        thNo: v.thNo || 'No',
        thDesc: v.thDesc || 'Description',
        thQty: v.thQty || 'Qty',
        thPrice: v.thPrice || 'Price/Unit',
        thAmount: v.thAmount || 'Amount',
      },
      notes: splitLines(v.notes),
      bank: {
        bankName: v.bankName || undefined,
        bankAccountNo: v.bankAccountNo || undefined,
      },
    }
  }, [w, previewPayload])

  const handleSave = async () => {
    setLoading(true)
    try {
      const { invoice, invoiceTemplate } = await buildConfig()
      const res = await updateAppConfig({ invoice, invoiceTemplate }, user?.id || '')
      if (!res.success) {
        message.error(t('invoiceTemplate.saveFailed'))
        return
      }
      message.success(t('invoiceTemplate.saved'))
      const cfg = await getAppConfig()
      setAppConfig(cfg)
    } catch {
      message.error(t('invoiceTemplate.saveFailed'))
    } finally {
      setLoading(false)
    }
  }

  const handleDownload = async () => {
    const { invoice, invoiceTemplate } = await buildConfig()
    await generateInvoicePdfAndDownload({
      order: previewPayload.order as any,
      invoice: previewPayload.invoice,
      appConfig: { ...appConfig, invoice, invoiceTemplate } as any,
      filename: 'invoice-preview.pdf',
    })
  }

  return (
    <div style={{ padding: '24px' }}>
      <div style={{ marginBottom: '24px' }}>
        <h1 style={{ fontSize: '24px', fontWeight: 800, margin: 0 }}>{t('invoiceTemplate.title')}</h1>
        <p style={{ opacity: 0.6, margin: '4px 0 0 0' }}>{t('invoiceTemplate.subtitle')}</p>
      </div>

      <Form form={form} layout="vertical">
        <Row gutter={24}>
          <Col xs={24} xl={14}>
            <Card
              title={t("invoiceTemplate.livePreview")}
              extra={
                <Space>
                  <Button onClick={handleDownload}>{t("invoiceTemplate.downloadPdf")}</Button>
                  <Button type="primary" onClick={handleSave} loading={loading}>{t("invoiceTemplate.saveChanges")}</Button>
                </Space>
              }
              bodyStyle={{ padding: '20px', background: '#F1F5F9', display: 'flex', justifyContent: 'center' }}
            >
              <div style={{ boxShadow: '0 10px 25px -5px rgba(0,0,0,0.1)', transform: 'scale(0.8)', transformOrigin: 'top center', marginBottom: '-150px' }}>
                <InvoiceA4Render preview={designerPreview as any} />
              </div>
            </Card>
          </Col>

          <Col xs={24} xl={10}>
            <Card title={t("invoiceTemplate.businessDetails")} style={{ marginBottom: '20px' }}>
              <Form.Item label={t("invoiceTemplate.companyName")} name="sellerName">
                <Input placeholder="JEP Ventures Sdn Bhd" />
              </Form.Item>
              <Form.Item label={t("invoiceTemplate.regNo")} name="sellerRegNo">
                <Input placeholder="e.g. 123456-X" />
              </Form.Item>
              <Form.Item label={t("invoiceTemplate.address")} name="sellerAddressLines">
                <Input.TextArea rows={3} placeholder="Full business address..." />
              </Form.Item>
              <Row gutter={12}>
                <Col span={12}>
                  <Form.Item label={t("invoiceTemplate.phone")} name="sellerPhone">
                    <Input />
                  </Form.Item>
                </Col>
                <Col span={12}>
                  <Form.Item label={t("invoiceTemplate.fax")} name="sellerFax">
                    <Input />
                  </Form.Item>
                </Col>
              </Row>
            </Card>

            <Card title={t("invoiceTemplate.paymentNotes")} style={{ marginBottom: '20px' }}>
              <Row gutter={12}>
                <Col span={12}>
                  <Form.Item label={t("invoiceTemplate.bankName")} name="bankName">
                    <Input />
                  </Form.Item>
                </Col>
                <Col span={12}>
                  <Form.Item label={t("invoiceTemplate.accountNo")} name="bankAccountNo">
                    <Input />
                  </Form.Item>
                </Col>
              </Row>
              <Form.Item label={t("invoiceTemplate.defaultRemarks")} name="notes">
                <Input.TextArea rows={3} placeholder="1. Payment due in 7 days..." />
              </Form.Item>
            </Card>

            <Card title={t("invoiceTemplate.labelsCustomization")}>
              <Form.Item label={t("invoiceTemplate.invoiceTitleLabel")} name="invoiceTitle">
                <Input />
              </Form.Item>
              <Row gutter={12}>
                <Col span={12}>
                  <Form.Item label={t("invoiceTemplate.currencySymbol")} name="currencySymbol">
                    <Input />
                  </Form.Item>
                </Col>
                <Col span={12}>
                  <Form.Item label={t("invoiceTemplate.tableNoLabel")} name="thNo">
                    <Input />
                  </Form.Item>
                </Col>
              </Row>
              <Form.Item label={t("invoiceTemplate.descriptionLabel")} name="thDesc">
                <Input />
              </Form.Item>
              <Row gutter={12}>
                <Col span={8}>
                  <Form.Item label={t("invoiceTemplate.qtyLabel")} name="thQty">
                    <Input />
                  </Form.Item>
                </Col>
                <Col span={8}>
                  <Form.Item label={t("invoiceTemplate.priceLabel")} name="thPrice">
                    <Input />
                  </Form.Item>
                </Col>
                <Col span={8}>
                  <Form.Item label={t("invoiceTemplate.amountLabel")} name="thAmount">
                    <Input />
                  </Form.Item>
                </Col>
              </Row>
            </Card>
          </Col>
        </Row>
      </Form>
    </div>
  )
}

export default InvoiceTemplateEditor


