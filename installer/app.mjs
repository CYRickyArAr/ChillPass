// Legacy entry point uses the maintained portable server.
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
process.env.CHILLPASS_APP_DIR = resolve(dirname(fileURLToPath(import.meta.url)), '..')
await import('./app.cjs')
