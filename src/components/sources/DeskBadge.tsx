/** Marks a byline that is a newsroom or wire service rather than a named person (#1904). */
export default function DeskBadge({ label, hint }: { label: string; hint: string }) {
  return (
    <span
      title={hint}
      className="ms-2 inline-block rounded border border-gray-600 px-1.5 py-0.5 align-middle text-[10px] font-medium uppercase tracking-wide text-gray-400"
    >
      {label}
    </span>
  )
}
