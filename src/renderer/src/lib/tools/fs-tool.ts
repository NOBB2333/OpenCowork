import { toolRegistry } from '../agent/tool-registry'
import { joinFsPath } from '../agent/memory-files'
import { IPC } from '../ipc/channels'
import { encodeStructuredToolResult, encodeToolError } from './tool-result-format'
import type { ToolHandler, ToolContext } from './tool-types'

type EolStyle = '\n' | '\r\n' | null
type EditMatchMode =
  | 'exact'
  | 'line_endings'
  | 'trailing_whitespace'
  | 'indentation'
  | 'mixed'
  | 'quote_normalized'

interface EditLineBlockMatch {
  startLine: number
  endLine: number
  commonIndent: string
}

interface ParsedPatchHunk {
  oldStart: number
  oldCount: number
  newStart: number
  newCount: number
  oldLines: string[]
  newLines: string[]
}

function detectEolStyle(str: string): EolStyle {
  if (str.includes('\r\n')) return '\r\n'
  if (str.includes('\n')) return '\n'
  return null
}

function normalizeToLf(str: string): string {
  return str.replace(/\r\n/g, '\n')
}

function applyEolStyle(str: string, style: EolStyle): string {
  if (!style) return str
  const normalized = normalizeToLf(str)
  return style === '\n' ? normalized : normalized.replace(/\n/g, '\r\n')
}

function splitLfLines(str: string): string[] {
  return normalizeToLf(str).split('\n')
}

function trimLineTrailingWhitespace(line: string): string {
  return line.replace(/[ \t]+$/g, '')
}

function getLeadingWhitespace(line: string): string {
  const match = line.match(/^[\t ]*/)
  return match ? match[0] : ''
}

function getCommonIndent(lines: string[]): string {
  let commonIndent: string | null = null
  for (const line of lines) {
    if (line.trim().length === 0) continue
    const indent = getLeadingWhitespace(line)
    if (commonIndent === null) {
      commonIndent = indent
      continue
    }
    let sharedLength = 0
    const limit = Math.min(commonIndent.length, indent.length)
    while (sharedLength < limit && commonIndent[sharedLength] === indent[sharedLength]) {
      sharedLength += 1
    }
    commonIndent = commonIndent.slice(0, sharedLength)
    if (!commonIndent) break
  }
  return commonIndent ?? ''
}

function stripCommonIndent(lines: string[]): string[] {
  const commonIndent = getCommonIndent(lines)
  if (!commonIndent) return [...lines]
  return lines.map((line) =>
    line.startsWith(commonIndent) ? line.slice(commonIndent.length) : line
  )
}

function applyCommonIndent(lines: string[], indent: string): string[] {
  if (!indent) return [...lines]
  return lines.map((line) => (line.length > 0 ? `${indent}${line}` : line))
}

function buildOldStringVariants(
  oldStr: string,
  fileContent: string
): Array<{ text: string; eol: EolStyle }> {
  const variants: Array<{ text: string; eol: EolStyle }> = [
    { text: oldStr, eol: detectEolStyle(oldStr) }
  ]
  const fileHasCrlf = fileContent.includes('\r\n')
  const fileHasOnlyLf = !fileHasCrlf

  if (oldStr.includes('\n') && !oldStr.includes('\r') && fileHasCrlf) {
    variants.push({ text: oldStr.replace(/\n/g, '\r\n'), eol: '\r\n' })
  } else if (oldStr.includes('\r\n') && fileHasOnlyLf) {
    variants.push({ text: oldStr.replace(/\r\n/g, '\n'), eol: '\n' })
  }

  return variants
}

function countOccurrences(content: string, value: string): number {
  if (!value) return 0
  return content.split(value).length - 1
}

function findNormalizedLineBlockMatches(
  content: string,
  oldStr: string,
  mode: 'trailing_whitespace' | 'indentation'
): EditLineBlockMatch[] {
  const contentLines = splitLfLines(content)
  const oldLines = splitLfLines(oldStr)
  if (oldLines.length === 0 || contentLines.length < oldLines.length) return []

  const normalizedOldLines =
    mode === 'indentation'
      ? stripCommonIndent(oldLines).map(trimLineTrailingWhitespace)
      : oldLines.map(trimLineTrailingWhitespace)

  const matches: EditLineBlockMatch[] = []
  for (let startLine = 0; startLine <= contentLines.length - oldLines.length; startLine += 1) {
    const slice = contentLines.slice(startLine, startLine + oldLines.length)
    const normalizedSlice =
      mode === 'indentation'
        ? stripCommonIndent(slice).map(trimLineTrailingWhitespace)
        : slice.map(trimLineTrailingWhitespace)

    if (normalizedSlice.every((line, index) => line === normalizedOldLines[index])) {
      matches.push({
        startLine,
        endLine: startLine + oldLines.length - 1,
        commonIndent: getCommonIndent(slice)
      })
    }
  }

  return matches
}

