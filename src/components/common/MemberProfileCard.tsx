// Shared Member Avatar/Member Card Component
import React, { useState, useEffect, useRef } from 'react'
import { CrownOutlined, CopyOutlined, ShareAltOutlined } from '@ant-design/icons'
import { Modal, Button, Space, message } from 'antd'
import { useQRCode } from '../../hooks/useQRCode'
import { QRCodeDisplay } from '../common/QRCodeDisplay'
import { useTranslation } from 'react-i18next'
import type { User, AppConfig, PointsConfig } from '../../types'
import { collection, query, where, orderBy, limit, onSnapshot, Unsubscribe } from 'firebase/firestore'
import { db } from '../../config/firebase'
import { GLOBAL_COLLECTIONS } from '../../config/globalCollections'
import { getAppConfig } from '../../services/firebase/appConfig'
import { getPointsConfig } from '../../services/firebase/pointsConfig'
import { getUserMembershipPeriod } from '../../services/firebase/membershipFee'
import { getThumbnailUrl, getOptimizedImageUrl, extractPublicIdFromUrl } from '../../services/cloudinary/url'
import dayjs from 'dayjs'

// Truncate text showing as many leading chars as possible, then "...", then last 3 chars
const TailTruncatedText: React.FC<{ text: string; style?: React.CSSProperties }> = ({ text, style }) => {
  const containerRef = useRef<HTMLDivElement>(null)
  const [display, setDisplay] = useState(text)

  useEffect(() => {
    const el = containerRef.current
    if (!el || !text) return
    const canvas = document.createElement('canvas')
    const ctx = canvas.getContext('2d')
    if (!ctx) return
    const computed = window.getComputedStyle(el)
    ctx.font = `${computed.fontWeight} ${computed.fontSize} ${computed.fontFamily}`
    const containerWidth = el.clientWidth - 4  // 4px safety buffer for font rendering
    if (ctx.measureText(text).width <= containerWidth) {
      setDisplay(text)
      return
    }
    const tail = text.slice(-3)
    const ellipsis = '...'
    let lo = 0, hi = text.length - 3
    while (lo < hi) {
      const mid = Math.floor((lo + hi + 1) / 2)
      if (ctx.measureText(text.slice(0, mid) + ellipsis + tail).width <= containerWidth) lo = mid
      else hi = mid - 1
    }
    setDisplay(lo > 0 ? text.slice(0, lo) + ellipsis + tail : ellipsis + tail)
  }, [text])

  return <div ref={containerRef} style={{ ...style, overflow: 'hidden', whiteSpace: 'nowrap' }}>{display}</div>
}

interface MemberProfileCardProps {
  user: User | null
  showMemberCard: boolean
  onToggleMemberCard: (show: boolean) => void
  getMembershipText: (level: string) => string
  className?: string
  style?: React.CSSProperties
  enableQrModal?: boolean // Whether to enable click member card to enlarge QR code (home scene)
}

