'use client'

import { useState, type ReactNode } from 'react'

const BUTTON = 'mt-3 text-sm text-cyan-400 hover:underline'

/** A server-rendered list that shows its first `initial` items until the reader asks for the rest. */
export function ShowMoreList({ items, initial, moreLabel, className }: {
  items: ReactNode[]
  initial: number
  moreLabel: string
  className?: string
}) {
  const [all, setAll] = useState(false)
  return (
    <>
      <ul className={className}>{all ? items : items.slice(0, initial)}</ul>
      {!all && items.length > initial && (
        <button type="button" onClick={() => setAll(true)} className={BUTTON}>{moreLabel}</button>
      )}
    </>
  )
}

/** The same for table rows: `head` is the `<tr>` of header cells. */
export function ShowMoreTable({ head, rows, initial, moreLabel, className }: {
  head: ReactNode
  rows: ReactNode[]
  initial: number
  moreLabel: string
  className?: string
}) {
  const [all, setAll] = useState(false)
  return (
    <>
      <div className={className}>
        <table className="w-full text-sm">
          <thead>{head}</thead>
          <tbody>{all ? rows : rows.slice(0, initial)}</tbody>
        </table>
      </div>
      {!all && rows.length > initial && (
        <button type="button" onClick={() => setAll(true)} className={BUTTON}>{moreLabel}</button>
      )}
    </>
  )
}
