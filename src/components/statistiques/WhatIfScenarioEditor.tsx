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
    name: '',
    specialite_id: '',
    besoin_secretaires: 1.2,
    selectedJours: new Set<number>(),
    demiJournee: 'both' as 'both' | 'matin' | 'apres_midi',
    heure_debut: '08:00',
    heure_fin: '17:00',
  });

  // New secretary form
  const [newSecretary, setNewSecretary] = useState({
    name: '',
    selectedSpecialites: new Set<string>(),
    selectedJours: new Set<number>(),
    heure_debut: '08:00',
    heure_fin: '17:00',
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
    if (!newDoctor.name || !newDoctor.specialite_id || newDoctor.selectedJours.size === 0) {
      toast.error('Veuillez remplir tous les champs obligatoires');
      return;
    }

    const horaires = Array.from(newDoctor.selectedJours).map(jour => {
      if (newDoctor.demiJournee === 'both') {
        return [
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
          },
        ];
      } else {
        return [{
          jour_semaine: jour,
          demi_journee: newDoctor.demiJournee,
          heure_debut: newDoctor.demiJournee === 'matin' ? '08:00' : '13:00',
          heure_fin: newDoctor.demiJournee === 'matin' ? '12:00' : '17:00',
        }];
      }
    }).flat();

    const doctor: FictionalDoctor = {
      id: `fictional-doctor-${Date.now()}`,
      name: newDoctor.name,
      specialite_id: newDoctor.specialite_id,
      besoin_secretaires: newDoctor.besoin_secretaires,
      horaires,
    };

    setScenario(prev => ({
      ...prev,
      fictionalDoctors: [...prev.fictionalDoctors, doctor],
    }));

    setNewDoctor({
      name: '',
      specialite_id: '',
      besoin_secretaires: 1.2,
      selectedJours: new Set(),
      demiJournee: 'both',
      heure_debut: '08:00',
      heure_fin: '17:00',
    });

    toast.success('Médecin fictif ajouté');
  };

  const addFictionalSecretary = () => {
    if (!newSecretary.name || newSecretary.selectedSpecialites.size === 0 || newSecretary.selectedJours.size === 0) {
      toast.error('Veuillez remplir tous les champs obligatoires');
      return;
    }

    const horaires = Array.from(newSecretary.selectedJours).map(jour => ({
      jour_semaine: jour,
      heure_debut: newSecretary.heure_debut,
      heure_fin: newSecretary.heure_fin,
    }));

    const secretary: FictionalSecretary = {
      id: `fictional-secretary-${Date.now()}`,
      name: newSecretary.name,
      specialites: Array.from(newSecretary.selectedSpecialites),
      horaires,
    };

    setScenario(prev => ({
      ...prev,
      fictionalSecretaries: [...prev.fictionalSecretaries, secretary],
    }));

    setNewSecretary({
      name: '',
      selectedSpecialites: new Set(),
      selectedJours: new Set(),
      heure_debut: '08:00',
      heure_fin: '17:00',
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

  const toggleJourDoctor = (jour: number) => {
    setNewDoctor(prev => {
      const newSet = new Set(prev.selectedJours);
      if (newSet.has(jour)) {
        newSet.delete(jour);
      } else {
        newSet.add(jour);
      }
      return { ...prev, selectedJours: newSet };
    });
  };

  const toggleJourSecretary = (jour: number) => {
    setNewSecretary(prev => {
      const newSet = new Set(prev.selectedJours);
      if (newSet.has(jour)) {
        newSet.delete(jour);
      } else {
        newSet.add(jour);
      }
      return { ...prev, selectedJours: newSet };
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
          <div className="grid grid-cols-2 gap-4">
            <div className="space-y-2">
              <Label>Nom du médecin</Label>
              <Input
                value={newDoctor.name}
                onChange={e => setNewDoctor(prev => ({ ...prev, name: e.target.value }))}
                placeholder="Dr. Dupont"
              />
            </div>
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
          </div>

          <div className="space-y-2">
            <Label>Jours de travail</Label>
            <div className="flex gap-2">
              {JOURS_SEMAINE.map(jour => (
                <Button
                  key={jour.value}
                  type="button"
                  variant={newDoctor.selectedJours.has(jour.value) ? 'default' : 'outline'}
                  size="sm"
                  onClick={() => toggleJourDoctor(jour.value)}
                >
                  {jour.label}
                </Button>
              ))}
            </div>
          </div>

          <div className="space-y-2">
            <Label>Demi-journée</Label>
            <Select value={newDoctor.demiJournee} onValueChange={value => setNewDoctor(prev => ({ ...prev, demiJournee: value as any }))}>
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="both">Journée complète</SelectItem>
                <SelectItem value="matin">Matin uniquement</SelectItem>
                <SelectItem value="apres_midi">Après-midi uniquement</SelectItem>
              </SelectContent>
            </Select>
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
            <Label>Nom de la secrétaire</Label>
            <Input
              value={newSecretary.name}
              onChange={e => setNewSecretary(prev => ({ ...prev, name: e.target.value }))}
              placeholder="Marie Martin"
            />
          </div>

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
            <Label>Jours de travail</Label>
            <div className="flex gap-2">
              {JOURS_SEMAINE.map(jour => (
                <Button
                  key={jour.value}
                  type="button"
                  variant={newSecretary.selectedJours.has(jour.value) ? 'default' : 'outline'}
                  size="sm"
                  onClick={() => toggleJourSecretary(jour.value)}
                >
                  {jour.label}
                </Button>
              ))}
            </div>
          </div>

          <div className="grid grid-cols-2 gap-4">
            <div className="space-y-2">
              <Label>Heure de début</Label>
              <Input
                type="time"
                value={newSecretary.heure_debut}
                onChange={e => setNewSecretary(prev => ({ ...prev, heure_debut: e.target.value }))}
              />
            </div>
            <div className="space-y-2">
              <Label>Heure de fin</Label>
              <Input
                type="time"
                value={newSecretary.heure_fin}
                onChange={e => setNewSecretary(prev => ({ ...prev, heure_fin: e.target.value }))}
              />
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