function selectNonOverlappingLineMatches(matches: EditLineBlockMatch[]): EditLineBlockMatch[] {
  const selected: EditLineBlockMatch[] = []
  let lastEndLine = -1

  for (const match of matches) {
    if (match.startLine <= lastEndLine) continue
    selected.push(match)
    lastEndLine = match.endLine
  }

  return selected
}

function applyNormalizedLineBlockMatches(
  content: string,
  newStr: string,
  matches: EditLineBlockMatch[],
  mode: 'trailing_whitespace' | 'indentation'
): string {
  const contentLines = splitLfLines(content)
  const newLines = splitLfLines(newStr)
  const baseReplacementLines = mode === 'indentation' ? stripCommonIndent(newLines) : [...newLines]
  const eol = detectEolStyle(content) ?? detectEolStyle(newStr) ?? '\n'
  const result: string[] = []
  let cursor = 0

  for (const match of matches) {
    result.push(...contentLines.slice(cursor, match.startLine))
    const replacementLines =
      mode === 'indentation'
        ? applyCommonIndent(baseReplacementLines, match.commonIndent)
        : baseReplacementLines
    result.push(...replacementLines)
    cursor = match.endLine + 1
  }

  result.push(...contentLines.slice(cursor))
  return applyEolStyle(result.join('\n'), eol)
}

function normalizeReadHistoryPath(filePath: string): string {
  return filePath.replace(/\\/g, '/').toLowerCase()
}

function recordRead(ctx: ToolContext, filePath: string): void {
  if (!ctx.readFileHistory) ctx.readFileHistory = new Map<string, number>()
  ctx.readFileHistory.set(normalizeReadHistoryPath(filePath), Date.now())
}

function buildEditNotFoundMessage(content: string, oldStr: string): string {
  const normalizedContent = normalizeToLf(content)
  const normalizedOld = normalizeToLf(oldStr)

  if (normalizedContent.includes(normalizedOld)) {
    return 'old_string not found in file (line endings differ; use the exact text from Read output)'
  }

  const trailingWhitespaceMatches = findNormalizedLineBlockMatches(
    content,
    oldStr,
    'trailing_whitespace'
  )
  if (trailingWhitespaceMatches.length === 1) {
    return `old_string not found in file (trailing whitespace differs near line ${trailingWhitespaceMatches[0].startLine + 1}; use the exact text from Read output)`
  }
  if (trailingWhitespaceMatches.length > 1) {
    return `old_string not found in file (multiple matches found after trailing whitespace normalization: ${trailingWhitespaceMatches.length}; provide more surrounding context)`
  }

  const indentationMatches = findNormalizedLineBlockMatches(content, oldStr, 'indentation')
  if (indentationMatches.length === 1) {
    return `old_string not found in file (indentation differs near line ${indentationMatches[0].startLine + 1}; use the exact text from Read output)`
  }
  if (indentationMatches.length > 1) {
    return `old_string not found in file (multiple matches found after indentation normalization: ${indentationMatches.length}; provide more surrounding context)`
  }

  const probeLine = normalizedOld
    .split('\n')
    .map((line) => line.trim())
    .find((line) => line.length > 0)

  if (probeLine) {
    const lines = normalizedContent.split('\n')
    const index = lines.findIndex((line) => line.includes(probeLine))
    if (index >= 0) {
      return `old_string not found in file (closest match near line ${index + 1}; ensure indentation and context match Read output exactly)`
    }
  }

  return 'old_string not found in file'
}

// ── Quote normalization (ported from Claude Code) ──

const LEFT_SINGLE_CURLY_QUOTE = '\u2018'
const RIGHT_SINGLE_CURLY_QUOTE = '\u2019'
const LEFT_DOUBLE_CURLY_QUOTE = '\u201C'
const RIGHT_DOUBLE_CURLY_QUOTE = '\u201D'

function normalizeQuotes(str: string): string {
  return str
    .replaceAll(LEFT_SINGLE_CURLY_QUOTE, "'")
    .replaceAll(RIGHT_SINGLE_CURLY_QUOTE, "'")
    .replaceAll(LEFT_DOUBLE_CURLY_QUOTE, '"')
    .replaceAll(RIGHT_DOUBLE_CURLY_QUOTE, '"')
}

function findActualString(fileContent: string, searchString: string): string | null {
  if (fileContent.includes(searchString)) return searchString

  const normalizedSearch = normalizeQuotes(searchString)
  const normalizedFile = normalizeQuotes(fileContent)
  const searchIndex = normalizedFile.indexOf(normalizedSearch)
  if (searchIndex !== -1) {
    return fileContent.substring(searchIndex, searchIndex + searchString.length)
  }
  return null
}

function isOpeningContext(chars: string[], index: number): boolean {
  if (index === 0) return true
  const prev = chars[index - 1]
  return (
    prev === ' ' ||
    prev === '\t' ||
    prev === '\n' ||
    prev === '\r' ||
    prev === '(' ||
    prev === '[' ||
    prev === '{' ||
    prev === '\u2014' ||
    prev === '\u2013'
  )
}