export const MemberProfileCard: React.FC<MemberProfileCardProps> = ({
  user,
  showMemberCard,
  onToggleMemberCard,
  getMembershipText,
  className = '',
  style = {},
  enableQrModal = false
}) => {
  const { t } = useTranslation()
  const [appConfig, setAppConfig] = useState<AppConfig | null>(null)
  const [pointsConfig, setPointsConfig] = useState<PointsConfig | null>(null)

  // 3D rotation animation state
  const [isRotating, setIsRotating] = useState(false)
  const [rotationDirection, setRotationDirection] = useState<'left' | 'right'>('right')
  const [touchStart, setTouchStart] = useState<number | null>(null)
  const [touchEnd, setTouchEnd] = useState<number | null>(null)
  // QR code enlarged display state
  const [qrModalVisible, setQrModalVisible] = useState(false)
  // Used to track previous check-in status
  const prevHasPendingSessionRef = useRef<boolean | null>(null)
  // Used to mark if it's the first callback
  const isFirstCallbackRef = useRef<boolean>(true)
  const [membershipPeriod, setMembershipPeriod] = useState<{ startDate: Date, endDate: Date } | null>(null)

  // Load app config
  useEffect(() => {
    const loadAppConfig = async () => {
      const config = await getAppConfig()
      if (config) {
        setAppConfig(config)
      }
    }
    loadAppConfig()
  }, [])

  // Load points config (to control referral reward text visibility)
  useEffect(() => {
    const loadPointsConfig = async () => {
      const config = await getPointsConfig()
      if (config) {
        setPointsConfig(config)
      }
    }
    loadPointsConfig()
  }, [])

  // 当 user 数据变化时重新获取会员有效期
  // auth store 已有 onSnapshot 监听 users/{uid}，user 对象变化会触发此 effect
  useEffect(() => {
    if (!user?.id) {
      setMembershipPeriod(null)
      return
    }
    getUserMembershipPeriod(user.id).then(setMembershipPeriod)
  }, [user?.id, user?.status, user?.membership?.level, user?.updatedAt])

  // Use onSnapshot to monitor user check-in status in real-time
  useEffect(() => {
    if (!user?.id) {
      // Reset state
      prevHasPendingSessionRef.current = null
      isFirstCallbackRef.current = true
      return
    }

    // Only set listener when referral code share modal is open
    if (!qrModalVisible) {
      // Reset state when modal closes to re-initialize next time
      prevHasPendingSessionRef.current = null
      isFirstCallbackRef.current = true
      return
    }

    // Query current user's pending visit session
    const q = query(
      collection(db, GLOBAL_COLLECTIONS.VISIT_SESSIONS),
      where('userId', '==', user.id),
      where('status', '==', 'pending'),
      orderBy('checkInAt', 'desc'),
      limit(1)
    )

    // Set real-time listener
    const unsubscribe: Unsubscribe = onSnapshot(
      q,
      (querySnapshot) => {
        const hasPendingSession = !querySnapshot.empty

        // First callback: only initialize state, don't close modal
        if (isFirstCallbackRef.current) {
          prevHasPendingSessionRef.current = hasPendingSession
          isFirstCallbackRef.current = false
          return
        }

        // Subsequent callbacks: user checked-in (from no pending session to having one)
        if (prevHasPendingSessionRef.current === false && hasPendingSession) {
          // Close referral code share modal
          setQrModalVisible(false)
        }

        // Update ref to current state
        prevHasPendingSessionRef.current = hasPendingSession
      },
      (error) => {
        // Silent error handling for listener
        if (error.code !== 'failed-precondition' && !error.message?.includes('index')) {
          // Log only if not an index error
        }
      }
    )

    // Cleanup: unsubscribe on unmount or dependency change
    return () => {
      unsubscribe()
    }
  }, [user?.id, qrModalVisible])

  // QR Code Hook - Generate referral link based on member ID
  const { qrCodeDataURL, loading: qrLoading, error: qrError } = useQRCode({
    memberId: user?.memberId,  // ✅ Use memberId instead of user.id
    memberName: user?.displayName,
    autoGenerate: true
  })

  // Copy referral code to clipboard
  const handleCopyReferralCode = async () => {
    if (!user?.memberId) {
      message.error(t('profile.referralCodeNotFound'))
      return
    }

    try {
      await navigator.clipboard.writeText(user.memberId)
      message.success(t('profile.referralCodeCopied'))
    } catch (error) {
      // Fallback: use traditional method
      const textArea = document.createElement('textarea')
      textArea.value = user.memberId
      textArea.style.position = 'fixed'
      textArea.style.opacity = '0'
      document.body.appendChild(textArea)
      textArea.select()
      try {
        document.execCommand('copy')
        message.success(t('profile.referralCodeCopied'))
      } catch (err) {
        message.error(t('profile.copyFailed'))
      }
      document.body.removeChild(textArea)
    }
  }

  // Copy share link to clipboard
  const handleCopyShareLink = async () => {
    if (!user?.memberId) {
      message.error(t('profile.referralCodeNotFound'))
      return
    }

    const baseUrl = window.location.origin
    const shareLink = `${baseUrl}/register?ref=${user.memberId}`

    try {
      await navigator.clipboard.writeText(shareLink)
      message.success(t('profile.inviteTextCopied'))
    } catch (error) {
      // Fallback
      const textArea = document.createElement('textarea')
      textArea.value = shareLink
      textArea.style.position = 'fixed'
      textArea.style.opacity = '0'
      document.body.appendChild(textArea)
      textArea.select()
      try {
        document.execCommand('copy')
        message.success(t('profile.inviteTextCopied'))
      } catch (err) {
        message.error(t('profile.copyFailed'))
      }
      document.body.removeChild(textArea)
    }
  }

  // Share function (Web Share API)
  const handleShare = async () => {
    if (!user?.memberId) {
      message.error(t('profile.referralCodeNotFound'))
      return
    }

    const baseUrl = window.location.origin
    const shareLink = `${baseUrl}/register?ref=${user.memberId}`
    const shareText = t('profile.shareText', { code: user.memberId })

    if (navigator.share) {
      try {
        await navigator.share({
          title: t('profile.shareInvitation'),
          text: shareText,
          url: shareLink
        })
      } catch (error: any) {
        // User cancelled or other error, silent handle
        if (error.name !== 'AbortError') {
          console.error('Share failed:', error)
        }
      }
    } else {
      // Fallback to copy link
      handleCopyShareLink()
    }
  }

  // Touch event handlers
  const handleTouchStart = (e: React.TouchEvent) => {
    setTouchEnd(null)
    setTouchStart(e.targetTouches[0].clientX)
  }

  const handleTouchMove = (e: React.TouchEvent) => {
    setTouchEnd(e.targetTouches[0].clientX)
  }

  const handleTouchEnd = () => {
    if (!touchStart || !touchEnd || isRotating) return

    // Removed logic to open QR modal on card click, only on QR area click

    const distance = touchStart - touchEnd
    const isLeftSwipe = distance > 50
    const isRightSwipe = distance < -50

    if (isLeftSwipe) {
      // Left swipe: avatar disappear from left to right, card appear from left to right
      setRotationDirection('left')
      setIsRotating(true)
      onToggleMemberCard(true)
      setTimeout(() => setIsRotating(false), 600)
    } else if (isRightSwipe) {
      // Right swipe: avatar disappear from right to left, card appear from right to left
      setRotationDirection('right')
      setIsRotating(true)
      onToggleMemberCard(true)
      setTimeout(() => setIsRotating(false), 600)
    }
  }

  // Click event handler
  const handleClick = (e: React.MouseEvent) => {
    if (isRotating) return

    // Removed QR click detection from parent, handled by child directly

    const rect = e.currentTarget.getBoundingClientRect()
    const clickX = e.clientX - rect.left
    const centerX = rect.width / 2

    if (clickX < centerX) {
      // Click left: avatar disappear from left to right, card appear from left to right
      setRotationDirection('left')
    } else {
      // Click right: avatar disappear from right to left, card appear from right to left
      setRotationDirection('right')
    }

    setIsRotating(true)
    onToggleMemberCard(!showMemberCard)
    setTimeout(() => setIsRotating(false), 600)
  }

  return (
    <>
      {/* CSS Animation Keyframes */}
      <style>
        {`
          @keyframes avatarSlideOutLeft {
            0% { transform: perspective(1000px) rotateY(0deg) translateX(0); opacity: 1; }
            50% { transform: perspective(1000px) rotateY(-45deg) translateX(-20px); opacity: 0.5; }
            100% { transform: perspective(1000px) rotateY(-90deg) translateX(-40px); opacity: 0; }
          }
          
          @keyframes avatarSlideOutRight {
            0% { transform: perspective(1000px) rotateY(0deg) translateX(0); opacity: 1; }
            50% { transform: perspective(1000px) rotateY(45deg) translateX(20px); opacity: 0.5; }
            100% { transform: perspective(1000px) rotateY(90deg) translateX(40px); opacity: 0; }
          }
          
          @keyframes cardSlideInLeft {
            0% { transform: perspective(1000px) rotateY(-90deg) translateX(-40px); opacity: 0; }
            50% { transform: perspective(1000px) rotateY(-45deg) translateX(-20px); opacity: 0.5; }
            100% { transform: perspective(1000px) rotateY(0deg) translateX(0); opacity: 1; }
          }
          
          @keyframes cardSlideInRight {
            0% { transform: perspective(1000px) rotateY(90deg) translateX(40px); opacity: 0; }
            50% { transform: perspective(1000px) rotateY(45deg) translateX(20px); opacity: 0.5; }
            100% { transform: perspective(1000px) rotateY(0deg) translateX(0); opacity: 1; }
          }
        `}
      </style>

      {/* Avatar/Member Card Toggle */}
      <div
        className={className}
        style={{
          position: 'relative',
          display: 'inline-block',
          marginBottom: '16px',
          cursor: 'pointer',
          transition: 'all 0.3s ease',
          perspective: '1000px',
          transformStyle: 'preserve-3d',
          ...style
        }}
        onTouchStart={handleTouchStart}
        onTouchMove={handleTouchMove}
        onTouchEnd={handleTouchEnd}
        onClick={handleClick}
        onMouseEnter={(e) => {
          if (!isRotating) {
            e.currentTarget.style.transform = showMemberCard ? 'scale(1.05)' : 'scale(1.02)'
          }
        }}
        onMouseLeave={(e) => {
          if (!isRotating) {
            e.currentTarget.style.transform = showMemberCard ? 'scale(1.02)' : 'scale(1)'
          }
        }}
      >
        {showMemberCard ? (
          /* Member Card Display - 3D effect and premium styling */
          <div
            className="card-3d-effect"
            style={{
              position: 'relative',
              borderRadius: 20,
              background: 'linear-gradient(145deg, #1A1A1A 0%, #0A0A0A 100%)',
              backgroundImage: `url('data:image/svg+xml;utf8,<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100" width="100" height="100"><defs><pattern id="p" width="10" height="10" patternUnits="userSpaceOnUse" patternTransform="rotate(45)"><path d="M0 0h5v5H0z" fill="%23D4AF37" fill-opacity="0.05"/></pattern></defs><rect width="100" height="100" fill="url(%23p)"/></svg>')`,
              border: '1px solid rgba(212, 175, 55, 0.25)',
              overflow: 'hidden',
              width: '85.6mm',
              height: '54mm',
              minWidth: '85.6mm',
              minHeight: '54mm',
              maxWidth: '85.6mm',
              maxHeight: '54mm',
              transformStyle: 'preserve-3d',
              transform: isRotating
                ? `perspective(1000px) rotateY(${rotationDirection === 'left' ? '0deg' : '0deg'})`
                : 'perspective(1000px) rotateY(0deg)',
              transition: 'all 0.6s cubic-bezier(0.4, 0, 0.2, 1)',
              transformOrigin: 'center center',
              animation: isRotating
                ? `cardSlideIn${rotationDirection === 'left' ? 'Left' : 'Right'} 0.6s cubic-bezier(0.4, 0, 0.2, 1) forwards`
                : 'none',
              // 3D shadow effect
              boxShadow: `
                0px 15px 35px rgba(0,0,0,0.5), 
                0px 5px 15px rgba(0,0,0,0.4),
                0 0 20px rgba(212, 175, 55, 0.3),
                0 0 40px rgba(212, 175, 55, 0.2),
                0 0 60px rgba(212, 175, 55, 0.1)
              `
            }}
            onMouseEnter={(e) => {
              if (!isRotating) {
                e.currentTarget.style.transform = 'translateY(-5px) rotateX(5deg) rotateY(2deg)';
                e.currentTarget.style.boxShadow = `
                  0px 25px 45px rgba(0,0,0,0.6), 
                  0px 10px 25px rgba(0,0,0,0.5),
                  0 0 30px rgba(212, 175, 55, 0.4),
                  0 0 60px rgba(212, 175, 55, 0.3),
                  0 0 90px rgba(212, 175, 55, 0.2)
                `;
              }
            }}
            onMouseLeave={(e) => {
              if (!isRotating) {
                e.currentTarget.style.transform = 'perspective(1000px) rotateY(0deg)';
                e.currentTarget.style.boxShadow = `
                  0px 15px 35px rgba(0,0,0,0.5), 
                  0px 5px 15px rgba(0,0,0,0.4),
                  0 0 20px rgba(212, 175, 55, 0.3),
                  0 0 40px rgba(212, 175, 55, 0.2),
                  0 0 60px rgba(212, 175, 55, 0.1)
                `;
              }
            }}
          >
            {/* Background Decoration */}
            <div style={{
              position: 'absolute',
              inset: 0,
              background: 'radial-gradient(circle at 15% 25%, rgba(212,175,55,0.15), transparent 40%), radial-gradient(circle at 85% 75%, rgba(212,175,55,0.1), transparent 40%)'
            }} />

            <div style={{ position: 'relative', zIndex: 1, padding: 16 }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 8 }}>
                <div>
                  <div style={{
                    fontSize: 22,
                    fontWeight: 700,
                    letterSpacing: 1,
                    textAlign: 'left',
                    WebkitBackgroundClip: 'text',
                    backgroundClip: 'text',
                    color: 'transparent',
                    backgroundImage: 'linear-gradient(to bottom, #F0E68C, #D4AF37)'
                  }}>{appConfig?.appName || 'Cigar Club'}</div>
                  <div style={{
                    fontSize: 12,
                    fontWeight: 700,
                    color: '#D4AF37',
                    letterSpacing: 2,
                    textAlign: 'left',
                    textShadow: '0 1px 2px rgba(0,0,0,0.5)'
                  }}>CIGAR World</div>
                </div>
                <div
                  className="qr-code-clickable"
                  onClick={(e) => {
                    e.stopPropagation();
                    if (enableQrModal) {
                      setQrModalVisible(true);
                    }
                  }}
                  onDragStart={(e) => e.preventDefault()}
                  style={{ cursor: 'pointer', position: 'relative', zIndex: 100, userSelect: 'none' }}
                >
                  <QRCodeDisplay
                    qrCodeDataURL={qrCodeDataURL}
                    loading={qrLoading}
                    error={qrError}
                    size={54}
                    showPlaceholder={true}
                  />
                </div>
              </div>
              <div style={{ marginTop: 40, display: 'flex', alignItems: 'flex-end', justifyContent: 'space-between' }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 12, minWidth: 0 }}>
                  <div style={{
                    width: 56,
                    height: 56,
                    borderRadius: '50%',
                    backgroundImage: user?.profile?.avatar
                      ? `url(${user.profile.avatar.includes('cloudinary') ? getThumbnailUrl(extractPublicIdFromUrl(user.profile.avatar) || '', 120) : user.profile.avatar})`
                      : 'url(https://lh3.googleusercontent.com/aida-public/AB6AXuDs5P-wl44y-z3P55qwZDWCSmApe-9yEsTNGmr02UNzEVBeCMwE7hIq_ikKnzQespBptCZg7RY1P5pvidROpLwXpyUdWETLOFTJYuGtSIN_2d53icCJctg5HZDPl5zRc3QfbeMOn0fl6RWLZplcDWF9frxhgWKf4-RKyNaQsWhBGRCkTAVvLMDnCcZUDGLg-c8YjnHcY8-gFFEmIaa-bHoz3lEcP-SgonuSLCTv4Fa7-_dYYF8uQ3H5a7nAxZocj7UyH0Jl9CAQQWET)',
                    backgroundSize: 'cover',
                    backgroundPosition: 'center',
                    border: '2px solid #D4AF37',
                    boxShadow: '0 6px 16px rgba(0,0,0,0.5)'
                  }} />
                  <div style={{ minWidth: 0 }}>
                    <TailTruncatedText
                      text={user?.displayName || t('common.member')}
                      style={{
                        color: '#ffffff',
                        fontSize: 20,
                        fontWeight: 700,
                        textAlign: 'left',
                        textShadow: '0 2px 4px rgba(0,0,0,0.7)',
                        fontFamily: "'Noto Sans SC', sans-serif"
                      }}
                    />
                    <div style={{
                      color: '#D4AF37',
                      fontSize: 12,
                      fontWeight: 700,
                      textAlign: 'left',
                      textShadow: '0 1px 2px rgba(0,0,0,0.5)',
                      fontFamily: "'Noto Sans SC', sans-serif"
                    }}>
                      {(() => {
                        let baseRole = '';
                        if (user?.role === 'developer') baseRole = t('auth.developer')
                        else if (user?.role === 'superAdmin') baseRole = t('auth.superAdmin')
                        else if (user?.role === 'admin') baseRole = t('auth.admin')
                        else if (user?.role === 'vip') baseRole = t('auth.vip')
                        else if (user?.role === 'member') baseRole = t('auth.member')
                        else baseRole = t('auth.guest')

                        // If regular member but not active (and not inactive/suspended), show as guest
                        if (user?.role === 'member' && user?.status !== 'active' && user?.status !== 'inactive' && user?.status !== 'suspended') {
                          baseRole = t('auth.guest')
                        }

                        if (user?.status === 'inactive') {
                          return `${baseRole} (${t('usersAdmin.inactive')})`
                        }
                        if (user?.status === 'suspended') {
                          return `${baseRole} (Suspended)`
                        }

                        // Special case: if status is not active and baseRole is member/guest, ensure consistency
                        if (user?.status !== 'active' && baseRole === t('auth.member') && user?.status !== 'inactive' && user?.status !== 'suspended') {
                          return t('auth.guest')
                        }

                        return baseRole;
                      })()}
                    </div>
                  </div>
                </div>
                <div style={{ textAlign: 'right', flexShrink: 0, paddingLeft: 8 }}>

                  <div style={{
                    color: '#ffffff',
                    fontSize: 16,
                    fontWeight: 700,
                    letterSpacing: 2,
                    textShadow: '0 2px 4px rgba(0,0,0,0.7)',
                    fontFamily: "'Noto Sans SC', sans-serif"
                  }}>
                    {user?.memberId || '000000'}
                  </div>

                  <div style={{
                    color: '#D4AF37',
                    fontSize: 14,
                    fontWeight: 700,
                    textShadow: '0 1px 2px rgba(0,0,0,0.5)',
                    fontFamily: "'Noto Sans SC', sans-serif"
                  }}>
                    {(user?.membership as any)?.points || 0}
                  </div>
                  <div>

                    <div style={{
                      color: membershipPeriod ? '#ffffff' : 'rgba(255,255,255,0.4)',
                      fontSize: 12,
                      fontWeight: 600,
                      fontFamily: "'Noto Sans SC', sans-serif",
                      textShadow: '0 1px 2px rgba(0,0,0,0.5)',
                      whiteSpace: 'nowrap'
                    }}>
                      {membershipPeriod ? dayjs(membershipPeriod.startDate).format('YYYY-MM-DD') : t('profile.notActivated')}
                    </div>
                  </div>

                </div>
              </div>
            </div>

            {/* Toggle Hint */}
            <div style={{
              position: 'absolute',
              bottom: '-30px',
              left: '50%',
              transform: 'translateX(-50%)',
              fontSize: '10px',
              color: 'rgba(255, 255, 255, 0.6)',
              whiteSpace: 'nowrap',
              fontFamily: "'Noto Sans SC', sans-serif",
              textShadow: '0 1px 2px rgba(0,0,0,0.5)'
            }}>
              {t('usersAdmin.clickToReturnAvatar')}
            </div>
          </div>
        ) : (
          /* Avatar Display */
          <div style={{
            position: 'relative',
            transform: isRotating
              ? `perspective(1000px) rotateY(${rotationDirection === 'left' ? '-90deg' : '90deg'})`
              : 'perspective(1000px) rotateY(0deg)',
            transition: 'all 0.6s cubic-bezier(0.4, 0, 0.2, 1)',
            transformOrigin: 'center center',
            animation: isRotating
              ? `avatarSlideOut${rotationDirection === 'left' ? 'Left' : 'Right'} 0.6s cubic-bezier(0.4, 0, 0.2, 1) forwards`
              : 'none'
          }}>
            <div style={{
              width: '128px',
              height: '128px',
              borderRadius: '50%',
              background: user?.profile?.avatar
                ? `url(${user.profile.avatar.includes('cloudinary') ? getThumbnailUrl(extractPublicIdFromUrl(user.profile.avatar) || '', 200) : user.profile.avatar})`
                : 'linear-gradient(to right,#FDE08D,#C48D3A)',
              backgroundSize: 'cover',
              backgroundPosition: 'center',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              fontSize: '48px',
              color: '#221c10',
              fontWeight: 'bold',
              // Gold multi-layer shadow effect
              boxShadow: `
                0 0 20px rgba(212, 175, 55, 0.4),
                0 0 40px rgba(212, 175, 55, 0.3),
                0 0 60px rgba(212, 175, 55, 0.2),
                0 8px 32px rgba(212, 175, 55, 0.25),
                0 16px 48px rgba(212, 175, 55, 0.15)
              `,
              border: '3px solid rgba(244, 175, 37, 0.6)',
              transition: 'all 0.3s ease'
            }}>
              {!user?.profile?.avatar && (user?.displayName?.charAt(0)?.toUpperCase() || 'U')}
            </div>
            <div style={{
              position: 'absolute',
              bottom: 0,
              right: 0,
              width: '32px',
              height: '32px',
              borderRadius: '50%',
              background: 'linear-gradient(to right,#FDE08D,#C48D3A)',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              border: '2px solid #221c10',
              // Gold shadow effect
              boxShadow: `
                0 0 12px rgba(212, 175, 55, 0.5),
                0 0 24px rgba(212, 175, 55, 0.3),
                0 4px 16px rgba(212, 175, 55, 0.2)
              `
            }}>
              <CrownOutlined style={{ color: '#221c10', fontSize: '16px' }} />
            </div>
            {/* Click Hint */}
            <div style={{
              position: 'absolute',
              bottom: '-30px',
              left: '50%',
              transform: 'translateX(-50%)',
              fontSize: '10px',
              color: 'rgba(255, 255, 255, 0.6)',
              whiteSpace: 'nowrap',
              fontFamily: "'Noto Sans SC', sans-serif",
              textShadow: '0 1px 2px rgba(0,0,0,0.5)'
            }}>
              {t('usersAdmin.clickToViewMemberCard')}
            </div>
          </div>
        )}
      </div>

      {/* Referral Code Share Modal */}
      <Modal
        title={null}
        open={qrModalVisible}
        onCancel={() => setQrModalVisible(false)}
        footer={null}
        centered
        width={420}
        styles={{
          content: {
            background: 'linear-gradient(135deg, #FDE08D 0%, #C48D3A 50%, #D4AF37 100%)',
            borderRadius: '12px',
            padding: '1px',
            boxShadow:
              '0 0 20px rgba(212, 175, 55, 0.3), 0 0 40px rgba(212, 175, 55, 0.2), 0 0 60px rgba(212, 175, 55, 0.1), 0 8px 32px rgba(0, 0, 0, 0.5)'
          },
          body: {
            padding: '32px',
            display: 'flex',
            flexDirection: 'column',
            alignItems: 'center',
            justifyContent: 'center',
            background: 'linear-gradient(135deg, rgba(26, 26, 26, 0.95) 0%, rgba(45, 45, 45, 0.95) 100%)',
            borderRadius: '10px',
            margin: 0
          }
        }}
        style={{
          background: 'rgba(0, 0, 0, 0.8)'
        }}
      >
        <div style={{
          textAlign: 'center',
          width: '100%'
        }}>
          {/* Title */}
          <div style={{
            fontSize: 16,
            fontWeight: 600,
            color: 'rgba(255, 255, 255, 0.8)',
            marginBottom: 16,
            fontFamily: "'Noto Sans SC', sans-serif"
          }}>
            {t('profile.myReferralCode')}
          </div>

          {/* Referral Code Display */}
          <div style={{
            fontSize: '36px',
            fontWeight: 'bold',
            color: '#ffd700',
            letterSpacing: '4px',
            fontFamily: 'monospace',
            marginBottom: 24,
            textShadow: '0 2px 8px rgba(255, 215, 0, 0.3)'
          }}>
            {user?.memberId || '------'}
          </div>

          {/* QR Code Display */}
          <div style={{
            display: 'flex',
            justifyContent: 'center',
            alignItems: 'center',
            padding: '16px',
            background: 'rgba(255, 255, 255, 0.05)',
            borderRadius: '12px',
            marginBottom: 24
          }}>
            <QRCodeDisplay
              qrCodeDataURL={qrCodeDataURL}
              loading={qrLoading}
              error={qrError}
              size={200}
              showPlaceholder={true}
            />
          </div>

          {/* Action Buttons */}
          <Space size="middle" direction="vertical" style={{ width: '100%', marginBottom: 20 }}>
            <Button
              type="default"
              icon={<CopyOutlined />}
              onClick={handleCopyReferralCode}
              block
              style={{
                background: 'rgba(255, 255, 255, 0.1)',
                border: '1px solid rgba(212, 175, 55, 0.3)',
                color: '#fff',
                borderRadius: '8px',
                height: '44px',
                fontSize: '15px',
                fontWeight: 500
              }}
            >
              {t('profile.copyReferralCode')}
            </Button>
            <Button
              type="default"
              icon={<ShareAltOutlined />}
              onClick={handleShare}
              block
              style={{
                background: 'linear-gradient(to right, #FDE08D, #C48D3A)',
                border: 'none',
                color: '#111',
                borderRadius: '8px',
                height: '44px',
                fontSize: '15px',
                fontWeight: 'bold'
              }}
            >
              {t('profile.shareInvitation')}
            </Button>
          </Space>

          {/* Reward Description: hidden if both referrer and referred rewards are 0 */}
          {(() => {
            const referrerReward = pointsConfig?.reload?.referrerFirstReload ?? 0
            const referredReward = pointsConfig?.reload?.referredFirstReload ?? 0
            const hideReferralTexts = referrerReward === 0 && referredReward === 0

            if (hideReferralTexts) return null

            return (
              <>
                <div style={{
                  padding: '12px',
                  background: 'rgba(212, 175, 55, 0.1)',
                  borderRadius: '8px',
                  fontSize: '12px',
                  color: 'rgba(255, 255, 255, 0.8)',
                  lineHeight: '1.6',
                  marginBottom: 12,
                  fontFamily: "'Noto Sans SC', sans-serif"
                }}>
                  {t('profile.referralReward')}
                </div>
                <div style={{
                  fontSize: '12px',
                  color: 'rgba(255, 255, 255, 0.6)',
                  lineHeight: '1.6',
                  fontFamily: "'Noto Sans SC', sans-serif"
                }}>
                  {t('profile.shareWithFriends')}
                </div>
              </>
            )
          })()}
        </div>
      </Modal>
    </>
  )
}

