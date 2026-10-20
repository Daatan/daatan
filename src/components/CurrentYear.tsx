import { connection } from 'next/server'

// Reads the clock per request: Cache Components rejects `new Date()` in a prerendered shell.
export default async function CurrentYear() {
  await connection()
  return <>{new Date().getFullYear()}</>
}
