import { useState, useEffect } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { useToast } from '@/hooks/use-toast';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Label } from '@/components/ui/label';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { Toggle } from '@/components/ui/toggle';
import { RadioGroup, RadioGroupItem } from '@/components/ui/radio-group';
import { Loader2 } from 'lucide-react';
import { 
  getAvailableSecretariesForSite, 
  getAssignedSecretariesForSite,
  getCompatibleSecretariesForSwap,
  getFullDayAssignments,
} from '@/lib/planningHelpers';

interface ManagePersonnelDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  context: {
    date: string;
    site_id?: string;
    site_nom?: string;
    periode?: 'matin' | 'apres_midi';
    secretaire_id?: string;
    secretaire_nom?: string;
    assignment_id?: string;
  };
  onSuccess: () => void;
}

type Action = 'add' | 'remove' | 'swap' | 'edit';

export function ManagePersonnelDialog({
  open,
  onOpenChange,
  context,
  onSuccess,
}: ManagePersonnelDialogProps) {
  const [loading, setLoading] = useState(false);
  const [action, setAction] = useState<Action | null>(null);
  const [availableSecretaries, setAvailableSecretaries] = useState<any[]>([]);
  const [assignedSecretaries, setAssignedSecretaries] = useState<any[]>([]);
  const [sites, setSites] = useState<any[]>([]);
  const [filteredSites, setFilteredSites] = useState<any[]>([]);
  const [selectedSecretaryId, setSelectedSecretaryId] = useState('');
  const [selectedSiteId, setSelectedSiteId] = useState('');
  const [is1R, setIs1R] = useState(false);
  const [is2F, setIs2F] = useState(false);
  const [is3F, setIs3F] = useState(false);
  const [selectedPeriod, setSelectedPeriod] = useState<'matin' | 'apres_midi' | 'toute_journee'>('matin');
  const [isFullDayAssignment, setIsFullDayAssignment] = useState(false);
  const [morningAssignmentId, setMorningAssignmentId] = useState<string | null>(null);
  const [afternoonAssignmentId, setAfternoonAssignmentId] = useState<string | null>(null);
  const { toast } = useToast();

  useEffect(() => {
    if (open) {
      if (context.assignment_id) {
        // Edit mode - load current assignment data
        setAction('edit');
        loadCurrentAssignment();
      } else {
        // New assignment mode
        setAction(null);
        setSelectedSecretaryId('');
        setSelectedSiteId(context.site_id || '');
        setIs1R(false);
        setIs2F(false);
        setIs3F(false);
        setSelectedPeriod('matin');
        setIsFullDayAssignment(false);
        setMorningAssignmentId(null);
        setAfternoonAssignmentId(null);
      }
      loadSites();
    }
  }, [open, context.assignment_id]);

  const loadSites = async () => {
    const { data, error } = await supabase
      .from('sites')
      .select('id, nom')
      .eq('actif', true)
      .order('nom');

    if (!error && data) {
      setSites(data);
    }
  };

  const loadCurrentAssignment = async () => {
    if (!context.assignment_id || !context.secretaire_id) return;
    
    setLoading(true);
    try {
      const { data, error } = await supabase
        .from('planning_genere_personnel')
        .select(`
          id,
          secretaire_id,
          site_id,
          periode,
          is_1r,
          is_2f,
          is_3f,
          secretaires:secretaires!planning_genere_personnel_secretaire_id_fkey (
            id,
            first_name,
            name
          )
        `)
        .eq('id', context.assignment_id)
        .single();

      if (error) throw error;

      if (data) {
        setSelectedSecretaryId(data.secretaire_id || '');
        setSelectedSiteId(data.site_id || '');
        setIs1R(data.is_1r || false);
        setIs2F(data.is_2f || false);
        setIs3F(data.is_3f || false);
        setSelectedPeriod(data.periode);

        // Load secretary site preferences
        const { data: sitesPreferences } = await supabase
          .from('secretaires_sites')
          .select('site_id')
          .eq('secretaire_id', data.secretaire_id);

        if (sitesPreferences) {
          const preferredSiteIds = sitesPreferences.map(sp => sp.site_id);
          const filtered = sites.filter(site => preferredSiteIds.includes(site.id));
          setFilteredSites(filtered);
        }

        // Check if this is part of a full day assignment
        const fullDayInfo = await getFullDayAssignments(context.date, context.secretaire_id);
        setIsFullDayAssignment(fullDayInfo.isFullDay);
        setMorningAssignmentId(fullDayInfo.morningId);
        setAfternoonAssignmentId(fullDayInfo.afternoonId);

        if (fullDayInfo.isFullDay) {
          setSelectedPeriod('toute_journee');
        }
      }
    } catch (error) {
      console.error('Error loading assignment:', error);
      toast({
        title: 'Erreur',
        description: 'Impossible de charger les informations',
        variant: 'destructive',
      });
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    if (action && context.site_id && context.periode) {
      if (action === 'add') {
        fetchAvailableSecretaries();
      } else if (action === 'remove') {
        fetchAssignedSecretaries();
      }
    }
  }, [action, context]);

  useEffect(() => {
    if (action === 'swap' && context.assignment_id) {
      fetchCompatibleSecretaries();
    }
  }, [action, context.assignment_id, selectedPeriod]);

  const fetchAvailableSecretaries = async () => {
    if (!context.site_id || !context.periode) return;
    setLoading(true);
    try {
      const secs = await getAvailableSecretariesForSite(
        context.date,
        context.periode,
        context.site_id
      );
      setAvailableSecretaries(secs);
    } catch (error) {
      console.error('Error fetching available secretaries:', error);
      toast({
        title: 'Erreur',
        description: 'Impossible de charger les secrétaires disponibles',
        variant: 'destructive',
      });
    } finally {
      setLoading(false);
    }
  };

  const fetchAssignedSecretaries = async () => {
    if (!context.site_id || !context.periode) return;
    setLoading(true);
    try {
      const secs = await getAssignedSecretariesForSite(
        context.date,
        context.periode,
        context.site_id
      );
      setAssignedSecretaries(secs);
    } catch (error) {
      console.error('Error fetching assigned secretaries:', error);
      toast({
        title: 'Erreur',
        description: 'Impossible de charger les secrétaires assignées',
        variant: 'destructive',
      });
    } finally {
      setLoading(false);
    }
  };

  const fetchCompatibleSecretaries = async () => {
    if (!context.assignment_id) return;
    setLoading(true);
    try {
      // Determine which period to use for fetching compatible secretaries
      let fetchPeriod: 'matin' | 'apres_midi' = 'matin';
      
      if (selectedPeriod === 'toute_journee') {
        // For full day, we'll fetch for morning and user can swap the whole day
        fetchPeriod = 'matin';
      } else {
        fetchPeriod = selectedPeriod as 'matin' | 'apres_midi';
      }

      const secs = await getCompatibleSecretariesForSwap(
        context.assignment_id,
        context.date,
        fetchPeriod
      );
      setAvailableSecretaries(secs);
    } catch (error) {
      console.error('Error fetching compatible secretaries:', error);
      toast({
        title: 'Erreur',
        description: 'Impossible de charger les secrétaires compatibles',
        variant: 'destructive',
      });
    } finally {
      setLoading(false);
    }
  };

  const handleAdd = async () => {
    if (!selectedSecretaryId || !selectedSiteId || !context.periode) return;

    setLoading(true);
    try {
      // Get max ordre
      const { data: existingAssignments } = await supabase
        .from('planning_genere_personnel')
        .select('ordre')
        .eq('date', context.date)
        .eq('periode', context.periode)
        .eq('site_id', selectedSiteId)
        .eq('type_assignation', 'site')
        .order('ordre', { ascending: false })
        .limit(1);

      const maxOrdre = existingAssignments && existingAssignments.length > 0
        ? existingAssignments[0].ordre
        : 0;

      const { error } = await supabase
        .from('planning_genere_personnel')
        .insert({
          date: context.date,
          periode: context.periode,
          site_id: selectedSiteId,
          secretaire_id: selectedSecretaryId,
          type_assignation: 'site',
          ordre: maxOrdre + 1,
          is_1r: is1R,
          is_2f: is2F,
          is_3f: is3F,
        });

      if (error) throw error;

      toast({ title: 'Succès', description: 'Secrétaire ajoutée avec succès' });
      onSuccess();
      onOpenChange(false);
    } catch (error: any) {
      console.error('Error adding secretary:', error);
      toast({
        title: 'Erreur',
        description: error.message || 'Erreur lors de l\'ajout',
        variant: 'destructive',
      });
    } finally {
      setLoading(false);
    }
  };

  const handleRemove = async () => {
    if (!selectedSecretaryId) return;

    setLoading(true);
    try {
      const { error } = await supabase
        .from('planning_genere_personnel')
        .delete()
        .eq('id', selectedSecretaryId);

      if (error) throw error;

      toast({ title: 'Succès', description: 'Secrétaire retirée avec succès' });
      onSuccess();
      onOpenChange(false);
    } catch (error: any) {
      console.error('Error removing secretary:', error);
      toast({
        title: 'Erreur',
        description: error.message || 'Erreur lors du retrait',
        variant: 'destructive',
      });
    } finally {
      setLoading(false);
    }
  };

  const handleEdit = async () => {
    if (!context.assignment_id || !selectedSiteId) {
      toast({
        title: 'Erreur',
        description: 'Veuillez sélectionner un site',
        variant: 'destructive',
      });
      return;
    }

    setLoading(true);
    try {
      const updateData = {
        site_id: selectedSiteId,
        is_1r: is1R,
        is_2f: is2F,
        is_3f: is3F,
      };

      // If full day and user wants to modify both periods
      if (selectedPeriod === 'toute_journee' && morningAssignmentId && afternoonAssignmentId) {
        // Update both morning and afternoon
        const { error: morningError } = await supabase
          .from('planning_genere_personnel')
          .update(updateData)
          .eq('id', morningAssignmentId);

        if (morningError) throw morningError;

        const { error: afternoonError } = await supabase
          .from('planning_genere_personnel')
          .update(updateData)
          .eq('id', afternoonAssignmentId);

        if (afternoonError) throw afternoonError;

        toast({ title: 'Succès', description: 'Assignations de la journée modifiées avec succès' });
      } else {
        // Single period modification
        const targetId = selectedPeriod === 'matin' ? morningAssignmentId : 
                        selectedPeriod === 'apres_midi' ? afternoonAssignmentId : 
                        context.assignment_id;

        const { error } = await supabase
          .from('planning_genere_personnel')
          .update(updateData)
          .eq('id', targetId);

        if (error) throw error;

        toast({ title: 'Succès', description: 'Assignation modifiée avec succès' });
      }

      onSuccess();
      onOpenChange(false);
    } catch (error: any) {
      console.error('Error updating assignment:', error);
      toast({
        title: 'Erreur',
        description: error.message || 'Erreur lors de la modification',
        variant: 'destructive',
      });
    } finally {
      setLoading(false);
    }
  };

  const handleSwap = async () => {
    if (!selectedSecretaryId || !context.assignment_id) return;

    // selectedSecretaryId contains the assignment_id of the target secretary
    const targetAssignment = availableSecretaries.find(
      (s) => s.assignment_id === selectedSecretaryId
    );

    if (!targetAssignment) return;

    setLoading(true);
    try {
      // Check if swapping with administrative secretary
      if (targetAssignment.site_nom === 'Administratif') {
        // Swap site <-> administratif
        // 1. Get current assignment details
        const { data: currentData } = await supabase
          .from('planning_genere_personnel')
          .select('secretaire_id, site_id, is_1r, is_2f, is_3f')
          .eq('id', context.assignment_id)
          .single();

        if (!currentData) throw new Error('Assignation actuelle introuvable');

        // 2. Remove current secretary from site
        const { error: error1 } = await supabase
          .from('planning_genere_personnel')
          .update({ secretaire_id: null })
          .eq('id', context.assignment_id);

        if (error1) throw error1;

        // 3. Create admin assignment for current secretary
        const { error: error2 } = await supabase
          .from('planning_genere_personnel')
          .insert({
            date: context.date,
            periode: selectedPeriod === 'toute_journee' ? 'matin' : selectedPeriod,
            secretaire_id: currentData.secretaire_id,
            type_assignation: 'administratif',
          });

        if (error2) throw error2;

        // 4. If full day, also create afternoon admin assignment
        if (selectedPeriod === 'toute_journee' && afternoonAssignmentId) {
          const { error: error2b } = await supabase
            .from('planning_genere_personnel')
            .update({ secretaire_id: null })
            .eq('id', afternoonAssignmentId);

          if (error2b) throw error2b;

          const { error: error2c } = await supabase
            .from('planning_genere_personnel')
            .insert({
              date: context.date,
              periode: 'apres_midi',
              secretaire_id: currentData.secretaire_id,
              type_assignation: 'administratif',
            });

          if (error2c) throw error2c;
        }

        // 5. Delete admin assignment(s)
        if (selectedPeriod === 'toute_journee') {
          // For full day swap, delete both morning and afternoon admin assignments
          const { error: error3 } = await supabase
            .from('planning_genere_personnel')
            .delete()
            .eq('date', context.date)
            .eq('secretaire_id', targetAssignment.id)
            .eq('type_assignation', 'administratif')
            .in('periode', ['matin', 'apres_midi']);

          if (error3) throw error3;
        } else {
          // For single period swap, delete only the matching period admin assignment
          const { error: error3 } = await supabase
            .from('planning_genere_personnel')
            .delete()
            .eq('id', targetAssignment.assignment_id);

          if (error3) throw error3;
        }

        // 6. Assign target to site
        const { error: error4 } = await supabase
          .from('planning_genere_personnel')
          .update({ 
            secretaire_id: targetAssignment.id,
            is_1r: currentData.is_1r,
            is_2f: currentData.is_2f,
            is_3f: currentData.is_3f,
          })
          .eq('id', context.assignment_id);

        if (error4) throw error4;

        // 7. If full day, also assign afternoon
        if (selectedPeriod === 'toute_journee' && afternoonAssignmentId) {
          const { error: error4b } = await supabase
            .from('planning_genere_personnel')
            .update({ 
              secretaire_id: targetAssignment.id,
              is_1r: currentData.is_1r,
              is_2f: currentData.is_2f,
              is_3f: currentData.is_3f,
            })
            .eq('id', afternoonAssignmentId);

          if (error4b) throw error4b;
        }

        toast({ title: 'Succès', description: 'Échange effectué avec le personnel administratif' });
      } else {
        // Standard swap using RPC function
        const { error } = await supabase.rpc('swap_secretaries_personnel', {
          p_assignment_id_1: context.assignment_id,
          p_assignment_id_2: targetAssignment.assignment_id,
        });

        if (error) throw error;

        toast({ title: 'Succès', description: 'Échange effectué avec succès' });
      }

      onSuccess();
      onOpenChange(false);
    } catch (error: any) {
      console.error('Error swapping secretaries:', error);
      toast({
        title: 'Erreur',
        description: error.message || 'Erreur lors de l\'échange',
        variant: 'destructive',
      });
    } finally {
      setLoading(false);
    }
  };

  const handleSubmit = () => {
    if (action === 'add') handleAdd();
    else if (action === 'remove') handleRemove();
    else if (action === 'swap') handleSwap();
    else if (action === 'edit') handleEdit();
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>
            {action === 'edit' ? 'Modifier l\'assignation' : 'Gérer le personnel'}
          </DialogTitle>
          <DialogDescription>
            {context.site_nom} - {context.periode === 'matin' ? 'Matin' : 'Après-midi'}
            {context.secretaire_nom && ` - ${context.secretaire_nom}`}
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4 py-4">
          {!action && (
            <div className="space-y-3">
              <Label>Action</Label>
              <div className="grid grid-cols-3 gap-2">
                <Button variant="outline" onClick={() => setAction('add')}>
                  Ajouter
                </Button>
                <Button variant="outline" onClick={() => setAction('remove')}>
                  Retirer
                </Button>
                <Button variant="outline" onClick={() => setAction('swap')}>
                  Échanger
                </Button>
              </div>
            </div>
          )}

          {action === 'edit' && (
            <>
              {isFullDayAssignment && (
                <div className="space-y-2">
                  <Label>Période à modifier</Label>
                  <RadioGroup value={selectedPeriod} onValueChange={(value: any) => setSelectedPeriod(value)}>
                    <div className="flex items-center space-x-2">
                      <RadioGroupItem value="matin" id="edit-matin" />
                      <Label htmlFor="edit-matin">Matin uniquement</Label>
                    </div>
                    <div className="flex items-center space-x-2">
                      <RadioGroupItem value="apres_midi" id="edit-apres-midi" />
                      <Label htmlFor="edit-apres-midi">Après-midi uniquement</Label>
                    </div>
                    <div className="flex items-center space-x-2">
                      <RadioGroupItem value="toute_journee" id="edit-toute-journee" />
                      <Label htmlFor="edit-toute-journee">Toute la journée</Label>
                    </div>
                  </RadioGroup>
                </div>
              )}

              <div className="space-y-2">
                <Label>Site</Label>
                <Select value={selectedSiteId} onValueChange={setSelectedSiteId}>
                  <SelectTrigger>
                    <SelectValue placeholder="Sélectionner un site" />
                  </SelectTrigger>
                  <SelectContent>
                    {filteredSites.map((site) => (
                      <SelectItem key={site.id} value={site.id}>
                        {site.nom}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                {filteredSites.length === 0 && (
                  <p className="text-sm text-muted-foreground">
                    Aucun site dans les préférences de cette secrétaire
                  </p>
                )}
              </div>

              <div className="space-y-2">
                <Label>Responsabilités</Label>
                <div className="flex gap-2">
                  <Toggle
                    pressed={is1R}
                    onPressedChange={setIs1R}
                    variant="outline"
                    className={is1R ? 'border-2 border-blue-500 bg-blue-50 text-blue-700 hover:bg-blue-100' : ''}
                  >
                    1R
                  </Toggle>
                  <Toggle
                    pressed={is2F}
                    onPressedChange={setIs2F}
                    variant="outline"
                    className={is2F ? 'border-2 border-green-500 bg-green-50 text-green-700 hover:bg-green-100' : ''}
                  >
                    2F
                  </Toggle>
                  <Toggle
                    pressed={is3F}
                    onPressedChange={setIs3F}
                    variant="outline"
                    className={is3F ? 'border-2 border-purple-500 bg-purple-50 text-purple-700 hover:bg-purple-100' : ''}
                  >
                    3F
                  </Toggle>
                </div>
              </div>

              <div className="pt-2">
                <Button
                  variant="outline"
                  className="w-full"
                  onClick={() => setAction('swap')}
                >
                  Échanger avec une autre secrétaire
                </Button>
              </div>
            </>
          )}

          {action === 'add' && (
            <>
              <div className="space-y-2">
                <Label>Secrétaire à ajouter</Label>
                <Select value={selectedSecretaryId} onValueChange={setSelectedSecretaryId}>
                  <SelectTrigger>
                    <SelectValue placeholder="Sélectionner" />
                  </SelectTrigger>
                  <SelectContent>
                    {availableSecretaries.map((sec) => (
                      <SelectItem key={sec.id} value={sec.id}>
                        {sec.first_name} {sec.name}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                {availableSecretaries.length === 0 && !loading && (
                  <p className="text-sm text-muted-foreground">Aucune secrétaire disponible</p>
                )}
              </div>

              {selectedSecretaryId && (
                <>
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

                  <div className="space-y-2">
                    <Label>Responsabilités</Label>
                    <div className="flex gap-2">
                      <Toggle
                        pressed={is1R}
                        onPressedChange={setIs1R}
                        variant="outline"
                        className={is1R ? 'border-2 border-blue-500 bg-blue-50 text-blue-700 hover:bg-blue-100' : ''}
                      >
                        1R
                      </Toggle>
                      <Toggle
                        pressed={is2F}
                        onPressedChange={setIs2F}
                        variant="outline"
                        className={is2F ? 'border-2 border-green-500 bg-green-50 text-green-700 hover:bg-green-100' : ''}
                      >
                        2F
                      </Toggle>
                      <Toggle
                        pressed={is3F}
                        onPressedChange={setIs3F}
                        variant="outline"
                        className={is3F ? 'border-2 border-purple-500 bg-purple-50 text-purple-700 hover:bg-purple-100' : ''}
                      >
                        3F
                      </Toggle>
                    </div>
                  </div>
                </>
              )}
            </>
          )}

          {action === 'remove' && (
            <div className="space-y-2">
              <Label>Secrétaire à retirer</Label>
              <Select value={selectedSecretaryId} onValueChange={setSelectedSecretaryId}>
                <SelectTrigger>
                  <SelectValue placeholder="Sélectionner" />
                </SelectTrigger>
                <SelectContent>
                  {assignedSecretaries.map((sec) => (
                    <SelectItem key={sec.id} value={sec.id}>
                      {sec.secretaires?.first_name} {sec.secretaires?.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          )}

          {action === 'swap' && (
            <>
              {isFullDayAssignment && (
                <div className="space-y-2">
                  <Label>Période à échanger</Label>
                  <RadioGroup value={selectedPeriod} onValueChange={(value: any) => setSelectedPeriod(value)}>
                    <div className="flex items-center space-x-2">
                      <RadioGroupItem value="matin" id="swap-matin" />
                      <Label htmlFor="swap-matin">Matin uniquement</Label>
                    </div>
                    <div className="flex items-center space-x-2">
                      <RadioGroupItem value="apres_midi" id="swap-apres-midi" />
                      <Label htmlFor="swap-apres-midi">Après-midi uniquement</Label>
                    </div>
                    <div className="flex items-center space-x-2">
                      <RadioGroupItem value="toute_journee" id="swap-toute-journee" />
                      <Label htmlFor="swap-toute-journee">Toute la journée</Label>
                    </div>
                  </RadioGroup>
                </div>
              )}

              <div className="space-y-2">
                <Label>Échanger avec (autre site uniquement)</Label>
                <Select value={selectedSecretaryId} onValueChange={setSelectedSecretaryId}>
                  <SelectTrigger>
                    <SelectValue placeholder="Sélectionner" />
                  </SelectTrigger>
                  <SelectContent>
                    {availableSecretaries.map((sec) => (
                      <SelectItem key={sec.assignment_id} value={sec.assignment_id}>
                        {sec.first_name} {sec.name} - {sec.site_nom}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                {availableSecretaries.length === 0 && !loading && (
                  <p className="text-sm text-muted-foreground">
                    Aucune secrétaire compatible pour l'échange (sur un autre site)
                  </p>
                )}
              </div>
            </>
          )}
        </div>

        <DialogFooter>
          <Button
            variant="outline"
            onClick={() => {
              if (action && action !== 'edit') {
                setAction(null);
                setSelectedSecretaryId('');
              } else {
                onOpenChange(false);
              }
            }}
            disabled={loading}
          >
            {action && action !== 'edit' ? 'Retour' : 'Annuler'}
          </Button>
          {action && (
            <Button 
              onClick={handleSubmit} 
              disabled={
                loading || 
                (action === 'add' && (!selectedSecretaryId || !selectedSiteId)) ||
                (action === 'remove' && !selectedSecretaryId) ||
                (action === 'swap' && !selectedSecretaryId) ||
                (action === 'edit' && !selectedSiteId)
              }
            >
              {loading && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
              {action === 'add' && 'Ajouter'}
              {action === 'remove' && 'Retirer'}
              {action === 'swap' && 'Échanger'}
              {action === 'edit' && 'Enregistrer'}
            </Button>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
