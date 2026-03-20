import * as React from 'react'

type AsyncLightHighlighter = React.ComponentType<Record<string, unknown>> & {
  registerLanguage?: (name: string, grammar: unknown) => void
}

interface HighlighterRuntime {
  Highlighter: AsyncLightHighlighter
  style: Record<string, React.CSSProperties>
}

const LANGUAGE_ALIASES: Record<string, string> = {
  ts: 'typescript',
  js: 'javascript',
  sh: 'bash',
  shell: 'bash',
  yml: 'yaml',
  md: 'markdown',
  html: 'markup',
  htm: 'markup',
  xml: 'markup',
  svg: 'markup',
  text: 'plaintext'
}

const LANGUAGE_LOADERS: Record<string, () => Promise<{ default: unknown }>> = {
  plaintext: async () => ({ default: {} }),
  typescript: () => import('react-syntax-highlighter/dist/esm/languages/prism/typescript'),
  javascript: () => import('react-syntax-highlighter/dist/esm/languages/prism/javascript'),
  python: () => import('react-syntax-highlighter/dist/esm/languages/prism/python'),
  bash: () => import('react-syntax-highlighter/dist/esm/languages/prism/bash'),
  json: () => import('react-syntax-highlighter/dist/esm/languages/prism/json'),
  css: () => import('react-syntax-highlighter/dist/esm/languages/prism/css'),
  scss: () => import('react-syntax-highlighter/dist/esm/languages/prism/scss'),
  less: () => import('react-syntax-highlighter/dist/esm/languages/prism/less'),
  jsx: () => import('react-syntax-highlighter/dist/esm/languages/prism/jsx'),
  tsx: () => import('react-syntax-highlighter/dist/esm/languages/prism/tsx'),
  markdown: () => import('react-syntax-highlighter/dist/esm/languages/prism/markdown'),
  yaml: () => import('react-syntax-highlighter/dist/esm/languages/prism/yaml'),
  rust: () => import('react-syntax-highlighter/dist/esm/languages/prism/rust'),
  go: () => import('react-syntax-highlighter/dist/esm/languages/prism/go'),
  sql: () => import('react-syntax-highlighter/dist/esm/languages/prism/sql'),
  graphql: () => import('react-syntax-highlighter/dist/esm/languages/prism/graphql'),
  c: () => import('react-syntax-highlighter/dist/esm/languages/prism/c'),
  cpp: () => import('react-syntax-highlighter/dist/esm/languages/prism/cpp'),
  java: () => import('react-syntax-highlighter/dist/esm/languages/prism/java'),
  kotlin: () => import('react-syntax-highlighter/dist/esm/languages/prism/kotlin'),
  ruby: () => import('react-syntax-highlighter/dist/esm/languages/prism/ruby'),
  php: () => import('react-syntax-highlighter/dist/esm/languages/prism/php'),
  swift: () => import('react-syntax-highlighter/dist/esm/languages/prism/swift'),
  docker: () => import('react-syntax-highlighter/dist/esm/languages/prism/docker'),
  makefile: () => import('react-syntax-highlighter/dist/esm/languages/prism/makefile'),
  r: () => import('react-syntax-highlighter/dist/esm/languages/prism/r'),
  lua: () => import('react-syntax-highlighter/dist/esm/languages/prism/lua'),
  dart: () => import('react-syntax-highlighter/dist/esm/languages/prism/dart'),
  toml: () => import('react-syntax-highlighter/dist/esm/languages/prism/toml'),
  ini: () => import('react-syntax-highlighter/dist/esm/languages/prism/ini'),
  markup: () => import('react-syntax-highlighter/dist/esm/languages/prism/markup')
}

let runtimePromise: Promise<HighlighterRuntime> | null = null
const loadedLanguages = new Set<string>()
const loadingLanguages = new Map<string, Promise<void>>()

function normalizeLanguage(language?: string): string {
  if (!language) return 'plaintext'
  const normalized = language.toLowerCase().trim()
  return LANGUAGE_ALIASES[normalized] ?? normalized
}

async function ensureRuntime(): Promise<HighlighterRuntime> {
  if (runtimePromise) return runtimePromise
  runtimePromise = Promise.all([
    import('react-syntax-highlighter/dist/esm/prism-async-light'),
    import('react-syntax-highlighter/dist/esm/styles/prism')
  ]).then(([highlighterMod, styleMod]) => ({
    Highlighter: highlighterMod.default as unknown as AsyncLightHighlighter,
    style: styleMod.oneDark
  }))
  return runtimePromise
}

async function ensureLanguageLoaded(language: string): Promise<void> {
  if (loadedLanguages.has(language)) return
  if (loadingLanguages.has(language)) {
    await loadingLanguages.get(language)
    return
  }

  const load = async (): Promise<void> => {
    const loader = LANGUAGE_LOADERS[language]
    if (!loader) return
    const runtime = await ensureRuntime()
    if (loadedLanguages.has(language)) return
    const languageModule = await loader()
    runtime.Highlighter.registerLanguage?.(language, languageModule.default)
    loadedLanguages.add(language)
  }

  const promise = load()
    .catch(() => {})
    .finally(() => loadingLanguages.delete(language))

  loadingLanguages.set(language, promise)
  await promise
}

type LazySyntaxHighlighterProps = Record<string, unknown> & {
  language?: string
  children: string
}

export function LazySyntaxHighlighter({
  language,
  children,
  ...rest
}: LazySyntaxHighlighterProps): React.JSX.Element {
  const [runtime, setRuntime] = React.useState<HighlighterRuntime | null>(null)
  const normalizedLanguage = normalizeLanguage(language)

  React.useEffect(() => {
    let cancelled = false
    ensureRuntime().then((loaded) => {
      if (!cancelled) setRuntime(loaded)
    })
    return () => {
      cancelled = true
    }
  }, [])

  React.useEffect(() => {
    if (!runtime) return
    void ensureLanguageLoaded(normalizedLanguage)
  }, [runtime, normalizedLanguage])

  if (!runtime) {
    return (
      <pre className="overflow-auto whitespace-pre-wrap break-words text-xs font-mono">
        {children}
      </pre>
    )
  }

  const Highlighter = runtime.Highlighter
  return (
    <Highlighter language={normalizedLanguage} style={runtime.style} {...rest}>
      {children}
    </Highlighter>
  )
}
