import { act, renderHook } from '@testing-library/react'
import { afterEach, describe, expect, it } from 'vitest'
import { getVirtualTableScroll, useVirtualTableScroll } from './useVirtualTableScroll'

const originalHeight = window.innerHeight
afterEach(() => Object.defineProperty(window, 'innerHeight', { configurable: true, value: originalHeight }))

describe('useVirtualTableScroll', () => {
  it('returns numeric dimensions and a usable minimum height', () => {
    expect(getVirtualTableScroll(900, 1400, 350)).toEqual({ x: 1400, y: 550 })
    expect(getVirtualTableScroll(300, 1600, 350)).toEqual({ x: 1600, y: 160 })
  })

  it('updates the numeric height after resizing', () => {
    Object.defineProperty(window, 'innerHeight', { configurable: true, value: 800 })
    const { result, unmount } = renderHook(() => useVirtualTableScroll(1800, 400))
    expect(result.current).toEqual({ x: 1800, y: 400 })
    act(() => {
      Object.defineProperty(window, 'innerHeight', { configurable: true, value: 1000 })
      window.dispatchEvent(new Event('resize'))
    })
    expect(result.current).toEqual({ x: 1800, y: 600 })
    unmount()
  })
})