function applyCurlyDoubleQuotes(str: string): string {
  const chars = [...str]
  const result: string[] = []
  for (let i = 0; i < chars.length; i++) {
    if (chars[i] === '"') {
      result.push(isOpeningContext(chars, i) ? LEFT_DOUBLE_CURLY_QUOTE : RIGHT_DOUBLE_CURLY_QUOTE)
    } else {
      result.push(chars[i])
    }
  }
  return result.join('')
}

function applyCurlySingleQuotes(str: string): string {
  const chars = [...str]
  const result: string[] = []
  for (let i = 0; i < chars.length; i++) {
    if (chars[i] === "'") {
      const prev = i > 0 ? chars[i - 1] : undefined
      const next = i < chars.length - 1 ? chars[i + 1] : undefined
      const prevIsLetter = prev !== undefined && /\p{L}/u.test(prev)
      const nextIsLetter = next !== undefined && /\p{L}/u.test(next)
      if (prevIsLetter && nextIsLetter) {
        result.push(RIGHT_SINGLE_CURLY_QUOTE)
      } else {
        result.push(
          isOpeningContext(chars, i) ? LEFT_SINGLE_CURLY_QUOTE : RIGHT_SINGLE_CURLY_QUOTE
        )
      }
    } else {
      result.push(chars[i])
    }
  }
  return result.join('')
}

function preserveQuoteStyle(
  oldString: string,
  actualOldString: string,
  newString: string
): string {
  if (oldString === actualOldString) return newString

  const hasDoubleQuotes =
    actualOldString.includes(LEFT_DOUBLE_CURLY_QUOTE) ||
    actualOldString.includes(RIGHT_DOUBLE_CURLY_QUOTE)
  const hasSingleQuotes =
    actualOldString.includes(LEFT_SINGLE_CURLY_QUOTE) ||
    actualOldString.includes(RIGHT_SINGLE_CURLY_QUOTE)

  if (!hasDoubleQuotes && !hasSingleQuotes) return newString

  let result = newString
  if (hasDoubleQuotes) result = applyCurlyDoubleQuotes(result)
  if (hasSingleQuotes) result = applyCurlySingleQuotes(result)
  return result
}

// ── Desanitization (handles API-sanitized XML tags) ──

const DESANITIZATIONS: Record<string, string> = {
  '<fnr>': '<function_results>',
  '<n>': '<name>',
  '</n>': '</name>',
  '<o>': '<output>',
  '</o>': '</output>',
  '<e>': '<error>',
  '</e>': '</error>',
  '<s>': '<system>',
  '</s>': '</system>',
  '<r>': '<result>',
  '</r>': '</result>',
  '\n\nH:': '\n\nHuman:',
  '\n\nA:': '\n\nAssistant:'
}

function desanitizeMatchString(
  matchString: string
): { result: string; appliedReplacements: Array<{ from: string; to: string }> } {
  let result = matchString
  const appliedReplacements: Array<{ from: string; to: string }> = []
  for (const [from, to] of Object.entries(DESANITIZATIONS)) {
    const before = result
    result = result.replaceAll(from, to)
    if (before !== result) {
      appliedReplacements.push({ from, to })
    }
  }
  return { result, appliedReplacements }
}

function stripTrailingWhitespaceLines(str: string): string {
  return str
    .split(/(\r\n|\n|\r)/)
    .map((part, i) => (i % 2 === 0 ? part.replace(/\s+$/, '') : part))
    .join('')
}

/**
 * Detect and strip line number prefixes from Read tool output.
 * Read output format: "  <lineNo>\t<content>" per line.
 * Returns stripped string if prefixes detected on all non-empty lines, null otherwise.
 */
function stripLineNumberPrefixes(str: string): string | null {
  const lines = str.split('\n')
  if (lines.length === 0) return null

  const pattern = /^\s*\d+\t/
  const nonEmptyLines = lines.filter((l) => l.length > 0)
  if (nonEmptyLines.length === 0) return null
  if (!nonEmptyLines.every((l) => pattern.test(l))) return null

  return lines
    .map((line) => {
      if (line.length === 0) return line
      const tabIndex = line.indexOf('\t')
      return tabIndex >= 0 ? line.slice(tabIndex + 1) : line
    })
    .join('\n')
}

function stripPatchHeader(diff: string): string[] {
  return normalizeToLf(diff)
    .split('\n')
    .filter((line) => !line.startsWith('diff --git ') && !line.startsWith('index '))
}

