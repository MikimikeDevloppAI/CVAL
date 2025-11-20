import { useState, useEffect } from "react";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
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
    const { data } = await supabase
      .from('sites')
      .select('id, nom')
      .eq('actif', true)
      .neq('nom', 'Administratif')
      .order('nom');
    
    if (data) setSites(data);
  };

  const fetchTypesIntervention = async () => {
    const { data } = await supabase
      .from('types_intervention')
      .select('id, nom')
      .eq('actif', true)
      .order('nom');
    
    if (data) setTypesIntervention(data);
  };

  const handleSubmit = async () => {
    if (!selectedSiteId) {
      toast.error('Veuillez sélectionner un site');
      return;
    }

    const isBlocOperatoire = sites.find(s => s.id === selectedSiteId)?.nom.includes('Bloc opératoire');
    if (isBlocOperatoire && !selectedTypeInterventionId) {
      toast.error('Le type d\'intervention est obligatoire pour le bloc opératoire');
      return;
    }

    setLoading(true);

    try {
      let targetBesoinIds: string[] = [];
      
      if (besoinIds && besoinIds.length > 0) {
        targetBesoinIds = besoinIds;
      } else {
        const { data: existingBesoins } = await supabase
          .from('besoin_effectif')
          .select('id')
          .eq('medecin_id', medecinId)
          .eq('date', date)
          .eq('type', 'medecin')
          .eq('actif', true);
        
        targetBesoinIds = existingBesoins?.map(b => b.id) || [];
      }

      if (targetBesoinIds.length > 0) {
        for (const besoinId of targetBesoinIds) {
          await supabase
            .from('besoin_effectif')
            .delete()
            .eq('id', besoinId);
        }
      }

      if (selectedPeriod === 'toute_journee') {
        await supabase.from('besoin_effectif').insert([
          {
            date,
            medecin_id: medecinId,
            site_id: selectedSiteId,
            demi_journee: 'matin',
            type: 'medecin',
            type_intervention_id: isBlocOperatoire ? selectedTypeInterventionId : null,
            actif: true,
          },
          {
            date,
            medecin_id: medecinId,
            site_id: selectedSiteId,
            demi_journee: 'apres_midi',
            type: 'medecin',
            type_intervention_id: isBlocOperatoire ? selectedTypeInterventionId : null,
            actif: true,
          }
        ]);
      } else {
        await supabase.from('besoin_effectif').insert({
          date,
          medecin_id: medecinId,
          site_id: selectedSiteId,
          demi_journee: selectedPeriod,
          type: 'medecin',
          type_intervention_id: isBlocOperatoire ? selectedTypeInterventionId : null,
          actif: true,
        });
      }

      toast.success('Besoin modifié avec succès');
      onSuccess();
      onOpenChange(false);
    } catch (error) {
      console.error('Error:', error);
      toast.error('Erreur lors de la modification');
    } finally {
      setLoading(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Modifier le besoin</DialogTitle>
        </DialogHeader>

        <div className="space-y-4">
          <div>
            <label className="text-sm font-medium mb-2 block">Période</label>
            <Select value={selectedPeriod} onValueChange={(v: 'matin' | 'apres_midi' | 'toute_journee') => setSelectedPeriod(v)}>
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

          <div>
            <label className="text-sm font-medium mb-2 block">Site</label>
            <Select value={selectedSiteId} onValueChange={setSelectedSiteId}>
              <SelectTrigger>
                <SelectValue placeholder="Sélectionner un site" />
              </SelectTrigger>
              <SelectContent>
                {sites.map(site => (
                  <SelectItem key={site.id} value={site.id}>{site.nom}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          {selectedSiteId && sites.find(s => s.id === selectedSiteId)?.nom.includes('Bloc opératoire') && (
            <div>
              <label className="text-sm font-medium mb-2 block">Type d'intervention</label>
              <Select value={selectedTypeInterventionId} onValueChange={setSelectedTypeInterventionId}>
                <SelectTrigger>
                  <SelectValue placeholder="Sélectionner un type" />
                </SelectTrigger>
                <SelectContent>
                  {typesIntervention.map(type => (
                    <SelectItem key={type.id} value={type.id}>{type.nom}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          )}

          <div className="flex justify-end gap-2">
            <Button variant="outline" onClick={() => onOpenChange(false)}>
              Annuler
            </Button>
            <Button onClick={handleSubmit} disabled={loading}>
              Modifier
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
