// Same storage server as the portable executable.
import { dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
process.env.CHILLPASS_APP_DIR = dirname(fileURLToPath(import.meta.url))
await import('./installer/app.cjs')
