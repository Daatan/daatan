'use client'
import { useState, useEffect, useCallback } from 'react'
import Link from 'next/link'
import { Loader2, Search } from 'lucide-react'
import { toast } from 'react-hot-toast'

type AdminUser = {
  id: string
  name: string | null
  username: string | null
  email: string
  role: string
  rs: number
  createdAt: string
  image: string | null
  isBot: boolean
}

export default function UsersTable() {
  const [users, setUsers] = useState<AdminUser[]>([])
  const [isLoading, setIsLoading] = useState(true)
  const [search, setSearch] = useState('')
  const [page, setPage] = useState(1)
  const [totalPages, setTotalPages] = useState(1)
  const fetchUsers = useCallback(async () => {
    setIsLoading(true)
    try {
      const res = await fetch(`/api/admin/users?page=${page}&limit=20&search=${encodeURIComponent(search)}`)
      if (res.ok) {
        const data = await res.json()
        setUsers(data.users)
        setTotalPages(data.pages)
      }
    } finally {
      setIsLoading(false)
    }
  }, [page, search])

  useEffect(() => {
    fetchUsers()
  }, [fetchUsers])

  const updateRole = async (userId: string, newRole: string) => {
    const res = await fetch(`/api/admin/users/${userId}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ role: newRole }),
    })
    if (res.ok) {
      setUsers(users.map(u => u.id === userId ? { ...u, role: newRole } : u))
      toast.success('User role updated successfully')
    } else {
      const error = await res.json().catch(() => ({}))
      toast.error(error.error || 'Failed to update role')
    }
  }

  const handleSearch = (e: React.FormEvent) => {
    e.preventDefault()
    setPage(1)
    fetchUsers()
  }

  return (
    <div>
      <div className="mb-6 flex gap-2">
        <form onSubmit={handleSearch} className="flex gap-2 flex-1">
          <div className="relative flex-1 max-w-md">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400 w-4 h-4" />
            <input
              type="text"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Search by name, email, or username..."
              className="pl-10 pr-4 py-2 border border-navy-600 rounded-lg w-full bg-navy-700 text-white placeholder:text-gray-400 focus:ring-2 focus:ring-blue-500 outline-none"
            />
          </div>
          <button type="submit" className="bg-blue-600 text-white px-4 py-2 rounded-lg hover:bg-blue-700 transition-colors">
            Search
          </button>
        </form>
      </div>

      {isLoading ? (
        <div className="flex justify-center py-12">
          <Loader2 className="w-8 h-8 animate-spin text-blue-500" />
        </div>
      ) : (
        <>
          <div className="overflow-x-auto border rounded-lg shadow-sm">
            <table className="w-full border-collapse bg-navy-700">
              <thead className="bg-navy-800 text-text-secondary text-sm font-semibold uppercase tracking-wider">
                <tr>
                  <th className="p-3 border-b text-left">User</th>
                  <th className="p-3 border-b text-left">Email</th>
                  <th className="p-3 border-b text-left">Role</th>
                  <th className="p-3 border-b text-right">Reputation</th>
                  <th className="p-3 border-b text-right">Created</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100">
                {users.map((u) => (
                  <tr key={u.id} className={`hover:bg-navy-800 transition-colors ${u.isBot ? 'border-l-2 border-cobalt/40 bg-cobalt/5' : ''}`}>
                    <td className="p-3">
                      <Link href={`/profile/${u.id}`} className="group inline-block hover:opacity-80 transition-opacity">
                        <div className="flex items-center gap-2">
                          <span className="font-medium text-white group-hover:underline">{u.name}</span>
                          {u.isBot && (
                            <span className="text-xs px-1.5 py-0.5 rounded bg-cobalt/20 text-cobalt-light font-mono">BOT</span>
                          )}
                        </div>
                        <div className="text-xs text-gray-500 font-mono">@{u.username || 'unknown'}</div>
                      </Link>
                    </td>
                    <td className="p-3 text-sm text-gray-500">{u.email}</td>
                    <td className="p-3">
                      <select
                        value={u.role}
                        onChange={(e) => updateRole(u.id, e.target.value)}
                        className={`border rounded p-1 text-sm outline-none focus:ring-2 focus:ring-blue-500 ${u.role === 'ADMIN' ? 'bg-purple-900/20 text-purple-800 border-purple-200' :
                          u.role === 'RESOLVER' ? 'bg-cobalt/10 text-cobalt-light border-cobalt/30' :
                            'bg-navy-700 text-white border-navy-600'
                          }`}
                      >
                        <option value="USER">User</option>
                        <option value="RESOLVER">Resolver</option>
                        <option value="ADMIN">Admin</option>
                      </select>
                    </td>
                    <td className="p-3 text-right font-mono text-sm">{Math.round(u.rs)}</td>
                    <td className="p-3 text-right text-xs text-gray-500">{new Date(u.createdAt).toLocaleDateString()}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          <div className="mt-4 flex justify-between items-center text-sm text-gray-600">
            <div>Page {page} of {totalPages}</div>
            <div className="flex gap-2">
              <button
                onClick={() => setPage(p => Math.max(1, p - 1))}
                disabled={page === 1}
                className="px-3 py-1 border rounded disabled:opacity-50 hover:bg-navy-800"
              >
                Previous
              </button>
              <button
                onClick={() => setPage(p => Math.min(totalPages, p + 1))}
                disabled={page === totalPages}
                className="px-3 py-1 border rounded disabled:opacity-50 hover:bg-navy-800"
              >
                Next
              </button>
            </div>
          </div>
        </>
      )}
    </div>
  )
}
