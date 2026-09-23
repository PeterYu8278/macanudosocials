// QR Code 生成工具
import QRCode from 'qrcode'

/**
 * 生成会员QR Code
 * @param memberId 会员ID
 * @param options QR Code选项
 * @returns Promise<string> Base64编码的QR Code图片
 */
export const generateMemberQRCode = async (
  memberId: string, 
  options: {
    size?: number
    margin?: number
    color?: {
      dark?: string
      light?: string
    }
    appName?: string
  } = {}
): Promise<string> => {
  try {
    const {
      size = 200,
      margin = 2,
      color = {
        dark: '#000000',
        light: '#FFFFFF'
      },
      appName = ''
    } = options

    // 构建QR Code内容 - 包含会员ID和俱乐部信息
    const qrContent = JSON.stringify({
      type: 'cigar_club_member',
      memberId: memberId,
      club: appName || 'MS',
      timestamp: new Date().toISOString(),
      version: '1.0'
    })

    // 生成QR Code
    const qrCodeDataURL = await QRCode.toDataURL(qrContent, {
      width: size,
      margin: margin,
      color: color,
      errorCorrectionLevel: 'M'
    })

    return qrCodeDataURL
  } catch (error) {
    throw new Error('QR Code生成失败')
  }
}

/**
 * 生成简单的会员ID QR Code
 * @param memberId 会员ID
 * @returns Promise<string> Base64编码的QR Code图片
 */
export const generateSimpleMemberQRCode = async (memberId: string): Promise<string> => {
  try {
    const qrCodeDataURL = await QRCode.toDataURL(memberId, {
      width: 200,
      margin: 2,
      color: {
        dark: '#000000',
        light: '#FFFFFF'
      },
      errorCorrectionLevel: 'M'
    })

    return qrCodeDataURL
  } catch (error) {
    throw new Error('QR Code生成失败')
  }
}

/**
 * 生成会员卡专用的QR Code
 * 内容：带引荐码参数的注册链接
 * @param memberId 会员编号（用作引荐码）
 * @param memberName 会员姓名（未使用，保留兼容性）
 * @returns Promise<string> Base64编码的QR Code图片
 */
export const generateMemberCardQRCode = async (
  memberId: string, 
  memberName?: string
): Promise<string> => {
  try {
    // 获取当前域名（生产环境或开发环境）
    const baseUrl = typeof window !== 'undefined' 
      ? window.location.origin 
      : 'https://jcigar.netlify.app';
    
    // 生成带引荐码参数的注册链接
    // 格式：https://jcigar.netlify.app/register?ref=000123
    const qrContent = `${baseUrl}/register?ref=${memberId}`;

    const qrCodeDataURL = await QRCode.toDataURL(qrContent, {
      width: 200,
      margin: 2,
      color: {
        dark: '#000000',
        light: '#FFFFFF'
      },
      errorCorrectionLevel: 'M'  // M级纠错（适合URL）
    })

    return qrCodeDataURL
  } catch (error) {
    throw new Error('会员卡QR Code生成失败')
  }
}
