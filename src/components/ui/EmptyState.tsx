import { Button } from './Button'

interface EmptyStateAction {
  label: string
  href: string
  icon?: React.ReactNode
  variant?: 'blue' | 'purple'
}

interface EmptyStateProps {
  icon: React.ReactNode
  /** Background class for the icon circle, e.g. 'bg-cobalt/10'. Omit to render icon without circle. */
  iconBgClass?: string
  title?: string
  description?: React.ReactNode
  action?: EmptyStateAction
  /** card = solid border, p-12, larger — dashed = dashed border, p-8, compact */
  variant?: 'card' | 'dashed'
}

export default function EmptyState({
  icon,
  iconBgClass,
  title,
  description,
  action,
  variant = 'card',
}: EmptyStateProps) {
  const isCard = variant === 'card'
  const actionColorClass =
    action?.variant === 'purple'
      ? 'bg-purple-600 hover:bg-purple-700'
      : 'bg-blue-600 hover:bg-blue-700'

  return (
    <div
      className={
        isCard
          ? 'bg-navy-700 border border-navy-600 rounded-2xl p-12 text-center shadow-xs'
          : 'bg-navy-800 border-2 border-dashed border-navy-600 rounded-2xl p-8 text-center'
      }
    >
      {iconBgClass ? (
        <div
          className={`${isCard ? 'w-20 h-20 mb-6' : 'w-14 h-14 mb-4'} rounded-full flex items-center justify-center mx-auto ${iconBgClass}`}
        >
          {icon}
        </div>
      ) : (
        <div className="flex justify-center mb-3">{icon}</div>
      )}

      {title && (
        <h2 className={isCard ? 'text-2xl font-bold text-white mb-3' : 'text-xl font-semibold text-white mb-2'}>
          {title}
        </h2>
      )}

      {description && (
        <div className={isCard ? 'text-gray-500 mb-8 max-w-md mx-auto text-lg' : 'text-gray-500 font-medium mb-4'}>
          {description}
        </div>
      )}

      {action && (
        <Button
          href={action.href}
          size={isCard ? 'lg' : 'md'}
          className={action.variant === 'purple' ? 'bg-purple-600 hover:bg-purple-700' : ''}
          leftIcon={action.icon}
        >
          {action.label}
        </Button>
      )}
    </div>
  )
}
