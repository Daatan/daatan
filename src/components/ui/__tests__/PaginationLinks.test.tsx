import { render, screen } from '@testing-library/react'
import { describe, it, expect } from 'vitest'
import PaginationLinks, { pageHref, parsePageParam } from '../PaginationLinks'

const labels = { previous: 'Previous', next: 'Next', status: 'Page 2 of 3' }

describe('pageHref', () => {
  it('drops the param on page 1 so it matches the bare canonical', () => {
    expect(pageHref('/forecasts', 1)).toBe('/forecasts')
    expect(pageHref('/he/forecasts', 3)).toBe('/he/forecasts?page=3')
  })
})

describe('parsePageParam', () => {
  it.each([
    [undefined, 1], ['', 1], ['abc', 1], ['0', 1], ['-4', 1], ['2', 2], ['2.7', 2], [['5', '6'], 5],
  ])('%j -> %i', (raw, expected) => {
    expect(parsePageParam(raw)).toBe(expected)
  })
})

describe('PaginationLinks', () => {
  it('renders real prev/next anchors', () => {
    render(<PaginationLinks base="/forecasts" page={2} totalPages={3} labels={labels} />)
    expect(screen.getByRole('link', { name: 'Previous' })).toHaveAttribute('href', '/forecasts')
    expect(screen.getByRole('link', { name: 'Next' })).toHaveAttribute('href', '/forecasts?page=3')
  })

  it('omits the link past either end', () => {
    render(<PaginationLinks base="/forecasts" page={3} totalPages={3} labels={labels} />)
    expect(screen.queryByRole('link', { name: 'Next' })).not.toBeInTheDocument()
    expect(screen.getByRole('link', { name: 'Previous' })).toHaveAttribute('href', '/forecasts?page=2')
  })

  it('renders nothing for a single page', () => {
    const { container } = render(<PaginationLinks base="/forecasts" page={1} totalPages={1} labels={labels} />)
    expect(container).toBeEmptyDOMElement()
  })
})
