export interface SystemCommandSnapshot {
  name: string
  content: string
}

export interface ParsedSlashCommandInput {
  commandName: string
  userText: string
}

export interface ParsedSystemCommandTag {
  command: SystemCommandSnapshot
  remainingText: string
}

const SYSTEM_COMMAND_TAG_RE = /<system-command\s+name=(['"])(.*?)\1>([\s\S]*?)<\/system-command>/i

function decodeAttribute(value: string): string {
  return value
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&amp;/g, '&')
}

function encodeAttribute(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
}

export function normalizeCommandName(name: string): string {
  return name.trim().toLowerCase()
}

export function parseSlashCommandInput(text: string): ParsedSlashCommandInput | null {
  const normalized = text.trimStart()
  if (!normalized.startsWith('/')) return null

  const match = normalized.match(/^\/([^\s/]+)(?:\s+([\s\S]*))?$/)
  if (!match) return null

  return {
    commandName: match[1].trim(),
    userText: match[2]?.trim() ?? ''
  }
}

export function serializeSystemCommand(command: SystemCommandSnapshot): string {
  return `<system-command name="${encodeAttribute(command.name)}">${command.content}</system-command>`
}

export function parseSystemCommandTag(text: string): ParsedSystemCommandTag | null {
  const match = SYSTEM_COMMAND_TAG_RE.exec(text)
  if (!match) return null

  const [fullMatch, , rawName, rawContent] = match
  const before = text.slice(0, match.index).trim()
  const after = text.slice(match.index + fullMatch.length).trim()
  const remainingParts = [before, after].filter(Boolean)

  return {
    command: {
      name: decodeAttribute(rawName.trim()),
      content: rawContent.trim()
    },
    remainingText: remainingParts.join('\n\n').trim()
  }
}

export function stripSystemCommandTag(text: string): string {
  return parseSystemCommandTag(text)?.remainingText ?? text
}
