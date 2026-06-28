'use client'

import Link from 'next/link'
import { usePathname, useRouter } from 'next/navigation'
import { useState, useEffect, useRef } from 'react'
import { useSession, signOut, signIn } from 'next-auth/react'
import { VERSION } from '@/lib/version'
import { BrandLogo } from '@/components/BrandLogo'
import { useBranding } from '@/components/BrandingProvider'
import { Avatar } from './Avatar'
import { UserLink } from './UserLink'
import { useUnreadCount } from '@/lib/hooks/useUnreadCount'
import {
  Home,
  Bell,
  PlusCircle,
  Trophy,
  User,
  Settings,
  Menu,
  X,
  LogOut,
  LogIn,
  History,
  Shield,
  Info,
  Activity,
  BarChart3,
  Mail,
  Search,
} from 'lucide-react'

import { useTranslations, useLocale } from 'next-intl'

type NavItem = {
  href: string
  labelKey: string
  icon: React.ComponentType<{ className?: string }>
}

const navItems: NavItem[] = [
  { href: '/', labelKey: 'feed', icon: Home },
  { href: '/create', labelKey: 'create', icon: PlusCircle },
  { href: '/notifications', labelKey: 'notifications', icon: Bell },
  { href: '/commitments', labelKey: 'commitments', icon: BarChart3 },
  { href: '/activity', labelKey: 'activity', icon: Activity },
  { href: '/leaderboard', labelKey: 'leaderboard', icon: Trophy },
  { href: '/profile', labelKey: 'profile', icon: User },
  { href: '/settings', labelKey: 'settings', icon: Settings },
  { href: '/about', labelKey: 'about', icon: Info },
  { href: '/contact', labelKey: 'contact', icon: Mail },
  { href: '/retroanalysis', labelKey: 'retroanalysis', icon: History },
]

