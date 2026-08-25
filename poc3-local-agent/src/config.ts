import dotenv from 'dotenv'

dotenv.config()

export const TALLY_HOST = process.env.TALLY_HOST ?? '127.0.0.1'
export const TALLY_PORT = process.env.TALLY_PORT ?? '9000'
export const TALLY_TIMEOUT_MS = Number(process.env.TALLY_TIMEOUT_MS ?? '5000')

/** Set TALLY_DEBUG=1 in .env to see raw HTTP logs */
const DEBUG = process.env.TALLY_DEBUG === '1'

export function log(op: string, details: Record<string, unknown>) {
  if (!DEBUG) return
  const ts = new Date().toISOString()
  console.log(JSON.stringify({ timestamp: ts, operation: op, ...details }))
}
