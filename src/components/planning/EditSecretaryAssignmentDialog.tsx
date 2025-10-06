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
  current_site?: string;
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
  responsable_3f_id?: string;
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
  const [allSecretaires, setAllSecretaires] = useState<Secretaire[]>([]);
  const [currentSiteSpecialiteId, setCurrentSiteSpecialiteId] = useState<string | null>(null);
  const [sites, setSites] = useState<any[]>([]);
  const [selectedSiteId, setSelectedSiteId] = useState<string>('');
  const [siteHasFermeture, setSiteHasFermeture] = useState(false);
  const [creneauMatin, setCreneauMatin] = useState<CreneauData | null>(null);
  const [creneauAM, setCreneauAM] = useState<CreneauData | null>(null);
  const [selectedPeriod, setSelectedPeriod] = useState<'matin' | 'apres_midi' | 'both'>('both');
  const [is1R, setIs1R] = useState(false);
  const [is2F, setIs2F] = useState(false);
  const [is3F, setIs3F] = useState(false);
  const [switchMode, setSwitchMode] = useState(false);
  const [selectedSwitchSecretaire, setSelectedSwitchSecretaire] = useState<string>('');

  useEffect(() => {
    if (open) {
      setSelectedPeriod(period);
      loadData();
    }
  }, [open, secretaryId, date, period]);

  // Refresh available secretaries when period changes
  useEffect(() => {
    if (open && allSecretaires.length > 0 && currentSecretaire) {
      // Filter based on selected period
      const filtered = allSecretaires.filter(sec => {
        // Check if secretary has required specialties for both sites
        const hasSpecForCurrentSite = currentSiteSpecialiteId ? 
          (sec.specialites || []).includes(currentSiteSpecialiteId) : true;
        
        return hasSpecForCurrentSite;
      });

      setAvailableSecretaires(filtered);
    }
  }, [selectedPeriod, open, allSecretaires, currentSiteSpecialiteId, currentSecretaire]);

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
      
      const allSites = sitesData || [];
      
      // Filtrer les sites selon les spécialités de la secrétaire
      const filteredSites = allSites.filter(site => 
        !site.specialite_id || secData.specialites?.includes(site.specialite_id)
      );

      // Récupérer tous les créneaux de ce jour pour trouver ceux où cette secrétaire est assignée
      const { data: allCreneaux, error: creneauxError } = await supabase
        .from('planning_genere')
        .select('*')
        .eq('date', date);

      if (creneauxError) throw creneauxError;

      // Trouver les créneaux où cette secrétaire est assignée (utiliser des plages horaires)
      const matinCreneau = allCreneaux?.find(c => 
        c.heure_debut < '12:00:00' && 
        (c.secretaires_ids?.includes(secretaryId) || 
         c.backups_ids?.includes(secretaryId) ||
         c.responsable_1r_id === secretaryId ||
         c.responsable_2f_id === secretaryId ||
         c.responsable_3f_id === secretaryId)
      );
      const amCreneau = allCreneaux?.find(c => 
        c.heure_debut >= '12:00:00' && 
        (c.secretaires_ids?.includes(secretaryId) || 
         c.backups_ids?.includes(secretaryId) ||
         c.responsable_1r_id === secretaryId ||
         c.responsable_2f_id === secretaryId ||
         c.responsable_3f_id === secretaryId)
      );

      setCreneauMatin(matinCreneau || null);
      setCreneauAM(amCreneau || null);

      // Définir le site sélectionné par défaut à partir du créneau trouvé
      const currentCreneau = period === 'matin' ? matinCreneau : amCreneau;
      
      // Déterminer le site présélectionné
      let preselectedSiteId = '';
      if (currentCreneau) {
        if (currentCreneau.type_assignation === 'administratif' || !currentCreneau.site_id) {
          preselectedSiteId = 'administratif';
        } else {
          preselectedSiteId = currentCreneau.site_id;
        }
      } else if (siteId) {
        preselectedSiteId = siteId;
      }

      // S'assurer que le site présélectionné est dans la liste filteredSites
      if (preselectedSiteId && preselectedSiteId !== 'administratif') {
        const siteInFiltered = filteredSites.find(s => s.id === preselectedSiteId);
        if (!siteInFiltered) {
          // Ajouter le site à la liste s'il n'y est pas
          const originalSite = allSites.find(s => s.id === preselectedSiteId);
          if (originalSite) {
            filteredSites.push(originalSite);
          }
        }
      }

      setSites(filteredSites);
      setSelectedSiteId(preselectedSiteId);

      // Calculer siteHasFermeture depuis allSites
      if (preselectedSiteId && preselectedSiteId !== 'administratif') {
        const site = allSites.find(s => s.id === preselectedSiteId);
        setSiteHasFermeture(site?.fermeture || false);
      } else {
        setSiteHasFermeture(false);
      }

      // Déterminer les rôles actuels
      setIs1R(matinCreneau?.responsable_1r_id === secretaryId || amCreneau?.responsable_1r_id === secretaryId);
      setIs2F(matinCreneau?.responsable_2f_id === secretaryId || amCreneau?.responsable_2f_id === secretaryId);
      setIs3F(matinCreneau?.responsable_3f_id === secretaryId || amCreneau?.responsable_3f_id === secretaryId);

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

        // Récupérer les assignations du jour pour ces secrétaires
        const { data: assignmentsData } = await supabase
          .from('planning_genere')
          .select('*, sites(nom)')
          .eq('date', date);

        // Déterminer le site actuel de la secrétaire pour la période concernée
        const currentAssignment = assignmentsData?.find(a => 
          (a.secretaires_ids?.includes(secretaryId) || a.backups_ids?.includes(secretaryId)) &&
          ((selectedPeriod === 'matin' || selectedPeriod === 'both') && a.heure_debut === '07:30:00' ||
           (selectedPeriod === 'apres_midi' || selectedPeriod === 'both') && a.heure_debut === '13:00:00')
        );
        const currentSiteId = currentAssignment?.site_id;
        const currentTypeAssignation = currentAssignment?.type_assignation;
        
        // Récupérer le site actuel pour vérifier sa spécialité
        const currentSite = filteredSites.find(s => s.id === currentSiteId);
        const currentSiteSpecialiteIdValue = currentSite?.specialite_id;
        setCurrentSiteSpecialiteId(currentSiteSpecialiteIdValue || null);

        // Créer une map des assignations par secrétaire
        const assignmentMap = new Map<string, { siteName: string; siteId?: string; typeAssignation?: string }>();
        assignmentsData?.forEach(assignment => {
          const period = assignment.heure_debut === '07:30:00' ? 'matin' : 'apres_midi';
          const targetPeriod = selectedPeriod === 'both' ? period : selectedPeriod;
          
          if (selectedPeriod === 'both' || period === targetPeriod) {
            [...(assignment.secretaires_ids || []), ...(assignment.backups_ids || [])].forEach(secId => {
              if (!assignmentMap.has(secId)) {
                const siteName = assignment.type_assignation === 'administratif' 
                  ? 'Administratif' 
                  : (assignment.sites as any)?.nom || 'Site inconnu';
                assignmentMap.set(secId, {
                  siteName,
                  siteId: assignment.site_id,
                  typeAssignation: assignment.type_assignation
                });
              }
            });
          }
        });

        // Récupérer les sites compatibles pour filtrer
        const compatibleSiteIds = filteredSites.map(s => s.id);

        // Filtrer les secrétaires pour ne garder que celles sur des sites compatibles et différents
        const allSec = [
          ...(secretairesRes.data || []),
          ...(backupsRes.data || []).map(b => ({ ...b, is_backup: true }))
        ].filter(sec => {
          // Vérifier si la secrétaire a une assignation ce jour-là
          const assignmentInfo = assignmentMap.get(sec.id);
          if (!assignmentInfo) return false;

          // Vérifier si l'assignation est sur un site compatible ou administratif
          const assignment = assignmentsData?.find(a => 
            (a.secretaires_ids?.includes(sec.id) || a.backups_ids?.includes(sec.id))
          );
          
          if (!assignment) return false;

          // Exclure si sur le même site que la secrétaire actuelle
          if (currentTypeAssignation === 'administratif' && assignmentInfo.typeAssignation === 'administratif') {
            return false; // Les deux sont en administratif
          }
          if (currentSiteId && assignmentInfo.siteId === currentSiteId) {
            return false; // Même site
          }
          
          // Vérification bidirectionnelle : la secrétaire cible doit pouvoir prendre la place actuelle
          if (currentSiteSpecialiteIdValue && !sec.specialites?.includes(currentSiteSpecialiteIdValue)) {
            return false; // La secrétaire cible n'a pas la spécialité du site actuel
          }
          
          // Accepter les assignations administratives ou sur des sites compatibles
          return assignment.type_assignation === 'administratif' || 
                 !assignment.site_id || 
                 compatibleSiteIds.includes(assignment.site_id);
        }).map(sec => ({
          ...sec,
          current_site: assignmentMap.get(sec.id)?.siteName
        }));

        setAllSecretaires(allSec);
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

      // Fonction pour déplacer une secrétaire d'un créneau à un autre
      const moveSecretaryToCreneau = async (
        oldCreneau: CreneauData, 
        newSiteId: string | null, 
        newTypeAssignation: string,
        periode: 'matin' | 'apres_midi'
      ) => {
        const heureDebut = periode === 'matin' ? '07:30:00' : '13:00:00';
        const heureFin = periode === 'matin' ? '12:00:00' : '17:00:00';

        // Étape 1: Retirer la secrétaire de l'ancien créneau
        const isBackup = oldCreneau.backups_ids?.includes(secretaryId);
        const newSecretairesIds = (oldCreneau.secretaires_ids || []).filter(id => id !== secretaryId);
        const newBackupsIds = (oldCreneau.backups_ids || []).filter(id => id !== secretaryId);
        
        const oldUpdateData: any = {
          secretaires_ids: newSecretairesIds,
          backups_ids: newBackupsIds,
        };

        // Retirer les rôles si la secrétaire les avait
        if (oldCreneau.responsable_1r_id === secretaryId) {
          oldUpdateData.responsable_1r_id = null;
        }
        if (oldCreneau.responsable_2f_id === secretaryId) {
          oldUpdateData.responsable_2f_id = null;
        }
        if (oldCreneau.responsable_3f_id === secretaryId) {
          oldUpdateData.responsable_3f_id = null;
        }

        await supabase
          .from('planning_genere')
          .update(oldUpdateData)
          .eq('id', oldCreneau.id);

        // Étape 2: Trouver ou créer le créneau de destination
        const { data: targetCreneauData } = await supabase
          .from('planning_genere')
          .select('*')
          .eq('date', date)
          .eq('heure_debut', heureDebut)
          .eq('site_id', newSiteId)
          .eq('type_assignation', newTypeAssignation)
          .maybeSingle();

        if (targetCreneauData) {
          // Le créneau existe, ajouter la secrétaire
          const updatedSecretairesIds = isBackup 
            ? targetCreneauData.secretaires_ids || []
            : [...(targetCreneauData.secretaires_ids || []), secretaryId];
          const updatedBackupsIds = isBackup
            ? [...(targetCreneauData.backups_ids || []), secretaryId]
            : targetCreneauData.backups_ids || [];

          const targetUpdateData: any = {
            secretaires_ids: updatedSecretairesIds,
            backups_ids: updatedBackupsIds,
          };

          // Ajouter les rôles si applicable et que le site a fermeture
          if (siteHasFermeture) {
            if (is1R) targetUpdateData.responsable_1r_id = secretaryId;
            if (is2F) targetUpdateData.responsable_2f_id = secretaryId;
            if (is3F) targetUpdateData.responsable_3f_id = secretaryId;
          }

          await supabase
            .from('planning_genere')
            .update(targetUpdateData)
            .eq('id', targetCreneauData.id);
        } else {
          // Le créneau n'existe pas, le créer
          const newCreneauData: any = {
            date,
            heure_debut: heureDebut,
            heure_fin: heureFin,
            site_id: newSiteId,
            type_assignation: newTypeAssignation,
            type: 'medecin',
            statut: 'planifie',
            secretaires_ids: isBackup ? [] : [secretaryId],
            backups_ids: isBackup ? [secretaryId] : [],
            medecins_ids: oldCreneau.medecins_ids || [],
          };

          // Ajouter les rôles si applicable et que le site a fermeture
          if (siteHasFermeture) {
            if (is1R) newCreneauData.responsable_1r_id = secretaryId;
            if (is2F) newCreneauData.responsable_2f_id = secretaryId;
            if (is3F) newCreneauData.responsable_3f_id = secretaryId;
          }

          await supabase
            .from('planning_genere')
            .insert(newCreneauData);
        }
      };

      const newTypeAssignation = selectedSiteId === 'administratif' ? 'administratif' : 'site';
      const newSiteId = selectedSiteId === 'administratif' ? null : (selectedSiteId || null);

      if (shouldUpdateMatin && creneauMatin) {
        await moveSecretaryToCreneau(creneauMatin, newSiteId, newTypeAssignation, 'matin');
      }

      if (shouldUpdateAM && creneauAM) {
        await moveSecretaryToCreneau(creneauAM, newSiteId, newTypeAssignation, 'apres_midi');
      }

      toast({
        title: 'Modification enregistrée',
        description: 'L\'assignation a été mise à jour avec succès.',
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
    if (!selectedSwitchSecretaire || !date) return;
    
    setLoading(true);
    try {
      // Determine period parameter for the RPC function
      let periodParam: string;
      if (!selectedPeriod || selectedPeriod === 'both') {
        periodParam = 'both';
      } else {
        periodParam = selectedPeriod;
      }

      // Call the transactional swap function
      const { data, error } = await supabase.rpc('swap_secretaries', {
        p_date: date,
        p_period: periodParam,
        p_secretary_id_1: secretaryId,
        p_secretary_id_2: selectedSwitchSecretaire,
      });

      if (error) throw error;

      toast({
        title: "Succès",
        description: "L'échange a été effectué avec succès.",
      });
      onOpenChange(false);
      onSuccess();
    } catch (error: any) {
      console.error('Error switching assignments:', error);
      toast({
        title: "Erreur",
        description: error.message || "Une erreur est survenue lors de l'échange.",
        variant: "destructive",
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
                        {site.nom}
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

                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-2">
                      <Badge variant="secondary" className="text-xs">3F</Badge>
                      <span className="text-sm">Responsable 3F</span>
                    </div>
                    <Switch checked={is3F} onCheckedChange={setIs3F} />
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
                        {sec.first_name} {sec.name} {sec.is_backup && '(Backup)'} - {sec.current_site}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                {availableSecretaires.length === 0 && (
                  <p className="text-xs text-muted-foreground">
                    Aucune secrétaire compatible trouvée sur des sites compatibles ce jour-là
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
