import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import { FitHeadline } from '../FitHeadline'

const LINE_HEIGHT_RATIO = 1.375

// happy-dom does no layout, so fake it: the headline takes `linesAt(fontSizePx)` lines.
function fakeLayout(linesAt: (px: number) => number) {
  const fontSize = (el: Element) => parseFloat((el as HTMLElement).style.fontSize) || 16
  vi.spyOn(window, 'getComputedStyle').mockImplementation(((el: Element) => ({
    fontSize: `${fontSize(el)}px`,
    lineHeight: `${fontSize(el) * LINE_HEIGHT_RATIO}px`,
  })) as never)
  vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockImplementation(function (this: HTMLElement) {
    return { height: linesAt(fontSize(this)) * fontSize(this) * LINE_HEIGHT_RATIO } as DOMRect
  })
}

describe('FitHeadline', () => {
  beforeEach(() => {
    vi.stubGlobal('ResizeObserver', class { observe() {} disconnect() {} unobserve() {} })
  })
  afterEach(() => {
    vi.restoreAllMocks()
    vi.unstubAllGlobals()
  })

  it('leaves the stylesheet size alone when the headline already fits two lines', () => {
    fakeLayout(() => 2)
    render(<FitHeadline text="Nvidia will top $5T" />)
    expect(screen.getByTestId('forecast-headline').style.fontSize).toBe('')
  })

  it('steps the font down until the headline fits two lines, without touching the text', () => {
    fakeLayout((px) => (px > 14 ? 3 : 2))
    render(<FitHeadline text="Benny Gantz will withdraw from the race before the elections" className="x" />)
    const h = screen.getByTestId('forecast-headline')
    expect(h.style.fontSize).toBe('14px')
    expect(h.textContent).toBe('Benny Gantz will withdraw from the race before the elections')
    expect(h.className).toBe('x')
  })

  it('stops at the minimum size instead of looping', () => {
    fakeLayout(() => 3)
    render(<FitHeadline text="a very long headline that never fits" />)
    expect(screen.getByTestId('forecast-headline').style.fontSize).toBe('12px')
  })
})
