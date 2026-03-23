import { MoreHorizontal, X } from 'lucide-react'
import { Button } from '@renderer/components/ui/button'
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
  onClose,
  t
}: Omit<RightPanelHeaderProps, 'visibleTabs' | 'onSelectTab'>): React.JSX.Element {
  return (
    <div className="flex h-10 shrink-0 items-center justify-between border-b border-border/50 bg-background px-4">
      <div className="flex items-center gap-2">
        <span className="text-sm font-semibold tracking-tight text-foreground/90">
          {t(`rightPanel.${activeTabDef.labelKey}`)}
        </span>
      </div>

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
