import { useState, useEffect } from 'react';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Badge } from '@/components/ui/badge';
import { toast } from 'sonner';
import { supabase } from '@/integrations/supabase/client';
import { Loader2, Plus, Trash2, Zap, ChevronDown, ChevronUp } from 'lucide-react';
import { OptimizationScoreCards } from './OptimizationScoreCards';
import type { FictionalDoctor, FictionalSecretary, WhatIfScenario } from '@/types/scenario';
import type { OptimizationScoreParSpecialite } from '@/types/baseSchedule';
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '@/components/ui/collapsible';

const JOURS_SEMAINE = [
  { value: 1, label: 'L', fullLabel: 'Lundi' },
  { value: 2, label: 'M', fullLabel: 'Mardi' },
  { value: 3, label: 'M', fullLabel: 'Mercredi' },
  { value: 4, label: 'J', fullLabel: 'Jeudi' },
  { value: 5, label: 'V', fullLabel: 'Vendredi' },
];

interface RealDoctor {
  id: string;
  name: string;
  first_name: string;
  specialite_id: string;
  specialite_nom: string;
  besoin_secretaires: number;
  horaires: Array<{
    id: string;
    jour_semaine: number;
    demi_journee: 'matin' | 'apres_midi' | 'toute_journee';
  }>;
}

interface RealSecretary {
  id: string;
  name: string;
  first_name: string;
  sites_assignes: string[];
  horaires: Array<{
    id: string;
    jour_semaine: number;
    demi_journee: 'matin' | 'apres_midi' | 'toute_journee';
  }>;
}

