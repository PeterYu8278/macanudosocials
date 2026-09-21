// 图片裁剪组件
import React, { useState, useRef, useCallback } from 'react'
import { Button, Modal, App } from 'antd'
import { useTranslation } from 'react-i18next'
import { CheckOutlined, CloseOutlined } from '@ant-design/icons'
import ReactCrop, { centerCrop, makeAspectCrop } from 'react-image-crop'
import type { Crop, PixelCrop } from 'react-image-crop'
import 'react-image-crop/dist/ReactCrop.css'

  interface ImageCropProps {
  src: string // 原始图片URL
  visible: boolean
  onCancel: () => void
  onConfirm: (croppedImageUrl: string) => void
  aspectRatio?: number // 宽高比，如 1 表示正方形，undefined 表示自由裁剪
  minWidth?: number // 最小宽度
  minHeight?: number // 最小高度
  maxWidth?: number // 最大宽度
  maxHeight?: number // 最大高度
  title?: string
  originalFileType?: string // 原始文件类型，如 'image/png' 或 'image/jpeg'
}

const ImageCrop: React.FC<ImageCropProps> = ({
  src,
  visible,
  onCancel,
  onConfirm,
  aspectRatio,
  minWidth = 100,
  minHeight = 100,
  maxWidth = 800,
  maxHeight = 800,
  title,
  originalFileType
}) => {
  const { t } = useTranslation()
  const { message } = App.useApp()
  const modalTitle = title ?? t('common.imageCrop')
  const [crop, setCrop] = useState<Crop>()
  const [completedCrop, setCompletedCrop] = useState<PixelCrop>()
  const [loading, setLoading] = useState(false)
  const imgRef = useRef<HTMLImageElement>(null)
  const previewCanvasRef = useRef<HTMLCanvasElement>(null)

  // 初始化裁剪区域
  const onImageLoad = useCallback((e: React.SyntheticEvent<HTMLImageElement>) => {
    const { width, height } = e.currentTarget
    if (aspectRatio) {
      const crop = centerCrop(
        makeAspectCrop(
          {
            unit: '%',
            width: 90,
          },
          aspectRatio,
          width,
          height
        ),
        width,
        height
      )
      setCrop(crop)
    } else {
      // 自由裁剪：不限制宽高比
      setCrop({
        unit: '%',
        x: 5,
        y: 5,
        width: 90,
        height: 90
      })
    }
  }, [aspectRatio])

  // 将裁剪后的图片转换为Blob
  const getCroppedImg = (image: HTMLImageElement, crop: PixelCrop, imageSrc: string, originalFileType?: string): Promise<Blob> => {
    const canvas = document.createElement('canvas')
    const ctx = canvas.getContext('2d')
    
    if (!ctx) {
      throw new Error('No 2d context')
    }

    const scaleX = image.naturalWidth / image.width
    const scaleY = image.naturalHeight / image.height
    const pixelRatio = window.devicePixelRatio

    canvas.width = crop.width * pixelRatio * scaleX
    canvas.height = crop.height * pixelRatio * scaleY

    // 清除 Canvas，确保透明背景保持透明（修复 PNG 透明背景被填充黑色的问题）
    ctx.clearRect(0, 0, canvas.width, canvas.height)
    
    ctx.setTransform(pixelRatio, 0, 0, pixelRatio, 0, 0)
    ctx.imageSmoothingQuality = 'high'

    ctx.drawImage(
      image,
      crop.x * scaleX,
      crop.y * scaleY,
      crop.width * scaleX,
      crop.height * scaleY,
      0,
      0,
      crop.width * scaleX,
      crop.height * scaleY
    )

    return new Promise((resolve) => {
      // 检测原始图片格式，如果是 PNG 则保持 PNG，否则使用 JPEG
      // 优先使用传入的 originalFileType，否则从 imageSrc 检测（兼容旧代码）
      let imageFormat = 'image/jpeg' // 默认 JPEG
      if (originalFileType === 'image/png') {
        imageFormat = 'image/png'
      } else if (imageSrc.toLowerCase().includes('.png')) {
        imageFormat = 'image/png'
      }
      
      canvas.toBlob(
        (blob) => {
          if (!blob) {
            throw new Error('Canvas is empty')
          }
          resolve(blob)
        },
        imageFormat,
        0.9
      )
    })
  }

  // 确认裁剪
  const handleConfirm = async () => {
    if (!completedCrop || !imgRef.current) {
      message.error(t('crop.selectArea'))
      return
    }

    // 验证裁剪尺寸
    if (completedCrop.width < minWidth || completedCrop.height < minHeight) {
      message.error(t('crop.tooSmall', { width: minWidth, height: minHeight }))
      return
    }

    if (completedCrop.width > maxWidth || completedCrop.height > maxHeight) {
      message.error(t('crop.tooLarge', { width: maxWidth, height: maxHeight }))
      return
    }

    setLoading(true)
    try {
      const croppedImageBlob = await getCroppedImg(imgRef.current, completedCrop, src, originalFileType)
      const croppedImageUrl = URL.createObjectURL(croppedImageBlob)
      onConfirm(croppedImageUrl)
      message.success(t('crop.success'))
    } catch (error) {
      message.error(t('crop.fail'))
    } finally {
      setLoading(false)
    }
  }

  // 重置裁剪区域
  const handleReset = () => {
    if (imgRef.current) {
      const { width, height } = imgRef.current
      if (aspectRatio) {
        const crop = centerCrop(
          makeAspectCrop(
            {
              unit: '%',
              width: 90,
            },
            aspectRatio,
            width,
            height
          ),
          width,
          height
        )
        setCrop(crop)
      } else {
        // 自由裁剪：不限制宽高比
        setCrop({
          unit: '%',
          x: 5,
          y: 5,
          width: 90,
          height: 90
        })
      }
    }
  }

  return (
    <Modal
      title={<span style={{ color: '#ffd700', fontWeight: 600 }}>{modalTitle}</span>}
      open={visible}
      onCancel={onCancel}
      style={{ width: '300px' }}
      styles={{
        content: {
          background: 'linear-gradient(135deg, #0f0f0f 0%, #1a1a1a 100%)',
          border: '1px solid rgba(255, 215, 0, 0.3)',
          borderRadius: '8px'
        },
        header: {
          background: 'rgba(15, 15, 15, 0.8)',
          borderBottom: '1px solid rgba(255, 215, 0, 0.2)',
          borderRadius: '8px 8px 0 0'
        },
        footer: {
          background: 'rgba(15, 15, 15, 0.8)',
          borderTop: '1px solid rgba(255, 215, 0, 0.2)',
          borderRadius: '0 0 8px 8px'
        }
      }}
      footer={[
        <Button 
          key="cancel" 
          onClick={onCancel} 
          icon={<CloseOutlined />}
          style={{
            background: 'rgba(255, 77, 79, 0.1)',
            marginTop: '10px',
            borderColor: 'rgba(255, 77, 79, 0.3)',
            color: '#ff4d4f'
          }}
        >
          {t('common.cancel')}
        </Button>,
        <Button 
          key="reset" 
          onClick={handleReset}
          style={{
            background: 'rgba(255, 215, 0, 0.1)',
            borderColor: 'rgba(255, 215, 0, 0.3)',
            color: '#ffd700'
          }}
        >
          {t('common.reset')}
        </Button>,
        <Button
          key="confirm"
          type="primary"
          loading={loading}
          onClick={handleConfirm}
          icon={<CheckOutlined />}
          style={{
            background: 'linear-gradient(to right, #FDE08D, #C48D3A)',
            borderColor: '#ffd700',
            color: '#000'
          }}
        >
          {t('crop.confirm')}
        </Button>
      ]}
    >
      <div style={{ textAlign: 'center' }}>
        {/* 裁剪说明 */}
        <div style={{ 
          marginBottom: '16px', 
          padding: '12px', 
          background: 'rgba(15, 15, 15, 0.6)', 
          border: '1px solid rgba(255, 215, 0, 0.2)',
          borderRadius: '6px',
          fontSize: '14px',
          color: '#ffd700'
        }}>
          <p style={{ margin: '0 0 8px 0', fontWeight: '600', color: '#ffd700' }}>{t('common.cropRequirements')}</p>
          <p style={{ margin: '0', color: '#c0c0c0' }}>
            {aspectRatio ? t('common.cropAspectRatio', { ratio: `${aspectRatio}:1` }) + ' | ' : t('common.cropFree') + ' | '}{t('common.cropMinSize', { width: minWidth, height: minHeight })} | {t('common.cropMaxSize', { width: maxWidth, height: maxHeight })}
          </p>
        </div>

        {/* 图片裁剪区域 */}
        <div style={{ 
          display: 'flex', 
          justifyContent: 'center', 
          alignItems: 'center',
          minHeight: '400px',
          background: 'linear-gradient(135deg, #0a0a0a 0%, #1a1a1a 50%, #2d2d2d 100%)',
          border: '1px solid rgba(255, 215, 0, 0.1)',
          borderRadius: '8px',
          padding: '20px'
        }}>
          <ReactCrop
            crop={crop}
            onChange={(_, percentCrop) => setCrop(percentCrop)}
            onComplete={(c) => setCompletedCrop(c)}
            aspect={aspectRatio || undefined}
            minWidth={minWidth}
            minHeight={minHeight}
            maxWidth={maxWidth}
            maxHeight={maxHeight}
          >
            <img
              ref={imgRef}
              alt="Crop me"
              src={src}
              style={{ maxWidth: '100%', maxHeight: '500px' }}
              onLoad={onImageLoad}
            />
          </ReactCrop>
        </div>
      </div>
    </Modal>
  )
}

export default ImageCrop
