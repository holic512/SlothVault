/** Keep newly introduced private runtime artifacts out of the developer's installation. */
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterAll } from 'vitest'
const directory = mkdtempSync(join(tmpdir(), 'sv-vitest-app-data-'))
process.env.APP_DATA_PATH = directory
afterAll(() => rmSync(directory, { recursive: true, force: true }))
