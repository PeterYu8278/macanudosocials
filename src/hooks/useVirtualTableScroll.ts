import { useEffect, useState } from 'react'

export const getVirtualTableScroll = (viewportHeight: number, width: number, offset: number) => ({
  x: width,
  y: Math.max(160, viewportHeight - offset),
})

export const useVirtualTableScroll = (width = 1400, offset = 350) => {
  const [height, setHeight] = useState(() => typeof window === 'undefined' ? 768 : window.innerHeight)
  useEffect(() => {
    const resize = () => setHeight(window.innerHeight)
    window.addEventListener('resize', resize)
    return () => window.removeEventListener('resize', resize)
  }, [])
  return getVirtualTableScroll(height, width, offset)
}
