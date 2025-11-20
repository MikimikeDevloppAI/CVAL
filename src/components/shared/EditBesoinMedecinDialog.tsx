import { useState, useEffect } from "react";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Label } from "@/components/ui/label";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";

interface Site {
  id: string;
  nom: string;
}

interface TypeIntervention {
  id: string;
  nom: string;
}

interface EditBesoinMedecinDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  medecinId: string;
  medecinNom: string;
  date: string;
  initialSiteId: string;
  initialPeriod: 'matin' | 'apres_midi' | 'toute_journee';
  initialTypeInterventionId?: string | null;
  besoinIds?: string[];
  onSuccess: () => void;
}

const BLOC_OPERATOIRE_SITE_ID = '86f1047f-c4ff-441f-a064-42ee2f8ef37a';

export function EditBesoinMedecinDialog({
  open,
  onOpenChange,
  medecinId,
  medecinNom,
  date,
  initialSiteId,
  initialPeriod,
  initialTypeInterventionId,
  besoinIds,
  onSuccess
}: EditBesoinMedecinDialogProps) {
  const [sites, setSites] = useState<Site[]>([]);
  const [selectedSiteId, setSelectedSiteId] = useState(initialSiteId);
  const [typesIntervention, setTypesIntervention] = useState<TypeIntervention[]>([]);
  const [selectedTypeInterventionId, setSelectedTypeInterventionId] = useState<string>(initialTypeInterventionId || '');
  const [selectedPeriod, setSelectedPeriod] = useState<'matin' | 'apres_midi' | 'toute_journee'>(initialPeriod);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (open) {
      fetchSites();
      fetchTypesIntervention();
      setSelectedSiteId(initialSiteId);
      setSelectedTypeInterventionId(initialTypeInterventionId || '');
      setSelectedPeriod(initialPeriod);
    }
  }, [open, initialSiteId, initialPeriod, initialTypeInterventionId]);

  const fetchSites = async () => {
    const { data, error } = await supabase
      .from('sites')
      .select('id, nom')
      .eq('actif', true)
      .neq('nom', 'Administratif')
      .order('nom');

    if (error) {
      console.error('Error fetching sites:', error);
      toast.error('Erreur lors du chargement des sites');
      return;
    }

    setSites(data || []);
  };

  const fetchTypesIntervention = async () => {
    const { data, error } = await supabase
      .from('types_intervention')
      .select('id, nom')
      .eq('actif', true)
      .order('nom');

    if (error) {
      console.error('Error fetching types intervention:', error);
      return;
    }

    setTypesIntervention(data || []);
  };

  const handleSubmit = async () => {
    if (!selectedSiteId) {
      toast.error('Veuillez sélectionner un site');
      return;
    }

    // Validation bloc opératoire
    const isBlocOperatoire = selectedSiteId === BLOC_OPERATOIRE_SITE_ID;
    if (isBlocOperatoire && !selectedTypeInterventionId) {
      toast.error('Le type d\'intervention est obligatoire pour le bloc opératoire');
      return;
    }

    setLoading(true);

    try {
      // 1. Récupérer les besoins existants
      let query = supabase
        .from('besoin_effectif')
        .select('id, demi_journee, site_id, type_intervention_id')
        .eq('medecin_id', medecinId)
        .eq('date', date)
        .eq('type', 'medecin')
        .eq('actif', true);

      // Si besoinIds fournis, filtrer sur eux
      if (besoinIds && besoinIds.length > 0) {
        query = query.in('id', besoinIds);
      }

      const { data: existingBesoins, error: fetchError } = await query;

      if (fetchError) {
        console.error('Error fetching existing besoins:', fetchError);
        toast.error('Erreur lors de la récupération des besoins');
        setLoading(false);
        return;
      }

      // 2. Identifier matin et après-midi
      const matinBesoin = existingBesoins?.find(b => b.demi_journee === 'matin');
      const apresmidiBesoin = existingBesoins?.find(b => b.demi_journee === 'apres_midi');

      // 3. Appliquer la logique selon la période sélectionnée
      const updates: Promise<any>[] = [];

      if (selectedPeriod === 'toute_journee') {
        // Toute la journée : mettre à jour/créer matin ET après-midi
        if (matinBesoin) {
          const { error: updateError } = await supabase
            .from('besoin_effectif')
            .update({
              site_id: selectedSiteId,
              type_intervention_id: isBlocOperatoire ? selectedTypeInterventionId : null
            })
            .eq('id', matinBesoin.id);
          
          if (updateError) {
            console.error('Error updating matin besoin:', updateError);
            toast.error('Erreur lors de la mise à jour du matin');
            setLoading(false);
            return;
          }
        } else {
          const { error: insertError } = await supabase
            .from('besoin_effectif')
            .insert({
              date,
              medecin_id: medecinId,
              site_id: selectedSiteId,
              demi_journee: 'matin',
              type: 'medecin',
              type_intervention_id: isBlocOperatoire ? selectedTypeInterventionId : null,
              actif: true
            });
          
          if (insertError) {
            console.error('Error inserting matin besoin:', insertError);
            toast.error('Erreur lors de la création du matin');
            setLoading(false);
            return;
          }
        }

        if (apresmidiBesoin) {
          const { error: updateError } = await supabase
            .from('besoin_effectif')
            .update({
              site_id: selectedSiteId,
              type_intervention_id: isBlocOperatoire ? selectedTypeInterventionId : null
            })
            .eq('id', apresmidiBesoin.id);
          
          if (updateError) {
            console.error('Error updating après-midi besoin:', updateError);
            toast.error('Erreur lors de la mise à jour de l\'après-midi');
            setLoading(false);
            return;
          }
        } else {
          const { error: insertError } = await supabase
            .from('besoin_effectif')
            .insert({
              date,
              medecin_id: medecinId,
              site_id: selectedSiteId,
              demi_journee: 'apres_midi',
              type: 'medecin',
              type_intervention_id: isBlocOperatoire ? selectedTypeInterventionId : null,
              actif: true
            });
          
          if (insertError) {
            console.error('Error inserting après-midi besoin:', insertError);
            toast.error('Erreur lors de la création de l\'après-midi');
            setLoading(false);
            return;
          }
        }
      } else if (selectedPeriod === 'matin') {
        // Matin uniquement : mettre à jour/créer matin, ne pas toucher après-midi
        if (matinBesoin) {
          const { error: updateError } = await supabase
            .from('besoin_effectif')
            .update({
              site_id: selectedSiteId,
              type_intervention_id: isBlocOperatoire ? selectedTypeInterventionId : null
            })
            .eq('id', matinBesoin.id);
          
          if (updateError) {
            console.error('Error updating matin besoin:', updateError);
            toast.error('Erreur lors de la mise à jour du matin');
            setLoading(false);
            return;
          }
        } else {
          const { error: insertError } = await supabase
            .from('besoin_effectif')
            .insert({
              date,
              medecin_id: medecinId,
              site_id: selectedSiteId,
              demi_journee: 'matin',
              type: 'medecin',
              type_intervention_id: isBlocOperatoire ? selectedTypeInterventionId : null,
              actif: true
            });
          
          if (insertError) {
            console.error('Error inserting matin besoin:', insertError);
            toast.error('Erreur lors de la création du matin');
            setLoading(false);
            return;
          }
        }
      } else if (selectedPeriod === 'apres_midi') {
        // Après-midi uniquement : mettre à jour/créer après-midi, ne pas toucher matin
        if (apresmidiBesoin) {
          const { error: updateError } = await supabase
            .from('besoin_effectif')
            .update({
              site_id: selectedSiteId,
              type_intervention_id: isBlocOperatoire ? selectedTypeInterventionId : null
            })
            .eq('id', apresmidiBesoin.id);
          
          if (updateError) {
            console.error('Error updating après-midi besoin:', updateError);
            toast.error('Erreur lors de la mise à jour de l\'après-midi');
            setLoading(false);
            return;
          }
        } else {
          const { error: insertError } = await supabase
            .from('besoin_effectif')
            .insert({
              date,
              medecin_id: medecinId,
              site_id: selectedSiteId,
              demi_journee: 'apres_midi',
              type: 'medecin',
              type_intervention_id: isBlocOperatoire ? selectedTypeInterventionId : null,
              actif: true
            });
          
          if (insertError) {
            console.error('Error inserting après-midi besoin:', insertError);
            toast.error('Erreur lors de la création de l\'après-midi');
            setLoading(false);
            return;
          }
        }
      }

      toast.success('Besoin modifié avec succès');
      onSuccess();
      onOpenChange(false);
    } catch (error) {
      console.error('Error in handleSubmit:', error);
      toast.error('Erreur lors de la modification du besoin');
    } finally {
      setLoading(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle className="bg-gradient-to-r from-teal-500 to-cyan-600 bg-clip-text text-transparent">
            Modifier le besoin
          </DialogTitle>
          <DialogDescription>
            Médecin : {medecinNom} - Date : {new Date(date).toLocaleDateString('fr-FR')}
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4">
          <div className="space-y-2">
            <Label>Période</Label>
            <Select
              value={selectedPeriod}
              onValueChange={(value: 'matin' | 'apres_midi' | 'toute_journee') => setSelectedPeriod(value)}
            >
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="matin">Matin</SelectItem>
                <SelectItem value="apres_midi">Après-midi</SelectItem>
                <SelectItem value="toute_journee">Toute la journée</SelectItem>
              </SelectContent>
            </Select>
          </div>

          <div className="space-y-2">
            <Label>Site</Label>
            <Select value={selectedSiteId} onValueChange={setSelectedSiteId}>
              <SelectTrigger>
                <SelectValue placeholder="Sélectionner un site" />
              </SelectTrigger>
              <SelectContent>
                {sites.map((site) => (
                  <SelectItem key={site.id} value={site.id}>
                    {site.nom}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          {selectedSiteId === BLOC_OPERATOIRE_SITE_ID && (
            <div className="space-y-2">
              <Label>Type d'intervention *</Label>
              <Select value={selectedTypeInterventionId} onValueChange={setSelectedTypeInterventionId}>
                <SelectTrigger>
                  <SelectValue placeholder="Sélectionner un type" />
                </SelectTrigger>
                <SelectContent>
                  {typesIntervention.map((type) => (
                    <SelectItem key={type.id} value={type.id}>
                      {type.nom}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          )}
        </div>

        <div className="flex justify-end gap-2 mt-6">
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={loading}>
            Annuler
          </Button>
          <Button onClick={handleSubmit} disabled={loading}>
            {loading ? 'Modification...' : 'Modifier'}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