const Sidebar = () => {
  const pathname = usePathname()
  const router = useRouter()
  const [isMobileMenuOpen, setIsMobileMenuOpen] = useState(false)
  const [hasMounted, setHasMounted] = useState(false)
  const [searchOpen, setSearchOpen] = useState(false)
  const [searchQuery, setSearchQuery] = useState('')
  const searchInputRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    if (searchOpen) searchInputRef.current?.focus()
  }, [searchOpen])

  const handleSearch = (e: React.FormEvent) => {
    e.preventDefault()
    const q = searchQuery.trim()
    setSearchOpen(false)
    setSearchQuery('')
    handleCloseMenu()
    router.push(q ? `/forecasts?q=${encodeURIComponent(q)}` : '/forecasts')
  }

  // Safely call useSession and provide defaults to avoid build-time crashes
  const sessionData = useSession()
  const session = sessionData?.data || null
  const status = sessionData?.status || 'unauthenticated'

  // Track mount state to avoid hydration mismatch
  // Server always renders the "loading" state; client switches after mount
  useEffect(() => {
    setHasMounted(true)
  }, [])

  const handleToggleMenu = () => {
    setIsMobileMenuOpen(!isMobileMenuOpen)
  }

  const handleCloseMenu = () => {
    setIsMobileMenuOpen(false)
  }

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter' || e.key === ' ') {
      handleToggleMenu()
    }
  }

  const handleSignOut = () => {
    signOut()
    handleCloseMenu()
  }

  const handleSignIn = () => {
    signIn()
    handleCloseMenu()
  }

  const t = useTranslations('nav')
  const { appName } = useBranding()
  const c = useTranslations('common')
  const ff = useTranslations('forecastsFeed')

  const { count: unreadCount } = useUnreadCount()

  // Use "loading" state for SSR and pre-mount to ensure server/client HTML matches
  const effectiveStatus = hasMounted ? status : 'loading'

  // Filter nav items based on auth status (only after mount to avoid hydration mismatch)
  const filteredNavItems = hasMounted
    ? navItems.filter((item) => {
      const authRequiredRoutes = ['/create', '/notifications', '/profile', '/commitments']
      if (authRequiredRoutes.includes(item.href)) {
        return status === 'authenticated'
      }
      return true
    })
    : navItems.filter((item) => {
      // During SSR/pre-mount, show all non-auth routes
      const authRequiredRoutes = ['/create', '/notifications', '/profile', '/commitments']
      return !authRequiredRoutes.includes(item.href)
    })

  const currentLocale = useLocale()

  const navLinks = filteredNavItems.map(item => ({
    ...item,
    href: currentLocale !== 'en' && item.href === '/about' ? `/${currentLocale}/about` : item.href,
    label: t(item.labelKey)
  }))

  // Add admin link for admin/moderator users
  if (hasMounted && status === 'authenticated' && (session?.user?.role === 'ADMIN' || session?.user?.role === 'RESOLVER' || session?.user?.role === 'APPROVER')) {
    navLinks.push({ href: '/admin', labelKey: 'admin', label: t('admin'), icon: Shield })
  }

  // Add Sign In button to nav if unauthenticated (only after mount)
  if (hasMounted && status === 'unauthenticated') {
    navLinks.push({ href: '#', labelKey: 'signIn', label: c('signIn'), icon: LogIn })
  }

  if (pathname.startsWith('/auth/')) return null

  return (
    <>
      {/* Mobile Header */}
      <header className="lg:hidden fixed top-0 left-0 right-0 h-16 bg-navy-900 border-b border-navy-600 flex items-center justify-between px-4 z-50">
        <Link href="/" className="flex items-center gap-2" onClick={handleCloseMenu}>
          <BrandLogo fallbackSrc="/logo-icon.png" width={40} height={40} priority />
          <span className="text-lg font-bold text-white">{appName}</span>
        </Link>
        <div className="flex items-center gap-2">
          <button
            onClick={() => { setSearchOpen(true); setIsMobileMenuOpen(true) }}
            className="p-2 rounded-lg hover:bg-navy-800 transition-colors"
            aria-label={c('search')}
          >
            <Search className="w-5 h-5 text-text-secondary" />
          </button>
          {hasMounted && status === 'authenticated' && session?.user && (
            <UserLink
              userId={session.user.id}
              username={session.user.username}
              name={session.user.name}
              image={session.user.image}
              showAvatar={true}
              avatarSize={32}
              onClick={handleCloseMenu}
            >
              <span />
            </UserLink>
          )}
          <button
            onClick={handleToggleMenu}
            onKeyDown={handleKeyDown}
            className="p-2 rounded-lg hover:bg-navy-800 transition-colors"
            aria-label={isMobileMenuOpen ? 'Close menu' : 'Open menu'}
            aria-expanded={isMobileMenuOpen}
            tabIndex={0}
          >
            {isMobileMenuOpen ? (
              <X className="w-6 h-6 text-text-secondary" />
            ) : (
              <Menu className="w-6 h-6 text-text-secondary" />
            )}
          </button>
        </div>
      </header>

      {/* Mobile Overlay */}
      {isMobileMenuOpen && (
        <div
          className="lg:hidden fixed inset-0 bg-black/50 z-40"
          onClick={handleCloseMenu}
          onKeyDown={(e) => e.key === 'Escape' && handleCloseMenu()}
          role="button"
          tabIndex={0}
          aria-label="Close menu"
        />
      )}

      {/* Sidebar */}
      <aside
        className={`
          fixed left-0 top-0 h-screen w-64 bg-navy-900 border-r border-navy-600 flex flex-col z-50
          transform transition-transform duration-300 ease-in-out
          lg:translate-x-0
          ${isMobileMenuOpen ? 'translate-x-0' : '-translate-x-full'}
        `}
      >
        {/* Logo */}
        <Link href="/" className="hidden lg:flex p-6 items-center gap-3 hover:bg-navy-800 transition-colors">
          <BrandLogo fallbackSrc="/logo-icon.png" width={48} height={48} priority />
          <div>
            <div className="flex items-center gap-2">
              <span className="text-xl font-bold text-white">{appName}</span>
              <span className="text-xs text-text-subtle font-mono">v{VERSION}</span>
            </div>
            <p className="text-sm text-text-secondary">{t('tagline')}</p>
          </div>
        </Link>

        {/* Mobile Logo Spacer */}
        <div className="lg:hidden h-16" />

        {/* Navigation */}
        <nav className="flex-1 px-4 py-6 overflow-y-auto">
          <ul className="space-y-1">
            {/* Search */}
            <li>
              {searchOpen ? (
                <form onSubmit={handleSearch} className="flex items-center gap-2 px-2 py-1.5">
                  <input
                    ref={searchInputRef}
                    value={searchQuery}
                    onChange={e => setSearchQuery(e.target.value)}
                    placeholder={ff('searchPlaceholder')}
                    className="flex-1 bg-navy-800 text-white text-sm px-3 py-2 rounded-lg border border-navy-600 outline-none focus:border-blue-500 placeholder-gray-500"
                    onKeyDown={e => e.key === 'Escape' && setSearchOpen(false)}
                  />
                  <button type="button" onClick={() => setSearchOpen(false)} className="p-1 text-gray-400 hover:text-white">
                    <X className="w-4 h-4" />
                  </button>
                </form>
              ) : (
                <button
                  onClick={() => setSearchOpen(true)}
                  className="flex items-center gap-3 px-4 py-3 rounded-lg text-text-secondary hover:bg-navy-800 hover:text-white transition-colors w-full"
                >
                  <Search className="w-5 h-5" />
                  <span className="font-medium">{c('search')}</span>
                </button>
              )}
            </li>

            {navLinks.map((item) => {
              const isActive = pathname === item.href
              const Icon = item.icon

              return (
                <li key={item.href}>
                  <Link
                    href={item.href}
                    onClick={item.labelKey === 'signIn' ? handleSignIn : handleCloseMenu}
                    className={`
                      flex items-center gap-3 px-4 py-3 rounded-lg transition-colors
                      ${isActive
                        ? 'bg-navy-700 text-cobalt-light'
                        : 'text-text-secondary hover:bg-navy-800 hover:text-white'
                      }
                    `}
                    aria-current={isActive ? 'page' : undefined}
                  >
                    <span className="relative">
                      <Icon className="w-5 h-5" />
                      {item.href === '/notifications' && hasMounted && unreadCount > 0 && (
                        <span className="absolute -top-1.5 -right-1.5 flex items-center justify-center min-w-[16px] h-4 px-1 text-[10px] font-bold text-white bg-red-500 rounded-full">
                          {unreadCount > 99 ? '99+' : unreadCount}
                        </span>
                      )}
                    </span>
                    <span className="font-medium">{item.label}</span>
                  </Link>
                </li>
              )
            })}
          </ul>
        </nav>

        {/* User Section */}
        <div className="p-4 border-t border-navy-600">
          {effectiveStatus === 'loading' ? (
            <div className="animate-pulse flex items-center gap-3 px-4 py-3">
              <div className="w-8 h-8 bg-navy-700 rounded-full" />
              <div className="flex-1">
                <div className="h-4 bg-navy-700 rounded w-24" />
              </div>
            </div>
          ) : effectiveStatus === 'authenticated' && session?.user ? (
            <div className="space-y-1">
              <UserLink
                userId={session.user.id}
                username={session.user.username}
                name={session.user.name}
                image={session.user.image}
                showAvatar={true}
                avatarSize={32}
                onClick={handleCloseMenu}
                className="flex items-center gap-3 px-4 py-3 rounded-lg text-text-secondary hover:bg-navy-800 hover:text-white transition-colors w-full"
              >
                <div className="flex-1 overflow-hidden text-left">
                  <div className="flex items-center gap-1.5">
                    <p className="font-medium truncate text-sm text-white">{session.user.username || session.user.name || 'User'}</p>
                    {session.user.role === 'ADMIN' && (
                      <span className="inline-flex items-center justify-center w-4 h-4 text-[9px] font-bold text-red-400 bg-red-900/40 border border-red-700 rounded-full shrink-0" title="Admin" aria-label="Admin">A</span>
                    )}
                    {session.user.role === 'RESOLVER' && (
                      <span className="inline-flex items-center justify-center w-4 h-4 text-[9px] font-bold text-cobalt-light bg-navy-700 border border-navy-600 rounded-full shrink-0" title="Resolver" aria-label="Resolver">R</span>
                    )}
                    {session.user.role === 'APPROVER' && (
                      <span className="inline-flex items-center justify-center w-4 h-4 text-[9px] font-bold text-teal bg-navy-700 border border-navy-600 rounded-full shrink-0" title="Approver" aria-label="Approver">B</span>
                    )}
                  </div>
                  <p className="text-xs text-text-subtle truncate mb-1">{session.user.email}</p>
                  <div className="flex items-center gap-1 text-xs font-medium text-teal bg-navy-700 px-2 py-0.5 rounded-full w-fit">
                    <span className="w-3 h-3 rounded-full border border-teal flex items-center justify-center text-[8px] font-bold">R</span>
                    {session.user.rs ?? 0} RS
                  </div>
                </div>
              </UserLink>
              <button
                onClick={handleSignOut}
                className="w-full flex items-center gap-3 px-4 py-3 rounded-lg text-text-secondary hover:bg-red-900/30 hover:text-red-400 transition-colors"
              >
                <LogOut className="w-5 h-5" />
                <span className="font-medium">{c('signOut')}</span>
              </button>
            </div>
          ) : (
            <button
              onClick={handleSignIn}
              className="w-full flex items-center gap-3 px-4 py-3 rounded-lg text-cobalt hover:bg-navy-700 transition-colors"
            >
              <LogIn className="w-5 h-5" />
              <span className="font-medium">{c('signIn')}</span>
            </button>
          )}
        </div>
      </aside>
    </>
  )
}

export default Sidebar
