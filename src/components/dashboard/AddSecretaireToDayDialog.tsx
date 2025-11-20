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
import { Check, ChevronsUpDown, AlertTriangle } from 'lucide-react';
import { cn } from '@/lib/utils';
import { Alert, AlertDescription } from '@/components/ui/alert';

interface Secretaire {
  id: string;
  first_name: string;
  name: string;
  existing_assignment?: string;
}

interface AddSecretaireToDayDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  date: string;
  siteId: string;
  siteName: string;
  onSuccess: () => void;
}

export function AddSecretaireToDayDialog({
  open,
  onOpenChange,
  date,
  siteId,
  siteName,
  onSuccess,
}: AddSecretaireToDayDialogProps) {
  const [secretaires, setSecretaires] = useState<Secretaire[]>([]);
  const [selectedSecretaireId, setSelectedSecretaireId] = useState('');
  const [selectedSiteId, setSelectedSiteId] = useState(siteId);
  const [periode, setPeriode] = useState<'matin' | 'apres_midi' | 'journee'>('matin');
  const [responsibility, setResponsibility] = useState<'1r' | '2f' | '3f' | null>(null);
  const [existingAssignment, setExistingAssignment] = useState<any>(null);
  const [loading, setLoading] = useState(false);
  const [comboOpen, setComboOpen] = useState(false);

  useEffect(() => {
    if (open) {
      fetchData();
      setSelectedSiteId(siteId);
      setResponsibility(null);
      setPeriode('matin');
    }
  }, [open, siteId]);

  useEffect(() => {
    if (periode) {
      fetchData();
    }
  }, [periode]);

  useEffect(() => {
    if (selectedSecretaireId) {
      checkExistingAssignment();
    } else {
      setExistingAssignment(null);
    }
  }, [selectedSecretaireId, date]);

  const fetchData = async () => {
    // Check if the site is "Administratif"
    const { data: siteData } = await supabase
      .from('sites')
      .select('nom')
      .eq('id', siteId)
      .single();
    
    const isAdministratif = siteData?.nom === 'Administratif';

    // Fetch secretaires
    let secData;
    if (isAdministratif) {
      // For Administratif, fetch all active secretaires
      const { data } = await supabase
        .from('secretaires')
        .select('id, first_name, name')
        .eq('actif', true)
        .order('name');
      secData = data;
    } else {
      // For other sites, only fetch secretaires who have this site in their preferences
      const { data } = await supabase
        .from('secretaires')
        .select(`
          id, 
          first_name, 
          name,
          secretaires_sites!inner(site_id)
        `)
        .eq('actif', true)
        .eq('secretaires_sites.site_id', siteId)
        .order('name');
      secData = data;
    }

    if (secData) {
      // Fetch existing assignments for ALL periods for this date
      const { data: capacitesData } = await supabase
        .from('capacite_effective')
        .select('secretaire_id, demi_journee')
        .eq('date', date)
        .eq('actif', true);

      // Filter to only include secretaires who don't have capacite_effective for ANY period
      const secretairesFiltered = secData.filter(sec => {
        const hasAnyCapacite = capacitesData?.some(c => c.secretaire_id === sec.id);
        return !hasAnyCapacite;
      });

      setSecretaires(secretairesFiltered.map(s => ({
        id: s.id,
        first_name: s.first_name,
        name: s.name,
        existing_assignment: ''
      })));
    }
  };

  const checkExistingAssignment = async () => {
    if (!selectedSecretaireId) {
      setExistingAssignment(null);
      return;
    }

    // Check which periods are available for this secretaire
    const periodsToCheck: ('matin' | 'apres_midi')[] = periode === 'journee' 
      ? ['matin', 'apres_midi'] 
      : [periode as 'matin' | 'apres_midi'];

    const { data } = await supabase
      .from('capacite_effective')
      .select('demi_journee')
      .eq('secretaire_id', selectedSecretaireId)
      .eq('date', date)
      .eq('actif', true)
      .in('demi_journee', periodsToCheck);

    setExistingAssignment(data && data.length > 0 ? data : null);
  };

  const handleSubmit = async () => {
    if (!selectedSecretaireId) {
      toast({
        title: 'Erreur',
        description: 'Veuillez sélectionner un assistant médical',
        variant: 'destructive',
      });
      return;
    }

    // Validate responsibility requires full day
    if (responsibility && periode !== 'journee') {
      toast({
        title: 'Attention',
        description: 'Une responsabilité nécessite une assignation pour toute la journée',
        variant: 'destructive',
      });
      return;
    }

    if (existingAssignment && existingAssignment.length > 0) {
      toast({
        title: 'Erreur',
        description: 'Cet assistant médical a déjà une assignation pour cette période',
        variant: 'destructive',
      });
      return;
    }

    setLoading(true);
    try {
      // Create new assignments only for available periods
      const entries: Array<{ demi_journee: 'matin' | 'apres_midi' }> = periode === 'journee'
        ? [{ demi_journee: 'matin' }, { demi_journee: 'apres_midi' }]
        : [{ demi_journee: periode as 'matin' | 'apres_midi' }];

      for (const entry of entries) {
        const { error } = await supabase
          .from('capacite_effective')
          .insert([{
            date,
            secretaire_id: selectedSecretaireId,
            site_id: selectedSiteId,
            demi_journee: entry.demi_journee,
            is_1r: responsibility === '1r',
            is_2f: responsibility === '2f',
            is_3f: responsibility === '3f',
            actif: true,
          }]);

        if (error) throw error;
      }

      toast({
        title: 'Succès',
        description: 'Assistant médical ajouté avec succès',
      });

      onSuccess();
      setSelectedSecretaireId('');
      setPeriode('matin');
      setResponsibility(null);
    } catch (error: any) {
      console.error('Error adding secretaire:', error);
      toast({
        title: 'Erreur',
        description: error.message || 'Impossible d\'ajouter l\'assistant médical',
        variant: 'destructive',
      });
    } finally {
      setLoading(false);
    }
  };

  const selectedSecretaire = secretaires.find(s => s.id === selectedSecretaireId);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle className="bg-gradient-to-r from-teal-500 to-cyan-600 bg-clip-text text-transparent">
            Ajouter un assistant médical
          </DialogTitle>
          <DialogDescription>
            Sélectionnez un assistant médical et la période pour ce jour
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4">
          <div className="space-y-2">
            <Label>Assistant médical</Label>
            <Popover open={comboOpen} onOpenChange={setComboOpen}>
              <PopoverTrigger asChild>
                <Button
                  variant="outline"
                  role="combobox"
                  aria-expanded={comboOpen}
                  className="w-full justify-between"
                >
                  {selectedSecretaire
                    ? `${selectedSecretaire.first_name} ${selectedSecretaire.name}`
                    : "Sélectionner un assistant médical..."}
                  <ChevronsUpDown className="ml-2 h-4 w-4 shrink-0 opacity-50" />
                </Button>
              </PopoverTrigger>
              <PopoverContent className="w-[400px] p-0">
                <Command>
                  <CommandInput placeholder="Rechercher un assistant médical..." />
                  <CommandEmpty>Aucun assistant médical trouvé.</CommandEmpty>
                  <CommandGroup className="max-h-[300px] overflow-y-auto">
                    {secretaires.map((secretaire) => (
                      <CommandItem
                        key={secretaire.id}
                        value={`${secretaire.first_name} ${secretaire.name}`}
                        onSelect={() => {
                          setSelectedSecretaireId(secretaire.id);
                          setComboOpen(false);
                        }}
                      >
                        <Check
                          className={cn(
                            "mr-2 h-4 w-4 flex-shrink-0",
                            selectedSecretaireId === secretaire.id ? "opacity-100" : "opacity-0"
                          )}
                        />
                        <div className="flex flex-col flex-1 min-w-0">
                          <span className="truncate">{secretaire.first_name} {secretaire.name}</span>
                          {secretaire.existing_assignment && (
                            <span className="text-xs text-muted-foreground truncate">
                              {secretaire.existing_assignment}
                            </span>
                          )}
                        </div>
                      </CommandItem>
                    ))}
                  </CommandGroup>
                </Command>
              </PopoverContent>
            </Popover>

            {existingAssignment && existingAssignment.length > 0 && (
              <Alert variant="destructive">
                <AlertTriangle className="h-4 w-4" />
                <AlertDescription>
                  Cet assistant médical a déjà une assignation pour cette période. Veuillez choisir une autre période.
                </AlertDescription>
              </Alert>
            )}
          </div>

          <div className="space-y-2">
            <Label>Période</Label>
            <RadioGroup value={periode} onValueChange={(v: any) => setPeriode(v)}>
              <div className="flex items-center space-x-2">
                <RadioGroupItem value="matin" id="sec-matin" />
                <Label htmlFor="sec-matin" className="font-normal cursor-pointer">
                  Matin
                </Label>
              </div>
              <div className="flex items-center space-x-2">
                <RadioGroupItem value="apres_midi" id="sec-apres_midi" />
                <Label htmlFor="sec-apres_midi" className="font-normal cursor-pointer">
                  Après-midi
                </Label>
              </div>
              <div className="flex items-center space-x-2">
                <RadioGroupItem value="journee" id="sec-journee" />
                <Label htmlFor="sec-journee" className="font-normal cursor-pointer">
                  Journée complète
                </Label>
              </div>
            </RadioGroup>
          </div>

          <div className="space-y-2">
            <Label>Responsabilité (optionnelle)</Label>
            <div className="flex flex-col space-y-2">
              <div className="flex items-center space-x-2">
                <Checkbox
                  id="resp-1r"
                  checked={responsibility === '1r'}
                  onCheckedChange={(checked) => {
                    setResponsibility(checked ? '1r' : null);
                    if (checked) setPeriode('journee');
                  }}
                />
                <Label htmlFor="resp-1r" className="font-normal cursor-pointer">
                  1R
                </Label>
              </div>
              <div className="flex items-center space-x-2">
                <Checkbox
                  id="resp-2f"
                  checked={responsibility === '2f'}
                  onCheckedChange={(checked) => {
                    setResponsibility(checked ? '2f' : null);
                    if (checked) setPeriode('journee');
                  }}
                />
                <Label htmlFor="resp-2f" className="font-normal cursor-pointer">
                  2F
                </Label>
              </div>
              <div className="flex items-center space-x-2">
                <Checkbox
                  id="resp-3f"
                  checked={responsibility === '3f'}
                  onCheckedChange={(checked) => {
                    setResponsibility(checked ? '3f' : null);
                    if (checked) setPeriode('journee');
                  }}
                />
                <Label htmlFor="resp-3f" className="font-normal cursor-pointer">
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

        <div className="flex justify-end gap-2 mt-4">
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={loading}>
            Annuler
          </Button>
          <Button
            onClick={handleSubmit}
            disabled={loading || !selectedSecretaireId}
            className="bg-gradient-to-r from-teal-500 to-cyan-600"
          >
            {loading && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
            Ajouter
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
