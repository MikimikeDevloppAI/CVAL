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
import { Loader2, AlertTriangle } from 'lucide-react';
import { toast } from '@/hooks/use-toast';
import { Alert, AlertDescription } from '@/components/ui/alert';
import {
  Command,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
} from '@/components/ui/command';
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from '@/components/ui/popover';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { Check, ChevronsUpDown } from 'lucide-react';
import { cn } from '@/lib/utils';
import { Badge } from '@/components/ui/badge';

interface MedecinFromOtherSite {
  id: string;
  first_name: string;
  name: string;
  current_site_id: string;
  current_site_name: string;
  current_periode: 'matin' | 'apres_midi' | 'toute_journee';
  besoin_id: string;
  besoin_id_apres_midi?: string;
  type_intervention_id?: string;
}

interface TypeIntervention {
  id: string;
  nom: string;
}

interface ReassignMedecinDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  date: string;
  targetSiteId: string;
  targetSiteName: string;
  onSuccess: () => void;
}

export function ReassignMedecinDialog({
  open,
  onOpenChange,
  date,
  targetSiteId,
  targetSiteName,
  onSuccess,
}: ReassignMedecinDialogProps) {
  const [medecins, setMedecins] = useState<MedecinFromOtherSite[]>([]);
  const [selectedMedecinId, setSelectedMedecinId] = useState('');
  const [periode, setPeriode] = useState<'matin' | 'apres_midi' | 'journee'>('matin');
  const [typeInterventionId, setTypeInterventionId] = useState<string>('');
  const [typesIntervention, setTypesIntervention] = useState<TypeIntervention[]>([]);
  const [loading, setLoading] = useState(false);
  const [comboOpen, setComboOpen] = useState(false);
  const [isBlocOperatoire, setIsBlocOperatoire] = useState(false);

  useEffect(() => {
    if (open) {
      checkIfBlocOperatoire();
    }
  }, [open, targetSiteId]);

  useEffect(() => {
    if (open && periode) {
      fetchMedecinsFromOtherSites();
    }
  }, [open, targetSiteId, periode]);

  useEffect(() => {
    if (isBlocOperatoire && open) {
      fetchTypesIntervention();
    }
  }, [isBlocOperatoire, open]);

  const checkIfBlocOperatoire = async () => {
    const { data } = await supabase
      .from('sites')
      .select('nom')
      .eq('id', targetSiteId)
      .single();
    
    setIsBlocOperatoire(data?.nom === 'Clinique La Vallée - Bloc opératoire');
  };

  const fetchTypesIntervention = async () => {
    const { data } = await supabase
      .from('types_intervention')
      .select('id, nom')
      .eq('actif', true)
      .order('nom');
    
    if (data) {
      setTypesIntervention(data);
    }
  };

  const fetchMedecinsFromOtherSites = async () => {
    // Determine which periods to fetch based on selected periode
    const periodsToFetch: ('matin' | 'apres_midi')[] = 
      periode === 'journee' 
        ? ['matin', 'apres_midi']
        : [periode as 'matin' | 'apres_midi'];

    const { data: besoins } = await supabase
      .from('besoin_effectif')
      .select(`
        id,
        demi_journee,
        type_intervention_id,
        medecin_id,
        site_id,
        medecins(id, first_name, name),
        sites(id, nom)
      `)
      .eq('date', date)
      .eq('type', 'medecin')
      .neq('site_id', targetSiteId)
      .in('demi_journee', periodsToFetch)
      .not('medecin_id', 'is', null);

    if (besoins) {
      // Group by medecin + site to detect full day assignments
      const grouped = new Map<string, {
        medecin_id: string;
        site_id: string;
        first_name: string;
        name: string;
        site_nom: string;
        besoins: typeof besoins;
      }>();

      besoins.filter(b => b.medecins && b.sites).forEach(b => {
        const key = `${b.medecin_id}_${b.site_id}`;
        if (!grouped.has(key)) {
          grouped.set(key, {
            medecin_id: b.medecin_id!,
            site_id: b.site_id,
            first_name: (b.medecins as any).first_name || '',
            name: (b.medecins as any).name || '',
            site_nom: (b.sites as any).nom,
            besoins: [],
          });
        }
        grouped.get(key)!.besoins.push(b);
      });

      const medecinsFromOther: MedecinFromOtherSite[] = [];

      grouped.forEach(({ medecin_id, site_id, first_name, name, site_nom, besoins: bsns }) => {
        const hasMatin = bsns.some(b => b.demi_journee === 'matin');
        const hasApresMidi = bsns.some(b => b.demi_journee === 'apres_midi');

        if (periode === 'journee' && hasMatin && hasApresMidi) {
          // Both periods exist: show as full day
          const matinBesoin = bsns.find(b => b.demi_journee === 'matin')!;
          const apresMidiBesoin = bsns.find(b => b.demi_journee === 'apres_midi')!;
          
          medecinsFromOther.push({
            id: medecin_id,
            first_name,
            name,
            current_site_id: site_id,
            current_site_name: site_nom,
            current_periode: 'toute_journee' as any,
            besoin_id: matinBesoin.id,
            besoin_id_apres_midi: apresMidiBesoin.id,
            type_intervention_id: matinBesoin.type_intervention_id || apresMidiBesoin.type_intervention_id || undefined,
          });
        } else {
          // Single period or only one period available: show individual periods
          bsns.forEach(b => {
            medecinsFromOther.push({
              id: medecin_id,
              first_name,
              name,
              current_site_id: site_id,
              current_site_name: site_nom,
              current_periode: b.demi_journee as 'matin' | 'apres_midi',
              besoin_id: b.id,
              type_intervention_id: b.type_intervention_id || undefined,
            });
          });
        }
      });

      setMedecins(medecinsFromOther);
    }
  };

  const handleSubmit = async () => {
    if (!selectedMedecinId) {
      toast({
        title: 'Erreur',
        description: 'Veuillez sélectionner un médecin',
        variant: 'destructive',
      });
      return;
    }

    if (isBlocOperatoire && !typeInterventionId) {
      toast({
        title: 'Erreur',
        description: 'Veuillez sélectionner un type d\'intervention',
        variant: 'destructive',
      });
      return;
    }

    setLoading(true);
    try {
      const selectedMedecin = medecins.find(m => m.id === selectedMedecinId);
      if (!selectedMedecin) return;

      // Determine which periods to delete based on current assignment
      const periodsToDelete: ('matin' | 'apres_midi')[] = 
        selectedMedecin.current_periode === 'toute_journee'
          ? ['matin', 'apres_midi']
          : [selectedMedecin.current_periode];

      const periodsToCreate: ('matin' | 'apres_midi')[] = 
        periode === 'journee' 
          ? ['matin', 'apres_midi']
          : [periode as 'matin' | 'apres_midi'];

      // Delete old besoin_effectif
      const { error: deleteError } = await supabase
        .from('besoin_effectif')
        .delete()
        .eq('medecin_id', selectedMedecinId)
        .eq('date', date)
        .in('demi_journee', periodsToDelete);

      if (deleteError) throw deleteError;

      // Create new besoin_effectif
      const newBesoins = periodsToCreate.map(p => ({
        date,
        type: 'medecin' as const,
        medecin_id: selectedMedecinId,
        site_id: targetSiteId,
        demi_journee: p,
        type_intervention_id: isBlocOperatoire ? typeInterventionId : null,
        actif: true,
      }));

      const { error: insertError } = await supabase
        .from('besoin_effectif')
        .insert(newBesoins);

      if (insertError) throw insertError;

      toast({
        title: 'Succès',
        description: `Le médecin a été réaffecté à ${targetSiteName}`,
      });
      onSuccess();
      onOpenChange(false);
    } catch (error) {
      console.error('Error reassigning medecin:', error);
      toast({
        title: 'Erreur',
        description: 'Impossible de réaffecter le médecin',
        variant: 'destructive',
      });
    } finally {
      setLoading(false);
    }
  };

  const selectedMedecin = medecins.find(m => m.id === selectedMedecinId);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-[500px]">
        <DialogHeader>
          <DialogTitle>Réaffecter un médecin</DialogTitle>
          <DialogDescription>
            Réaffecter un médecin depuis un autre site vers {targetSiteName}
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4 py-4">
          {/* Période selection - FIRST */}
          <div className="space-y-2">
            <Label>Période souhaitée *</Label>
            <RadioGroup value={periode} onValueChange={(value: any) => {
              setPeriode(value);
              setSelectedMedecinId(''); // Reset selection when period changes
            }}>
              <div className="flex items-center space-x-2">
                <RadioGroupItem value="matin" id="matin" />
                <Label htmlFor="matin" className="font-normal cursor-pointer">Matin</Label>
              </div>
              <div className="flex items-center space-x-2">
                <RadioGroupItem value="apres_midi" id="apres_midi" />
                <Label htmlFor="apres_midi" className="font-normal cursor-pointer">Après-midi</Label>
              </div>
              <div className="flex items-center space-x-2">
                <RadioGroupItem value="journee" id="journee" />
                <Label htmlFor="journee" className="font-normal cursor-pointer">Toute la journée</Label>
              </div>
            </RadioGroup>
          </div>

          {/* Médecin selection - SECOND */}
          <div className="space-y-2">
            <Label>Médecin à réaffecter</Label>
            <Popover open={comboOpen} onOpenChange={setComboOpen}>
              <PopoverTrigger asChild>
                <Button
                  variant="outline"
                  role="combobox"
                  aria-expanded={comboOpen}
                  className="w-full justify-between"
                >
                  {selectedMedecinId
                    ? `${medecins.find(m => m.id === selectedMedecinId)?.first_name} ${medecins.find(m => m.id === selectedMedecinId)?.name}`
                    : "Sélectionner un médecin..."}
                  <ChevronsUpDown className="ml-2 h-4 w-4 shrink-0 opacity-50" />
                </Button>
              </PopoverTrigger>
              <PopoverContent className="w-[var(--radix-popover-trigger-width)] p-0" align="start">
                <Command className="max-h-[300px]">
                  <CommandInput placeholder="Rechercher..." />
                  <CommandEmpty>Aucun médecin trouvé.</CommandEmpty>
                  <CommandGroup className="overflow-auto">
                    {Array.from(new Map(medecins.map(m => [m.id, m])).values()).map((medecin) => (
                      <CommandItem
                        key={medecin.id}
                        value={`${medecin.first_name} ${medecin.name}`}
                        onSelect={() => {
                          setSelectedMedecinId(medecin.id);
                          setComboOpen(false);
                        }}
                      >
                        <Check
                          className={cn(
                            "mr-2 h-4 w-4",
                            selectedMedecinId === medecin.id ? "opacity-100" : "opacity-0"
                          )}
                        />
                        <div className="flex flex-col">
                          <span>{medecin.first_name} {medecin.name}</span>
                          <span className="text-xs text-muted-foreground">
                            {medecin.current_site_name} - {
                              medecin.current_periode === 'matin' ? 'Matin' : 
                              medecin.current_periode === 'apres_midi' ? 'Après-midi' :
                              'Toute la journée'
                            }
                          </span>
                        </div>
                      </CommandItem>
                    ))}
                  </CommandGroup>
                </Command>
              </PopoverContent>
            </Popover>
          </div>

          {selectedMedecin && (
            <Alert>
              <AlertTriangle className="h-4 w-4" />
              <AlertDescription>
                Actuellement assigné à <Badge variant="secondary">{selectedMedecin.current_site_name}</Badge> 
                {' '}pour la période <Badge variant="secondary">
                  {selectedMedecin.current_periode === 'matin' ? 'Matin' : 
                   selectedMedecin.current_periode === 'apres_midi' ? 'Après-midi' :
                   'Toute la journée'}
                </Badge>
              </AlertDescription>
            </Alert>
          )}

          {/* Type d'intervention (only for Bloc opératoire) */}
          {isBlocOperatoire && (
            <div className="space-y-2">
              <Label>Type d'intervention *</Label>
              <Select value={typeInterventionId} onValueChange={setTypeInterventionId}>
                <SelectTrigger>
                  <SelectValue placeholder="Sélectionner un type..." />
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

        <div className="flex justify-end gap-2">
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            Annuler
          </Button>
          <Button onClick={handleSubmit} disabled={loading}>
            {loading && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
            Réaffecter
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
