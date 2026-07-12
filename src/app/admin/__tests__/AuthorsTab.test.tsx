import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, waitFor, fireEvent } from '@testing-library/react'
import { NextIntlClientProvider } from 'next-intl'
import AuthorsTab from '../AuthorsTab'
import enMessages from '../../../../messages/en.json'

const API = '/api/admin/news-indexer/authors'
const CASPIT = '11111111-1111-4111-8111-111111111111'
const SEGAL = '22222222-2222-4222-8222-222222222222'
const ALIAS = '33333333-3333-4333-8333-333333333333'
const OUTLET = '44444444-4444-4444-8444-444444444444'

const renderWithIntl = (ui: React.ReactElement) =>
  render(
    <NextIntlClientProvider locale="en" messages={enMessages}>
      {ui}
    </NextIntlClientProvider>,
  )

const people = [
  {
    id: CASPIT,
    canonical_name: 'Ben Caspit',
    notes: 'Maariv',
    aliases: [{ id: ALIAS, alias: 'בן כספית' }],
    outlets: [{ id: OUTLET, name: 'Maariv' }],
  },
  { id: SEGAL, canonical_name: 'Amit Segal', notes: null, aliases: [], outlets: [] },
]

const ok = (body: unknown) => ({ ok: true, json: () => Promise.resolve(body) })
const fail = (status: number, body: unknown) => ({ ok: false, status, json: () => Promise.resolve(body) })

const mockFetch = vi.fn()

/** The list request the component fires on mount, and again after every mutation. */
const listOk = () => mockFetch.mockResolvedValueOnce(ok({ people }))

