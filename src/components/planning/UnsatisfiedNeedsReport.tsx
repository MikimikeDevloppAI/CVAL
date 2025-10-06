import { AssignmentResult } from '@/types/planning';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { AlertCircle, UserPlus, ArrowLeftRight } from 'lucide-react';
import { format } from 'date-fns';
import { fr } from 'date-fns/locale';
import { useState, useEffect, useMemo, useCallback } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { toast } from 'sonner';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';

interface UnsatisfiedNeedsReportProps {
  assignments: AssignmentResult[];
  weekDays: Date[];
  onRefresh?: () => void;
}

interface UnsatisfiedNeed {
  date: string;
  dateObj: Date;
  site_id: string;
  site_nom: string;
  matin_manquant: number;
  apres_midi_manquant: number;
  total_manquant: number;
}

interface SecretaryInfo {
  id: string;
  name: string;
  first_name: string;
  flexible_jours_supplementaires: boolean;
  nombre_jours_supplementaires: number;
  specialites: string[];
  base_days: number; // Nombre de jours de base par semaine
  assigned_days: number; // Nombre de jours assignés cette semaine
}

interface Suggestion {
  secretaire: SecretaryInfo;
  type: 'assign' | 'swap';
  target_need: UnsatisfiedNeed;
  swap_with?: {
    secretaire_id: string;
    nom: string;
    current_site: string;
  };
}

