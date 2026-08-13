import type { Metadata } from 'next'
import { Mail, Github, MessageSquare } from 'lucide-react'
import Link from 'next/link'
import { notFound } from 'next/navigation'
import { isSelfHosted } from '@/lib/edition'
import { getContactEmail } from '@/lib/branding'

export const metadata: Metadata = {
  title: 'Contact Us',
  description: 'Get in touch with the DAATAN team — questions, feedback, partnership ideas, or support for the reputation-based news-forecasting platform.',
  alternates: { canonical: '/contact' },
  openGraph: { url: '/contact', type: 'website' },
}

export default function ContactPage() {
  // SaaS-only support page (DAATAN contact details) — absent on self-host.
  if (isSelfHosted()) notFound()
  const contactEmail = getContactEmail()
  return (
    <div className="p-4 sm:p-6 lg:p-8 max-w-2xl mx-auto">
      <div className="flex items-center gap-3 mb-6 lg:mb-8">
        <Mail className="w-6 h-6 sm:w-8 sm:h-8 text-blue-500" />
        <h1 className="text-2xl sm:text-3xl font-bold text-white">Contact Us</h1>
      </div>

      <div className="bg-navy-800 border border-cobalt/30 rounded-xl p-6 mb-6">
        <p className="text-sm text-text-secondary">
          Have a question, feedback, or want to report an issue? We&apos;d love to hear from you.
        </p>
      </div>

      <div className="bg-navy-700 border border-navy-600 rounded-xl shadow-sm overflow-hidden mb-6">
        <div className="p-6 border-b border-navy-600">
          <h2 className="text-lg font-semibold text-white">Get in Touch</h2>
        </div>
        <div className="p-6 space-y-4">
          <a
            href={`mailto:${contactEmail}`}
            className="flex items-center gap-4 p-4 bg-navy-800 hover:bg-navy-600 rounded-xl transition-colors group"
          >
            <div className="p-3 bg-blue-900/30 text-blue-400 rounded-lg shrink-0">
              <Mail className="w-5 h-5" />
            </div>
            <div>
              <p className="font-medium text-white group-hover:text-cobalt-light transition-colors">Email</p>
              <p className="text-sm text-cobalt-light">{contactEmail}</p>
            </div>
          </a>

          <a
            href="https://github.com/Daatan/daatan/issues"
            target="_blank"
            rel="noopener noreferrer"
            className="flex items-center gap-4 p-4 bg-navy-800 hover:bg-navy-600 rounded-xl transition-colors group"
          >
            <div className="p-3 bg-navy-700 text-text-secondary rounded-lg shrink-0">
              <Github className="w-5 h-5" />
            </div>
            <div>
              <p className="font-medium text-white group-hover:text-cobalt-light transition-colors">GitHub Issues</p>
              <p className="text-sm text-text-secondary">Report bugs or request features</p>
            </div>
          </a>

          <a
            href="https://x.com/daatan_dev"
            target="_blank"
            rel="noopener noreferrer"
            className="flex items-center gap-4 p-4 bg-navy-800 hover:bg-navy-600 rounded-xl transition-colors group"
          >
            <div className="p-3 bg-navy-700 text-text-secondary rounded-lg shrink-0">
              <MessageSquare className="w-5 h-5" />
            </div>
            <div>
              <p className="font-medium text-white group-hover:text-cobalt-light transition-colors">Twitter / X</p>
              <p className="text-sm text-text-secondary">@daatan_dev</p>
            </div>
          </a>
        </div>
      </div>

      <div className="text-center text-sm text-text-subtle">
        <Link href="/about" className="hover:text-white hover:underline">
          Learn more about DAATAN →
        </Link>
      </div>
    </div>
  )
}
