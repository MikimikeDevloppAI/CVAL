import { useState, useEffect } from 'react';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Label } from '@/components/ui/label';
import { useToast } from '@/hooks/use-toast';
import { supabase } from '@/integrations/supabase/client';
import { format } from 'date-fns';
import { fr } from 'date-fns/locale';
import { Loader2, ArrowLeftRight } from 'lucide-react';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Badge } from '@/components/ui/badge';
import { Switch } from '@/components/ui/switch';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';

interface EditSecretaryAssignmentDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  secretaryId: string;
  date: string;
  period: 'matin' | 'apres_midi';
  siteId?: string;
  onSuccess: () => void;
}

interface Secretaire {
  id: string;
  first_name: string;
  name: string;
  specialites: string[];
  is_backup?: boolean;
}

interface CreneauData {
  id: string;
  date: string;
  heure_debut: string;
  heure_fin: string;
  site_id?: string;
  type_assignation?: string;
  secretaires_ids: string[];
  backups_ids: string[];
  responsable_1r_id?: string;
  responsable_2f_id?: string;
  medecins_ids?: string[];
  type?: string;
  statut?: string;
  version_planning?: number;
}

export function EditSecretaryAssignmentDialog({
  open,
  onOpenChange,
  secretaryId,
  date,
  period,
  siteId,
  onSuccess,
}: EditSecretaryAssignmentDialogProps) {
  const { toast } = useToast();
  const [loading, setLoading] = useState(false);
  const [loadingData, setLoadingData] = useState(true);
  const [currentSecretaire, setCurrentSecretaire] = useState<Secretaire | null>(null);
  const [availableSecretaires, setAvailableSecretaires] = useState<Secretaire[]>([]);
  const [sites, setSites] = useState<any[]>([]);
  const [selectedSiteId, setSelectedSiteId] = useState<string>('');
  const [siteHasFermeture, setSiteHasFermeture] = useState(false);
  const [creneauMatin, setCreneauMatin] = useState<CreneauData | null>(null);
  const [creneauAM, setCreneauAM] = useState<CreneauData | null>(null);
  const [selectedPeriod, setSelectedPeriod] = useState<'matin' | 'apres_midi' | 'both'>('both');
  const [is1R, setIs1R] = useState(false);
  const [is2F, setIs2F] = useState(false);
  const [switchMode, setSwitchMode] = useState(false);
  const [selectedSwitchSecretaire, setSelectedSwitchSecretaire] = useState<string>('');

  useEffect(() => {
    if (open) {
      loadData();
    }
  }, [open, secretaryId, date]);

  const loadData = async () => {
    setLoadingData(true);
    try {
      // Récupérer la secrétaire actuelle
      const { data: secData, error: secError } = await supabase
        .from('secretaires')
        .select('*')
        .eq('id', secretaryId)
        .single();

      if (secError) throw secError;
      setCurrentSecretaire(secData);

      // Récupérer tous les sites
      const { data: sitesData, error: sitesError } = await supabase
        .from('sites')
        .select('*')
        .eq('actif', true);

      if (sitesError) throw sitesError;
      setSites(sitesData || []);

      // Récupérer les créneaux matin et après-midi
      const [matinRes, amRes] = await Promise.all([
        supabase
          .from('planning_genere')
          .select('*')
          .eq('date', date)
          .eq('heure_debut', '07:30:00')
          .eq('site_id', siteId || '')
          .maybeSingle(),
        supabase
          .from('planning_genere')
          .select('*')
          .eq('date', date)
          .eq('heure_debut', '13:00:00')
          .eq('site_id', siteId || '')
          .maybeSingle()
      ]);

      setCreneauMatin(matinRes.data);
      setCreneauAM(amRes.data);

      // Définir le site sélectionné par défaut
      if (siteId) {
        setSelectedSiteId(siteId);
        const site = sitesData?.find(s => s.id === siteId);
        setSiteHasFermeture(site?.fermeture || false);
      }

      // Déterminer les rôles actuels
      if (matinRes.data?.responsable_1r_id === secretaryId || amRes.data?.responsable_1r_id === secretaryId) {
        setIs1R(true);
      }
      if (matinRes.data?.responsable_2f_id === secretaryId || amRes.data?.responsable_2f_id === secretaryId) {
        setIs2F(true);
      }

      // Récupérer toutes les secrétaires et backups avec les mêmes spécialités
      if (secData?.specialites && secData.specialites.length > 0) {
        const [secretairesRes, backupsRes] = await Promise.all([
          supabase
            .from('secretaires')
            .select('*')
            .eq('actif', true)
            .neq('id', secretaryId)
            .overlaps('specialites', secData.specialites),
          supabase
            .from('backup')
            .select('*')
            .eq('actif', true)
            .overlaps('specialites', secData.specialites)
        ]);

        const allSec = [
          ...(secretairesRes.data || []),
          ...(backupsRes.data || []).map(b => ({ ...b, is_backup: true }))
        ];
        setAvailableSecretaires(allSec);
      }
    } catch (error: any) {
      toast({
        variant: 'destructive',
        title: 'Erreur',
        description: error.message,
      });
    } finally {
      setLoadingData(false);
    }
  };

  const handleSave = async () => {
    setLoading(true);
    try {
      // Déterminer quels créneaux modifier
      const shouldUpdateMatin = selectedPeriod === 'matin' || selectedPeriod === 'both';
      const shouldUpdateAM = selectedPeriod === 'apres_midi' || selectedPeriod === 'both';

      if (shouldUpdateMatin && creneauMatin) {
        const updateData: any = {
          site_id: selectedSiteId === 'administratif' ? null : selectedSiteId || creneauMatin.site_id,
          type_assignation: selectedSiteId === 'administratif' ? 'administratif' : 'site',
        };

        // Ajouter les rôles seulement si le site a fermeture
        if (siteHasFermeture) {
          updateData.responsable_1r_id = is1R ? secretaryId : creneauMatin.responsable_1r_id === secretaryId ? null : creneauMatin.responsable_1r_id;
          updateData.responsable_2f_id = is2F ? secretaryId : creneauMatin.responsable_2f_id === secretaryId ? null : creneauMatin.responsable_2f_id;
        } else {
          // Si pas de fermeture, retirer les rôles s'ils existaient
          if (creneauMatin.responsable_1r_id === secretaryId) updateData.responsable_1r_id = null;
          if (creneauMatin.responsable_2f_id === secretaryId) updateData.responsable_2f_id = null;
        }

        await supabase
          .from('planning_genere')
          .update(updateData)
          .eq('id', creneauMatin.id);
      }

      if (shouldUpdateAM && creneauAM) {
        const updateData: any = {
          site_id: selectedSiteId === 'administratif' ? null : selectedSiteId || creneauAM.site_id,
          type_assignation: selectedSiteId === 'administratif' ? 'administratif' : 'site',
        };

        // Ajouter les rôles seulement si le site a fermeture
        if (siteHasFermeture) {
          updateData.responsable_1r_id = is1R ? secretaryId : creneauAM.responsable_1r_id === secretaryId ? null : creneauAM.responsable_1r_id;
          updateData.responsable_2f_id = is2F ? secretaryId : creneauAM.responsable_2f_id === secretaryId ? null : creneauAM.responsable_2f_id;
        } else {
          // Si pas de fermeture, retirer les rôles s'ils existaient
          if (creneauAM.responsable_1r_id === secretaryId) updateData.responsable_1r_id = null;
          if (creneauAM.responsable_2f_id === secretaryId) updateData.responsable_2f_id = null;
        }

        await supabase
          .from('planning_genere')
          .update(updateData)
          .eq('id', creneauAM.id);
      }

      toast({
        title: 'Modification enregistrée',
        description: 'Les rôles ont été mis à jour avec succès.',
      });
      onSuccess();
      onOpenChange(false);
    } catch (error: any) {
      toast({
        variant: 'destructive',
        title: 'Erreur',
        description: error.message,
      });
    } finally {
      setLoading(false);
    }
  };

  const handleSwitch = async () => {
    if (!selectedSwitchSecretaire) {
      toast({
        variant: 'destructive',
        title: 'Erreur',
        description: 'Veuillez sélectionner une secrétaire à échanger.',
      });
      return;
    }

    setLoading(true);
    try {
      const shouldUpdateMatin = selectedPeriod === 'matin' || selectedPeriod === 'both';
      const shouldUpdateAM = selectedPeriod === 'apres_midi' || selectedPeriod === 'both';

      // Fonction pour échanger les IDs dans un tableau
      const swapInArray = (arr: string[] | null, id1: string, id2: string): string[] => {
        if (!arr) return [];
        return arr.map(id => {
          if (id === id1) return id2;
          if (id === id2) return id1;
          return id;
        });
      };

      if (shouldUpdateMatin && creneauMatin) {
        const newSecretairesIds = swapInArray(creneauMatin.secretaires_ids, secretaryId, selectedSwitchSecretaire);
        const newBackupsIds = swapInArray(creneauMatin.backups_ids, secretaryId, selectedSwitchSecretaire);
        
        let newResp1R = creneauMatin.responsable_1r_id;
        let newResp2F = creneauMatin.responsable_2f_id;
        if (newResp1R === secretaryId) newResp1R = selectedSwitchSecretaire;
        else if (newResp1R === selectedSwitchSecretaire) newResp1R = secretaryId;
        if (newResp2F === secretaryId) newResp2F = selectedSwitchSecretaire;
        else if (newResp2F === selectedSwitchSecretaire) newResp2F = secretaryId;

        await supabase
          .from('planning_genere')
          .update({
            secretaires_ids: newSecretairesIds,
            backups_ids: newBackupsIds,
            responsable_1r_id: newResp1R,
            responsable_2f_id: newResp2F,
          })
          .eq('id', creneauMatin.id);
      }

      if (shouldUpdateAM && creneauAM) {
        const newSecretairesIds = swapInArray(creneauAM.secretaires_ids, secretaryId, selectedSwitchSecretaire);
        const newBackupsIds = swapInArray(creneauAM.backups_ids, secretaryId, selectedSwitchSecretaire);
        
        let newResp1R = creneauAM.responsable_1r_id;
        let newResp2F = creneauAM.responsable_2f_id;
        if (newResp1R === secretaryId) newResp1R = selectedSwitchSecretaire;
        else if (newResp1R === selectedSwitchSecretaire) newResp1R = secretaryId;
        if (newResp2F === secretaryId) newResp2F = selectedSwitchSecretaire;
        else if (newResp2F === selectedSwitchSecretaire) newResp2F = secretaryId;

        await supabase
          .from('planning_genere')
          .update({
            secretaires_ids: newSecretairesIds,
            backups_ids: newBackupsIds,
            responsable_1r_id: newResp1R,
            responsable_2f_id: newResp2F,
          })
          .eq('id', creneauAM.id);
      }

      toast({
        title: 'Échange effectué',
        description: 'Les secrétaires ont été échangées avec succès.',
      });
      onSuccess();
      onOpenChange(false);
    } catch (error: any) {
      toast({
        variant: 'destructive',
        title: 'Erreur',
        description: error.message,
      });
    } finally {
      setLoading(false);
    }
  };

  if (!currentSecretaire) return null;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle>
            Modifier l'assignation - {currentSecretaire.first_name} {currentSecretaire.name}
          </DialogTitle>
          <p className="text-sm text-muted-foreground">
            {format(new Date(date), 'EEEE d MMMM yyyy', { locale: fr })}
          </p>
        </DialogHeader>

        {loadingData ? (
          <div className="flex items-center justify-center py-8">
            <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
          </div>
        ) : (
          <Tabs defaultValue="modify" className="w-full">
            <TabsList className="grid w-full grid-cols-2">
              <TabsTrigger value="modify">Modifier</TabsTrigger>
              <TabsTrigger value="switch">Échanger</TabsTrigger>
            </TabsList>

            <TabsContent value="modify" className="space-y-4">
              <div className="space-y-2">
                <Label>Période à modifier</Label>
                <Select value={selectedPeriod} onValueChange={(v: any) => setSelectedPeriod(v)}>
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="both">Toute la journée</SelectItem>
                    <SelectItem value="matin">Matin uniquement</SelectItem>
                    <SelectItem value="apres_midi">Après-midi uniquement</SelectItem>
                  </SelectContent>
                </Select>
              </div>

              <div className="space-y-2">
                <Label>Site</Label>
                <Select 
                  value={selectedSiteId} 
                  onValueChange={(value) => {
                    setSelectedSiteId(value);
                    if (value === 'administratif') {
                      setSiteHasFermeture(false);
                    } else {
                      const site = sites.find(s => s.id === value);
                      setSiteHasFermeture(site?.fermeture || false);
                    }
                  }}
                >
                  <SelectTrigger>
                    <SelectValue placeholder="Sélectionner un site" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="administratif">Administratif</SelectItem>
                    {sites.map(site => (
                      <SelectItem key={site.id} value={site.id}>
                        {site.nom} {site.fermeture && '(Fermeture)'}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>

              {siteHasFermeture && (
                <div className="space-y-3 p-4 border rounded-lg">
                  <Label className="text-base">Rôles</Label>
                  
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-2">
                      <Badge variant="default" className="text-xs">1R</Badge>
                      <span className="text-sm">Responsable 1R (Réception)</span>
                    </div>
                    <Switch checked={is1R} onCheckedChange={setIs1R} />
                  </div>

                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-2">
                      <Badge variant="outline" className="text-xs">2F</Badge>
                      <span className="text-sm">Responsable 2F (Fond)</span>
                    </div>
                    <Switch checked={is2F} onCheckedChange={setIs2F} />
                  </div>
                </div>
              )}

              {!siteHasFermeture && selectedSiteId && (
                <p className="text-xs text-muted-foreground italic">
                  Ce site n'a pas de fermeture, les rôles ne sont pas disponibles.
                </p>
              )}

              <div className="flex gap-2 pt-4">
                <Button onClick={handleSave} disabled={loading} className="flex-1">
                  {loading && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
                  Enregistrer
                </Button>
              </div>
            </TabsContent>

            <TabsContent value="switch" className="space-y-4">
              <div className="space-y-2">
                <Label>Période à échanger</Label>
                <Select value={selectedPeriod} onValueChange={(v: any) => setSelectedPeriod(v)}>
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="both">Toute la journée</SelectItem>
                    <SelectItem value="matin">Matin uniquement</SelectItem>
                    <SelectItem value="apres_midi">Après-midi uniquement</SelectItem>
                  </SelectContent>
                </Select>
              </div>

              <div className="space-y-2">
                <Label>Échanger avec</Label>
                <Select value={selectedSwitchSecretaire} onValueChange={setSelectedSwitchSecretaire}>
                  <SelectTrigger>
                    <SelectValue placeholder="Sélectionner une secrétaire" />
                  </SelectTrigger>
                  <SelectContent>
                    {availableSecretaires.map(sec => (
                      <SelectItem key={sec.id} value={sec.id}>
                        {sec.first_name} {sec.name} {sec.is_backup && '(Backup)'}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                {availableSecretaires.length === 0 && (
                  <p className="text-xs text-muted-foreground">
                    Aucune secrétaire compatible trouvée (même spécialité)
                  </p>
                )}
              </div>

              <div className="flex gap-2 pt-4">
                <Button onClick={handleSwitch} disabled={loading || !selectedSwitchSecretaire} className="flex-1">
                  {loading ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <ArrowLeftRight className="mr-2 h-4 w-4" />}
                  Échanger
                </Button>
              </div>
            </TabsContent>
          </Tabs>
        )}
      </DialogContent>
    </Dialog>
  );
}