describe('AuthorsTab', () => {
  beforeEach(() => {
    vi.resetAllMocks()
    global.fetch = mockFetch
  })

  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('lists curated people with their aliases and a summary count', async () => {
    listOk()

    renderWithIntl(<AuthorsTab />)

    await waitFor(() => expect(screen.getByDisplayValue('Ben Caspit')).toBeInTheDocument())
    expect(screen.getByDisplayValue('Amit Segal')).toBeInTheDocument()
    expect(screen.getByText('2 curated people')).toBeInTheDocument()
    expect(screen.getByText('בן כספית')).toBeInTheDocument()
    // Segal has none, so his card shows the empty-alias hint rather than a chip.
    expect(screen.getByText('no aliases')).toBeInTheDocument()
    expect(screen.getByText('Maariv')).toBeInTheDocument()
    expect(screen.getByText('no linked outlets')).toBeInTheDocument()

    expect(mockFetch).toHaveBeenCalledExactlyOnceWith(API, { cache: 'no-store' })
  })

  it('renders the empty state when no one is curated yet', async () => {
    mockFetch.mockResolvedValueOnce(ok({ people: [] }))

    renderWithIntl(<AuthorsTab />)

    await waitFor(() => expect(screen.getByText('No curated people yet.')).toBeInTheDocument())
    expect(screen.getByText('0 curated people')).toBeInTheDocument()
  })

  it("surfaces the proxy's error message instead of rendering an empty list", async () => {
    mockFetch.mockResolvedValueOnce(fail(503, { error: 'News-indexer not configured' }))

    renderWithIntl(<AuthorsTab />)

    await waitFor(() => expect(screen.getByText('News-indexer not configured')).toBeInTheDocument())
    // The list stays null rather than rendering a misleading half-populated table.
    expect(screen.getByText('No curated people yet.')).toBeInTheDocument()
  })

  it('falls back to a status-code message when the error body is not json', async () => {
    mockFetch.mockResolvedValueOnce({ ok: false, status: 500, json: () => Promise.reject(new Error('no body')) })

    renderWithIntl(<AuthorsTab />)

    await waitFor(() => expect(screen.getByText('Request failed (500)')).toBeInTheDocument())
  })

  it('adds a person, then reloads the list and clears the form', async () => {
    listOk()
    renderWithIntl(<AuthorsTab />)
    await waitFor(() => expect(screen.getByDisplayValue('Ben Caspit')).toBeInTheDocument())

    const name = screen.getByPlaceholderText('Canonical name (e.g. Ben Caspit)')
    const notes = screen.getAllByPlaceholderText('Notes (optional)')[0]
    fireEvent.change(name, { target: { value: '  Nadav Eyal  ' } })
    fireEvent.change(notes, { target: { value: 'Channel 12' } })

    mockFetch.mockResolvedValueOnce(ok({})) // POST
    listOk() //                                reload
    fireEvent.click(screen.getByRole('button', { name: 'Add person' }))

    await waitFor(() => expect(mockFetch).toHaveBeenCalledTimes(3))
    const [url, init] = mockFetch.mock.calls[1]
    expect(url).toBe(API)
    expect(init.method).toBe('POST')
    // Name and notes are trimmed before they reach the proxy.
    expect(JSON.parse(init.body)).toEqual({ canonical_name: 'Nadav Eyal', notes: 'Channel 12' })
    expect(mockFetch.mock.calls[2][0]).toBe(API)

    await waitFor(() => expect(name).toHaveValue(''))
    expect(notes).toHaveValue('')
  })

  it('sends notes as null when the field is left blank', async () => {
    listOk()
    renderWithIntl(<AuthorsTab />)
    await waitFor(() => expect(screen.getByDisplayValue('Ben Caspit')).toBeInTheDocument())

    fireEvent.change(screen.getByPlaceholderText('Canonical name (e.g. Ben Caspit)'), {
      target: { value: 'Nadav Eyal' },
    })
    mockFetch.mockResolvedValueOnce(ok({}))
    listOk()
    fireEvent.click(screen.getByRole('button', { name: 'Add person' }))

    await waitFor(() => expect(mockFetch).toHaveBeenCalledTimes(3))
    expect(JSON.parse(mockFetch.mock.calls[1][1].body)).toEqual({ canonical_name: 'Nadav Eyal', notes: null })
  })

  it('will not submit a whitespace-only name', async () => {
    listOk()
    renderWithIntl(<AuthorsTab />)
    await waitFor(() => expect(screen.getByDisplayValue('Ben Caspit')).toBeInTheDocument())

    const add = screen.getByRole('button', { name: 'Add person' })
    expect(add).toBeDisabled()

    fireEvent.change(screen.getByPlaceholderText('Canonical name (e.g. Ben Caspit)'), { target: { value: '   ' } })
    expect(add).toBeDisabled()
    expect(mockFetch).toHaveBeenCalledTimes(1) // still just the initial load
  })

  it('renames a person via PATCH on their id', async () => {
    listOk()
    renderWithIntl(<AuthorsTab />)
    await waitFor(() => expect(screen.getByDisplayValue('Ben Caspit')).toBeInTheDocument())

    fireEvent.change(screen.getByDisplayValue('Ben Caspit'), { target: { value: 'Ben Caspit  ' } })
    mockFetch.mockResolvedValueOnce(ok({}))
    listOk()
    fireEvent.click(screen.getAllByRole('button', { name: 'Save' })[0])

    await waitFor(() => expect(mockFetch).toHaveBeenCalledTimes(3))
    const [url, init] = mockFetch.mock.calls[1]
    expect(url).toBe(`${API}/${CASPIT}`)
    expect(init.method).toBe('PATCH')
    expect(JSON.parse(init.body)).toEqual({ canonical_name: 'Ben Caspit', notes: 'Maariv' })
  })

  it('adds an alias via POST on the person id', async () => {
    listOk()
    renderWithIntl(<AuthorsTab />)
    await waitFor(() => expect(screen.getByDisplayValue('Ben Caspit')).toBeInTheDocument())

    const aliasInputs = screen.getAllByPlaceholderText('Add alias (byline / channel name)')
    fireEvent.change(aliasInputs[1], { target: { value: '  עמית סגל  ' } })

    mockFetch.mockResolvedValueOnce(ok({}))
    listOk()
    fireEvent.click(screen.getAllByRole('button', { name: 'Add alias' })[1])

    await waitFor(() => expect(mockFetch).toHaveBeenCalledTimes(3))
    const [url, init] = mockFetch.mock.calls[1]
    expect(url).toBe(`${API}/${SEGAL}/aliases`)
    expect(init.method).toBe('POST')
    expect(JSON.parse(init.body)).toEqual({ alias: 'עמית סגל' })
  })

  it('adds an alias on Enter as well as on click', async () => {
    listOk()
    renderWithIntl(<AuthorsTab />)
    await waitFor(() => expect(screen.getByDisplayValue('Ben Caspit')).toBeInTheDocument())

    const aliasInput = screen.getAllByPlaceholderText('Add alias (byline / channel name)')[0]
    fireEvent.change(aliasInput, { target: { value: 'Caspit' } })

    mockFetch.mockResolvedValueOnce(ok({}))
    listOk()
    fireEvent.keyDown(aliasInput, { key: 'Enter' })

    await waitFor(() => expect(mockFetch).toHaveBeenCalledTimes(3))
    expect(mockFetch.mock.calls[1][0]).toBe(`${API}/${CASPIT}/aliases`)
  })

  it('removes an alias via DELETE on the alias id', async () => {
    listOk()
    renderWithIntl(<AuthorsTab />)
    await waitFor(() => expect(screen.getByDisplayValue('Ben Caspit')).toBeInTheDocument())

    mockFetch.mockResolvedValueOnce(ok({}))
    listOk()
    fireEvent.click(screen.getByRole('button', { name: 'Remove alias בן כספית' }))

    await waitFor(() => expect(mockFetch).toHaveBeenCalledTimes(3))
    const [url, init] = mockFetch.mock.calls[1]
    expect(url).toBe(`${API}/${CASPIT}/aliases/${ALIAS}`)
    expect(init.method).toBe('DELETE')
  })

  it('links an outlet via POST on the person id', async () => {
    listOk()
    renderWithIntl(<AuthorsTab />)
    await waitFor(() => expect(screen.getByDisplayValue('Ben Caspit')).toBeInTheDocument())

    const outletInputs = screen.getAllByPlaceholderText('Add outlet (their own channel, or one they write for)')
    fireEvent.change(outletInputs[1], { target: { value: '  Channel 12  ' } })

    mockFetch.mockResolvedValueOnce(ok({}))
    listOk()
    fireEvent.click(screen.getAllByRole('button', { name: 'Add outlet' })[1])

    await waitFor(() => expect(mockFetch).toHaveBeenCalledTimes(3))
    const [url, init] = mockFetch.mock.calls[1]
    expect(url).toBe(`${API}/${SEGAL}/outlets`)
    expect(init.method).toBe('POST')
    expect(JSON.parse(init.body)).toEqual({ outlet_name: 'Channel 12' })
  })

  it('links an outlet on Enter as well as on click', async () => {
    listOk()
    renderWithIntl(<AuthorsTab />)
    await waitFor(() => expect(screen.getByDisplayValue('Ben Caspit')).toBeInTheDocument())

    const outletInput = screen.getAllByPlaceholderText('Add outlet (their own channel, or one they write for)')[0]
    fireEvent.change(outletInput, { target: { value: 'Ynet' } })

    mockFetch.mockResolvedValueOnce(ok({}))
    listOk()
    fireEvent.keyDown(outletInput, { key: 'Enter' })

    await waitFor(() => expect(mockFetch).toHaveBeenCalledTimes(3))
    expect(mockFetch.mock.calls[1][0]).toBe(`${API}/${CASPIT}/outlets`)
  })

  it('removes an outlet link via DELETE on the outlet id', async () => {
    listOk()
    renderWithIntl(<AuthorsTab />)
    await waitFor(() => expect(screen.getByDisplayValue('Ben Caspit')).toBeInTheDocument())

    mockFetch.mockResolvedValueOnce(ok({}))
    listOk()
    fireEvent.click(screen.getByRole('button', { name: 'Remove outlet Maariv' }))

    await waitFor(() => expect(mockFetch).toHaveBeenCalledTimes(3))
    const [url, init] = mockFetch.mock.calls[1]
    expect(url).toBe(`${API}/${CASPIT}/outlets/${OUTLET}`)
    expect(init.method).toBe('DELETE')
  })

  it('deletes a person only after the confirm prompt is accepted', async () => {
    listOk()
    renderWithIntl(<AuthorsTab />)
    await waitFor(() => expect(screen.getByDisplayValue('Ben Caspit')).toBeInTheDocument())

    const confirmSpy = vi.fn().mockReturnValue(false)
    vi.stubGlobal('confirm', confirmSpy)

    fireEvent.click(screen.getAllByRole('button', { name: 'Delete person' })[0])
    expect(confirmSpy).toHaveBeenCalledWith('Delete Ben Caspit? This removes all their aliases too.')
    expect(mockFetch).toHaveBeenCalledTimes(1) // cancelled — no DELETE went out

    confirmSpy.mockReturnValue(true)
    mockFetch.mockResolvedValueOnce(ok({}))
    listOk()
    fireEvent.click(screen.getAllByRole('button', { name: 'Delete person' })[0])

    await waitFor(() => expect(mockFetch).toHaveBeenCalledTimes(3))
    const [url, init] = mockFetch.mock.calls[1]
    expect(url).toBe(`${API}/${CASPIT}`)
    expect(init.method).toBe('DELETE')
  })

  it('shows the error banner when a write fails and does not reload', async () => {
    listOk()
    renderWithIntl(<AuthorsTab />)
    await waitFor(() => expect(screen.getByDisplayValue('Ben Caspit')).toBeInTheDocument())

    mockFetch.mockResolvedValueOnce(fail(409, { error: 'a person with this name already exists' }))
    fireEvent.change(screen.getByPlaceholderText('Canonical name (e.g. Ben Caspit)'), {
      target: { value: 'Ben Caspit' },
    })
    fireEvent.click(screen.getByRole('button', { name: 'Add person' }))

    await waitFor(() =>
      expect(screen.getByText('a person with this name already exists')).toBeInTheDocument(),
    )
    expect(mockFetch).toHaveBeenCalledTimes(2) // load + failed POST, no reload
    // The form keeps its value so the operator can correct it.
    expect(screen.getByPlaceholderText('Canonical name (e.g. Ben Caspit)')).toHaveValue('Ben Caspit')
  })

  it('clears a stale error when the next request succeeds', async () => {
    mockFetch.mockResolvedValueOnce(fail(503, { error: 'News-indexer not configured' }))
    renderWithIntl(<AuthorsTab />)
    await waitFor(() => expect(screen.getByText('News-indexer not configured')).toBeInTheDocument())

    listOk()
    fireEvent.click(screen.getByRole('button', { name: /refresh/i }))

    await waitFor(() => expect(screen.getByDisplayValue('Ben Caspit')).toBeInTheDocument())
    expect(screen.queryByText('News-indexer not configured')).not.toBeInTheDocument()
  })
})
