import { describe, it, expect } from 'vitest'
import { render } from '@testing-library/react'
import LocaleMethodologyPage, { generateMetadata } from '../page'

describe('LocaleMethodologyPage', () => {
  it('renders the Hebrew scoring explanation, RTL, for locale=he', async () => {
    const page = await LocaleMethodologyPage({ params: Promise.resolve({ locale: 'he' }) })
    const { container } = render(page)
    expect(container.querySelector('h1')?.textContent).toBe('שיטת הניקוד של דעתן')
    expect(container.querySelector('[dir="rtl"]')).not.toBeNull()
  })

  it('renders the Russian scoring explanation for locale=ru', async () => {
    const page = await LocaleMethodologyPage({ params: Promise.resolve({ locale: 'ru' }) })
    const { container } = render(page)
    expect(container.querySelector('h1')?.textContent).toBe('Методика подсчёта очков Daatan')
    expect(container.textContent).toContain('Brier Score')
  })

  it('renders the Esperanto scoring explanation for locale=eo', async () => {
    const page = await LocaleMethodologyPage({ params: Promise.resolve({ locale: 'eo' }) })
    const { container } = render(page)
    expect(container.querySelector('h1')?.textContent).toBe('La poentado-metodo de Daatan')
    expect(container.textContent).toContain('Glicko-2')
  })

  it('sets per-locale canonical and a full hreflang map', async () => {
    const meta = await generateMetadata({ params: Promise.resolve({ locale: 'eo' }) })
    expect(meta.alternates?.canonical).toBe('https://daatan.com/eo/methodology')
    expect(meta.alternates?.languages).toMatchObject({
      'x-default': 'https://daatan.com/methodology',
      en: 'https://daatan.com/methodology',
      he: 'https://daatan.com/he/methodology',
      ru: 'https://daatan.com/ru/methodology',
    })
    expect(meta.title).toBe('La poentado-metodo de Daatan')
  })
})