export function WhatIfScenarioEditor() {
  const [realDoctors, setRealDoctors] = useState<RealDoctor[]>([]);
  const [realSecretaries, setRealSecretaries] = useState<RealSecretary[]>([]);
  const [scenario, setScenario] = useState<WhatIfScenario>({
    fictionalDoctors: [],
    fictionalSecretaries: [],
  });
  const [specialites, setSpecialites] = useState<Array<{ id: string; nom: string }>>([]);
  const [isOptimizing, setIsOptimizing] = useState(false);
  const [optimizationResults, setOptimizationResults] = useState<OptimizationScoreParSpecialite[]>([]);
  
  // Modified horaires for real doctors/secretaries
  const [doctorHorairesModifications, setDoctorHorairesModifications] = useState<Map<string, Map<number, 'both' | 'matin' | 'apres_midi' | null>>>(new Map());
  const [secretaryHorairesModifications, setSecretaryHorairesModifications] = useState<Map<string, Map<number, 'both' | 'matin' | 'apres_midi' | null>>>(new Map());
  
  // Expanded states
  const [expandedDoctors, setExpandedDoctors] = useState<Set<string>>(new Set());
  const [expandedSecretaries, setExpandedSecretaries] = useState<Set<string>>(new Set());
  
  // Show add forms
  const [showAddDoctor, setShowAddDoctor] = useState(false);
  const [showAddSecretary, setShowAddSecretary] = useState(false);
  
  // New doctor form
  const [newDoctor, setNewDoctor] = useState({
    specialite_id: '',
    besoin_secretaires: 1.2,
    selectedJours: new Map<number, 'both' | 'matin' | 'apres_midi'>(),
  });

  // New secretary form
  const [newSecretary, setNewSecretary] = useState({
    selectedSpecialites: new Set<string>(),
    selectedJours: new Map<number, 'both' | 'matin' | 'apres_midi'>(),
  });

  useEffect(() => {
    fetchData();
  }, []);

  const fetchData = async () => {
    await Promise.all([fetchSpecialites(), fetchRealDoctors(), fetchRealSecretaries()]);
  };

  const fetchSpecialites = async () => {
    const { data, error } = await supabase
      .from('specialites')
      .select('id, nom')
      .order('nom');
    
    if (!error && data) {
      setSpecialites(data);
    }
  };

  const fetchRealDoctors = async () => {
    const { data: medecins, error: medError } = await supabase
      .from('medecins')
      .select('id, name, first_name, specialite_id, besoin_secretaires, specialites(nom), actif')
      .eq('actif', true);

    if (medError || !medecins) return;

    const { data: horaires, error: horError } = await supabase
      .from('horaires_base_medecins')
      .select('*')
      .eq('actif', true);

    if (horError || !horaires) return;

    const doctors = medecins.map(m => ({
      id: m.id,
      name: m.name || '',
      first_name: m.first_name || '',
      specialite_id: m.specialite_id,
      specialite_nom: (m.specialites as any)?.nom || 'Inconnue',
      besoin_secretaires: m.besoin_secretaires || 1.2,
      horaires: horaires
        .filter(h => h.medecin_id === m.id)
        .map(h => ({
          id: h.id,
          jour_semaine: h.jour_semaine,
          demi_journee: h.demi_journee,
        })),
    }));

    setRealDoctors(doctors);
  };

  const fetchRealSecretaries = async () => {
    const { data: secretaires, error: secError } = await supabase
      .from('secretaires')
      .select('id, name, first_name, sites_assignes, actif')
      .eq('actif', true);

    if (secError || !secretaires) return;

    const { data: horaires, error: horError } = await supabase
      .from('horaires_base_secretaires')
      .select('*')
      .eq('actif', true);

    if (horError || !horaires) return;

    const { data: allSpecialites } = await supabase
      .from('specialites')
      .select('id, nom');

    const specMap = new Map((allSpecialites || []).map(s => [s.id, s.nom]));

    const secretaries = secretaires.map(s => ({
      id: s.id,
      name: s.name || '',
      first_name: s.first_name || '',
      sites_assignes: (s.sites_assignes || []),
      horaires: horaires
        .filter(h => h.secretaire_id === s.id)
        .map(h => ({
          id: h.id,
          jour_semaine: h.jour_semaine,
          demi_journee: h.demi_journee,
        })),
    }));

    setRealSecretaries(secretaries);
  };

  const getPeriodeForHoraire = (demi_journee: 'matin' | 'apres_midi' | 'toute_journee'): 'matin' | 'apres_midi' | 'both' => {
    if (demi_journee === 'toute_journee') return 'both';
    return demi_journee === 'matin' ? 'matin' : 'apres_midi';
  };

  const getDoctorJourStatus = (doctor: RealDoctor, jour: number): 'both' | 'matin' | 'apres_midi' | null => {
    const modifications = doctorHorairesModifications.get(doctor.id);
    if (modifications?.has(jour)) {
      return modifications.get(jour)!;
    }
    
    const horairesDuJour = doctor.horaires.filter(h => h.jour_semaine === jour);
    if (horairesDuJour.length === 0) return null;
    
    const periodes = horairesDuJour.map(h => getPeriodeForHoraire(h.demi_journee));
    if (periodes.includes('both')) return 'both';
    if (periodes.includes('matin') && periodes.includes('apres_midi')) return 'both';
    if (periodes.includes('matin')) return 'matin';
    if (periodes.includes('apres_midi')) return 'apres_midi';
    return null;
  };

  const getSecretaryJourStatus = (secretary: RealSecretary, jour: number): 'both' | 'matin' | 'apres_midi' | null => {
    const modifications = secretaryHorairesModifications.get(secretary.id);
    if (modifications?.has(jour)) {
      return modifications.get(jour)!;
    }
    
    const horairesDuJour = secretary.horaires.filter(h => h.jour_semaine === jour);
    if (horairesDuJour.length === 0) return null;
    
    const periodes = horairesDuJour.map(h => getPeriodeForHoraire(h.demi_journee));
    if (periodes.includes('both')) return 'both';
    if (periodes.includes('matin') && periodes.includes('apres_midi')) return 'both';
    if (periodes.includes('matin')) return 'matin';
    if (periodes.includes('apres_midi')) return 'apres_midi';
    return null;
  };

  const toggleDoctorJour = (doctorId: string, jour: number, newPeriode: 'both' | 'matin' | 'apres_midi') => {
    setDoctorHorairesModifications(prev => {
      const newMap = new Map(prev);
      if (!newMap.has(doctorId)) {
        newMap.set(doctorId, new Map());
      }
      const doctorMods = newMap.get(doctorId)!;
      
      const currentStatus = getDoctorJourStatus(realDoctors.find(d => d.id === doctorId)!, jour);
      if (currentStatus === newPeriode) {
        doctorMods.set(jour, null);
      } else {
        doctorMods.set(jour, newPeriode);
      }
      
      return newMap;
    });
  };

  const toggleSecretaryJour = (secretaryId: string, jour: number, newPeriode: 'both' | 'matin' | 'apres_midi') => {
    setSecretaryHorairesModifications(prev => {
      const newMap = new Map(prev);
      if (!newMap.has(secretaryId)) {
        newMap.set(secretaryId, new Map());
      }
      const secretaryMods = newMap.get(secretaryId)!;
      
      const currentStatus = getSecretaryJourStatus(realSecretaries.find(s => s.id === secretaryId)!, jour);
      if (currentStatus === newPeriode) {
        secretaryMods.set(jour, null);
      } else {
        secretaryMods.set(jour, newPeriode);
      }
      
      return newMap;
    });
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
          { jour_semaine: jour, demi_journee: 'matin' as const, heure_debut: '08:00', heure_fin: '12:00' },
          { jour_semaine: jour, demi_journee: 'apres_midi' as const, heure_debut: '13:00', heure_fin: '17:00' }
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

    setScenario(prev => ({ ...prev, fictionalDoctors: [...prev.fictionalDoctors, doctor] }));
    setNewDoctor({ specialite_id: '', besoin_secretaires: 1.2, selectedJours: new Map() });
    setShowAddDoctor(false);
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
        horaires.push({ jour_semaine: jour, heure_debut: '08:00', heure_fin: '17:00' });
      } else if (periode === 'matin') {
        horaires.push({ jour_semaine: jour, heure_debut: '08:00', heure_fin: '12:00' });
      } else {
        horaires.push({ jour_semaine: jour, heure_debut: '13:00', heure_fin: '17:00' });
      }
    }

    const secretaryNumber = scenario.fictionalSecretaries.length + 1;
    const secretary: FictionalSecretary = {
      id: `fictional-secretary-${Date.now()}`,
      name: `Secrétaire fictive ${secretaryNumber}`,
      specialites: Array.from(newSecretary.selectedSpecialites),
      horaires,
    };

    setScenario(prev => ({ ...prev, fictionalSecretaries: [...prev.fictionalSecretaries, secretary] }));
    setNewSecretary({ selectedSpecialites: new Set(), selectedJours: new Map() });
    setShowAddSecretary(false);
    toast.success('Secrétaire fictive ajoutée');
  };

  const runOptimization = async () => {
    setIsOptimizing(true);
    try {
      // Build scenario with modifications
      const modifiedScenario: WhatIfScenario = {
        fictionalDoctors: [...scenario.fictionalDoctors],
        fictionalSecretaries: [...scenario.fictionalSecretaries],
      };

      // Add modified real doctors as fictional
      for (const [doctorId, modifications] of doctorHorairesModifications) {
        if (modifications.size === 0) continue;
        
        const doctor = realDoctors.find(d => d.id === doctorId);
        if (!doctor) continue;

        const horaires: FictionalDoctor['horaires'] = [];
        for (let jour = 1; jour <= 5; jour++) {
          const status = getDoctorJourStatus(doctor, jour);
          if (!status) continue;

          if (status === 'both') {
            horaires.push(
              { jour_semaine: jour, demi_journee: 'matin', heure_debut: '08:00', heure_fin: '12:00' },
              { jour_semaine: jour, demi_journee: 'apres_midi', heure_debut: '13:00', heure_fin: '17:00' }
            );
          } else {
            horaires.push({
              jour_semaine: jour,
              demi_journee: status,
              heure_debut: status === 'matin' ? '08:00' : '13:00',
              heure_fin: status === 'matin' ? '12:00' : '17:00',
            });
          }
        }

        if (horaires.length > 0) {
          modifiedScenario.fictionalDoctors.push({
            id: `modified-${doctorId}`,
            name: `${doctor.first_name} ${doctor.name} (modifié)`,
            specialite_id: doctor.specialite_id,
            besoin_secretaires: doctor.besoin_secretaires,
            horaires,
          });
        }
      }

      // Add modified real secretaries as fictional
      for (const [secretaryId, modifications] of secretaryHorairesModifications) {
        if (modifications.size === 0) continue;
        
        const secretary = realSecretaries.find(s => s.id === secretaryId);
        if (!secretary) continue;

        const horaires: FictionalSecretary['horaires'] = [];
        for (let jour = 1; jour <= 5; jour++) {
          const status = getSecretaryJourStatus(secretary, jour);
          if (!status) continue;

          if (status === 'both') {
            horaires.push({ jour_semaine: jour, heure_debut: '08:00', heure_fin: '17:00' });
          } else if (status === 'matin') {
            horaires.push({ jour_semaine: jour, heure_debut: '08:00', heure_fin: '12:00' });
          } else {
            horaires.push({ jour_semaine: jour, heure_debut: '13:00', heure_fin: '17:00' });
          }
        }

        if (horaires.length > 0) {
          modifiedScenario.fictionalSecretaries.push({
            id: `modified-${secretaryId}`,
            name: `${secretary.first_name} ${secretary.name} (modifié)`,
            specialites: secretary.sites_assignes,
            horaires,
          });
        }
      }

      const { data, error } = await supabase.functions.invoke('optimize-base-schedule-milp-scenario', {
        body: { scenario: modifiedScenario },
      });

      if (error) throw error;

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

  const getPeriodeColor = (periode: 'matin' | 'apres_midi' | 'both' | null) => {
    if (!periode) return 'bg-muted text-muted-foreground';
    if (periode === 'matin') return 'bg-blue-100 text-blue-700 dark:bg-blue-900/30 dark:text-blue-300';
    if (periode === 'apres_midi') return 'bg-orange-100 text-orange-700 dark:bg-orange-900/30 dark:text-orange-300';
    return 'bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-300';
  };

  const toggleJourNewDoctor = (jour: number, periode: 'both' | 'matin' | 'apres_midi') => {
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

  const toggleJourNewSecretary = (jour: number, periode: 'both' | 'matin' | 'apres_midi') => {
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

  return (
    <div className="space-y-6">
      {/* Médecins Section */}
      <Card>
        <CardHeader>
          <div className="flex items-center justify-between">
            <div>
              <CardTitle>Médecins</CardTitle>
              <CardDescription>Modifiez les horaires des médecins existants ou ajoutez-en de fictifs</CardDescription>
            </div>
            <Button onClick={() => setShowAddDoctor(!showAddDoctor)} variant="outline" size="sm">
              <Plus className="w-4 h-4 mr-2" />
              Ajouter un médecin
            </Button>
          </div>
        </CardHeader>
        <CardContent className="space-y-3">
          {/* Real Doctors */}
          {realDoctors.map(doctor => {
            const isExpanded = expandedDoctors.has(doctor.id);
            return (
              <Collapsible
                key={doctor.id}
                open={isExpanded}
                onOpenChange={(open) => {
                  setExpandedDoctors(prev => {
                    const newSet = new Set(prev);
                    if (open) newSet.add(doctor.id);
                    else newSet.delete(doctor.id);
                    return newSet;
                  });
                }}
              >
                <div className="border rounded-lg p-3 bg-card">
                  <CollapsibleTrigger asChild>
                    <div className="flex items-center justify-between cursor-pointer">
                      <div className="flex-1">
                        <div className="font-medium">{doctor.first_name} {doctor.name}</div>
                        <div className="text-sm text-muted-foreground">{doctor.specialite_nom}</div>
                        <div className="flex gap-1 mt-2">
                          {JOURS_SEMAINE.map(jour => {
                            const status = getDoctorJourStatus(doctor, jour.value);
                            return (
                              <div
                                key={jour.value}
                                className={`w-8 h-8 rounded flex items-center justify-center text-xs font-medium ${getPeriodeColor(status)}`}
                                title={`${jour.fullLabel}${status ? ` - ${status === 'both' ? 'Journée' : status === 'matin' ? 'Matin' : 'Après-midi'}` : ' - Absent'}`}
                              >
                                {jour.label}
                              </div>
                            );
                          })}
                        </div>
                      </div>
                      <Button variant="ghost" size="sm">
                        {isExpanded ? <ChevronUp className="w-4 h-4" /> : <ChevronDown className="w-4 h-4" />}
                      </Button>
                    </div>
                  </CollapsibleTrigger>
                  <CollapsibleContent className="mt-4 pt-4 border-t space-y-2">
                    <Label className="text-sm">Modifier les jours de travail</Label>
                    {JOURS_SEMAINE.map(jour => {
                      const status = getDoctorJourStatus(doctor, jour.value);
                      return (
                        <div key={jour.value} className="flex items-center gap-2">
                          <span className="w-24 text-sm font-medium">{jour.fullLabel}</span>
                          <div className="flex gap-1">
                            <Button
                              type="button"
                              variant={status === 'matin' ? 'default' : 'outline'}
                              size="sm"
                              onClick={() => toggleDoctorJour(doctor.id, jour.value, 'matin')}
                            >
                              Matin
                            </Button>
                            <Button
                              type="button"
                              variant={status === 'apres_midi' ? 'default' : 'outline'}
                              size="sm"
                              onClick={() => toggleDoctorJour(doctor.id, jour.value, 'apres_midi')}
                            >
                              Après-midi
                            </Button>
                            <Button
                              type="button"
                              variant={status === 'both' ? 'default' : 'outline'}
                              size="sm"
                              onClick={() => toggleDoctorJour(doctor.id, jour.value, 'both')}
                            >
                              Journée
                            </Button>
                          </div>
                        </div>
                      );
                    })}
                  </CollapsibleContent>
                </div>
              </Collapsible>
            );
          })}

          {/* Fictional Doctors */}
          {scenario.fictionalDoctors.map(doctor => (
            <div key={doctor.id} className="border rounded-lg p-3 bg-muted/50">
              <div className="flex items-center justify-between">
                <div className="flex-1">
                  <div className="font-medium">{doctor.name}</div>
                  <div className="text-sm text-muted-foreground">
                    {specialites.find(s => s.id === doctor.specialite_id)?.nom}
                  </div>
                  <div className="flex gap-1 mt-2">
                    {JOURS_SEMAINE.map(jour => {
                      const horairesDuJour = doctor.horaires.filter(h => h.jour_semaine === jour.value);
                      let status: 'both' | 'matin' | 'apres_midi' | null = null;
                      if (horairesDuJour.some(h => h.demi_journee === 'matin') && horairesDuJour.some(h => h.demi_journee === 'apres_midi')) {
                        status = 'both';
                      } else if (horairesDuJour.some(h => h.demi_journee === 'matin')) {
                        status = 'matin';
                      } else if (horairesDuJour.some(h => h.demi_journee === 'apres_midi')) {
                        status = 'apres_midi';
                      }
                      return (
                        <div
                          key={jour.value}
                          className={`w-8 h-8 rounded flex items-center justify-center text-xs font-medium ${getPeriodeColor(status)}`}
                        >
                          {jour.label}
                        </div>
                      );
                    })}
                  </div>
                </div>
                <Button variant="ghost" size="icon" onClick={() => removeFictionalDoctor(doctor.id)}>
                  <Trash2 className="w-4 h-4" />
                </Button>
              </div>
            </div>
          ))}

          {/* Add Doctor Form */}
          {showAddDoctor && (
            <div className="border rounded-lg p-4 bg-muted/30 space-y-4">
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
                <Label>Jours de travail</Label>
                {JOURS_SEMAINE.map(jour => {
                  const periode = newDoctor.selectedJours.get(jour.value);
                  return (
                    <div key={jour.value} className="flex items-center gap-2">
                      <span className="w-24 text-sm font-medium">{jour.fullLabel}</span>
                      <div className="flex gap-1">
                        <Button
                          type="button"
                          variant={periode === 'matin' ? 'default' : 'outline'}
                          size="sm"
                          onClick={() => toggleJourNewDoctor(jour.value, 'matin')}
                        >
                          Matin
                        </Button>
                        <Button
                          type="button"
                          variant={periode === 'apres_midi' ? 'default' : 'outline'}
                          size="sm"
                          onClick={() => toggleJourNewDoctor(jour.value, 'apres_midi')}
                        >
                          Après-midi
                        </Button>
                        <Button
                          type="button"
                          variant={periode === 'both' ? 'default' : 'outline'}
                          size="sm"
                          onClick={() => toggleJourNewDoctor(jour.value, 'both')}
                        >
                          Journée
                        </Button>
                      </div>
                    </div>
                  );
                })}
              </div>

              <div className="flex gap-2">
                <Button onClick={addFictionalDoctor} className="flex-1">
                  <Plus className="w-4 h-4 mr-2" />
                  Ajouter
                </Button>
                <Button variant="outline" onClick={() => setShowAddDoctor(false)}>
                  Annuler
                </Button>
              </div>
            </div>
          )}
        </CardContent>
      </Card>

      {/* Secrétaires Section */}
      <Card>
        <CardHeader>
          <div className="flex items-center justify-between">
            <div>
              <CardTitle>Secrétaires</CardTitle>
              <CardDescription>Modifiez les horaires des secrétaires existantes ou ajoutez-en de fictives</CardDescription>
            </div>
            <Button onClick={() => setShowAddSecretary(!showAddSecretary)} variant="outline" size="sm">
              <Plus className="w-4 h-4 mr-2" />
              Ajouter une secrétaire
            </Button>
          </div>
        </CardHeader>
        <CardContent className="space-y-3">
          {/* Real Secretaries */}
          {realSecretaries.map(secretary => {
            const isExpanded = expandedSecretaries.has(secretary.id);
            return (
              <Collapsible
                key={secretary.id}
                open={isExpanded}
                onOpenChange={(open) => {
                  setExpandedSecretaries(prev => {
                    const newSet = new Set(prev);
                    if (open) newSet.add(secretary.id);
                    else newSet.delete(secretary.id);
                    return newSet;
                  });
                }}
              >
                <div className="border rounded-lg p-3 bg-card">
                  <CollapsibleTrigger asChild>
                    <div className="flex items-center justify-between cursor-pointer">
                      <div className="flex-1">
                        <div className="font-medium">{secretary.first_name} {secretary.name}</div>
                        <div className="flex flex-wrap gap-1 mt-1">
                          <Badge variant="secondary" className="text-xs">
                            {secretary.sites_assignes.length} sites assignés
                          </Badge>
                        </div>
                        <div className="flex gap-1 mt-2">
                          {JOURS_SEMAINE.map(jour => {
                            const status = getSecretaryJourStatus(secretary, jour.value);
                            return (
                              <div
                                key={jour.value}
                                className={`w-8 h-8 rounded flex items-center justify-center text-xs font-medium ${getPeriodeColor(status)}`}
                                title={`${jour.fullLabel}${status ? ` - ${status === 'both' ? 'Journée' : status === 'matin' ? 'Matin' : 'Après-midi'}` : ' - Absent'}`}
                              >
                                {jour.label}
                              </div>
                            );
                          })}
                        </div>
                      </div>
                      <Button variant="ghost" size="sm">
                        {isExpanded ? <ChevronUp className="w-4 h-4" /> : <ChevronDown className="w-4 h-4" />}
                      </Button>
                    </div>
                  </CollapsibleTrigger>
                  <CollapsibleContent className="mt-4 pt-4 border-t space-y-2">
                    <Label className="text-sm">Modifier les jours de travail</Label>
                    {JOURS_SEMAINE.map(jour => {
                      const status = getSecretaryJourStatus(secretary, jour.value);
                      return (
                        <div key={jour.value} className="flex items-center gap-2">
                          <span className="w-24 text-sm font-medium">{jour.fullLabel}</span>
                          <div className="flex gap-1">
                            <Button
                              type="button"
                              variant={status === 'matin' ? 'default' : 'outline'}
                              size="sm"
                              onClick={() => toggleSecretaryJour(secretary.id, jour.value, 'matin')}
                            >
                              Matin
                            </Button>
                            <Button
                              type="button"
                              variant={status === 'apres_midi' ? 'default' : 'outline'}
                              size="sm"
                              onClick={() => toggleSecretaryJour(secretary.id, jour.value, 'apres_midi')}
                            >
                              Après-midi
                            </Button>
                            <Button
                              type="button"
                              variant={status === 'both' ? 'default' : 'outline'}
                              size="sm"
                              onClick={() => toggleSecretaryJour(secretary.id, jour.value, 'both')}
                            >
                              Journée
                            </Button>
                          </div>
                        </div>
                      );
                    })}
                  </CollapsibleContent>
                </div>
              </Collapsible>
            );
          })}

          {/* Fictional Secretaries */}
          {scenario.fictionalSecretaries.map(secretary => (
            <div key={secretary.id} className="border rounded-lg p-3 bg-muted/50">
              <div className="flex items-center justify-between">
                <div className="flex-1">
                  <div className="font-medium">{secretary.name}</div>
                  <div className="text-sm text-muted-foreground">
                    {secretary.specialites.length} spécialité{secretary.specialites.length > 1 ? 's' : ''}
                  </div>
                  <div className="flex gap-1 mt-2">
                    {JOURS_SEMAINE.map(jour => {
                      const jourHoraires = secretary.horaires.filter(h => h.jour_semaine === jour.value);
                      let status: 'both' | 'matin' | 'apres_midi' | null = null;
                      if (jourHoraires.length > 0) {
                        const h = jourHoraires[0];
                        if (h.heure_debut <= '12:00' && h.heure_fin >= '13:00') {
                          status = 'both';
                        } else if (h.heure_debut < '13:00') {
                          status = 'matin';
                        } else {
                          status = 'apres_midi';
                        }
                      }
                      return (
                        <div
                          key={jour.value}
                          className={`w-8 h-8 rounded flex items-center justify-center text-xs font-medium ${getPeriodeColor(status)}`}
                        >
                          {jour.label}
                        </div>
                      );
                    })}
                  </div>
                </div>
                <Button variant="ghost" size="icon" onClick={() => removeFictionalSecretary(secretary.id)}>
                  <Trash2 className="w-4 h-4" />
                </Button>
              </div>
            </div>
          ))}

          {/* Add Secretary Form */}
          {showAddSecretary && (
            <div className="border rounded-lg p-4 bg-muted/30 space-y-4">
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
                {JOURS_SEMAINE.map(jour => {
                  const periode = newSecretary.selectedJours.get(jour.value);
                  return (
                    <div key={jour.value} className="flex items-center gap-2">
                      <span className="w-24 text-sm font-medium">{jour.fullLabel}</span>
                      <div className="flex gap-1">
                        <Button
                          type="button"
                          variant={periode === 'matin' ? 'default' : 'outline'}
                          size="sm"
                          onClick={() => toggleJourNewSecretary(jour.value, 'matin')}
                        >
                          Matin
                        </Button>
                        <Button
                          type="button"
                          variant={periode === 'apres_midi' ? 'default' : 'outline'}
                          size="sm"
                          onClick={() => toggleJourNewSecretary(jour.value, 'apres_midi')}
                        >
                          Après-midi
                        </Button>
                        <Button
                          type="button"
                          variant={periode === 'both' ? 'default' : 'outline'}
                          size="sm"
                          onClick={() => toggleJourNewSecretary(jour.value, 'both')}
                        >
                          Journée
                        </Button>
                      </div>
                    </div>
                  );
                })}
              </div>

              <div className="flex gap-2">
                <Button onClick={addFictionalSecretary} className="flex-1">
                  <Plus className="w-4 h-4 mr-2" />
                  Ajouter
                </Button>
                <Button variant="outline" onClick={() => setShowAddSecretary(false)}>
                  Annuler
                </Button>
              </div>
            </div>
          )}
        </CardContent>
      </Card>

      {/* Run Optimization */}
      <Card>
        <CardHeader>
          <CardTitle>Lancer l'optimisation</CardTitle>
          <CardDescription>
            Calculez l'optimisation avec les modifications et ajouts effectués
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

      {/* Results */}
      {optimizationResults.length > 0 && (
        <OptimizationScoreCards scores={optimizationResults} />
      )}
    </div>
  );
}
