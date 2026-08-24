import type { UserRole } from '@prisma/client'

type Role = UserRole | null | undefined

interface RoleBadgeProps {
  role: Role
  size?: 'sm' | 'md'
}

export const RoleBadge = ({ role, size = 'sm' }: RoleBadgeProps) => {
  if (role !== 'ADMIN' && role !== 'RESOLVER' && role !== 'APPROVER') return null

  const sizeClasses =
    size === 'sm'
      ? 'w-4 h-4 text-[9px]'
      : 'w-5 h-5 text-[11px]'

  const label = role === 'ADMIN' ? 'A' : role === 'APPROVER' ? 'B' : 'R'
  const title = role === 'ADMIN' ? 'Admin' : role === 'APPROVER' ? 'Approver' : 'Resolver'
  const colorClasses =
    role === 'ADMIN'
      ? 'bg-red-100 text-red-700 border-red-800/50'
      : role === 'APPROVER'
        ? 'bg-purple-100 text-purple-700 border-purple-200'
        : 'bg-blue-100 text-blue-800 border-cobalt/30'

  return (
    <span
      role="img"
      className={`inline-flex items-center justify-center rounded-full font-bold border ${sizeClasses} ${colorClasses}`}
      title={title}
      aria-label={title}
    >
      {label}
    </span>
  )
}

