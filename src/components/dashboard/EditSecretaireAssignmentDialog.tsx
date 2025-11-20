import { useState, useEffect } from 'react';
import { supabase } from '@/integrations/supabase/client';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Label } from '@/components/ui/label';
import { RadioGroup, RadioGroupItem } from '@/components/ui/radio-group';
import { Checkbox } from '@/components/ui/checkbox';
import { Loader2 } from 'lucide-react';
import { toast } from '@/hooks/use-toast';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';

interface Secretaire {
  id: string;
  capacite_id: string;
  nom: string;
  periode: 'matin' | 'apres_midi' | 'journee';
  is_1r: boolean;
  is_2f: boolean;
  is_3f: boolean;
}

interface Site {
  id: string;
  nom: string;
}

interface OperationWithNeed {
  id: string; // planning_genere_bloc_operatoire.id
  besoin_effectif_id: string;
  besoin_operation_id: string; // ID du besoin opérationnel réel
  besoin_operation_nom: string; // Nom du besoin opérationnel
  medecin_nom: string;
  type_intervention_nom: string;
  salle_nom: string | null;
  periode: 'matin' | 'apres_midi';
  besoins_requis: number;
  besoins_assignes: number;
}

interface EditSecretaireAssignmentDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  secretaire: Secretaire;
  date: string;
  siteId: string;
  onSuccess: () => void;
}

