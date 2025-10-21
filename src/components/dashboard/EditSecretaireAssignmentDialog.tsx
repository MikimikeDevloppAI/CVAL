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

  useEffect(() => {
    if (open) {
      fetchInitialData();
    }
  }, [open, secretaire, siteId]);

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
    
    // 1. Récupérer les sites de préférence de la secrétaire
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

    // 4. Ajouter le bloc opératoire si la secrétaire a des besoins opératoires
    const { data: besoinOps } = await supabase
      .from('secretaires_besoins_operations')
      .select('besoin_operation_id')
      .eq('secretaire_id', secretaire.id);
    
    if (besoinOps && besoinOps.length > 0) {
      // La secrétaire a des besoins opératoires, on peut ajouter le bloc opératoire
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

    // 5. Trier par nom
    sitesFromPreferences.sort((a, b) => a.nom.localeCompare(b.nom));
    setSites(sitesFromPreferences);
  };

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

    setLoading(true);
    try {
      // 1. Récupérer les capacités existantes pour cette secrétaire à cette date
      const { data: existingCapacites } = await supabase
        .from('capacite_effective')
        .select('id, demi_journee')
        .eq('secretaire_id', secretaire.id)
        .eq('date', date);

      // 2. Déterminer quelles demi-journées UPDATE
      const targetPeriods: ('matin' | 'apres_midi')[] = 
        periode === 'journee' ? ['matin', 'apres_midi'] : [periode];

      // 3. UPDATE chaque demi-journée concernée
      for (const targetPeriod of targetPeriods) {
        const existingCapacite = existingCapacites?.find(c => c.demi_journee === targetPeriod);
        
        if (existingCapacite) {
          // UPDATE la ligne existante
          const { error } = await supabase
            .from('capacite_effective')
            .update({
              site_id: selectedSiteId,
              is_1r: responsibility === '1r',
              is_2f: responsibility === '2f',
              is_3f: responsibility === '3f',
            })
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

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle className="bg-gradient-to-r from-teal-500 to-cyan-600 bg-clip-text text-transparent">
            Modifier l'assignation
          </DialogTitle>
          <DialogDescription>
            Secrétaire : {secretaire.nom}
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
                  {sites.map((site) => (
                    <SelectItem key={site.id} value={site.id}>
                      {site.nom}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

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
            disabled={loading || fetchingData}
            className="bg-gradient-to-r from-teal-500 to-cyan-600"
          >
            {loading && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
            Enregistrer
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
