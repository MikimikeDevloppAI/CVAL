import { MapPin, Stethoscope, Briefcase } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from '@/components/ui/tooltip';

interface Assignment {
  site_nom?: string;
  medecin_nom?: string;
  besoin_operation_nom?: string;
  is_1r?: boolean;
  is_2f?: boolean;
  is_3f?: boolean;
  validated?: boolean;
}

interface SecretaireDayCellProps {
  date: string;
  matin?: Assignment[];
  apres_midi?: Assignment[];
  onClick?: () => void;
}

export function SecretaireDayCell({ date, matin = [], apres_midi = [], onClick }: SecretaireDayCellProps) {
  const hasMatinAssignment = matin && matin.length > 0;
  const hasAMAssignment = apres_midi && apres_midi.length > 0;
  const hasBothPeriods = hasMatinAssignment && hasAMAssignment;

  const renderPeriodContent = (assignments: Assignment[], isMorning: boolean) => {
    if (!assignments || assignments.length === 0) return null;

    const periodLabel = isMorning ? 'M' : 'AM';
    const periodColor = isMorning ? 'bg-blue-500/10' : 'bg-yellow-500/10';

    return (
      <div className={`flex-1 p-2 rounded ${periodColor}`}>
        <div className="flex items-center gap-1 mb-1">
          <div className={`w-2 h-2 rounded-full ${isMorning ? 'bg-blue-500' : 'bg-yellow-500'}`} />
          <span className="text-xs font-medium">{periodLabel}</span>
        </div>
        
        <div className="space-y-1">
          {assignments.map((assignment, idx) => (
            <div key={idx} className="space-y-0.5">
              {assignment.site_nom && (
                <div className="flex items-center gap-1 text-xs">
                  <MapPin className="h-3 w-3 text-muted-foreground" />
                  <span className="truncate">{assignment.site_nom}</span>
                </div>
              )}
              {assignment.medecin_nom && (
                <div className="flex items-center gap-1 text-xs">
                  <Stethoscope className="h-3 w-3 text-muted-foreground" />
                  <span className="truncate">{assignment.medecin_nom}</span>
                </div>
              )}
              {assignment.besoin_operation_nom && (
                <div className="flex items-center gap-1 text-xs">
                  <Briefcase className="h-3 w-3 text-muted-foreground" />
                  <span className="truncate">{assignment.besoin_operation_nom}</span>
                  {(assignment.is_1r || assignment.is_2f || assignment.is_3f) && (
                    <div className="flex gap-0.5">
                      {assignment.is_1r && <Badge variant="outline" className="text-[8px] px-1 py-0 h-3">1R</Badge>}
                      {assignment.is_2f && <Badge variant="outline" className="text-[8px] px-1 py-0 h-3">2F</Badge>}
                      {assignment.is_3f && <Badge variant="outline" className="text-[8px] px-1 py-0 h-3">3F</Badge>}
                    </div>
                  )}
                </div>
              )}
              {assignment.validated && (
                <Badge variant="outline" className="text-[8px] px-1 py-0 h-3 bg-green-500/10">
                  Validé
                </Badge>
              )}
            </div>
          ))}
        </div>
      </div>
    );
  };

  const getTooltipContent = () => {
    const content: string[] = [];
    
    if (hasMatinAssignment) {
      content.push('Matin:');
      matin.forEach(a => {
        if (a.site_nom) content.push(`  📍 ${a.site_nom}`);
        if (a.medecin_nom) content.push(`  🩺 ${a.medecin_nom}`);
        if (a.besoin_operation_nom) {
          const badges = [a.is_1r && '1R', a.is_2f && '2F', a.is_3f && '3F'].filter(Boolean).join(' ');
          content.push(`  💼 ${a.besoin_operation_nom}${badges ? ` (${badges})` : ''}`);
        }
      });
    }
    
    if (hasAMAssignment) {
      if (content.length > 0) content.push('');
      content.push('Après-midi:');
      apres_midi.forEach(a => {
        if (a.site_nom) content.push(`  📍 ${a.site_nom}`);
        if (a.medecin_nom) content.push(`  🩺 ${a.medecin_nom}`);
        if (a.besoin_operation_nom) {
          const badges = [a.is_1r && '1R', a.is_2f && '2F', a.is_3f && '3F'].filter(Boolean).join(' ');
          content.push(`  💼 ${a.besoin_operation_nom}${badges ? ` (${badges})` : ''}`);
        }
      });
    }
    
    return content.join('\n');
  };

  if (!hasMatinAssignment && !hasAMAssignment) {
    return (
      <div className="h-full min-h-[120px] bg-muted/20 rounded-lg border border-dashed border-muted-foreground/20 flex items-center justify-center">
        <span className="text-xs text-muted-foreground">-</span>
      </div>
    );
  }

  return (
    <TooltipProvider>
      <Tooltip>
        <TooltipTrigger asChild>
          <div
            onClick={onClick}
            className={`h-full min-h-[120px] rounded-lg border transition-all cursor-pointer hover:shadow-md ${
              hasBothPeriods
                ? 'bg-gradient-to-b from-blue-500/5 via-green-500/5 to-yellow-500/5 border-green-500/30'
                : hasMatinAssignment
                ? 'bg-blue-500/5 border-blue-500/30'
                : 'bg-yellow-500/5 border-yellow-500/30'
            }`}
          >
            <div className="p-2 h-full flex flex-col gap-2">
              {hasBothPeriods ? (
                <>
                  {renderPeriodContent(matin, true)}
                  {renderPeriodContent(apres_midi, false)}
                </>
              ) : hasMatinAssignment ? (
                renderPeriodContent(matin, true)
              ) : (
                renderPeriodContent(apres_midi, false)
              )}
            </div>
          </div>
        </TooltipTrigger>
        <TooltipContent side="top" className="max-w-xs whitespace-pre-line">
          {getTooltipContent()}
        </TooltipContent>
      </Tooltip>
    </TooltipProvider>
  );
}
