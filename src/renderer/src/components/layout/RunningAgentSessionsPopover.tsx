import { Brain, MessageSquareText, FolderKanban, ExternalLink } from 'lucide-react'
import { Button } from '@renderer/components/ui/button'
import { Popover, PopoverContent, PopoverTrigger } from '@renderer/components/ui/popover'
import { Tooltip, TooltipContent, TooltipTrigger } from '@renderer/components/ui/tooltip'
import { useAgentStore } from '@renderer/stores/agent-store'
import { useChatStore } from '@renderer/stores/chat-store'
import { useUIStore } from '@renderer/stores/ui-store'
import { useTranslation } from 'react-i18next'
import { useMemo } from 'react'

interface ProjectGroup {
  projectId: string
  projectName: string
  sessions: Array<{
    sessionId: string
    title: string
    taskCount: number
    updatedAt: number
    mode: string
    modelLabel?: string
  }>
  updatedAt: number
}

function formatTime(ts: number): string {
  try {
    return new Intl.DateTimeFormat(undefined, {
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit'
    }).format(ts)
  } catch {
    return String(ts)
  }
}

export function RunningAgentSessionsPopover(): React.JSX.Element | null {
  const { t } = useTranslation('layout')
  const sessions = useChatStore((s) => s.sessions)
  const projects = useChatStore((s) => s.projects)
  const activeSubAgents = useAgentStore((s) => s.activeSubAgents)

  const groups = useMemo<ProjectGroup[]>(() => {
    const projectMap = new Map(projects.map((project) => [project.id, project]))
    const sessionMap = new Map(sessions.map((session) => [session.id, session]))
    const sessionAgg = new Map<
      string,
      { sessionId: string; taskCount: number; updatedAt: number; title: string; mode: string; modelLabel?: string; projectId: string }
    >()

    for (const subAgent of Object.values(activeSubAgents)) {
      if (!subAgent.isRunning || !subAgent.sessionId) continue
      const session = sessionMap.get(subAgent.sessionId)
      if (!session?.projectId) continue
      const current = sessionAgg.get(session.id)
      sessionAgg.set(session.id, {
        sessionId: session.id,
        taskCount: (current?.taskCount ?? 0) + 1,
        updatedAt: Math.max(current?.updatedAt ?? 0, session.updatedAt ?? 0, subAgent.startedAt ?? 0),
        title: session.title,
        mode: session.mode,
        modelLabel: session.modelId,
        projectId: session.projectId
      })
    }

    const grouped = new Map<string, ProjectGroup>()
    for (const item of sessionAgg.values()) {
      const project = projectMap.get(item.projectId)
      const existing = grouped.get(item.projectId)
      const sessionEntry = {
        sessionId: item.sessionId,
        title: item.title,
        taskCount: item.taskCount,
        updatedAt: item.updatedAt,
        mode: item.mode,
        modelLabel: item.modelLabel
      }
      if (existing) {
        existing.sessions.push(sessionEntry)
        existing.updatedAt = Math.max(existing.updatedAt, item.updatedAt)
      } else {
        grouped.set(item.projectId, {
          projectId: item.projectId,
          projectName: project?.name ?? t('sidebar.unknownProject'),
          sessions: [sessionEntry],
          updatedAt: item.updatedAt
        })
      }
    }

    return Array.from(grouped.values())
      .map((group) => ({
        ...group,
        sessions: group.sessions.sort((a, b) => b.updatedAt - a.updatedAt)
      }))
      .sort((a, b) => b.updatedAt - a.updatedAt)
  }, [activeSubAgents, projects, sessions, t])

  const totalSessions = groups.reduce((sum, group) => sum + group.sessions.length, 0)
  const totalTasks = groups.reduce(
    (sum, group) => sum + group.sessions.reduce((inner, session) => inner + session.taskCount, 0),
    0
  )

  return (
    <Popover>
      <Tooltip>
        <TooltipTrigger asChild>
          <span className="inline-flex">
            <PopoverTrigger asChild>
              <Button variant="ghost" size="sm" className="titlebar-no-drag h-7 gap-1.5 px-2 text-[10px]">
                <Brain className="size-3.5 text-violet-500" />
                {t('topbar.runningSessionsCount', { count: totalSessions, tasks: totalTasks })}
              </Button>
            </PopoverTrigger>
          </span>
        </TooltipTrigger>
        <TooltipContent>{t('topbar.runningSessionsTooltip')}</TooltipContent>
      </Tooltip>
      <PopoverContent align="end" className="w-[28rem] p-2">
        <div className="mb-2 text-xs font-medium text-foreground/85">
          {t('topbar.runningSessionsTitle', { count: totalSessions, tasks: totalTasks })}
        </div>
        <div className="max-h-[26rem] space-y-2 overflow-y-auto">
          {groups.map((group) => (
            <div key={group.projectId} className="rounded-lg border bg-muted/20 p-2">
              <div className="mb-1 flex items-center gap-2 text-xs font-medium text-foreground">
                <FolderKanban className="size-3.5 text-muted-foreground" />
                <span className="truncate">{group.projectName}</span>
              </div>
              <div className="space-y-1">
                {group.sessions.map((session) => (
                  <div key={session.sessionId} className="rounded-md border bg-background px-2 py-1.5">
                    <div className="flex items-start justify-between gap-2">
                      <div className="min-w-0">
                        <div className="truncate text-[11px] font-medium text-foreground">
                          {session.title}
                        </div>
                        <div className="mt-0.5 flex flex-wrap items-center gap-1 text-[10px] text-muted-foreground">
                          <span>{session.mode}</span>
                          <span>·</span>
                          <span>{t('topbar.sessionTaskCount', { count: session.taskCount })}</span>
                          <span>·</span>
                          <span>{formatTime(session.updatedAt)}</span>
                          {session.modelLabel && (
                            <>
                              <span>·</span>
                              <span className="truncate">{session.modelLabel}</span>
                            </>
                          )}
                        </div>
                      </div>
                      <div className="flex shrink-0 items-center gap-1">
                        <Button
                          variant="ghost"
                          size="sm"
                          className="h-6 px-2 text-[10px]"
                          onClick={() => {
                            const chatState = useChatStore.getState()
                            const targetSession = chatState.sessions.find((item) => item.id === session.sessionId)
                            if (targetSession?.projectId) {
                              chatState.setActiveProject(targetSession.projectId)
                            }
                            chatState.setActiveSession(session.sessionId)
                            useUIStore.getState().navigateToSession()
                          }}
                        >
                          <ExternalLink className="mr-1 size-3" />
                          {t('topbar.openSession')}
                        </Button>
                        <Button
                          variant="ghost"
                          size="sm"
                          className="h-6 px-2 text-[10px]"
                          onClick={() => useUIStore.getState().openMiniSessionWindow(session.sessionId)}
                        >
                          <MessageSquareText className="mr-1 size-3" />
                          {t('topbar.openMiniWindow')}
                        </Button>
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          ))}
        </div>
      </PopoverContent>
    </Popover>
  )
}