function parseUnifiedDiff(diff: string): ParsedPatchHunk[] {
  const lines = stripPatchHeader(diff)
  const hunks: ParsedPatchHunk[] = []
  let index = 0

  while (index < lines.length) {
    const line = lines[index]
    if (line.startsWith('--- ') || line.startsWith('+++ ')) {
      index += 1
      continue
    }

    const headerMatch = line.match(/^@@ -(\d+)(?:,(\d+))? \+(\d+)(?:,(\d+))? @@/)
    if (!headerMatch) {
      index += 1
      continue
    }

    const hunk: ParsedPatchHunk = {
      oldStart: Number(headerMatch[1]),
      oldCount: Number(headerMatch[2] ?? 1),
      newStart: Number(headerMatch[3]),
      newCount: Number(headerMatch[4] ?? 1),
      oldLines: [],
      newLines: []
    }
    index += 1

    while (index < lines.length) {
      const current = lines[index]
      if (current.startsWith('@@ ')) break
      if (current.startsWith('--- ') || current.startsWith('+++ ')) break
      if (current === '\\ No newline at end of file') {
        index += 1
        continue
      }
      if (current.length === 0) {
        hunk.oldLines.push('')
        hunk.newLines.push('')
        index += 1
        continue
      }

      const marker = current[0]
      const text = current.slice(1)
      if (marker === ' ' || marker === '-') {
        hunk.oldLines.push(text)
      }
      if (marker === ' ' || marker === '+') {
        hunk.newLines.push(text)
      }
      if (![' ', '+', '-'].includes(marker)) {
        throw new Error(`Invalid unified diff line: ${current}`)
      }
      index += 1
    }

    hunks.push(hunk)
  }

  if (hunks.length === 0) {
    const hasHunkHeader = normalizeToLf(diff).includes('@@ ')
    const hasDiffMarkers = /^[+-]/m.test(normalizeToLf(diff))
    if (!hasHunkHeader && !hasDiffMarkers) {
      throw new Error(
        'patch does not appear to be a unified diff (no @@ hunk headers or +/- markers found). Use the Edit tool for plain text replacements instead of PatchEdit.'
      )
    }
    throw new Error(
      'patch must contain at least one valid unified diff hunk (expected @@ -N,N +N,N @@ header). Check that the diff format is correct.'
    )
  }

  return hunks
}

function applyPatchEdit(
  content: string,
  patch: string
): {
  updated: string
  matchMode: EditMatchMode
  hunkCount: number
} {
  const hunks = parseUnifiedDiff(patch)
  const contentLines = splitLfLines(content)
  const eol = detectEolStyle(content) ?? '\n'
  const result: string[] = []
  let cursor = 0
  let matchMode: EditMatchMode = 'exact'

  for (const hunk of hunks) {
    const oldExact = hunk.oldLines.join('\n')
    const oldNormalized = oldExact
      .split('\n')
      .map(trimLineTrailingWhitespace)
      .join('\n')
    const expectedIndex = Math.max(0, hunk.oldStart - 1)
    let matchedIndex = -1
    let currentMode: EditMatchMode = 'exact'

    for (let start = cursor; start <= contentLines.length - hunk.oldLines.length; start += 1) {
      const slice = contentLines.slice(start, start + hunk.oldLines.length)
      const exact = slice.every((line, lineIndex) => line === hunk.oldLines[lineIndex])
      if (exact) {
        matchedIndex = start
        currentMode = start === expectedIndex ? 'exact' : 'mixed'
        break
      }

      const normalized = slice.map(trimLineTrailingWhitespace).join('\n')
      if (normalized === oldNormalized) {
        matchedIndex = start
        currentMode = 'trailing_whitespace'
        break
      }
    }

    if (matchedIndex < 0) {
      throw new Error(
        `patch hunk not found in file near line ${hunk.oldStart}; ensure unified diff context matches current file contents`
      )
    }

    result.push(...contentLines.slice(cursor, matchedIndex))
    result.push(...hunk.newLines)
    cursor = matchedIndex + hunk.oldLines.length
    if (matchMode === 'exact') {
      matchMode = currentMode
    } else if (matchMode !== currentMode) {
      matchMode = 'mixed'
    }
  }

  result.push(...contentLines.slice(cursor))
  return {
    updated: applyEolStyle(result.join('\n'), eol),
    matchMode,
    hunkCount: hunks.length
  }
}

// ── SSH routing helper ──

function isSsh(ctx: ToolContext): boolean {
  return !!ctx.sshConnectionId
}

function sshArgs(ctx: ToolContext, extra: Record<string, unknown>): Record<string, unknown> {
  return { connectionId: ctx.sshConnectionId, ...extra }
}

function buildChangeMeta(
  ctx: ToolContext,
  toolName: 'Write' | 'Edit' | 'PatchEdit'
): Record<string, unknown> | undefined {
  if (!ctx.agentRunId) return undefined
  return {
    runId: ctx.agentRunId,
    sessionId: ctx.sessionId,
    toolUseId: ctx.currentToolUseId,
    toolName
  }
}

function localWriteArgs(
  ctx: ToolContext,
  path: string,
  content: string,
  toolName: 'Write' | 'Edit' | 'PatchEdit'
): Record<string, unknown> {
  return {
    path,
    content,
    ...(buildChangeMeta(ctx, toolName) ? { changeMeta: buildChangeMeta(ctx, toolName) } : {})
  }
}

