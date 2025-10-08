import { useState, useEffect } from 'react';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Badge } from '@/components/ui/badge';
import { toast } from 'sonner';
import { supabase } from '@/integrations/supabase/client';
import { Loader2, Plus, Trash2, Zap } from 'lucide-react';
import { OptimizationScoreCards } from './OptimizationScoreCards';
import type { FictionalDoctor, FictionalSecretary, WhatIfScenario } from '@/types/scenario';
import type { OptimizationScoreParSpecialite } from '@/types/baseSchedule';
import { Checkbox } from '@/components/ui/checkbox';

const JOURS_SEMAINE = [
  { value: 1, label: 'Lundi' },
  { value: 2, label: 'Mardi' },
  { value: 3, label: 'Mercredi' },
  { value: 4, label: 'Jeudi' },
  { value: 5, label: 'Vendredi' },
];

export function WhatIfScenarioEditor() {
  const [scenario, setScenario] = useState<WhatIfScenario>({
    fictionalDoctors: [],
    fictionalSecretaries: [],
  });
  const [specialites, setSpecialites] = useState<Array<{ id: string; nom: string }>>([]);
  const [isOptimizing, setIsOptimizing] = useState(false);
  const [optimizationResults, setOptimizationResults] = useState<OptimizationScoreParSpecialite[]>([]);
  
  // New doctor form
  const [newDoctor, setNewDoctor] = useState({
    specialite_id: '',
    besoin_secretaires: 1.2,
    selectedJours: new Map<number, 'both' | 'matin' | 'apres_midi'>(), // jour -> période
  });

  // New secretary form
  const [newSecretary, setNewSecretary] = useState({
    selectedSpecialites: new Set<string>(),
    selectedJours: new Map<number, 'both' | 'matin' | 'apres_midi'>(), // jour -> période
  });

  useEffect(() => {
    fetchSpecialites();
  }, []);

  const fetchSpecialites = async () => {
    const { data, error } = await supabase
      .from('specialites')
      .select('id, nom')
      .order('nom');
    
    if (!error && data) {
      setSpecialites(data);
    }
  };

  const addFictionalDoctor = () => {
    if (!newDoctor.specialite_id || newDoctor.selectedJours.size === 0) {
      toast.error('Veuillez sélectionner une spécialité et au moins un jour');
      return;
    }

    const horaires: FictionalDoctor['horaires'] = [];
    
    for (const [jour, periode] of newDoctor.selectedJours.entries()) {
      if (periode === 'both') {
        horaires.push(
          {
            jour_semaine: jour,
            demi_journee: 'matin' as const,
            heure_debut: '08:00',
            heure_fin: '12:00',
          },
          {
            jour_semaine: jour,
            demi_journee: 'apres_midi' as const,
            heure_debut: '13:00',
            heure_fin: '17:00',
          }
        );
      } else {
        horaires.push({
          jour_semaine: jour,
          demi_journee: periode,
          heure_debut: periode === 'matin' ? '08:00' : '13:00',
          heure_fin: periode === 'matin' ? '12:00' : '17:00',
        });
      }
    }

    const doctorNumber = scenario.fictionalDoctors.length + 1;
    const doctor: FictionalDoctor = {
      id: `fictional-doctor-${Date.now()}`,
      name: `Médecin fictif ${doctorNumber}`,
      specialite_id: newDoctor.specialite_id,
      besoin_secretaires: newDoctor.besoin_secretaires,
      horaires,
    };

    setScenario(prev => ({
      ...prev,
      fictionalDoctors: [...prev.fictionalDoctors, doctor],
    }));

    setNewDoctor({
      specialite_id: '',
      besoin_secretaires: 1.2,
      selectedJours: new Map(),
    });

    toast.success('Médecin fictif ajouté');
  };

  const addFictionalSecretary = () => {
    if (newSecretary.selectedSpecialites.size === 0 || newSecretary.selectedJours.size === 0) {
      toast.error('Veuillez sélectionner au moins une spécialité et un jour');
      return;
    }

    const horaires: FictionalSecretary['horaires'] = [];
    
    for (const [jour, periode] of newSecretary.selectedJours.entries()) {
      if (periode === 'both') {
        horaires.push({
          jour_semaine: jour,
          heure_debut: '08:00',
          heure_fin: '17:00',
        });
      } else if (periode === 'matin') {
        horaires.push({
          jour_semaine: jour,
          heure_debut: '08:00',
          heure_fin: '12:00',
        });
      } else {
        horaires.push({
          jour_semaine: jour,
          heure_debut: '13:00',
          heure_fin: '17:00',
        });
      }
    }

    const secretaryNumber = scenario.fictionalSecretaries.length + 1;
    const secretary: FictionalSecretary = {
      id: `fictional-secretary-${Date.now()}`,
      name: `Secrétaire fictive ${secretaryNumber}`,
      specialites: Array.from(newSecretary.selectedSpecialites),
      horaires,
    };

    setScenario(prev => ({
      ...prev,
      fictionalSecretaries: [...prev.fictionalSecretaries, secretary],
    }));

    setNewSecretary({
      selectedSpecialites: new Set(),
      selectedJours: new Map(),
    });

    toast.success('Secrétaire fictive ajoutée');
  };

  const runOptimization = async () => {
    if (scenario.fictionalDoctors.length === 0 && scenario.fictionalSecretaries.length === 0) {
      toast.error('Ajoutez au moins un médecin ou une secrétaire fictive');
      return;
    }

    setIsOptimizing(true);
    try {
      const { data, error } = await supabase.functions.invoke('optimize-base-schedule-milp-scenario', {
        body: { scenario },
      });

      if (error) throw error;

      // Transform results into OptimizationScoreParSpecialite format
      const specialitesMap = new Map<string, OptimizationScoreParSpecialite>();
      const JOURS_NOMS = ['Lundi', 'Mardi', 'Mercredi', 'Jeudi', 'Vendredi'];

      data.results.forEach((row: any) => {
        const specId = row.specialite_id;
        
        if (!specialitesMap.has(specId)) {
          specialitesMap.set(specId, {
            specialite_id: specId,
            specialite_nom: row.specialite_nom || 'Inconnue',
            score_global: 0,
            pourcentage_global: 0,
            details_jours: JOURS_NOMS.map((nom, idx) => ({
              jour_semaine: idx + 1,
              jour_nom: nom,
              matin: { besoins: 0, capacites: 0, score: 0, pourcentage: 0 },
              apres_midi: { besoins: 0, capacites: 0, score: 0, pourcentage: 0 },
            })),
          });
        }

        const spec = specialitesMap.get(specId)!;
        const jourIndex = row.jour_semaine - 1;
        
        if (jourIndex >= 0 && jourIndex < 5) {
          const detail = spec.details_jours[jourIndex];
          
          if (row.demi_journee === 'matin') {
            detail.matin.besoins = row.besoins;
            detail.matin.capacites = row.capacites_assignees;
            detail.matin.pourcentage = row.besoins > 0 ? Math.round((row.capacites_assignees / row.besoins) * 100) : 100;
          } else {
            detail.apres_midi.besoins = row.besoins;
            detail.apres_midi.capacites = row.capacites_assignees;
            detail.apres_midi.pourcentage = row.besoins > 0 ? Math.round((row.capacites_assignees / row.besoins) * 100) : 100;
          }
        }
      });

      setOptimizationResults(Array.from(specialitesMap.values()));
      toast.success('Optimisation terminée !');
    } catch (error) {
      console.error('Error running optimization:', error);
      toast.error('Erreur lors de l\'optimisation');
    } finally {
      setIsOptimizing(false);
    }
  };

  const removeFictionalDoctor = (id: string) => {
    setScenario(prev => ({
      ...prev,
      fictionalDoctors: prev.fictionalDoctors.filter(d => d.id !== id),
    }));
  };

  const removeFictionalSecretary = (id: string) => {
    setScenario(prev => ({
      ...prev,
      fictionalSecretaries: prev.fictionalSecretaries.filter(s => s.id !== id),
    }));
  };

  const toggleJourDoctor = (jour: number, periode: 'both' | 'matin' | 'apres_midi') => {
    setNewDoctor(prev => {
      const newMap = new Map(prev.selectedJours);
      if (newMap.get(jour) === periode) {
        newMap.delete(jour);
      } else {
        newMap.set(jour, periode);
      }
      return { ...prev, selectedJours: newMap };
    });
  };

  const toggleJourSecretary = (jour: number, periode: 'both' | 'matin' | 'apres_midi') => {
    setNewSecretary(prev => {
      const newMap = new Map(prev.selectedJours);
      if (newMap.get(jour) === periode) {
        newMap.delete(jour);
      } else {
        newMap.set(jour, periode);
      }
      return { ...prev, selectedJours: newMap };
    });
  };

  const toggleSpecialiteSecretary = (specId: string) => {
    setNewSecretary(prev => {
      const newSet = new Set(prev.selectedSpecialites);
      if (newSet.has(specId)) {
        newSet.delete(specId);
      } else {
        newSet.add(specId);
      }
      return { ...prev, selectedSpecialites: newSet };
    });
  };

  return (
    <div className="space-y-6">
      <Card>
        <CardHeader>
          <CardTitle>Ajouter un médecin fictif</CardTitle>
          <CardDescription>Simulez l'ajout d'un nouveau médecin avec ses besoins</CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="space-y-2">
            <Label>Spécialité</Label>
            <Select value={newDoctor.specialite_id} onValueChange={value => setNewDoctor(prev => ({ ...prev, specialite_id: value }))}>
              <SelectTrigger>
                <SelectValue placeholder="Choisir une spécialité" />
              </SelectTrigger>
              <SelectContent>
                {specialites.map(spec => (
                  <SelectItem key={spec.id} value={spec.id}>{spec.nom}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          <div className="space-y-2">
            <Label>Jours de travail (cliquez pour sélectionner la période)</Label>
            <div className="space-y-2">
              {JOURS_SEMAINE.map(jour => {
                const periode = newDoctor.selectedJours.get(jour.value);
                return (
                  <div key={jour.value} className="flex items-center gap-2">
                    <span className="w-24 text-sm font-medium">{jour.label}</span>
                    <div className="flex gap-1">
                      <Button
                        type="button"
                        variant={periode === 'matin' ? 'default' : 'outline'}
                        size="sm"
                        onClick={() => toggleJourDoctor(jour.value, 'matin')}
                      >
                        Matin
                      </Button>
                      <Button
                        type="button"
                        variant={periode === 'apres_midi' ? 'default' : 'outline'}
                        size="sm"
                        onClick={() => toggleJourDoctor(jour.value, 'apres_midi')}
                      >
                        Après-midi
                      </Button>
                      <Button
                        type="button"
                        variant={periode === 'both' ? 'default' : 'outline'}
                        size="sm"
                        onClick={() => toggleJourDoctor(jour.value, 'both')}
                      >
                        Journée
                      </Button>
                    </div>
                  </div>
                );
              })}
            </div>
          </div>

          <div className="space-y-2">
            <Label>Besoin en secrétaires (coefficient)</Label>
            <Input
              type="number"
              step="0.1"
              min="0"
              value={newDoctor.besoin_secretaires}
              onChange={e => setNewDoctor(prev => ({ ...prev, besoin_secretaires: parseFloat(e.target.value) || 1.2 }))}
            />
          </div>

          <Button onClick={addFictionalDoctor} className="w-full">
            <Plus className="w-4 h-4 mr-2" />
            Ajouter ce médecin
          </Button>

          {scenario.fictionalDoctors.length > 0 && (
            <div className="space-y-2 pt-4 border-t">
              <Label>Médecins fictifs ajoutés ({scenario.fictionalDoctors.length})</Label>
              {scenario.fictionalDoctors.map(doctor => (
                <div key={doctor.id} className="flex items-center justify-between p-3 bg-muted rounded-lg">
                  <div className="space-y-1">
                    <div className="font-medium">{doctor.name}</div>
                    <div className="text-sm text-muted-foreground">
                      {specialites.find(s => s.id === doctor.specialite_id)?.nom} • {doctor.horaires.length} créneaux
                    </div>
                  </div>
                  <Button variant="ghost" size="icon" onClick={() => removeFictionalDoctor(doctor.id)}>
                    <Trash2 className="w-4 h-4" />
                  </Button>
                </div>
              ))}
            </div>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Ajouter une secrétaire fictive</CardTitle>
          <CardDescription>Simulez l'ajout d'une nouvelle secrétaire avec ses capacités</CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="space-y-2">
            <Label>Spécialités (plusieurs possibles)</Label>
            <div className="flex flex-wrap gap-2">
              {specialites.map(spec => (
                <Badge
                  key={spec.id}
                  variant={newSecretary.selectedSpecialites.has(spec.id) ? 'default' : 'outline'}
                  className="cursor-pointer"
                  onClick={() => toggleSpecialiteSecretary(spec.id)}
                >
                  {spec.nom}
                </Badge>
              ))}
            </div>
          </div>

          <div className="space-y-2">
            <Label>Jours de travail (cliquez pour sélectionner la période)</Label>
            <div className="space-y-2">
              {JOURS_SEMAINE.map(jour => {
                const periode = newSecretary.selectedJours.get(jour.value);
                return (
                  <div key={jour.value} className="flex items-center gap-2">
                    <span className="w-24 text-sm font-medium">{jour.label}</span>
                    <div className="flex gap-1">
                      <Button
                        type="button"
                        variant={periode === 'matin' ? 'default' : 'outline'}
                        size="sm"
                        onClick={() => toggleJourSecretary(jour.value, 'matin')}
                      >
                        Matin
                      </Button>
                      <Button
                        type="button"
                        variant={periode === 'apres_midi' ? 'default' : 'outline'}
                        size="sm"
                        onClick={() => toggleJourSecretary(jour.value, 'apres_midi')}
                      >
                        Après-midi
                      </Button>
                      <Button
                        type="button"
                        variant={periode === 'both' ? 'default' : 'outline'}
                        size="sm"
                        onClick={() => toggleJourSecretary(jour.value, 'both')}
                      >
                        Journée
                      </Button>
                    </div>
                  </div>
                );
              })}
            </div>
          </div>

          <Button onClick={addFictionalSecretary} className="w-full">
            <Plus className="w-4 h-4 mr-2" />
            Ajouter cette secrétaire
          </Button>

          {scenario.fictionalSecretaries.length > 0 && (
            <div className="space-y-2 pt-4 border-t">
              <Label>Secrétaires fictives ajoutées ({scenario.fictionalSecretaries.length})</Label>
              {scenario.fictionalSecretaries.map(secretary => (
                <div key={secretary.id} className="flex items-center justify-between p-3 bg-muted rounded-lg">
                  <div className="space-y-1">
                    <div className="font-medium">{secretary.name}</div>
                    <div className="text-sm text-muted-foreground">
                      {secretary.specialites.length} spécialités • {secretary.horaires.length} jours
                    </div>
                  </div>
                  <Button variant="ghost" size="icon" onClick={() => removeFictionalSecretary(secretary.id)}>
                    <Trash2 className="w-4 h-4" />
                  </Button>
                </div>
              ))}
            </div>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Lancer l'optimisation</CardTitle>
          <CardDescription>
            Calculez l'optimisation avec les médecins et secrétaires fictifs ajoutés
          </CardDescription>
        </CardHeader>
        <CardContent>
          <Button onClick={runOptimization} disabled={isOptimizing} className="w-full" size="lg">
            {isOptimizing ? (
              <>
                <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                Optimisation en cours...
              </>
            ) : (
              <>
                <Zap className="w-4 h-4 mr-2" />
                Optimiser le scénario What-if
              </>
            )}
          </Button>
        </CardContent>
      </Card>

      {optimizationResults.length > 0 && (
        <OptimizationScoreCards scores={optimizationResults} />
      )}
    </div>
  );
}