export function EditSecretaireAssignmentDialog({
  open,
  onOpenChange,
  secretaire,
  date,
  siteId,
  onSuccess,
}: EditSecretaireAssignmentDialogProps) {
  const [sites, setSites] = useState<Site[]>([]);
  const [selectedSiteId, setSelectedSiteId] = useState(siteId);
  const [periode, setPeriode] = useState(secretaire.periode);
  const [responsibility, setResponsibility] = useState<'1r' | '2f' | '3f' | null>(null);
  const [loading, setLoading] = useState(false);
  const [fetchingData, setFetchingData] = useState(true);
  const [operations, setOperations] = useState<OperationWithNeed[]>([]);
  const [selectedOperationId, setSelectedOperationId] = useState<string | null>(null);
  const [loadingOperations, setLoadingOperations] = useState(false);
  const [blocSiteId, setBlocSiteId] = useState<string | null>(null);

  useEffect(() => {
    if (open) {
      fetchInitialData();
    }
  }, [open, secretaire, siteId]);

  // Reset site selection if switching to "journee" while bloc is selected
  useEffect(() => {
    if (periode === 'journee' && blocSiteId && selectedSiteId === blocSiteId) {
      const nonBlocSite = sites.find(s => s.id !== blocSiteId);
      if (nonBlocSite) {
        setSelectedSiteId(nonBlocSite.id);
      }
      setSelectedOperationId(null);
    }
  }, [periode, blocSiteId, selectedSiteId, sites]);

  const fetchInitialData = async () => {
    setFetchingData(true);
    try {
      // Fetch capacite_effective to get real responsibility values
      const { data: capacites } = await supabase
        .from('capacite_effective')
        .select('is_1r, is_2f, is_3f, demi_journee')
        .eq('secretaire_id', secretaire.id)
        .eq('date', date)
        .eq('actif', true);

      // Determine actual responsibility from capacite_effective
      let actualResponsibility: '1r' | '2f' | '3f' | null = null;
      if (capacites && capacites.length > 0) {
        const hasAny1r = capacites.some(c => c.is_1r);
        const hasAny2f = capacites.some(c => c.is_2f);
        const hasAny3f = capacites.some(c => c.is_3f);
        
        if (hasAny1r) actualResponsibility = '1r';
        else if (hasAny2f) actualResponsibility = '2f';
        else if (hasAny3f) actualResponsibility = '3f';
      }

      setSelectedSiteId(siteId);
      setPeriode(secretaire.periode);
      setResponsibility(actualResponsibility);
      
      await fetchSites();
    } finally {
      setFetchingData(false);
    }
  };

  const fetchSites = async () => {
    const adminSiteId = '00000000-0000-0000-0000-000000000001';
    
    // 1. Récupérer les sites de préférence de l'assistant médical
    const { data: preferencesData } = await supabase
      .from('secretaires_sites')
      .select('site_id, sites(id, nom)')
      .eq('secretaire_id', secretaire.id);

    // 2. Extraire les sites uniques (sans exclure le bloc opératoire)
    const siteIds = new Set<string>();
    const sitesFromPreferences: Site[] = [];
    
    preferencesData?.forEach((pref: any) => {
      if (pref.sites && !siteIds.has(pref.sites.id)) {
        siteIds.add(pref.sites.id);
        sitesFromPreferences.push({
          id: pref.sites.id,
          nom: pref.sites.nom
        });
      }
    });

    // 3. Ajouter le site Administratif s'il n'est pas déjà présent (tout le monde peut y être affecté)
    if (!siteIds.has(adminSiteId)) {
      const { data: adminSite } = await supabase
        .from('sites')
        .select('id, nom')
        .eq('id', adminSiteId)
        .eq('actif', true)
        .single();
      
      if (adminSite) {
        sitesFromPreferences.push(adminSite);
      }
    }

    // 4. Ajouter le bloc opératoire si l'assistant médical a des besoins opératoires
    const { data: besoinOps } = await supabase
      .from('secretaires_besoins_operations')
      .select('besoin_operation_id')
      .eq('secretaire_id', secretaire.id);
    
    if (besoinOps && besoinOps.length > 0) {
      // L'assistant médical a des besoins opératoires, on peut ajouter le bloc opératoire
      const { data: blocSite } = await supabase
        .from('sites')
        .select('id, nom')
        .ilike('nom', '%bloc opératoire%')
        .eq('actif', true)
        .limit(1)
        .single();
      
      if (blocSite && !siteIds.has(blocSite.id)) {
        sitesFromPreferences.push(blocSite);
      }
    }

    // 5. Identifier le bloc opératoire pour l'utiliser plus tard
    const blocSiteFound = sitesFromPreferences.find(s => s.nom.toLowerCase().includes('bloc opératoire'));
    if (blocSiteFound) {
      setBlocSiteId(blocSiteFound.id);
    }

    // 6. Trier par nom
    sitesFromPreferences.sort((a, b) => a.nom.localeCompare(b.nom));
    setSites(sitesFromPreferences);
  };

  const fetchOperations = async () => {
    if (!blocSiteId) return;
    
    setLoadingOperations(true);
    setOperations([]);
    setSelectedOperationId(null);
    
    try {
      // Déterminer quelles périodes chercher
      const targetPeriods: ('matin' | 'apres_midi')[] = 
        periode === 'journee' ? ['matin', 'apres_midi'] : [periode];

      // 1. Récupérer toutes les opérations pour cette date (non annulées)
      const { data: planningOps, error: opsError } = await supabase
        .from('planning_genere_bloc_operatoire')
        .select(`
          id,
          date,
          periode,
          besoin_effectif_id,
          type_intervention_id,
          medecin_id,
          salle_assignee,
          statut,
          medecins!planning_genere_bloc_operatoire_medecin_id_fkey(first_name, name),
          types_intervention(nom),
          salles_operation:salle_assignee(name)
        `)
        .eq('date', date)
        .neq('statut', 'annule');

      if (opsError) throw opsError;
      if (!planningOps || planningOps.length === 0) {
        setOperations([]);
        return;
      }

      // Filtrer par période côté client
      const filteredOps = planningOps.filter(op => {
        if (op.periode === 'toute_journee') return true; // Les opérations toute journée sont toujours disponibles
        return targetPeriods.includes(op.periode as 'matin' | 'apres_midi');
      });

      // 2. Pour chaque opération, récupérer les besoins requis et compter les assignations
      const operationsWithNeeds: OperationWithNeed[] = [];

      for (const op of filteredOps) {
        // Récupérer le nombre d'assistants médicaux requis pour ce type d'intervention
        const { data: besoinsData } = await supabase
          .from('types_intervention_besoins_personnel')
          .select('nombre_requis, besoin_operation_id, besoins_operations(nom)')
          .eq('type_intervention_id', op.type_intervention_id)
          .eq('actif', true);

        if (!besoinsData || besoinsData.length === 0) continue;

        // Itérer sur CHAQUE besoin opérationnel spécifique
        for (const besoin of besoinsData) {
          const besoinOperationId = besoin.besoin_operation_id;
          const besoinOperationNom = (besoin.besoins_operations as any)?.nom || 'Besoin non défini';
          const nombreRequis = besoin.nombre_requis;
          
          if (!besoinOperationId) continue;

          // Déterminer la période à vérifier
          const periodeToCheck = op.periode === 'toute_journee' 
            ? (periode === 'journee' ? 'matin' : periode)
            : op.periode;
          
          // Compter les assistants médicaux assignés POUR CE BESOIN SPÉCIFIQUE
          const { data: assignedData } = await supabase
            .from('capacite_effective')
            .select('id')
            .eq('planning_genere_bloc_operatoire_id', op.id)
            .eq('besoin_operation_id', besoinOperationId) // Filtrer par besoin spécifique
            .eq('date', date)
            .eq('demi_journee', periodeToCheck)
            .eq('actif', true);

          const nombreAssignes = assignedData?.length || 0;

          // Si des places sont disponibles POUR CE BESOIN SPÉCIFIQUE, ajouter au dropdown
          if (nombreAssignes < nombreRequis) {
            const medecinNom = op.medecins 
              ? `Dr ${op.medecins.first_name} ${op.medecins.name}`
              : 'Médecin non assigné';
            
            const displayPeriode: 'matin' | 'apres_midi' = 
              op.periode === 'toute_journee' 
                ? (periode === 'journee' ? 'matin' : periode)
                : (op.periode as 'matin' | 'apres_midi');
            
            operationsWithNeeds.push({
              id: op.id,
              besoin_effectif_id: op.besoin_effectif_id,
              besoin_operation_id: besoinOperationId,
              besoin_operation_nom: besoinOperationNom,
              medecin_nom: medecinNom,
              type_intervention_nom: op.types_intervention?.nom || 'Intervention',
              salle_nom: op.salles_operation?.name || null,
              periode: displayPeriode,
              besoins_requis: nombreRequis, // Besoin spécifique, pas total
              besoins_assignes: nombreAssignes, // Assignations spécifiques à ce besoin
            });
          }
        }
      }

      setOperations(operationsWithNeeds);
    } catch (error: any) {
      console.error('Error fetching operations:', error);
      toast({
        title: 'Erreur',
        description: 'Impossible de récupérer les opérations disponibles',
        variant: 'destructive',
      });
    } finally {
      setLoadingOperations(false);
    }
  };

  // Déclencher la récupération des opérations quand bloc opératoire est sélectionné
  useEffect(() => {
    if (selectedSiteId === blocSiteId && blocSiteId) {
      fetchOperations();
    } else {
      setOperations([]);
      setSelectedOperationId(null);
    }
  }, [selectedSiteId, blocSiteId, periode]);

  const handleSubmit = async () => {
    // Validate responsibility requires full day
    if (responsibility && periode !== 'journee') {
      toast({
        title: 'Attention',
        description: 'Une responsabilité nécessite une assignation pour toute la journée',
        variant: 'destructive',
      });
      return;
    }

    // Prevent full-day assignment to operating room (bloc opératoire is always half-day)
    if (periode === 'journee' && selectedSiteId === blocSiteId) {
      toast({
        title: 'Attention',
        description: 'Impossible de réaffecter une journée complète au bloc opératoire (toujours par demi-journée)',
        variant: 'destructive',
      });
      return;
    }

    // Si bloc opératoire sélectionné, une opération doit être choisie
    if (selectedSiteId === blocSiteId && !selectedOperationId) {
      toast({
        title: 'Attention',
        description: 'Veuillez sélectionner une opération pour le bloc opératoire',
        variant: 'destructive',
      });
      return;
    }

    setLoading(true);
    try {
      // 1. Récupérer les capacités existantes pour cet assistant médical à cette date
      const { data: existingCapacites } = await supabase
        .from('capacite_effective')
        .select('id, demi_journee')
        .eq('secretaire_id', secretaire.id)
        .eq('date', date);

      // 2. Déterminer quelles demi-journées UPDATE
      const targetPeriods: ('matin' | 'apres_midi')[] = 
        periode === 'journee' ? ['matin', 'apres_midi'] : [periode];

      // 3. Si assignation à une opération, récupérer les infos
      let operationData: OperationWithNeed | null = null;
      if (selectedOperationId) {
        operationData = operations.find(op => op.id === selectedOperationId) || null;
      }

      // 4. UPDATE chaque demi-journée concernée
      for (const targetPeriod of targetPeriods) {
        const existingCapacite = existingCapacites?.find(c => c.demi_journee === targetPeriod);
        
        if (existingCapacite) {
          // Préparer l'update
          const updateData: any = {
            site_id: selectedSiteId,
            is_1r: responsibility === '1r',
            is_2f: responsibility === '2f',
            is_3f: responsibility === '3f',
          };

          // Si assignation au bloc opératoire avec une opération
          if (operationData && targetPeriod === operationData.periode) {
            updateData.planning_genere_bloc_operatoire_id = operationData.id;
            updateData.besoin_operation_id = operationData.besoin_operation_id;
          } else {
            // Réinitialiser les champs bloc si changement vers site classique
            updateData.planning_genere_bloc_operatoire_id = null;
            updateData.besoin_operation_id = null;
          }

          // UPDATE la ligne existante
          const { error } = await supabase
            .from('capacite_effective')
            .update(updateData)
            .eq('id', existingCapacite.id);

          if (error) throw error;
        }
      }

      toast({
        title: 'Succès',
        description: 'Assignation modifiée avec succès',
      });

      onSuccess();
    } catch (error: any) {
      console.error('Error updating secretaire:', error);
      toast({
        title: 'Erreur',
        description: error.message || 'Impossible de modifier l\'assignation',
        variant: 'destructive',
      });
    } finally {
      setLoading(false);
    }
  };

  // Déterminer si le bouton "Enregistrer" doit être désactivé
  const isBlocSelected = selectedSiteId === blocSiteId && periode !== 'journee';
  const canSubmit = !isBlocSelected || (isBlocSelected && selectedOperationId);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle className="text-primary">
            Modifier l'assignation
          </DialogTitle>
          <DialogDescription className="text-muted-foreground">
            Assistant médical : {secretaire.nom}
          </DialogDescription>
        </DialogHeader>

        {fetchingData ? (
          <div className="flex items-center justify-center py-8">
            <Loader2 className="h-6 w-6 animate-spin text-primary" />
          </div>
        ) : (
          <div className="space-y-4">
            <div className="space-y-2">
              <Label>Site</Label>
              <Select value={selectedSiteId} onValueChange={setSelectedSiteId}>
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {sites
                    .filter(site => !(periode === 'journee' && site.id === blocSiteId))
                    .map((site) => (
                      <SelectItem key={site.id} value={site.id}>
                        {site.nom}
                      </SelectItem>
                    ))}
                </SelectContent>
              </Select>
            </div>

            {/* Dropdown conditionnel pour sélectionner une opération au bloc */}
            {isBlocSelected && (
              <div className="space-y-2">
                <Label>Opération au bloc opératoire</Label>
                {loadingOperations ? (
                  <div className="flex items-center justify-center py-4">
                    <Loader2 className="h-5 w-5 animate-spin text-primary" />
                  </div>
                ) : operations.length === 0 ? (
                  <div className="p-3 bg-muted rounded-md">
                    <p className="text-sm text-muted-foreground">
                      Aucune opération disponible pour cette période
                    </p>
                  </div>
                ) : (
                  <Select 
                    value={selectedOperationId || ''} 
                    onValueChange={setSelectedOperationId}
                  >
                    <SelectTrigger>
                      <SelectValue placeholder="Sélectionner une opération" />
                    </SelectTrigger>
                    <SelectContent>
                      {operations.map((op) => (
                        <SelectItem key={op.id} value={op.id}>
                          <div className="flex flex-col py-1">
                            <span className="font-medium">
                              {op.medecin_nom} - {op.type_intervention_nom}
                            </span>
                            <span className="text-xs text-muted-foreground">
                              {op.besoin_operation_nom} • {op.periode === 'matin' ? 'Matin' : 'Après-midi'}
                              {op.salle_nom ? ` - Salle ${op.salle_nom}` : ''}
                              {' '}- {op.besoins_assignes}/{op.besoins_requis} assigné(s)
                            </span>
                          </div>
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                )}
              </div>
            )}

            {secretaire.periode === 'journee' ? (
              <div className="space-y-2">
                <Label>Période</Label>
                <RadioGroup value={periode} onValueChange={(v: any) => setPeriode(v)}>
                  <div className="flex items-center space-x-2">
                    <RadioGroupItem value="matin" id="edit-sec-matin" />
                    <Label htmlFor="edit-sec-matin" className="font-normal cursor-pointer">
                      Matin
                    </Label>
                  </div>
                  <div className="flex items-center space-x-2">
                    <RadioGroupItem value="apres_midi" id="edit-sec-apres_midi" />
                    <Label htmlFor="edit-sec-apres_midi" className="font-normal cursor-pointer">
                      Après-midi
                    </Label>
                  </div>
                  <div className="flex items-center space-x-2">
                    <RadioGroupItem value="journee" id="edit-sec-journee" />
                    <Label htmlFor="edit-sec-journee" className="font-normal cursor-pointer">
                      Journée complète
                    </Label>
                  </div>
                </RadioGroup>
              </div>
            ) : (
              <div className="space-y-2">
                <Label>Période</Label>
                <p className="text-sm text-muted-foreground">
                  {secretaire.periode === 'matin' ? 'Matin' : 'Après-midi'}
                </p>
              </div>
            )}

            <div className="space-y-2">
              <Label>Responsabilité (optionnelle)</Label>
              <div className="flex flex-col space-y-2">
                <div className="flex items-center space-x-2">
                  <Checkbox
                    id="edit-resp-1r"
                    checked={responsibility === '1r'}
                    onCheckedChange={(checked) => {
                      setResponsibility(checked ? '1r' : null);
                      if (checked) setPeriode('journee');
                    }}
                  />
                  <Label htmlFor="edit-resp-1r" className="font-normal cursor-pointer">
                    1R
                  </Label>
                </div>
                <div className="flex items-center space-x-2">
                  <Checkbox
                    id="edit-resp-2f"
                    checked={responsibility === '2f'}
                    onCheckedChange={(checked) => {
                      setResponsibility(checked ? '2f' : null);
                      if (checked) setPeriode('journee');
                    }}
                  />
                  <Label htmlFor="edit-resp-2f" className="font-normal cursor-pointer">
                    2F
                  </Label>
                </div>
                <div className="flex items-center space-x-2">
                  <Checkbox
                    id="edit-resp-3f"
                    checked={responsibility === '3f'}
                    onCheckedChange={(checked) => {
                      setResponsibility(checked ? '3f' : null);
                      if (checked) setPeriode('journee');
                    }}
                  />
                  <Label htmlFor="edit-resp-3f" className="font-normal cursor-pointer">
                    3F
                  </Label>
                </div>
              </div>
              {responsibility && (
                <p className="text-xs text-muted-foreground">
                  Une responsabilité implique automatiquement une présence toute la journée
                </p>
              )}
            </div>
          </div>
        )}

        <div className="flex justify-end gap-2 mt-4">
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={loading || fetchingData}>
            Annuler
          </Button>
          <Button
            onClick={handleSubmit}
            disabled={loading || fetchingData || !canSubmit}
          >
            {loading && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
            Enregistrer
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