export function UnsatisfiedNeedsReport({ assignments, weekDays, onRefresh }: UnsatisfiedNeedsReportProps) {
  const [suggestions, setSuggestions] = useState<Suggestion[]>([]);
  const [loading, setLoading] = useState(true);
  const [selectedNeed, setSelectedNeed] = useState<UnsatisfiedNeed | null>(null);
  const [availableSecretaries, setAvailableSecretaries] = useState<SecretaryInfo[]>([]);
  const [selectedSecretaryId, setSelectedSecretaryId] = useState<string>('');
  const [dialogOpen, setDialogOpen] = useState(false);
  const [needsAnalyzed, setNeedsAnalyzed] = useState(false);

  // Mémoriser les besoins non satisfaits pour éviter les rechargements constants
  const unsatisfiedNeeds = useMemo(() => {
    const needs: UnsatisfiedNeed[] = [];
    const weekdaysOnly = weekDays.filter(d => {
      const dow = d.getDay();
      return dow !== 0 && dow !== 6;
    });

    weekdaysOnly.forEach(day => {
      const dateStr = format(day, 'yyyy-MM-dd');
      const dayAssignments = assignments.filter(a => a.date === dateStr);

      const siteGroups = new Map<string, { matin?: AssignmentResult; apres_midi?: AssignmentResult }>();
      
      dayAssignments.forEach(a => {
        if (!siteGroups.has(a.site_id)) {
          siteGroups.set(a.site_id, {});
        }
        const group = siteGroups.get(a.site_id)!;
        if (a.periode === 'matin') group.matin = a;
        if (a.periode === 'apres_midi') group.apres_midi = a;
      });

      siteGroups.forEach((periods, siteId) => {
        const matin_manquant = periods.matin ? Math.max(0, periods.matin.nombre_requis - periods.matin.nombre_assigne) : 0;
        const apres_midi_manquant = periods.apres_midi ? Math.max(0, periods.apres_midi.nombre_requis - periods.apres_midi.nombre_assigne) : 0;
        
        if (matin_manquant > 0 || apres_midi_manquant > 0) {
          needs.push({
            date: dateStr,
            dateObj: day,
            site_id: siteId,
            site_nom: periods.matin?.site_nom || periods.apres_midi?.site_nom || '',
            matin_manquant,
            apres_midi_manquant,
            total_manquant: matin_manquant + apres_midi_manquant,
          });
        }
      });
    });

    return needs;
  }, [assignments, weekDays]);

  // Charger les suggestions uniquement une fois au chargement initial
  useEffect(() => {
    if (!needsAnalyzed && unsatisfiedNeeds.length > 0) {
      loadSuggestions();
    } else if (unsatisfiedNeeds.length === 0) {
      setLoading(false);
      setNeedsAnalyzed(true);
    }
  }, [unsatisfiedNeeds, needsAnalyzed]);

  const loadSuggestions = useCallback(async () => {
    setLoading(true);
    try {
      const weekdaysOnly = weekDays.filter(d => {
        const dow = d.getDay();
        return dow !== 0 && dow !== 6;
      });

      // Récupérer les infos des secrétaires flexibles
      const { data: secretaires, error: secError } = await supabase
        .from('secretaires')
        .select('*')
        .eq('actif', true);

      if (secError) throw secError;

      // Calculer les jours de base et assignés pour chaque secrétaire
      const secretariesInfo: SecretaryInfo[] = [];

      for (const sec of secretaires || []) {
        // Récupérer les horaires de base (nombre de jours par semaine)
        const { data: horaireBase, error: hbError } = await supabase
          .from('horaires_base_secretaires')
          .select('jour_semaine')
          .eq('secretaire_id', sec.id)
          .eq('actif', true);

        if (hbError) throw hbError;

        const baseDays = new Set(horaireBase?.map(h => h.jour_semaine) || []).size;

        // Compter les jours assignés cette semaine
        const assignedDaysSet = new Set<string>();
        weekdaysOnly.forEach(day => {
          const dateStr = format(day, 'yyyy-MM-dd');
          const dayAssignments = assignments.filter(a => 
            a.date === dateStr && 
            a.secretaires.some(s => s.secretaire_id === sec.id || s.backup_id === sec.id)
          );
          if (dayAssignments.length > 0) {
            assignedDaysSet.add(dateStr);
          }
        });

        secretariesInfo.push({
          id: sec.id,
          name: sec.name || '',
          first_name: sec.first_name || '',
          flexible_jours_supplementaires: sec.flexible_jours_supplementaires || false,
          nombre_jours_supplementaires: sec.nombre_jours_supplementaires || 0,
          specialites: sec.specialites || [],
          base_days: baseDays,
          assigned_days: assignedDaysSet.size,
        });
      }

      // Générer des suggestions - Séparer les suggestions prioritaires
      const newSuggestions: Suggestion[] = [];
      const prioritySuggestions: Suggestion[] = [];

      for (const need of unsatisfiedNeeds) {
        // Trouver des secrétaires flexibles qui peuvent travailler un jour de plus
        for (const sec of secretariesInfo) {
          if (!sec.flexible_jours_supplementaires) continue;
          
          const joursSupplementairesUtilises = sec.assigned_days - sec.base_days;
          const joursSupplementairesRestants = sec.nombre_jours_supplementaires - joursSupplementairesUtilises;

          if (joursSupplementairesRestants > 0) {
            // Vérifier si la secrétaire ne travaille pas déjà ce jour-là
            const alreadyWorking = assignments.some(a => 
              a.date === need.date && 
              a.secretaires.some(s => s.secretaire_id === sec.id || s.backup_id === sec.id)
            );

            if (!alreadyWorking) {
              const suggestion: Suggestion = {
                secretaire: sec,
                type: 'assign',
                target_need: need,
              };

              // Si la secrétaire n'a pas encore utilisé de jours supplémentaires, c'est prioritaire
              if (joursSupplementairesUtilises === 0) {
                prioritySuggestions.push(suggestion);
              } else {
                newSuggestions.push(suggestion);
              }
            }
          }
        }
      }

      setSuggestions([...prioritySuggestions, ...newSuggestions]);
      setNeedsAnalyzed(true);
    } catch (error) {
      console.error('Erreur lors de l\'analyse des besoins:', error);
      toast.error('Erreur lors de l\'analyse des besoins non satisfaits');
    } finally {
      setLoading(false);
    }
  }, [unsatisfiedNeeds, weekDays, assignments]);

  // Regrouper les besoins par site et trier alphabétiquement
  const needsBySite = useMemo(() => {
    const grouped = unsatisfiedNeeds.reduce((acc, need) => {
      if (!acc[need.site_nom]) {
        acc[need.site_nom] = [];
      }
      acc[need.site_nom].push(need);
      return acc;
    }, {} as Record<string, UnsatisfiedNeed[]>);

    // Trier les sites alphabétiquement et trier les jours par date
    return Object.entries(grouped)
      .sort(([siteA], [siteB]) => siteA.localeCompare(siteB))
      .map(([siteName, needs]) => ({
        siteName,
        needs: needs.sort((a, b) => a.dateObj.getTime() - b.dateObj.getTime()),
      }));
  }, [unsatisfiedNeeds]);

  const handleNeedClick = async (need: UnsatisfiedNeed) => {
    setSelectedNeed(need);
    setSelectedSecretaryId('');
    
    // Trouver les secrétaires disponibles (qui ne travaillent pas ce jour-là)
    try {
      // Récupérer les infos du site pour obtenir sa spécialité
      const { data: site, error: siteError } = await supabase
        .from('sites')
        .select('specialite_id')
        .eq('id', need.site_id)
        .maybeSingle();

      if (siteError) throw siteError;

      const siteSpecialiteId = site?.specialite_id;

      const { data: secretaires, error } = await supabase
        .from('secretaires')
        .select('*')
        .eq('actif', true);

      if (error) throw error;

      const available = secretaires?.filter(sec => {
        // Vérifier qu'elle ne travaille pas déjà ce jour-là
        const alreadyWorking = assignments.some(a => 
          a.date === need.date && 
          a.secretaires.some(s => s.secretaire_id === sec.id || s.backup_id === sec.id)
        );
        
        // Vérifier que la secrétaire a la spécialité du site
        const hasMatchingSpeciality = siteSpecialiteId 
          ? (sec.specialites || []).includes(siteSpecialiteId)
          : true; // Si pas de spécialité définie pour le site, on accepte toutes les secrétaires

        return !alreadyWorking && hasMatchingSpeciality;
      }).map(sec => ({
        id: sec.id,
        name: sec.name || '',
        first_name: sec.first_name || '',
        flexible_jours_supplementaires: sec.flexible_jours_supplementaires || false,
        nombre_jours_supplementaires: sec.nombre_jours_supplementaires || 0,
        specialites: sec.specialites || [],
        base_days: 0,
        assigned_days: 0,
      })) || [];

      setAvailableSecretaries(available);
      setDialogOpen(true);
    } catch (error) {
      console.error('Erreur:', error);
      toast.error('Erreur lors de la récupération des secrétaires disponibles');
    }
  };

  const handleAssignSecretary = async () => {
    if (!selectedNeed || !selectedSecretaryId) return;

    try {
      // Déterminer les périodes à assigner
      const periods: ('matin' | 'apres_midi')[] = [];
      if (selectedNeed.matin_manquant > 0) periods.push('matin');
      if (selectedNeed.apres_midi_manquant > 0) periods.push('apres_midi');

      for (const period of periods) {
        const heureDebut = period === 'matin' ? '07:30:00' : '13:00:00';
        const heureFin = period === 'matin' ? '12:00:00' : '17:00:00';

        // Chercher un créneau existant pour ce site/date/période
        const { data: existingCreneaux, error: fetchError } = await supabase
          .from('planning_genere')
          .select('*')
          .eq('date', selectedNeed.date)
          .eq('site_id', selectedNeed.site_id)
          .eq('heure_debut', heureDebut)
          .neq('statut', 'annule');

        if (fetchError) throw fetchError;

        if (existingCreneaux && existingCreneaux.length > 0) {
          // Ajouter la secrétaire au créneau existant
          const creneau = existingCreneaux[0];
          const newSecretairesIds = [...(creneau.secretaires_ids || []), selectedSecretaryId];

          const { error: updateError } = await supabase
            .from('planning_genere')
            .update({ secretaires_ids: newSecretairesIds })
            .eq('id', creneau.id);

          if (updateError) throw updateError;
        } else {
          // Créer un nouveau créneau
          const { error: insertError } = await supabase
            .from('planning_genere')
            .insert({
              date: selectedNeed.date,
              site_id: selectedNeed.site_id,
              heure_debut: heureDebut,
              heure_fin: heureFin,
              secretaires_ids: [selectedSecretaryId],
              type: 'secretaire',
              statut: 'planifie',
            });

          if (insertError) throw insertError;
        }
      }

      toast.success('Secrétaire assignée avec succès');
      setDialogOpen(false);
      setNeedsAnalyzed(false); // Forcer une nouvelle analyse après l'assignation
      if (onRefresh) onRefresh();
    } catch (error) {
      console.error('Erreur:', error);
      toast.error('Erreur lors de l\'assignation de la secrétaire');
    }
  };

  if (loading) {
    return (
      <Card className="mb-6">
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <AlertCircle className="h-5 w-5" />
            Analyse des besoins...
          </CardTitle>
        </CardHeader>
      </Card>
    );
  }

  if (unsatisfiedNeeds.length === 0) {
    return (
      <Card className="mb-6 border-green-200 bg-green-50">
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-green-800">
            ✓ Tous les besoins sont couverts
          </CardTitle>
        </CardHeader>
      </Card>
    );
  }

  return (
    <>
      <Card className="mb-6 border-border bg-white">
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-foreground">
            <AlertCircle className="h-5 w-5" />
            Besoins non satisfaits ({unsatisfiedNeeds.length})
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          {/* Suggestions prioritaires - Secrétaires sans jours supplémentaires utilisés */}
          {suggestions.length > 0 && suggestions.some(s => (s.secretaire.assigned_days - s.secretaire.base_days) === 0) && (
            <div className="border-2 border-green-300 rounded-lg p-4 bg-green-50">
              <h4 className="font-semibold text-base mb-3 flex items-center gap-2 text-green-800">
                ⭐ Secrétaires disponibles (pas de jours supplémentaires utilisés)
              </h4>
              <div className="space-y-2">
                {suggestions
                  .filter(s => (s.secretaire.assigned_days - s.secretaire.base_days) === 0)
                  .map((suggestion, idx) => {
                    const joursSupplementairesUtilises = suggestion.secretaire.assigned_days - suggestion.secretaire.base_days;
                    return (
                      <div key={idx} className="border rounded-lg p-3 bg-white border-green-300">
                        <div className="flex items-center justify-between gap-2">
                          <div className="flex-1">
                            <div className="text-sm font-semibold text-green-800">
                              {suggestion.secretaire.first_name} {suggestion.secretaire.name}
                            </div>
                            <div className="text-xs text-muted-foreground">
                              Peut travailler à {suggestion.target_need.site_nom} le{' '}
                              {format(suggestion.target_need.dateObj, 'd MMMM', { locale: fr })}
                            </div>
                            <div className="text-xs text-green-700 mt-1 font-medium">
                              {joursSupplementairesUtilises}/{suggestion.secretaire.nombre_jours_supplementaires} jours supp. utilisés
                            </div>
                          </div>
                          
                          <Button 
                            size="sm" 
                            variant="default"
                            className="bg-green-600 hover:bg-green-700"
                            onClick={async () => {
                              setSelectedNeed(suggestion.target_need);
                              setSelectedSecretaryId(suggestion.secretaire.id);
                              await handleAssignSecretary();
                              setNeedsAnalyzed(false);
                            }}
                          >
                            Assigner
                          </Button>
                        </div>
                      </div>
                    );
                  })}
              </div>
            </div>
          )}

          {/* Liste des besoins groupés par site */}
          <div className="space-y-4">
            {needsBySite.map(({ siteName, needs }) => (
              <div key={siteName} className="border rounded-lg p-4 bg-background">
                <div className="font-semibold text-base mb-3 text-primary">
                  {siteName}
                </div>
                <div className="space-y-2">
                  {needs.map((need, idx) => (
                    <div 
                      key={idx} 
                      className="border rounded-lg p-3 bg-card hover:bg-accent/5 transition-colors cursor-pointer"
                      onClick={() => handleNeedClick(need)}
                    >
                      <div className="flex items-center justify-between gap-2">
                        <div className="flex-1">
                          <div className="text-sm text-muted-foreground">
                            {format(need.dateObj, 'EEEE d MMMM yyyy', { locale: fr })}
                          </div>
                        </div>
                        
                        <div className="flex items-center gap-2">
                          {need.matin_manquant > 0 && (
                            <Badge variant="destructive" className="text-xs">
                              Matin: -{need.matin_manquant}
                            </Badge>
                          )}
                          {need.apres_midi_manquant > 0 && (
                            <Badge variant="destructive" className="text-xs">
                              Après-midi: -{need.apres_midi_manquant}
                            </Badge>
                          )}
                          
                          <Button size="sm" variant="outline" className="h-7">
                            <UserPlus className="h-3 w-3 mr-1" />
                            Assigner
                          </Button>
                        </div>
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            ))}
          </div>

          {/* Suggestions */}
          {suggestions.length > 0 && (
            <div className="border-t pt-4 mt-4">
              <h4 className="font-medium text-sm mb-3 flex items-center gap-2">
                💡 Suggestions ({suggestions.length})
              </h4>
              <div className="space-y-2">
                {suggestions.slice(0, 5).map((suggestion, idx) => (
                  <div key={idx} className="border rounded-lg p-3 bg-blue-50 border-blue-200">
                    <div className="flex items-center justify-between gap-2">
                      <div className="flex-1">
                        <div className="text-sm font-medium">
                          {suggestion.secretaire.first_name} {suggestion.secretaire.name}
                        </div>
                        <div className="text-xs text-muted-foreground">
                          Peut travailler à {suggestion.target_need.site_nom} le{' '}
                          {format(suggestion.target_need.dateObj, 'd MMMM', { locale: fr })}
                        </div>
                        <div className="text-xs text-blue-700 mt-1">
                          {suggestion.secretaire.assigned_days - suggestion.secretaire.base_days}/{suggestion.secretaire.nombre_jours_supplementaires} jours supp. utilisés
                        </div>
                      </div>
                      
                      <Button 
                        size="sm" 
                        variant="default"
                        onClick={async () => {
                          setSelectedNeed(suggestion.target_need);
                          setSelectedSecretaryId(suggestion.secretaire.id);
                          await handleAssignSecretary();
                          setNeedsAnalyzed(false); // Forcer une nouvelle analyse après l'assignation
                        }}
                      >
                        Appliquer
                      </Button>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}
        </CardContent>
      </Card>

      {/* Dialog pour assigner une secrétaire */}
      <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Assigner une secrétaire</DialogTitle>
          </DialogHeader>
          
          {selectedNeed && (
            <div className="space-y-4">
              <div className="text-sm">
                <div className="font-medium">{selectedNeed.site_nom}</div>
                <div className="text-muted-foreground">
                  {format(selectedNeed.dateObj, 'EEEE d MMMM yyyy', { locale: fr })}
                </div>
                <div className="mt-2 flex gap-2">
                  {selectedNeed.matin_manquant > 0 && (
                    <Badge variant="destructive">Matin: -{selectedNeed.matin_manquant}</Badge>
                  )}
                  {selectedNeed.apres_midi_manquant > 0 && (
                    <Badge variant="destructive">Après-midi: -{selectedNeed.apres_midi_manquant}</Badge>
                  )}
                </div>
              </div>

              <div className="space-y-2">
                <label className="text-sm font-medium">
                  Secrétaires disponibles ({availableSecretaries.length})
                </label>
                <Select value={selectedSecretaryId} onValueChange={setSelectedSecretaryId}>
                  <SelectTrigger>
                    <SelectValue placeholder="Sélectionner une secrétaire" />
                  </SelectTrigger>
                  <SelectContent>
                    {availableSecretaries.map(sec => (
                      <SelectItem key={sec.id} value={sec.id}>
                        {sec.first_name} {sec.name}
                        {sec.flexible_jours_supplementaires && (
                          <span className="text-xs text-muted-foreground ml-2">
                            (Flexible: {sec.nombre_jours_supplementaires} jours)
                          </span>
                        )}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>

              <div className="flex gap-2 justify-end">
                <Button variant="outline" onClick={() => setDialogOpen(false)}>
                  Annuler
                </Button>
                <Button 
                  onClick={handleAssignSecretary}
                  disabled={!selectedSecretaryId}
                >
                  Assigner
                </Button>
              </div>
            </div>
          )}
        </DialogContent>
      </Dialog>
    </>
  );
}