function sshWriteArgs(
  ctx: ToolContext,
  path: string,
  content: string,
  toolName: 'Write' | 'Edit' | 'PatchEdit'
): Record<string, unknown> {
  return sshArgs(ctx, {
    path,
    content,
    ...(buildChangeMeta(ctx, toolName) ? { changeMeta: buildChangeMeta(ctx, toolName) } : {})
  })
}

// ── Plugin path permission helpers ──

function normalizePath(p: string): string {
  let normalized = p.replace(/\\/g, '/').replace(/\/+/g, '/').replace(/\/$/, '')
  if (/^[a-zA-Z]:/.test(normalized)) normalized = normalized.toLowerCase()
  return normalized
}

export function isAbsolutePath(p: string): boolean {
  if (!p) return false
  if (p.startsWith('/') || p.startsWith('\\')) return true
  return /^[a-zA-Z]:[\\/]/.test(p)
}

export function resolveToolPath(inputPath: unknown, workingFolder?: string): string {
  const raw = typeof inputPath === 'string' ? inputPath.trim() : ''
  const base = workingFolder?.trim()
  if (!raw || raw === '.') {
    return base && base.length > 0 ? base : '.'
  }
  if (isAbsolutePath(raw)) return raw
  if (base && base.length > 0) return joinFsPath(base, raw)
  return raw
}

function isPluginPathAllowed(
  targetPath: string | undefined,
  ctx: ToolContext,
  mode: 'read' | 'write'
): boolean {
  const perms = ctx.channelPermissions
  if (!perms) return true // No plugin context — defer to normal approval logic

  if (!targetPath) return mode === 'read'
  const normalized = normalizePath(targetPath)
  const normalizedWorkDir = ctx.workingFolder ? normalizePath(ctx.workingFolder) : ''
  const normalizedHome = ctx.channelHomedir ? normalizePath(ctx.channelHomedir) : ''

  // Always allow access within plugin working directory
  if (normalizedWorkDir && (normalized + '/').startsWith(normalizedWorkDir + '/')) return true

  const homePrefix = normalizedHome.length > 0 ? normalizedHome + '/' : ''
  const isUnderHome = homePrefix.length > 0 && (normalized + '/').startsWith(homePrefix)

  if (mode === 'read') {
    if (!isUnderHome) return true
    if (perms.allowReadHome) return true
    return perms.readablePathPrefixes.some((prefix) => {
      const np = normalizePath(prefix)
      return (normalized + '/').startsWith(np + '/')
    })
  }

  // Write mode
  if (isUnderHome && !perms.allowWriteOutside) return false
  return perms.allowWriteOutside
}

const readHandler: ToolHandler = {
  definition: {
    name: 'Read',
    description: 'Read a file from the filesystem',
    inputSchema: {
      type: 'object',
      properties: {
        file_path: {
          type: 'string',
          description: 'Absolute path or relative to the working folder'
        },
        offset: { type: 'number', description: 'Start line (1-indexed)' },
        limit: { type: 'number', description: 'Number of lines to read' }
      },
      required: ['file_path']
    }
  },
  execute: async (input, ctx) => {
    const resolvedPath = resolveToolPath(input.file_path, ctx.workingFolder)
    if (isSsh(ctx)) {
      const result = await ctx.ipc.invoke(
        IPC.SSH_FS_READ_FILE,
        sshArgs(ctx, {
          path: resolvedPath,
          offset: input.offset,
          limit: input.limit,
          raw: false
        })
      )
      if (isErrorResult(result)) throw new Error(`Read failed: ${result.error}`)
      recordRead(ctx, resolvedPath)
      return String(result)
    }
    const result = await ctx.ipc.invoke(IPC.FS_READ_FILE, {
      path: resolvedPath,
      offset: input.offset,
      limit: input.limit,
      raw: false
    })
    if (isErrorResult(result)) throw new Error(`Read failed: ${result.error}`)
    recordRead(ctx, resolvedPath)
    // IPC returns { type: 'image', mediaType, data } for image files
    if (
      result &&
      typeof result === 'object' &&
      (result as Record<string, unknown>).type === 'image'
    ) {
      const img = result as { mediaType: string; data: string }
      return [
        {
          type: 'image' as const,
          source: { type: 'base64' as const, mediaType: img.mediaType, data: img.data }
        }
      ]
    }
    return String(result)
  },
  requiresApproval: (input, ctx) => {
    // Plugin context: check read permission
    if (ctx.channelPermissions) {
      const filePath = resolveToolPath(input.file_path, ctx.workingFolder)
      return !isPluginPathAllowed(filePath, ctx, 'read')
    }
    return false
  }
}

