import { ipcMain } from 'electron'
import * as fs from 'fs'
import * as path from 'path'
import * as os from 'os'

const DATA_DIR = path.join(os.homedir(), '.open-cowork')
const SETTINGS_FILE = 'settings.json'

function getSettingsPath(): string {
  return path.join(DATA_DIR, SETTINGS_FILE)
}

export function readSettings(): Record<string, unknown> {
  try {
    const filePath = getSettingsPath()
    if (fs.existsSync(filePath)) {
      return JSON.parse(fs.readFileSync(filePath, 'utf-8'))
    }
  } catch {
    // Return empty on any error
  }
  return {}
}

function writeSettings(settings: Record<string, unknown>): void {
  try {
    if (!fs.existsSync(DATA_DIR)) {
      fs.mkdirSync(DATA_DIR, { recursive: true })
    }
    const filePath = getSettingsPath()
    fs.writeFileSync(filePath, JSON.stringify(settings, null, 2), 'utf-8')
  } catch (err) {
    console.error('[Settings] Write error:', err)
  }
}

export function registerSettingsHandlers(): void {
  ipcMain.handle('settings:get', async (_event, key?: string) => {
    const settings = readSettings()
    if (key) return settings[key]
    return settings
  })

  ipcMain.handle('settings:set', async (_event, args: { key: string; value: unknown }) => {
    const settings = readSettings()
    settings[args.key] = args.value
    writeSettings(settings)
    return { success: true }
  })
}
