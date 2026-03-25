import { ShieldCheck, ArrowRightLeft, FileWarning, GitBranchPlus } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import { Badge } from '@renderer/components/ui/badge'
import { Separator } from '@renderer/components/ui/separator'

export function AcpPanel(): React.JSX.Element {
  const { t } = useTranslation('layout')

  return (
    <div className="space-y-4 rounded-xl border bg-background/60 p-4">
      <div className="flex items-center gap-2">
        <ShieldCheck className="size-4 text-primary" />
        <h3 className="text-sm font-semibold">{t('rightPanel.acpTitle')}</h3>
        <Badge variant="secondary">ACP</Badge>
      </div>
      <p className="text-sm text-muted-foreground">{t('rightPanel.acpDesc')}</p>
      <Separator />
      <div className="space-y-3 rounded-lg border bg-muted/30 p-3 text-sm text-muted-foreground">
        <div className="flex items-start gap-2">
          <FileWarning className="mt-0.5 size-4 text-amber-500" />
          <p>{t('rightPanel.acpRuleNoCode')}</p>
        </div>
        <div className="flex items-start gap-2">
          <GitBranchPlus className="mt-0.5 size-4 text-cyan-500" />
          <p>{t('rightPanel.acpRuleDelegate')}</p>
        </div>
        <div className="flex items-start gap-2">
          <ArrowRightLeft className="mt-0.5 size-4 text-emerald-500" />
          <p>{t('rightPanel.acpRuleReport')}</p>
        </div>
      </div>
    </div>
  )
}