const writeHandler: ToolHandler = {
  definition: {
    name: 'Write',
    description:
      "Writes a file to the local filesystem.\n\nUsage:\n- This tool will overwrite the existing file if there is one at the provided path.\n- If this is an existing file, you MUST use the Read tool first to read the file's contents. This tool will fail if you did not read the file first.\n- ALWAYS prefer editing existing files in the codebase. NEVER write new files unless explicitly required.\n- NEVER proactively create documentation files (*.md) or README files. Only create documentation files if explicitly requested by the User.\n- Only use emojis if the user explicitly requests it. Avoid writing emojis to files unless asked.",
    inputSchema: {
      type: 'object',
      properties: {
        file_path: {
          type: 'string',
          description: 'Absolute path or relative to the working folder'
        },
        content: { type: 'string', description: 'The content to write to the file' }
      },
      required: ['file_path', 'content']
    }
  },
  execute: async (input, ctx) => {
    if (typeof input.file_path !== 'string' || input.file_path.trim().length === 0) {
      throw new Error('Write requires a non-empty "file_path" string')
    }
    if (typeof input.content !== 'string') {
      throw new Error('Write requires a "content" string')
    }

    const resolvedPath = resolveToolPath(input.file_path, ctx.workingFolder)

    if (isSsh(ctx)) {
      const result = await ctx.ipc.invoke(
        IPC.SSH_FS_WRITE_FILE,
        sshWriteArgs(ctx, resolvedPath, input.content, 'Write')
      )
      if (isErrorResult(result)) throw new Error(`Write failed: ${result.error}`)
      return encodeStructuredToolResult({ success: true, path: resolvedPath })
    }
    const result = await ctx.ipc.invoke(
      IPC.FS_WRITE_FILE,
      localWriteArgs(ctx, resolvedPath, input.content, 'Write')
    )
    if (isErrorResult(result)) {
      throw new Error(`Write failed: ${result.error}`)
    }

    return encodeStructuredToolResult({ success: true, path: resolvedPath })
  },
  requiresApproval: (input, ctx) => {
    const filePath = resolveToolPath(input.file_path, ctx.workingFolder)
    // Plugin context: check write permission
    if (ctx.channelPermissions) {
      return !isPluginPathAllowed(filePath, ctx, 'write')
    }
    // Normal sessions: writing outside working folder requires approval
    if (!ctx.workingFolder) return true
    return !filePath.startsWith(ctx.workingFolder)
  }
}

