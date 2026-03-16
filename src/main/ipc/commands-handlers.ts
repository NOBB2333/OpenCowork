import { ipcMain } from 'electron'
import * as fs from 'fs'
import * as path from 'path'
import * as os from 'os'

const COMMANDS_DIR = path.join(os.homedir(), '.open-cowork', 'commands')

export interface CommandInfo {
  name: string
  summary: string
}

function ensureCommandsDir(): void {
  if (!fs.existsSync(COMMANDS_DIR)) {
    fs.mkdirSync(COMMANDS_DIR, { recursive: true })
  }
}

function getCommandEntries(): fs.Dirent[] {
  ensureCommandsDir()
  return fs
    .readdirSync(COMMANDS_DIR, { withFileTypes: true })
    .filter((entry) => entry.isFile() && entry.name.toLowerCase().endsWith('.md'))
}

function normalizeCommandName(name: string): string {
  return name.trim().toLowerCase()
}

function commandNameFromFilename(filename: string): string {
  return filename.replace(/\.md$/i, '')
}

function summarizeCommand(content: string): string {
  const lines = content
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean)

  const firstMeaningfulLine = lines.find((line) => !line.startsWith('```'))
  if (!firstMeaningfulLine) return ''

  const normalized = firstMeaningfulLine.replace(/^#+\s*/, '').trim()
  return normalized.length > 120 ? `${normalized.slice(0, 120)}…` : normalized
}

function resolveCommandPath(name: string): string | null {
  const normalized = normalizeCommandName(name)
  if (!normalized) return null

  const matched = getCommandEntries().find(
    (entry) => normalizeCommandName(commandNameFromFilename(entry.name)) === normalized
  )

  if (!matched) return null
  return path.join(COMMANDS_DIR, matched.name)
}

export function registerCommandsHandlers(): void {
  ensureCommandsDir()

  ipcMain.handle('commands:list', async (): Promise<CommandInfo[]> => {
    try {
      return getCommandEntries()
        .map((entry) => {
          const fullPath = path.join(COMMANDS_DIR, entry.name)
          const content = fs.readFileSync(fullPath, 'utf-8')
          return {
            name: commandNameFromFilename(entry.name),
            summary: summarizeCommand(content)
          }
        })
        .sort((left, right) => left.name.localeCompare(right.name, undefined, { sensitivity: 'base' }))
    } catch {
      return []
    }
  })

  ipcMain.handle(
    'commands:load',
    async (
      _event,
      args: { name: string }
    ): Promise<
      { name: string; content: string; summary: string } | { error: string; notFound?: boolean }
    > => {
      try {
        const name = args?.name?.trim()
        if (!name) return { error: 'Command name is required' }

        const commandPath = resolveCommandPath(name)
        if (!commandPath) return { error: `Command "${name}" not found`, notFound: true }

        const content = fs.readFileSync(commandPath, 'utf-8').trim()
        if (!content) return { error: `Command "${name}" is empty` }

        return {
          name: commandNameFromFilename(path.basename(commandPath)),
          content,
          summary: summarizeCommand(content)
        }
      } catch (err) {
        return { error: String(err) }
      }
    }
  )
}
