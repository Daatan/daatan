'use client'
import { useState, useEffect, useCallback } from 'react'
import { Loader2, RefreshCw, X } from 'lucide-react'
import { useTranslations } from 'next-intl'

type Alias = { id: string; alias: string }
type OutletLink = { id: string; name: string }
type Person = {
  id: string
  canonical_name: string
  notes: string | null
  aliases: Alias[]
  outlets: OutletLink[]
}

const API = '/api/admin/news-indexer/authors'

export default function AuthorsTab() {
  const t = useTranslations('admin')
  const [people, setPeople] = useState<Person[] | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  const [newName, setNewName] = useState('')
  const [newNotes, setNewNotes] = useState('')
  // Per-person draft state for the inline name/notes editors, the alias input, and the outlet-link input.
  const [drafts, setDrafts] = useState<Record<string, { name: string; notes: string; alias: string; outlet: string }>>({})

  const load = useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      const res = await fetch(API, { cache: 'no-store' })
      if (!res.ok) {
        const body = await res.json().catch(() => ({}))
        throw new Error(body.error || `Request failed (${res.status})`)
      }
      const data = await res.json()
      const list: Person[] = data.people ?? []
      setPeople(list)
      setDrafts(Object.fromEntries(
        list.map((p) => [p.id, { name: p.canonical_name, notes: p.notes ?? '', alias: '', outlet: '' }]),
      ))
    } catch (e) {
      setError(e instanceof Error ? e.message : t('authorsLoadError'))
    } finally {
      setLoading(false)
    }
  }, [t])

  useEffect(() => { load() }, [load])

  /** Every mutation reloads: upstream invalidates its alias cache on write, so the list is the source of truth. */
  const mutate = useCallback(async (path: string, init: RequestInit) => {
    setError(null)
    try {
      const res = await fetch(`${API}${path}`, {
        ...init,
        headers: { 'content-type': 'application/json', ...init.headers },
      })
      if (!res.ok) {
        const body = await res.json().catch(() => ({}))
        throw new Error(body.error || `Request failed (${res.status})`)
      }
      await load()
      return true
    } catch (e) {
      setError(e instanceof Error ? e.message : t('authorsSaveError'))
      return false
    }
  }, [load, t])

  const addPerson = async () => {
    const canonical_name = newName.trim()
    if (!canonical_name) return
    const ok = await mutate('', {
      method: 'POST',
      body: JSON.stringify({ canonical_name, notes: newNotes.trim() || null }),
    })
    if (ok) { setNewName(''); setNewNotes('') }
  }

  const savePerson = (p: Person) => {
    const draft = drafts[p.id]
    if (!draft?.name.trim()) return
    return mutate(`/${p.id}`, {
      method: 'PATCH',
      body: JSON.stringify({ canonical_name: draft.name.trim(), notes: draft.notes.trim() }),
    })
  }

  const deletePerson = (p: Person) => {
    if (!confirm(t('authorsDeleteConfirm', { name: p.canonical_name }))) return
    return mutate(`/${p.id}`, { method: 'DELETE' })
  }

  const addAlias = (p: Person) => {
    const alias = drafts[p.id]?.alias.trim()
    if (!alias) return
    return mutate(`/${p.id}/aliases`, { method: 'POST', body: JSON.stringify({ alias }) })
  }

  const deleteAlias = (p: Person, alias: Alias) =>
    mutate(`/${p.id}/aliases/${alias.id}`, { method: 'DELETE' })

  const addOutlet = (p: Person) => {
    const outlet_name = drafts[p.id]?.outlet.trim()
    if (!outlet_name) return
    return mutate(`/${p.id}/outlets`, { method: 'POST', body: JSON.stringify({ outlet_name }) })
  }

  const removeOutlet = (p: Person, outlet: OutletLink) =>
    mutate(`/${p.id}/outlets/${outlet.id}`, { method: 'DELETE' })

  const setDraft = (id: string, patch: Partial<{ name: string; notes: string; alias: string; outlet: string }>) =>
    setDrafts((d) => ({ ...d, [id]: { ...d[id], ...patch } }))

  const inputClass = 'px-3 py-1.5 text-sm bg-navy-900 border border-navy-600 rounded-md text-white placeholder:text-gray-600 focus:outline-none focus:border-blue-500'

  return (
    <div>
      <div className="flex items-center justify-between mb-4">
        <div>
          <h2 className="text-lg font-semibold text-white">{t('authorsTitle')}</h2>
          {people && <p className="text-sm text-gray-400">{t('authorsSummary', { count: people.length })}</p>}
        </div>
        <button
          onClick={load}
          disabled={loading}
          className="inline-flex items-center gap-1.5 px-3 py-1.5 text-sm font-medium text-blue-600 bg-cobalt/10 hover:bg-blue-100 rounded-md transition-colors disabled:opacity-50"
        >
          {loading ? <Loader2 className="w-4 h-4 animate-spin" /> : <RefreshCw className="w-4 h-4" />}
          {t('refresh')}
        </button>
      </div>

      {error && (
        <div className="p-3 mb-4 rounded-lg bg-red-500/10 border border-red-500/30 text-sm text-red-400">
          {error}
        </div>
      )}

      <div className="mb-6">
        <h3 className="text-xs font-bold uppercase tracking-wider text-gray-500 mb-2">{t('authorsAddTitle')}</h3>
        <div className="flex flex-wrap gap-2 items-center p-4 rounded-lg border border-navy-600 bg-navy-800">
          <input
            className={`${inputClass} flex-1 min-w-[10rem]`}
            placeholder={t('authorsNamePlaceholder')}
            value={newName}
            onChange={(e) => setNewName(e.target.value)}
          />
          <input
            className={`${inputClass} flex-1 min-w-[10rem]`}
            placeholder={t('authorsNotesPlaceholder')}
            value={newNotes}
            onChange={(e) => setNewNotes(e.target.value)}
          />
          <button
            onClick={addPerson}
            disabled={!newName.trim()}
            className="px-3 py-1.5 text-sm font-semibold text-white bg-blue-600 hover:bg-blue-500 rounded-md transition-colors disabled:opacity-40"
          >
            {t('authorsAdd')}
          </button>
        </div>
      </div>

      {loading && !people ? (
        <div className="flex justify-center py-12"><Loader2 className="w-6 h-6 text-blue-500 animate-spin" /></div>
      ) : !people?.length ? (
        <div className="py-8 text-sm text-gray-500">{t('authorsEmpty')}</div>
      ) : (
        <div className="flex flex-col gap-3">
          {people.map((p) => {
            const draft = drafts[p.id] ?? { name: p.canonical_name, notes: p.notes ?? '', alias: '', outlet: '' }
            return (
              <div key={p.id} className="p-4 rounded-lg border border-navy-600 bg-navy-800">
                <div className="flex flex-wrap gap-2 items-center mb-3">
                  <input
                    className={`${inputClass} flex-1 min-w-[9rem] font-semibold`}
                    value={draft.name}
                    onChange={(e) => setDraft(p.id, { name: e.target.value })}
                  />
                  <input
                    className={`${inputClass} flex-1 min-w-[9rem]`}
                    placeholder={t('authorsNotesPlaceholder')}
                    value={draft.notes}
                    onChange={(e) => setDraft(p.id, { notes: e.target.value })}
                  />
                  <button
                    onClick={() => savePerson(p)}
                    className="px-3 py-1.5 text-sm font-medium text-gray-200 bg-navy-700 hover:bg-navy-600 border border-navy-600 rounded-md transition-colors"
                  >
                    {t('authorsSave')}
                  </button>
                  <button
                    onClick={() => deletePerson(p)}
                    className="px-3 py-1.5 text-sm font-medium text-red-400 bg-red-500/10 hover:bg-red-500/20 border border-red-500/30 rounded-md transition-colors"
                  >
                    {t('authorsDelete')}
                  </button>
                </div>

                <div className="flex flex-wrap gap-1.5 mb-3">
                  {p.aliases.length === 0 ? (
                    <span className="text-xs text-gray-600">{t('authorsNoAliases')}</span>
                  ) : p.aliases.map((a) => (
                    <span key={a.id} className="inline-flex items-center gap-1.5 pl-3 pr-1 py-1 text-xs text-gray-300 bg-navy-900 border border-navy-600 rounded-full">
                      {a.alias}
                      <button
                        onClick={() => deleteAlias(p, a)}
                        aria-label={t('authorsRemoveAlias', { alias: a.alias })}
                        className="p-0.5 text-gray-500 hover:text-red-400 rounded-full transition-colors"
                      >
                        <X className="w-3 h-3" />
                      </button>
                    </span>
                  ))}
                </div>

                <div className="flex gap-2 mb-3">
                  <input
                    className={`${inputClass} flex-1`}
                    placeholder={t('authorsAliasPlaceholder')}
                    value={draft.alias}
                    onChange={(e) => setDraft(p.id, { alias: e.target.value })}
                    onKeyDown={(e) => { if (e.key === 'Enter') addAlias(p) }}
                  />
                  <button
                    onClick={() => addAlias(p)}
                    disabled={!draft.alias.trim()}
                    className="px-3 py-1.5 text-sm font-medium text-gray-200 bg-navy-700 hover:bg-navy-600 border border-navy-600 rounded-md transition-colors disabled:opacity-40"
                  >
                    {t('authorsAddAlias')}
                  </button>
                </div>

                <h4 className="text-xs font-bold uppercase tracking-wider text-gray-500 mb-1.5">{t('authorsOutletsTitle')}</h4>
                <div className="flex flex-wrap gap-1.5 mb-3">
                  {p.outlets.length === 0 ? (
                    <span className="text-xs text-gray-600">{t('authorsNoOutlets')}</span>
                  ) : p.outlets.map((o) => (
                    <span key={o.id} className="inline-flex items-center gap-1.5 pl-3 pr-1 py-1 text-xs text-gray-300 bg-navy-900 border border-navy-600 rounded-full">
                      {o.name}
                      <button
                        onClick={() => removeOutlet(p, o)}
                        aria-label={t('authorsRemoveOutlet', { name: o.name })}
                        className="p-0.5 text-gray-500 hover:text-red-400 rounded-full transition-colors"
                      >
                        <X className="w-3 h-3" />
                      </button>
                    </span>
                  ))}
                </div>

                <div className="flex gap-2">
                  <input
                    className={`${inputClass} flex-1`}
                    placeholder={t('authorsOutletPlaceholder')}
                    value={draft.outlet}
                    onChange={(e) => setDraft(p.id, { outlet: e.target.value })}
                    onKeyDown={(e) => { if (e.key === 'Enter') addOutlet(p) }}
                  />
                  <button
                    onClick={() => addOutlet(p)}
                    disabled={!draft.outlet.trim()}
                    className="px-3 py-1.5 text-sm font-medium text-gray-200 bg-navy-700 hover:bg-navy-600 border border-navy-600 rounded-md transition-colors disabled:opacity-40"
                  >
                    {t('authorsAddOutlet')}
                  </button>
                </div>
              </div>
            )
          })}
        </div>
      )}
    </div>
  )
}