const editHandler: ToolHandler = {
  definition: {
    name: 'Edit',
    description:
      'Performs exact string replacements in files. \n\nUsage:\n- When editing text from Read tool output, ensure you preserve the exact indentation (tabs/spaces) as it appears AFTER the line number prefix. The line number prefix format is: spaces + line number + tab. Everything after that tab is the actual file content to match. Never include any part of the line number prefix in the old_string or new_string.\n- ALWAYS prefer editing existing files in the codebase. NEVER write new files unless explicitly required.\n- Only use emojis if the user explicitly requests it. Avoid adding emojis to files unless asked.\n- The edit will FAIL if `old_string` is not unique in the file. Either provide a larger string with more surrounding context to make it unique or use `replace_all` to change every instance of `old_string`. \n- Use `replace_all` for replacing and renaming strings across the file. This parameter is useful if you want to rename a variable for instance.',
    inputSchema: {
      type: 'object',
      properties: {
        file_path: {
          type: 'string',
          description: 'Absolute path or relative to the working folder'
        },
        old_string: {
          type: 'string',
          description: 'The text to replace'
        },
        new_string: {
          type: 'string',
          description: 'The text to replace it with (must be different from old_string)'
        },
        replace_all: {
          type: 'boolean',
          description: 'Replace all occurences of old_string (default false)'
        }
      },
      required: ['file_path', 'old_string', 'new_string']
    }
  },
  execute: async (input, ctx) => {
    const resolvedPath = resolveToolPath(input.file_path, ctx.workingFolder)
    let oldStr = String(input.old_string ?? '')
    let newStr = String(input.new_string ?? '')
    const replaceAll = Boolean(input.replace_all)

    if (!oldStr) {
      return encodeToolError('old_string must be non-empty')
    }

    if (oldStr === newStr) {
      return encodeToolError('new_string must be different from old_string')
    }

    const readCh = isSsh(ctx) ? IPC.SSH_FS_READ_FILE : IPC.FS_READ_FILE
    const readArgs = isSsh(ctx)
      ? sshArgs(ctx, { path: resolvedPath })
      : { path: resolvedPath }
    const contentResult = await ctx.ipc.invoke(readCh, readArgs)
    if (isErrorResult(contentResult)) {
      return encodeToolError(`Read failed: ${contentResult.error}`)
    }

    const content = String(contentResult)

    // Strip trailing whitespace from new_string (except markdown where trailing
    // spaces are semantically meaningful as hard line breaks)
    const isMarkdown = /\.(md|mdx)$/i.test(resolvedPath)
    if (!isMarkdown) {
      newStr = stripTrailingWhitespaceLines(newStr)
    }

    // Try desanitization on old_string if exact match fails
    if (!content.includes(oldStr)) {
      const { result: desanitized, appliedReplacements } = desanitizeMatchString(oldStr)
      if (desanitized !== oldStr && content.includes(desanitized)) {
        oldStr = desanitized
        for (const { from, to } of appliedReplacements) {
          newStr = newStr.replaceAll(from, to)
        }
      }
    }

    // Strip line number prefixes from Read output (e.g. "  1\tcode here")
    if (!content.includes(oldStr)) {
      const strippedOld = stripLineNumberPrefixes(oldStr)
      if (strippedOld !== null) {
        const strippedNew = stripLineNumberPrefixes(newStr)
        oldStr = strippedOld
        if (strippedNew !== null) newStr = strippedNew
      }
    }

    const oldStringVariants = buildOldStringVariants(oldStr, content)
    const exactVariant = oldStringVariants.find(
      (variant) => variant.text.length > 0 && content.includes(variant.text)
    )

    let updated: string | null = null
    let matchMode: EditMatchMode | null = null

    if (exactVariant) {
      const replacementText = applyEolStyle(newStr, exactVariant.eol)
      const matchTarget = exactVariant.text
      // Smart trailing newline stripping: when deleting text (empty new_string),
      // auto-include the trailing newline to avoid leaving blank lines
      const useNewlineStrip =
        !replacementText &&
        !matchTarget.endsWith('\n') &&
        content.includes(matchTarget + '\n')
      const effectiveOld = useNewlineStrip ? matchTarget + '\n' : matchTarget
      const occurrences = countOccurrences(content, effectiveOld)
      if (!replaceAll && occurrences > 1) {
        return encodeToolError('old_string is not unique in file')
      }
      updated = replaceAll
        ? content.split(effectiveOld).join(replacementText)
        : content.replace(effectiveOld, replacementText)
      matchMode = exactVariant.text === oldStr ? 'exact' : 'line_endings'
    } else {
      // Tier 2: Quote normalization (curly quotes ↔ straight quotes)
      const actualOldString = findActualString(content, oldStr)
      if (actualOldString) {
        const actualNewString = preserveQuoteStyle(oldStr, actualOldString, newStr)
        const occurrences = countOccurrences(content, actualOldString)
        if (!replaceAll && occurrences > 1) {
          return encodeToolError('old_string is not unique in file')
        }
        const useNewlineStrip =
          !actualNewString &&
          !actualOldString.endsWith('\n') &&
          content.includes(actualOldString + '\n')
        const effectiveOld = useNewlineStrip ? actualOldString + '\n' : actualOldString
        updated = replaceAll
          ? content.split(effectiveOld).join(actualNewString)
          : content.replace(effectiveOld, actualNewString)
        matchMode = 'quote_normalized'
      } else {
        // Tier 3: Trailing whitespace normalization
        const trailingWhitespaceMatches = findNormalizedLineBlockMatches(
          content,
          oldStr,
          'trailing_whitespace'
        )
        if (trailingWhitespaceMatches.length > 0) {
          const selectedMatches = replaceAll
            ? selectNonOverlappingLineMatches(trailingWhitespaceMatches)
            : trailingWhitespaceMatches
          if (!replaceAll && trailingWhitespaceMatches.length > 1) {
            return encodeToolError(
              `old_string is not unique in file (multiple matches found after trailing whitespace normalization: ${trailingWhitespaceMatches.length})`
            )
          }
          updated = applyNormalizedLineBlockMatches(
            content,
            newStr,
            selectedMatches,
            'trailing_whitespace'
          )
          matchMode = 'trailing_whitespace'
        } else {
          // Tier 4: Indentation normalization
          const indentationMatches = findNormalizedLineBlockMatches(content, oldStr, 'indentation')
          if (indentationMatches.length > 0) {
            const selectedMatches = replaceAll
              ? selectNonOverlappingLineMatches(indentationMatches)
              : indentationMatches
            if (!replaceAll && indentationMatches.length > 1) {
              return encodeToolError(
                `old_string is not unique in file (multiple matches found after indentation normalization: ${indentationMatches.length})`
              )
            }
            updated = applyNormalizedLineBlockMatches(content, newStr, selectedMatches, 'indentation')
            matchMode = 'indentation'
          }
        }
      }
    }

    if (!updated || !matchMode) {
      return encodeToolError(buildEditNotFoundMessage(content, oldStr))
    }

    const writeCh = isSsh(ctx) ? IPC.SSH_FS_WRITE_FILE : IPC.FS_WRITE_FILE
    const writeArgs = isSsh(ctx)
      ? sshWriteArgs(ctx, resolvedPath, updated, 'Edit')
      : localWriteArgs(ctx, resolvedPath, updated, 'Edit')
    const writeResult = await ctx.ipc.invoke(writeCh, writeArgs)
    if (isErrorResult(writeResult)) {
      return encodeToolError(`Write failed: ${writeResult.error}`)
    }

    recordRead(ctx, resolvedPath)
    return encodeStructuredToolResult({
      success: true,
      path: resolvedPath,
      replaceAll,
      matchMode
    })
  },
  requiresApproval: (input, ctx) => {
    if (isSsh(ctx)) return false // SSH sessions: trust working folder
    const filePath = resolveToolPath(input.file_path, ctx.workingFolder)
    // Plugin context: check write permission
    if (ctx.channelPermissions) {
      return !isPluginPathAllowed(filePath, ctx, 'write')
    }
    if (!ctx.workingFolder) return true
    return !filePath.startsWith(ctx.workingFolder)
  }
}

