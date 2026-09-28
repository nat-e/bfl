import type { Metadata } from 'next'
import './globals.css'

export const metadata: Metadata = { title: 'FLUX 3 Video (Vercel/Next.js)' }

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  )
}
