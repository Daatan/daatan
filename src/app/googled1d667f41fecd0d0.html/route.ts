import { NextResponse } from 'next/server'


export async function GET() {
  return new NextResponse('google-site-verification: googled1d667f41fecd0d0.html', {
    headers: {
      'Content-Type': 'text/html',
    },
  })
}
