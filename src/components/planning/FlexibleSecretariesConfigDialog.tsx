import { useState, useEffect } from 'react';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Card } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Loader2, CalendarX, UserX, Briefcase, TrendingUp } from 'lucide-react';
import { supabase } from '@/integrations/supabase/client';
import { format } from 'date-fns';
import { fr } from 'date-fns/locale';

interface FlexibleSecretary {
  id: string;
  name: string;
  pourcentage_temps: number;
  quota_total: number;
  jours_feries: number;
  absences: Array<{ date_debut: string; date_fin: string; motif?: string }>;
  deja_travaille: Array<{ date: string; site: string; periode: string }>;
  reste_theorique: number;
}

interface FlexibleSecretariesConfigDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  selectedDates: string[];
  onConfirm: (configuration: { [id: string]: number }) => void;
  isOptimizing: boolean;
}

export function FlexibleSecretariesConfigDialog({
  open,
  onOpenChange,
  selectedDates,
  onConfirm,
  isOptimizing,
}: FlexibleSecretariesConfigDialogProps) {
  const [flexibleSecretaries, setFlexibleSecretaries] = useState<FlexibleSecretary[]>([]);
  const [configuration, setConfiguration] = useState<{ [id: string]: number }>({});
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (open && selectedDates.length > 0) {
      fetchFlexibleSecretariesInfo();
    }
  }, [open, selectedDates]);

  const fetchFlexibleSecretariesInfo = async () => {
    setLoading(true);
    try {
      // Déterminer la semaine ISO
      const firstDate = new Date(selectedDates[0]);
      const startOfWeek = new Date(firstDate);
      startOfWeek.setDate(firstDate.getDate() - ((firstDate.getDay() + 6) % 7));
      const endOfWeek = new Date(startOfWeek);
      endOfWeek.setDate(startOfWeek.getDate() + 6);

      const week_start = format(startOfWeek, 'yyyy-MM-dd');
      const week_end = format(endOfWeek, 'yyyy-MM-dd');

      // Récupérer les secrétaires flexibles
      const { data: secretaires, error: secError } = await supabase
        .from('secretaires')
        .select('id, name, pourcentage_temps, horaire_flexible, actif')
        .eq('horaire_flexible', true)
        .eq('actif', true);

      if (secError) throw secError;
      if (!secretaires || secretaires.length === 0) {
        setFlexibleSecretaries([]);
        return;
      }

      // Récupérer les jours fériés dans la semaine
      const { data: joursFeries, error: feriesError } = await supabase
        .from('jours_feries')
        .select('date')
        .gte('date', week_start)
        .lte('date', week_end)
        .eq('actif', true);

      if (feriesError) throw feriesError;
      const nbJoursFeries = joursFeries?.length || 0;

      // Récupérer les absences des flexibles
      const { data: absences, error: absError } = await supabase
        .from('absences')
        .select('secretaire_id, date_debut, date_fin, motif')
        .in('secretaire_id', secretaires.map(s => s.id))
        .lte('date_debut', week_end)
        .gte('date_fin', week_start)
        .in('statut', ['approuve', 'en_attente']);

      if (absError) throw absError;

      // Récupérer les assignations existantes
      const { data: existingAssignments, error: assignError } = await supabase
        .from('planning_genere_personnel')
        .select('secretaire_id, date, periode, site_id, sites(nom)')
        .in('secretaire_id', secretaires.map(s => s.id))
        .gte('date', week_start)
        .lte('date', week_end);

      if (assignError) throw assignError;

      // Construire les données pour chaque secrétaire
      const flexibleData: FlexibleSecretary[] = secretaires.map(sec => {
        const pourcentage = sec.pourcentage_temps ?? 60;
        const quota_total = Math.round((pourcentage / 100) * 5);

        // Filtrer absences
        const secAbsences = absences
          ?.filter(a => a.secretaire_id === sec.id)
          .map(a => ({
            date_debut: a.date_debut,
            date_fin: a.date_fin,
            motif: a.motif,
          })) || [];

        // Filtrer assignations (jours ouvrables uniquement)
        const assignments = existingAssignments?.filter(a => {
          if (a.secretaire_id !== sec.id) return false;
          const dow = new Date(a.date).getDay();
          return dow >= 1 && dow <= 5; // Lundi-vendredi
        }) || [];

        // Compter jours déjà travaillés (dates uniques)
        const joursDejaSet = new Set(assignments.map(a => a.date));
        const joursDejaHorsPeriode = Array.from(joursDejaSet).filter(
          d => !selectedDates.includes(d)
        ).length;

        const reste_theorique = Math.max(0, quota_total - joursDejaHorsPeriode);

        // Enrichir avec nom du site
        const deja_travaille = assignments.map(a => ({
          date: a.date,
          site: (a.sites as any)?.nom || 'Admin',
          periode: a.periode,
        }));

        return {
          id: sec.id,
          name: sec.name,
          pourcentage_temps: pourcentage,
          quota_total,
          jours_feries: nbJoursFeries,
          absences: secAbsences,
          deja_travaille,
          reste_theorique,
        };
      });

      setFlexibleSecretaries(flexibleData);

      // Initialiser la configuration avec les valeurs suggérées
      const initialConfig: { [id: string]: number } = {};
      flexibleData.forEach(sec => {
        initialConfig[sec.id] = sec.reste_theorique;
      });
      setConfiguration(initialConfig);
    } catch (error) {
      console.error('Erreur lors de la récupération des infos flexibles:', error);
    } finally {
      setLoading(false);
    }
  };

  const handleConfirm = () => {
    onConfirm(configuration);
  };

  const handleConfigChange = (secretaireId: string, value: string) => {
    setConfiguration(prev => ({
      ...prev,
      [secretaireId]: parseInt(value),
    }));
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-3xl max-h-[80vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Configuration Secrétaires Flexibles</DialogTitle>
        </DialogHeader>

        {loading ? (
          <div className="flex items-center justify-center py-8">
            <Loader2 className="h-8 w-8 animate-spin text-primary" />
          </div>
        ) : flexibleSecretaries.length === 0 ? (
          <div className="text-center py-8 text-muted-foreground">
            Aucune secrétaire flexible trouvée
          </div>
        ) : (
          <div className="space-y-4">
            {flexibleSecretaries.map(sec => (
              <Card key={sec.id} className="p-4">
                <div className="space-y-3">
                  {/* Header */}
                  <div className="flex items-center justify-between">
                    <div>
                      <h4 className="font-semibold text-lg">{sec.name}</h4>
                      <Badge variant="secondary" className="mt-1">
                        {sec.pourcentage_temps}% - {sec.quota_total} jours/semaine
                      </Badge>
                    </div>
                  </div>

                  {/* Détails */}
                  <div className="grid grid-cols-2 gap-3 text-sm">
                    {/* Jours fériés */}
                    <div className="flex items-start gap-2">
                      <CalendarX className="h-4 w-4 text-muted-foreground mt-0.5" />
                      <div>
                        <p className="font-medium">Jours fériés</p>
                        <p className="text-muted-foreground">
                          {sec.jours_feries} jour{sec.jours_feries > 1 ? 's' : ''}
                        </p>
                      </div>
                    </div>

                    {/* Absences */}
                    <div className="flex items-start gap-2">
                      <UserX className="h-4 w-4 text-muted-foreground mt-0.5" />
                      <div>
                        <p className="font-medium">Absences</p>
                        {sec.absences.length === 0 ? (
                          <p className="text-muted-foreground">Aucune absence</p>
                        ) : (
                          <div className="space-y-1">
                            {sec.absences.map((abs, idx) => (
                              <p key={idx} className="text-muted-foreground text-xs">
                                {format(new Date(abs.date_debut), 'dd/MM', { locale: fr })} → {format(new Date(abs.date_fin), 'dd/MM', { locale: fr })}
                                {abs.motif && ` (${abs.motif})`}
                              </p>
                            ))}
                          </div>
                        )}
                      </div>
                    </div>

                    {/* Déjà travaillé */}
                    <div className="flex items-start gap-2 col-span-2">
                      <Briefcase className="h-4 w-4 text-muted-foreground mt-0.5" />
                      <div className="flex-1">
                        <p className="font-medium">Déjà travaillé cette semaine</p>
                        {sec.deja_travaille.length === 0 ? (
                          <p className="text-muted-foreground">Aucune assignation</p>
                        ) : (
                          <div className="space-y-1 mt-1">
                            {/* Grouper par date */}
                            {Array.from(new Set(sec.deja_travaille.map(d => d.date)))
                              .sort()
                              .map(date => {
                                const assigns = sec.deja_travaille.filter(d => d.date === date);
                                const periodes = assigns.map(a => a.periode);
                                const isFullDay = periodes.includes('matin') && periodes.includes('apres_midi');
                                const site = assigns[0].site;
                                
                                return (
                                  <div key={date} className="text-xs text-muted-foreground">
                                    • {format(new Date(date), 'EEEE dd/MM', { locale: fr })} - {site}
                                    {isFullDay ? ' (journée complète)' : ` (${periodes.join(', ')})`}
                                  </div>
                                );
                              })}
                          </div>
                        )}
                      </div>
                    </div>

                    {/* Reste théorique */}
                    <div className="flex items-start gap-2 col-span-2">
                      <TrendingUp className="h-4 w-4 text-primary mt-0.5" />
                      <div>
                        <p className="font-medium">Quota restant calculé</p>
                        <p className="text-muted-foreground">
                          {sec.reste_theorique} jour{sec.reste_theorique > 1 ? 's' : ''} disponible{sec.reste_theorique > 1 ? 's' : ''}
                        </p>
                      </div>
                    </div>
                  </div>

                  {/* Configuration */}
                  <div className="pt-3 border-t">
                    <Label htmlFor={`config-${sec.id}`} className="text-sm font-medium">
                      Nombre de jours à assigner dans l'optimisation
                    </Label>
                    <Select
                      value={configuration[sec.id]?.toString() || '0'}
                      onValueChange={(value) => handleConfigChange(sec.id, value)}
                    >
                      <SelectTrigger id={`config-${sec.id}`} className="mt-2">
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        {[0, 1, 2, 3, 4, 5].map(num => (
                          <SelectItem key={num} value={num.toString()}>
                            {num} jour{num > 1 ? 's' : ''}
                            {num === sec.reste_theorique && ' (suggéré)'}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>
                </div>
              </Card>
            ))}
          </div>
        )}

        <DialogFooter className="gap-2">
          <Button
            variant="outline"
            onClick={() => onOpenChange(false)}
            disabled={isOptimizing}
          >
            Retour
          </Button>
          <Button
            onClick={handleConfirm}
            disabled={loading || isOptimizing || flexibleSecretaries.length === 0}
          >
            {isOptimizing ? (
              <>
                <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                Optimisation...
              </>
            ) : (
              'Optimiser'
            )}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
