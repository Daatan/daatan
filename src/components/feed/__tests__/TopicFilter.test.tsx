import { render, screen, fireEvent, within } from '@testing-library/react'
import { NextIntlClientProvider } from 'next-intl'
import { describe, it, expect, vi } from 'vitest'
import messages from '../../../../messages/he.json'
import { TopicFilter } from '../TopicFilter'

const renderFilter = (selected: string[], onChange = vi.fn()) => {
  render(
    <NextIntlClientProvider locale="he" messages={messages}>
      <TopicFilter selected={selected} counts={{ politics: 3, economy: 2 }} onChange={onChange} />
    </NextIntlClientProvider>,
  )
  return onChange
}

describe('TopicFilter (daatan#2330)', () => {
  it('marks picked topics as pressed and lists them first', () => {
    renderFilter(['Economy'])
    const chips = within(screen.getByRole('group', { name: messages.topics.filterLabel })).getAllByRole('button')
    expect(chips.map((c) => c.textContent)).toEqual(['כלכלה', 'פוליטיקה'])
    expect(chips[0]).toHaveAttribute('aria-pressed', 'true')
    expect(chips[1]).toHaveAttribute('aria-pressed', 'false')
  })

  it('adds and removes topics', () => {
    const onChange = renderFilter(['Economy'])
    fireEvent.click(screen.getByRole('button', { name: 'פוליטיקה' }))
    expect(onChange).toHaveBeenLastCalledWith(['Economy', 'Politics'])
    fireEvent.click(screen.getByRole('button', { name: 'כלכלה' }))
    expect(onChange).toHaveBeenLastCalledWith([])
  })

  it('clears everything from the summary line', () => {
    const onChange = renderFilter(['Economy', 'Politics'])
    expect(screen.getByTestId('topics-selected')).toHaveTextContent('2 נושאים')
    fireEvent.click(screen.getByRole('button', { name: messages.topics.clear }))
    expect(onChange).toHaveBeenLastCalledWith([])
  })

  it('shows no summary line with nothing picked', () => {
    renderFilter([])
    expect(screen.queryByTestId('topics-selected')).toBeNull()
  })
})
