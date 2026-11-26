import React from 'react'
import Link from 'next/link'
import { Loader2 } from 'lucide-react'

interface ButtonProps extends React.ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: 'primary' | 'secondary' | 'ghost' | 'outline' | 'danger'
  size?: 'xs' | 'sm' | 'md' | 'lg' | 'xl'
  loading?: boolean
  href?: string
  leftIcon?: React.ReactNode
  rightIcon?: React.ReactNode
  fullWidth?: boolean
}

export const Button = React.forwardRef<HTMLButtonElement & HTMLAnchorElement, ButtonProps>(
  (
    {
      className = '',
      variant = 'primary',
      size = 'md',
      loading = false,
      href,
      leftIcon,
      rightIcon,
      fullWidth = false,
      children,
      disabled,
      ...props
    },
    ref
  ) => {
    const baseStyles = 'inline-flex items-center justify-center gap-2 font-medium transition-all active:scale-95 disabled:opacity-50 disabled:cursor-not-allowed disabled:active:scale-100'
    
    const variants = {
      primary: 'bg-blue-600 text-white hover:bg-blue-700 shadow-xs',
      secondary: 'bg-navy-700 text-white hover:bg-navy-600',
      outline: 'border border-gray-300 bg-transparent hover:bg-navy-800 text-text-secondary',
      ghost: 'bg-transparent hover:bg-navy-700 text-gray-400',
      danger: 'bg-red-600 text-white hover:bg-red-700 shadow-xs',
    }

    const sizes = {
      xs: 'px-2 py-1 text-[10px] sm:text-xs rounded-md',
      sm: 'px-3 py-1.5 text-sm rounded-lg',
      md: 'px-4 py-2 text-sm sm:text-base rounded-lg',
      lg: 'px-6 py-2.5 text-base rounded-xl font-semibold',
      xl: 'px-6 py-3 text-lg rounded-xl font-bold',
    }

    const combinedClassName = `
      ${baseStyles} 
      ${variants[variant]} 
      ${sizes[size]} 
      ${fullWidth ? 'w-full' : ''} 
      ${className}
    `.trim().replace(/\s+/g, ' ')

    const content = (
      <>
        {loading && <Loader2 className="w-4 h-4 animate-spin" />}
        {!loading && leftIcon}
        {children}
        {!loading && rightIcon}
      </>
    )

    if (href) {
      return (
        <Link 
          href={href} 
          className={combinedClassName}
          {...(props as any)}
        >
          {content}
        </Link>
      )
    }

    return (
      <button
        ref={ref}
        className={combinedClassName}
        disabled={disabled || loading}
        {...props}
      >
        {content}
      </button>
    )
  }
)

Button.displayName = 'Button'
