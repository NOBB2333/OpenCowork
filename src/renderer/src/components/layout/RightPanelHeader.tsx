import { ChevronDown, MoreHorizontal, X } from 'lucide-react'
import { Button } from '@renderer/components/ui/button'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger
} from '@renderer/components/ui/dropdown-menu'
import type { RightPanelTab } from '@renderer/stores/ui-store'
import type { RightPanelTabDef } from './right-panel-defs'

interface RightPanelHeaderProps {
  activeTabDef: RightPanelTabDef
  visibleTabs: RightPanelTabDef[]
  onSelectTab: (tab: RightPanelTab) => void
  onClose: () => void
  t: (key: string, options?: { defaultValue?: string }) => string
}

export function RightPanelHeader({
  activeTabDef,
  visibleTabs,
  onSelectTab,
  onClose,
  t
}: RightPanelHeaderProps): React.JSX.Element {
  const ActiveTabIcon = activeTabDef.icon

  return (
    <div className="flex h-10 shrink-0 items-center justify-between border-b border-border/50 bg-background px-3">
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button
            variant="ghost"
            size="sm"
            className="flex h-7 items-center gap-2 px-2 text-sm font-medium hover:bg-muted/50"
          >
            <ActiveTabIcon className="size-4 text-muted-foreground" />
            <span className="text-foreground">{t(`rightPanel.${activeTabDef.labelKey}`)}</span>
            <ChevronDown className="size-3.5 text-muted-foreground" />
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="start" className="w-48">
          {visibleTabs.map((tabDef) => {
            const TabIcon = tabDef.icon
            const isActive = tabDef.value === activeTabDef.value
            return (
              <DropdownMenuItem
                key={tabDef.value}
                onClick={() => onSelectTab(tabDef.value)}
                className="flex items-center gap-2"
              >
                <TabIcon className="size-4 text-muted-foreground" />
                <span className={isActive ? 'font-medium' : ''}>
                  {t(`rightPanel.${tabDef.labelKey}`)}
                </span>
              </DropdownMenuItem>
            )
          })}
        </DropdownMenuContent>
      </DropdownMenu>

      <div className="flex items-center gap-0.5">
        <Button
          variant="ghost"
          size="icon"
          className="size-6 rounded-md text-muted-foreground hover:bg-muted/50 hover:text-foreground"
          title={t('rightPanelAction.moreOptions', { defaultValue: '更多选项' })}
        >
          <MoreHorizontal className="size-3.5" />
        </Button>
        <Button
          variant="ghost"
          size="icon"
          className="size-6 rounded-md text-muted-foreground hover:bg-muted/50 hover:text-destructive"
          onClick={onClose}
          title={t('rightPanelAction.closePanel', { defaultValue: '关闭面板' })}
        >
          <X className="size-3.5" />
        </Button>
      </div>
    </div>
  )
}
