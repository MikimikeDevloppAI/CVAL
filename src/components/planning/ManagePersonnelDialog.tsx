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
import { RadioGroup, RadioGroupItem } from '@/components/ui/radio-group';
import { Loader2 } from 'lucide-react';
import { 
  getAvailableSecretariesForSite, 
  getAssignedSecretariesForSite,
  getCompatibleSecretariesForSwap 
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
  };
  onSuccess: () => void;
}

type Action = 'add' | 'remove' | 'swap';
type SwapScope = 'periode' | 'both';

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
  const [selectedSecretaryId, setSelectedSecretaryId] = useState('');
  const [swapScope, setSwapScope] = useState<SwapScope>('periode');
  const { toast } = useToast();

  useEffect(() => {
    if (open) {
      setAction(null);
      setSelectedSecretaryId('');
      setSwapScope('periode');
    }
  }, [open]);

  useEffect(() => {
    if (action && context.site_id && context.periode) {
      if (action === 'add') {
        fetchAvailableSecretaries();
      } else if (action === 'remove') {
        fetchAssignedSecretaries();
      } else if (action === 'swap' && context.secretaire_id) {
        fetchCompatibleSecretaries();
      }
    }
  }, [action, context]);

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
    if (!context.secretaire_id || !context.periode) return;
    setLoading(true);
    try {
      const secs = await getCompatibleSecretariesForSwap(
        context.secretaire_id,
        context.date,
        context.periode
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
    if (!selectedSecretaryId || !context.site_id || !context.periode) return;

    setLoading(true);
    try {
      // Get max ordre
      const { data: existingAssignments } = await supabase
        .from('planning_genere_personnel')
        .select('ordre')
        .eq('date', context.date)
        .eq('periode', context.periode)
        .eq('site_id', context.site_id)
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
          site_id: context.site_id,
          secretaire_id: selectedSecretaryId,
          type_assignation: 'site',
          ordre: maxOrdre + 1,
          is_1r: false,
          is_2f: false,
          is_3f: false,
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

  const handleSwap = async () => {
    if (!selectedSecretaryId || !context.secretaire_id) return;

    setLoading(true);
    try {
      const period = swapScope === 'both' ? 'both' : context.periode;

      const { data, error } = await supabase.rpc('swap_secretaries', {
        p_date: context.date,
        p_period: period,
        p_secretary_id_1: context.secretaire_id,
        p_secretary_id_2: selectedSecretaryId,
      });

      if (error) throw error;

      toast({ title: 'Succès', description: 'Échange effectué avec succès' });
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
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Gérer le personnel</DialogTitle>
          <DialogDescription>
            {context.site_nom} - {context.periode === 'matin' ? 'Matin' : 'Après-midi'}
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

          {action === 'add' && (
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
              <div className="space-y-2">
                <Label>Échanger avec</Label>
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
                  <p className="text-sm text-muted-foreground">
                    Aucune secrétaire compatible pour l'échange
                  </p>
                )}
              </div>

              {selectedSecretaryId && (
                <div className="space-y-2">
                  <Label>Portée de l'échange</Label>
                  <RadioGroup value={swapScope} onValueChange={(v) => setSwapScope(v as SwapScope)}>
                    <div className="flex items-center space-x-2">
                      <RadioGroupItem value="periode" id="scope-periode" />
                      <Label htmlFor="scope-periode" className="cursor-pointer font-normal">
                        Uniquement {context.periode === 'matin' ? 'le matin' : 'l\'après-midi'}
                      </Label>
                    </div>
                    <div className="flex items-center space-x-2">
                      <RadioGroupItem value="both" id="scope-both" />
                      <Label htmlFor="scope-both" className="cursor-pointer font-normal">
                        Toute la journée (matin et après-midi)
                      </Label>
                    </div>
                  </RadioGroup>
                </div>
              )}
            </>
          )}
        </div>

        <DialogFooter>
          <Button
            variant="outline"
            onClick={() => {
              if (action) {
                setAction(null);
                setSelectedSecretaryId('');
              } else {
                onOpenChange(false);
              }
            }}
            disabled={loading}
          >
            {action ? 'Retour' : 'Annuler'}
          </Button>
          {action && (
            <Button onClick={handleSubmit} disabled={loading || !selectedSecretaryId}>
              {loading && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
              {action === 'add' && 'Ajouter'}
              {action === 'remove' && 'Retirer'}
              {action === 'swap' && 'Échanger'}
            </Button>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
