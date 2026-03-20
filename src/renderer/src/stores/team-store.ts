import { create } from 'zustand'
import { immer } from 'zustand/middleware/immer'
import { persist, createJSONStorage } from 'zustand/middleware'
import type { TeamMember, TeamTask, TeamMessage, TeamEvent } from '../lib/agent/teams/types'
import { ipcStorage } from '../lib/ipc/ipc-storage'

export interface ActiveTeam {
  name: string
  description: string
  sessionId?: string
  members: TeamMember[]
  tasks: TeamTask[]
  messages: TeamMessage[]
  createdAt: number
}

interface TeamStore {
  activeTeam: ActiveTeam | null
  /** Historical teams — persisted after team_end */
  teamHistory: ActiveTeam[]

  // Actions
  createTeam: (name: string, description: string) => void
  deleteTeam: () => void

  addMember: (member: TeamMember) => void
  updateMember: (id: string, patch: Partial<TeamMember>) => void
  removeMember: (id: string) => void

  addTask: (task: TeamTask) => void
  updateTask: (id: string, patch: Partial<TeamTask>) => void

  addMessage: (msg: TeamMessage) => void

  /** Unified event handler — called from use-chat-actions subscription */
  handleTeamEvent: (event: TeamEvent, sessionId?: string) => void

  /** Remove all team data that belongs to the given session */
  clearSessionTeam: (sessionId: string) => void

  /** Wipe all team data: active team + history */
  clearAll: () => void
}

export const useTeamStore = create<TeamStore>()(
  persist(
    immer((set) => ({
      activeTeam: null,
      teamHistory: [],

      createTeam: (name, description) =>
        set({
          activeTeam: {
            name,
            description,
            members: [],
            tasks: [],
            messages: [],
            createdAt: Date.now()
          }
        }),

      deleteTeam: () => set({ activeTeam: null }),

      addMember: (member) => {
        set((state) => {
          if (state.activeTeam) state.activeTeam.members.push(member)
        })
      },

      updateMember: (id, patch) => {
        set((state) => {
          if (!state.activeTeam) return
          const member = state.activeTeam.members.find((m) => m.id === id)
          if (member) Object.assign(member, patch)
        })
      },

      removeMember: (id) => {
        set((state) => {
          if (!state.activeTeam) return
          const idx = state.activeTeam.members.findIndex((m) => m.id === id)
          if (idx !== -1) state.activeTeam.members.splice(idx, 1)
        })
      },

      addTask: (task) => {
        set((state) => {
          if (state.activeTeam) state.activeTeam.tasks.push(task)
        })
      },

      updateTask: (id, patch) => {
        set((state) => {
          if (!state.activeTeam) return
          const task = state.activeTeam.tasks.find((t) => t.id === id)
          if (task) Object.assign(task, patch)
        })
      },

      addMessage: (msg) => {
        set((state) => {
          if (state.activeTeam) state.activeTeam.messages.push(msg)
        })
      },

      handleTeamEvent: (event, sessionId) => {
        set((state) => {
          switch (event.type) {
            case 'team_start':
              state.activeTeam = {
                name: event.teamName,
                description: event.description,
                sessionId,
                members: [],
                tasks: [],
                messages: [],
                createdAt: Date.now()
              }
              break
            case 'team_member_add':
              if (state.activeTeam) {
                // Guard: skip if a member with the same id or name already exists
                const dup = state.activeTeam.members.some(
                  (m) => m.id === event.member.id || m.name === event.member.name
                )
                if (!dup) state.activeTeam.members.push(event.member)
              }
              break
            case 'team_member_update': {
              if (!state.activeTeam) break
              const member = state.activeTeam.members.find((m) => m.id === event.memberId)
              if (member) Object.assign(member, event.patch)
              break
            }
            case 'team_member_remove': {
              if (!state.activeTeam) break
              const idx = state.activeTeam.members.findIndex((m) => m.id === event.memberId)
              if (idx !== -1) state.activeTeam.members.splice(idx, 1)
              break
            }
            case 'team_task_add':
              if (state.activeTeam) {
                // Guard: skip if a task with the same id already exists
                const dupTask = state.activeTeam.tasks.some((t) => t.id === event.task.id)
                if (!dupTask) state.activeTeam.tasks.push(event.task)
              }
              break
            case 'team_task_update': {
              if (!state.activeTeam) break
              const task = state.activeTeam.tasks.find((t) => t.id === event.taskId)
              if (task) {
                // Guard: never roll back a completed task to a non-completed status
                if (
                  task.status === 'completed' &&
                  event.patch.status &&
                  event.patch.status !== 'completed'
                ) {
                  break
                }
                Object.assign(task, event.patch)
              }
              break
            }
            case 'team_message':
              if (state.activeTeam) state.activeTeam.messages.push(event.message)
              break
            case 'team_end':
              if (state.activeTeam) {
                state.teamHistory.push({ ...state.activeTeam })
              }
              state.activeTeam = null
              break
          }
        })
      },
      clearSessionTeam: (sessionId) => {
        set((state) => {
          // Clear active team if it belongs to the session
          if (state.activeTeam?.sessionId === sessionId) {
            state.activeTeam = null
          }
          // Remove history entries belonging to the session
          state.teamHistory = state.teamHistory.filter((t) => t.sessionId !== sessionId)
        })
      },
      clearAll: () => {
        set((state) => {
          state.activeTeam = null
          state.teamHistory = []
        })
      }
    })),
    {
      name: 'opencowork-team',
      storage: createJSONStorage(() => ipcStorage),
      partialize: (state) => ({
        activeTeam: state.activeTeam,
        teamHistory: state.teamHistory
      })
    }
  )
)
