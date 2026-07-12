import { describe, it, expect, vi } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import { NextIntlClientProvider } from 'next-intl'
import { DateTimeField } from '../DateTimeField'
import messages from '../../../../messages/en.json'

const renderField = (props: React.ComponentProps<typeof DateTimeField>) =>
  render(
    <NextIntlClientProvider locale="en" messages={messages}>
      <DateTimeField {...props} />
    </NextIntlClientProvider>
  )

const dateInput = () => screen.getByLabelText('Date (day/month/year)') as HTMLInputElement
const timeInput = () => screen.getByLabelText('Time (24-hour)') as HTMLInputElement

describe('DateTimeField', () => {
  it('splits a datetime-local value into DD/MM/YYYY and 24h time fields', () => {
    renderField({ value: '2026-12-31T18:30', onChange: vi.fn() })
    expect(dateInput().value).toBe('31/12/2026')
    expect(timeInput().value).toBe('18:30')
  })

  it('emits the combined value when the date is edited', () => {
    const onChange = vi.fn()
    renderField({ value: '2026-12-31T18:30', onChange })
    fireEvent.change(dateInput(), { target: { value: '15/06/2027' } })
    expect(onChange).toHaveBeenLastCalledWith('2027-06-15T18:30')
  })

  it('emits the combined value when the time is edited', () => {
    const onChange = vi.fn()
    renderField({ value: '2026-12-31T18:30', onChange })
    fireEvent.change(timeInput(), { target: { value: '9:05' } })
    expect(onChange).toHaveBeenLastCalledWith('2026-12-31T09:05')
  })

  it('emits empty string while the date is incomplete', () => {
    const onChange = vi.fn()
    renderField({ value: '2026-12-31T18:30', onChange })
    fireEvent.change(dateInput(), { target: { value: '6' } })
    expect(onChange).toHaveBeenLastCalledWith('')
  })

  it('emits empty string for an invalid time', () => {
    const onChange = vi.fn()
    renderField({ value: '2026-12-31T18:30', onChange })
    fireEvent.change(timeInput(), { target: { value: '25:00' } })
    expect(onChange).toHaveBeenLastCalledWith('')
  })

  it('applies defaultTime when the time field is blank', () => {
    const onChange = vi.fn()
    renderField({ value: '', onChange, defaultTime: '23:59' })
    fireEvent.change(dateInput(), { target: { value: '15/06/2027' } })
    expect(onChange).toHaveBeenLastCalledWith('2027-06-15T23:59')
  })

  it('treats a blank time as incomplete without defaultTime', () => {
    const onChange = vi.fn()
    renderField({ value: '2026-12-31T18:30', onChange })
    fireEvent.change(timeInput(), { target: { value: '' } })
    expect(onChange).toHaveBeenLastCalledWith('')
  })

  it('updates the date field from the native calendar picker', () => {
    const onChange = vi.fn()
    const { container } = renderField({ value: '2026-12-31T18:30', onChange })
    const picker = container.querySelector('input[type="date"]') as HTMLInputElement
    fireEvent.change(picker, { target: { value: '2027-06-15' } })
    expect(dateInput().value).toBe('15/06/2027')
    expect(onChange).toHaveBeenLastCalledWith('2027-06-15T18:30')
  })

  it('resyncs the fields when the parent changes the value externally', () => {
    const onChange = vi.fn()
    const { rerender } = renderField({ value: '2026-12-31T18:30', onChange })
    rerender(
      <NextIntlClientProvider locale="en" messages={messages}>
        <DateTimeField value="2027-01-05T08:00" onChange={onChange} />
      </NextIntlClientProvider>
    )
    expect(dateInput().value).toBe('05/01/2027')
    expect(timeInput().value).toBe('08:00')
  })

  it('renders empty fields for an empty value', () => {
    renderField({ value: '', onChange: vi.fn() })
    expect(dateInput().value).toBe('')
    expect(timeInput().value).toBe('')
  })
})