const patchEditHandler: ToolHandler = {
  definition: {
    name: 'PatchEdit',
    description:
      'Apply a unified diff patch to an existing file. Use when you have a valid patch/hunk and exact Edit matching is too strict.',
    inputSchema: {
      type: 'object',
      properties: {
        file_path: {
          type: 'string',
          description: 'Absolute path or relative to the working folder'
        },
        patch: {
          type: 'string',
          description: 'Unified diff patch content for a single file'
        }
      },
      required: ['file_path', 'patch']
    }
  },
  execute: async (input, ctx) => {
    const resolvedPath = resolveToolPath(input.file_path, ctx.workingFolder)
    const patch = String(input.patch ?? '')
    if (!patch.trim()) {
      return encodeToolError('patch must be non-empty')
    }

    const readCh = isSsh(ctx) ? IPC.SSH_FS_READ_FILE : IPC.FS_READ_FILE
    const readArgs = isSsh(ctx)
      ? sshArgs(ctx, { path: resolvedPath })
      : { path: resolvedPath }
    const contentResult = await ctx.ipc.invoke(readCh, readArgs)
    if (isErrorResult(contentResult)) {
      return encodeToolError(`Read failed: ${contentResult.error}`)
    }

    const content = String(contentResult)
    let applied: { updated: string; matchMode: EditMatchMode; hunkCount: number }
    try {
      applied = applyPatchEdit(content, patch)
    } catch (error) {
      return encodeToolError(error instanceof Error ? error.message : String(error))
    }

    const writeCh = isSsh(ctx) ? IPC.SSH_FS_WRITE_FILE : IPC.FS_WRITE_FILE
    const writeArgs = isSsh(ctx)
      ? sshWriteArgs(ctx, resolvedPath, applied.updated, 'PatchEdit')
      : localWriteArgs(ctx, resolvedPath, applied.updated, 'PatchEdit')
    const writeResult = await ctx.ipc.invoke(writeCh, writeArgs)
    if (isErrorResult(writeResult)) {
      return encodeToolError(`Write failed: ${writeResult.error}`)
    }

    recordRead(ctx, resolvedPath)
    return encodeStructuredToolResult({
      success: true,
      path: resolvedPath,
      matchMode: applied.matchMode,
      hunkCount: applied.hunkCount
    })
  },
  requiresApproval: (input, ctx) => {
    if (isSsh(ctx)) return false
    const filePath = resolveToolPath(input.file_path, ctx.workingFolder)
    if (ctx.channelPermissions) {
      return !isPluginPathAllowed(filePath, ctx, 'write')
    }
    if (!ctx.workingFolder) return true
    return !filePath.startsWith(ctx.workingFolder)
  }
}

const lsHandler: ToolHandler = {
  definition: {
    name: 'LS',
    description: 'List files and directories in a given path',
    inputSchema: {
      type: 'object',
      properties: {
        path: { type: 'string', description: 'Absolute path or relative to the working folder' },
        ignore: {
          type: 'array',
          items: { type: 'string' },
          description: 'Glob patterns to ignore'
        }
      },
      required: []
    }
  },
  execute: async (input, ctx) => {
    const resolvedPath = resolveToolPath(input.path, ctx.workingFolder)
    if (isSsh(ctx)) {
      const result = await ctx.ipc.invoke(
        IPC.SSH_FS_LIST_DIR,
        sshArgs(ctx, {
          path: resolvedPath
        })
      )
      return encodeStructuredToolResult(
        result as Array<{ name: string; type: string; path: string }>
      )
    }
    const result = await ctx.ipc.invoke(IPC.FS_LIST_DIR, {
      path: resolvedPath,
      ignore: input.ignore
    })
    return encodeStructuredToolResult(result as Array<{ name: string; type: string; path: string }>)
  },
  requiresApproval: (input, ctx) => {
    if (ctx.channelPermissions) {
      const targetPath = resolveToolPath(input.path, ctx.workingFolder)
      return !isPluginPathAllowed(targetPath, ctx, 'read')
    }
    return false
  }
}

export function registerFsTools(): void {
  toolRegistry.register(readHandler)
  toolRegistry.register(writeHandler)
  toolRegistry.register(editHandler)
  toolRegistry.register(patchEditHandler)
  toolRegistry.register(lsHandler)
}

function isErrorResult(value: unknown): value is { error: string } {
  if (!value || typeof value !== 'object') return false
  const error = (value as { error?: unknown }).error
  return typeof error === 'string' && error.length > 0
}
