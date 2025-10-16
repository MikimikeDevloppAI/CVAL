import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { AlertCircle, Building2, Scissors, UserPlus } from 'lucide-react';
import { format } from 'date-fns';
import { fr } from 'date-fns/locale';
import { useState, useEffect } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { Separator } from '@/components/ui/separator';
import { AssignToUnsatisfiedNeedDialog } from './AssignToUnsatisfiedNeedDialog';

interface UnsatisfiedNeedsReportProps {
  startDate: Date;
  endDate: Date;
}

interface MissingNeed {
  date: string;
  periode: 'matin' | 'apres_midi';
  type: 'site' | 'bloc';
  site_nom?: string;
  site_id?: string;
  type_intervention_nom?: string;
  type_intervention_code?: string;
  required: number;
  assigned: number;
  missing: number;
}

export function UnsatisfiedNeedsReport({ startDate, endDate }: UnsatisfiedNeedsReportProps) {
  const [missingNeeds, setMissingNeeds] = useState<MissingNeed[]>([]);
  const [loading, setLoading] = useState(true);
  const [assignDialogOpen, setAssignDialogOpen] = useState(false);
  const [selectedNeed, setSelectedNeed] = useState<any>(null);

  useEffect(() => {
    fetchMissingNeeds();
  }, [startDate, endDate]);

  const handleNeedClick = (need: MissingNeed, plannelPersonnelId?: string) => {
    setSelectedNeed({
      date: need.date,
      periode: need.periode,
      type: need.type,
      site_id: need.site_id,
      site_nom: need.site_nom,
      type_besoin_bloc: need.type,
      planning_genere_personnel_id: plannelPersonnelId,
    });
    setAssignDialogOpen(true);
  };

  const fetchMissingNeeds = async () => {
    setLoading(true);
    try {
      const startDateStr = format(startDate, 'yyyy-MM-dd');
      const endDateStr = format(endDate, 'yyyy-MM-dd');

      // Fetch site needs (besoin_effectif type=medecin)
      const { data: siteBesoinsData, error: siteBesoinsError } = await supabase
        .from('besoin_effectif')
        .select(`
          *,
          site:sites(nom),
          medecin:medecins(besoin_secretaires)
        `)
        .eq('type', 'medecin')
        .eq('actif', true)
        .gte('date', startDateStr)
        .lte('date', endDateStr);

      if (siteBesoinsError) throw siteBesoinsError;

      // Filter out "Bloc opératoire" site to avoid false positives
      const filteredSiteBesoins = (siteBesoinsData || []).filter((besoin: any) => 
        besoin.site?.nom !== 'Clinique La Vallée - Bloc opératoire'
      );

      // Group site needs by (date, site_id, periode) and sum besoin_secretaires BEFORE ceiling
      const siteNeedsSumMap = new Map<string, { site_nom: string; site_id: string; total: number }>();
      
      for (const besoin of filteredSiteBesoins) {
        const periodes = besoin.demi_journee === 'toute_journee' 
          ? ['matin', 'apres_midi'] 
          : [besoin.demi_journee];

        for (const periode of periodes) {
          const key = `${besoin.date}|${besoin.site_id}|${periode}`;
          const existing = siteNeedsSumMap.get(key) || { 
            site_nom: besoin.site?.nom || 'Site inconnu', 
            site_id: besoin.site_id,
            total: 0 
          };
          // Sum first, ceil later
          existing.total += (besoin.medecin?.besoin_secretaires || 1.2);
          siteNeedsSumMap.set(key, existing);
        }
      }

      // Now apply Math.ceil to the total sum for each site/period
      const siteNeedsMap = new Map<string, { site_nom: string; site_id: string; required: number }>();
      for (const [key, data] of siteNeedsSumMap.entries()) {
        siteNeedsMap.set(key, {
          site_nom: data.site_nom,
          site_id: data.site_id,
          required: Math.ceil(data.total)
        });
      }

      // Fetch site assignments
      const { data: siteAssignmentsData, error: siteAssignmentsError } = await supabase
        .from('planning_genere_personnel')
        .select('date, periode, site_id')
        .eq('type_assignation', 'site')
        .gte('date', startDateStr)
        .lte('date', endDateStr);

      if (siteAssignmentsError) throw siteAssignmentsError;

      // Count assignments by (date, site_id, periode)
      const siteAssignmentsMap = new Map<string, number>();
      for (const assignment of siteAssignmentsData || []) {
        const key = `${assignment.date}|${assignment.site_id}|${assignment.periode}`;
        siteAssignmentsMap.set(key, (siteAssignmentsMap.get(key) || 0) + 1);
      }

      // Calculate missing needs
      const missing: MissingNeed[] = [];

      // Site missing needs
      for (const [key, data] of siteNeedsMap.entries()) {
        const [date, site_id, periode] = key.split('|');
        const assigned = siteAssignmentsMap.get(key) || 0;
        const missingCount = data.required - assigned;

        if (missingCount > 0) {
          const name = data.site_nom || '';
          const s = name.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase();
          if (s.includes('bloc') && s.includes('operatoire')) {
            continue;
          }
          missing.push({
            date,
            periode: periode as 'matin' | 'apres_midi',
            type: 'site',
            site_nom: data.site_nom,
            site_id,
            required: data.required,
            assigned,
            missing: missingCount,
          });
        }
      }

      // Fetch bloc missing rows only: operations with unassigned personnel
      const { data: blocMissingRows, error: blocMissingError } = await supabase
        .from('planning_genere_personnel')
        .select('planning_genere_bloc_operatoire_id, date, periode')
        .eq('type_assignation', 'bloc')
        .is('secretaire_id', null)
        .gte('date', startDateStr)
        .lte('date', endDateStr);

      if (blocMissingError) throw blocMissingError;

      // Build set of operation IDs to fetch labels for
      const opIds = Array.from(new Set((blocMissingRows || [])
        .map((r: any) => r.planning_genere_bloc_operatoire_id)
        .filter(Boolean)));

      let opLabelMap = new Map<string, { nom?: string; code?: string }>();
      if (opIds.length > 0) {
        const { data: blocOpsMeta, error: blocOpsMetaError } = await supabase
          .from('planning_genere_bloc_operatoire')
          .select('id, statut, type_intervention:types_intervention(nom, code)')
          .in('id', opIds);
        if (blocOpsMetaError) throw blocOpsMetaError;
        opLabelMap = new Map<string, { nom?: string; code?: string }>((blocOpsMeta || [])
          .map((op: any) => [op.id, { nom: op.type_intervention?.nom, code: op.type_intervention?.code }]));
        var allowedOps = new Set<string>((blocOpsMeta || [])
          .filter((op: any) => op.statut !== 'annule')
          .map((op: any) => op.id));
      }

      // Each missing row corresponds to exactly one unassigned need
      for (const row of blocMissingRows || []) {
        if (typeof allowedOps !== 'undefined' && row.planning_genere_bloc_operatoire_id && !allowedOps.has(row.planning_genere_bloc_operatoire_id)) {
          continue;
        }
        const labels = opLabelMap.get(row.planning_genere_bloc_operatoire_id) || {};
        missing.push({
          date: row.date,
          periode: row.periode as 'matin' | 'apres_midi',
          type: 'bloc',
          type_intervention_nom: labels.nom,
          type_intervention_code: labels.code,
          required: 1,
          assigned: 0,
          missing: 1,
        });
      }

      // Sort by date then by type
      missing.sort((a, b) => {
        const dateCompare = a.date.localeCompare(b.date);
        if (dateCompare !== 0) return dateCompare;
        if (a.periode !== b.periode) {
          return a.periode === 'matin' ? -1 : 1;
        }
        return a.type === 'bloc' ? 1 : -1;
      });

      setMissingNeeds(missing);
    } catch (error) {
      console.error('Error fetching missing needs:', error);
    } finally {
      setLoading(false);
    }
  };

  if (loading) {
    return null;
  }

  if (missingNeeds.length === 0) {
    return null;
  }

  // Group by date
  const needsByDate = missingNeeds.reduce((acc, need) => {
    if (!acc[need.date]) acc[need.date] = [];
    acc[need.date].push(need);
    return acc;
  }, {} as Record<string, MissingNeed[]>);

  return (
    <Card className="border-destructive/50 bg-background">
      <CardHeader>
        <CardTitle className="flex items-center gap-2 text-destructive">
          <AlertCircle className="h-5 w-5" />
          Besoins non satisfaits
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        {Object.entries(needsByDate).map(([date, needs]) => (
          <div key={date} className="space-y-2">
            <div className="font-semibold text-sm">
              {format(new Date(date), 'EEEE d MMMM yyyy', { locale: fr })}
            </div>
            
            <div className="space-y-2 pl-4">
              {needs.map((need, idx) => (
                <div
                  key={idx}
                  className="w-full flex items-center justify-between p-3 bg-background rounded border border-destructive/30 gap-3"
                >
                  <div className="flex items-center gap-3 flex-1 min-w-0">
                    {need.type === 'site' ? (
                      <Building2 className="h-4 w-4 text-muted-foreground flex-shrink-0" />
                    ) : (
                      <Scissors className="h-4 w-4 text-muted-foreground flex-shrink-0" />
                    )}
                    
                    <div className="flex items-center gap-2 flex-wrap flex-1 min-w-0">
                      <Badge variant="outline" className="text-xs flex-shrink-0">
                        {need.periode === 'matin' ? 'Matin' : 'Après-midi'}
                      </Badge>
                      
                      {need.type === 'site' ? (
                        <span className="text-sm font-medium truncate">{need.site_nom}</span>
                      ) : (
                        <>
                          <span className="text-sm font-medium truncate">{need.type_intervention_nom}</span>
                          {need.type_intervention_code && (
                            <Badge variant="secondary" className="text-xs flex-shrink-0">
                              {need.type_intervention_code}
                            </Badge>
                          )}
                        </>
                      )}
                      
                      <span className="text-xs text-muted-foreground flex-shrink-0">
                        • Requis: {need.required} • Assigné: {need.assigned} • Manquant: {need.missing}
                      </span>
                    </div>
                  </div>

                  <Button
                    onClick={() => handleNeedClick(need)}
                    size="sm"
                    variant="destructive"
                    className="gap-2 flex-shrink-0"
                  >
                    <UserPlus className="h-4 w-4" />
                    Assigner
                  </Button>
                </div>
              ))}
            </div>

            {Object.keys(needsByDate).indexOf(date) < Object.keys(needsByDate).length - 1 && (
              <Separator className="my-4" />
            )}
          </div>
        ))}
      </CardContent>

      {selectedNeed && (
        <AssignToUnsatisfiedNeedDialog
          open={assignDialogOpen}
          onOpenChange={setAssignDialogOpen}
          need={selectedNeed}
          onSuccess={() => {
            fetchMissingNeeds();
            setSelectedNeed(null);
          }}
        />
      )}
    </Card>
  );
}
