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

interface SecretaireFromOtherSite {
  id: string;
  first_name: string;
  name: string;
  current_site_id: string;
  current_site_name: string;
  current_periode: 'matin' | 'apres_midi' | 'toute_journee';
  capacite_id: string;
  capacite_id_apres_midi?: string;
  is_1r: boolean;
  is_2f: boolean;
  is_3f: boolean;
  besoin_operation_id?: string;
  is_compatible: boolean;
}

interface BesoinOperation {
  id: string;
  nom: string;
}

interface ReassignSecretaireDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  date: string;
  targetSiteId: string;
  targetSiteName: string;
  onSuccess: () => void;
}

export function ReassignSecretaireDialog({
  open,
  onOpenChange,
  date,
  targetSiteId,
  targetSiteName,
  onSuccess,
}: ReassignSecretaireDialogProps) {
  const [secretaires, setSecretaires] = useState<SecretaireFromOtherSite[]>([]);
  const [selectedSecretaireId, setSelectedSecretaireId] = useState('');
  const [periode, setPeriode] = useState<'matin' | 'apres_midi' | 'journee'>('matin');
  const [responsibility, setResponsibility] = useState<'1r' | '2f' | '3f' | null>(null);
  const [besoinOperationId, setBesoinOperationId] = useState<string>('');
  const [besoinsOperations, setBesoinsOperations] = useState<BesoinOperation[]>([]);
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
      fetchSecretairesFromOtherSites();
    }
  }, [open, targetSiteId, periode]);

  useEffect(() => {
    if (isBlocOperatoire && open && selectedSecretaireId) {
      fetchBesoinsOperations();
    }
  }, [isBlocOperatoire, open, selectedSecretaireId]);

  const checkIfBlocOperatoire = async () => {
    const { data } = await supabase
      .from('sites')
      .select('nom')
      .eq('id', targetSiteId)
      .single();
    
    setIsBlocOperatoire(data?.nom === 'Clinique La Vallée - Bloc opératoire');
  };

  const fetchBesoinsOperations = async () => {
    if (!selectedSecretaireId) return;

    const { data } = await supabase
      .from('secretaires_besoins_operations')
      .select('besoin_operation_id, besoins_operations(id, nom)')
      .eq('secretaire_id', selectedSecretaireId);
    
    if (data) {
      const besoins = data
        .filter(b => b.besoins_operations)
        .map(b => ({
          id: (b.besoins_operations as any).id,
          nom: (b.besoins_operations as any).nom,
        }));
      setBesoinsOperations(besoins);
    }
  };

  const fetchSecretairesFromOtherSites = async () => {
    // Determine which periods to fetch based on selected periode
    const periodsToFetch: ('matin' | 'apres_midi')[] = 
      periode === 'journee' 
        ? ['matin', 'apres_midi']
        : [periode as 'matin' | 'apres_midi'];

    const { data: capacites } = await supabase
      .from('capacite_effective')
      .select(`
        id,
        demi_journee,
        secretaire_id,
        site_id,
        is_1r,
        is_2f,
        is_3f,
        besoin_operation_id,
        secretaires(id, first_name, name),
        sites(id, nom)
      `)
      .eq('date', date)
      .eq('actif', true)
      .neq('site_id', targetSiteId)
      .in('demi_journee', periodsToFetch)
      .not('secretaire_id', 'is', null);

    if (capacites) {
      // Check compatibility with target site
      const secretaireIds = [...new Set(capacites.map(c => c.secretaire_id).filter(Boolean))];
      
      const { data: compatibilityData } = await supabase
        .from('secretaires_sites')
        .select('secretaire_id')
        .eq('site_id', targetSiteId)
        .in('secretaire_id', secretaireIds as string[]);

      const compatibleIds = new Set(compatibilityData?.map(c => c.secretaire_id) || []);

      // Group by secretaire + site to detect full day assignments
      const grouped = new Map<string, {
        secretaire_id: string;
        site_id: string;
        first_name: string;
        name: string;
        site_nom: string;
        capacites: typeof capacites;
      }>();

      capacites.filter(c => c.secretaires && c.sites).forEach(c => {
        const key = `${c.secretaire_id}_${c.site_id}`;
        if (!grouped.has(key)) {
          grouped.set(key, {
            secretaire_id: c.secretaire_id!,
            site_id: c.site_id,
            first_name: (c.secretaires as any).first_name || '',
            name: (c.secretaires as any).name || '',
            site_nom: (c.sites as any).nom,
            capacites: [],
          });
        }
        grouped.get(key)!.capacites.push(c);
      });

      const secretairesFromOther: SecretaireFromOtherSite[] = [];

      grouped.forEach(({ secretaire_id, site_id, first_name, name, site_nom, capacites: caps }) => {
        const hasMatin = caps.some(c => c.demi_journee === 'matin');
        const hasApresMidi = caps.some(c => c.demi_journee === 'apres_midi');

        if (periode === 'journee' && hasMatin && hasApresMidi) {
          // Both periods exist: show as full day
          const matinCap = caps.find(c => c.demi_journee === 'matin')!;
          const apresMidiCap = caps.find(c => c.demi_journee === 'apres_midi')!;
          
          secretairesFromOther.push({
            id: secretaire_id,
            first_name,
            name,
            current_site_id: site_id,
            current_site_name: site_nom,
            current_periode: 'toute_journee' as any,
            capacite_id: matinCap.id,
            capacite_id_apres_midi: apresMidiCap.id,
            is_1r: matinCap.is_1r || apresMidiCap.is_1r,
            is_2f: matinCap.is_2f || apresMidiCap.is_2f,
            is_3f: matinCap.is_3f || apresMidiCap.is_3f,
            besoin_operation_id: matinCap.besoin_operation_id || apresMidiCap.besoin_operation_id || undefined,
            is_compatible: compatibleIds.has(secretaire_id),
          });
        } else {
          // Single period or only one period available: show individual periods
          caps.forEach(c => {
            secretairesFromOther.push({
              id: secretaire_id,
              first_name,
              name,
              current_site_id: site_id,
              current_site_name: site_nom,
              current_periode: c.demi_journee as 'matin' | 'apres_midi',
              capacite_id: c.id,
              is_1r: c.is_1r,
              is_2f: c.is_2f,
              is_3f: c.is_3f,
              besoin_operation_id: c.besoin_operation_id || undefined,
              is_compatible: compatibleIds.has(secretaire_id),
            });
          });
        }
      });

      setSecretaires(secretairesFromOther);
    }
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

    const selectedSecretaire = secretaires.find(s => s.id === selectedSecretaireId);
    if (!selectedSecretaire?.is_compatible) {
      toast({
        title: 'Erreur',
        description: 'Cet assistant médical n\'est pas compatible avec ce site',
        variant: 'destructive',
      });
      return;
    }

    if (responsibility && periode !== 'journee') {
      toast({
        title: 'Erreur',
        description: 'Les responsabilités (1R, 2F, 3F) nécessitent une journée complète',
        variant: 'destructive',
      });
      return;
    }

    if (isBlocOperatoire && !besoinOperationId) {
      toast({
        title: 'Erreur',
        description: 'Veuillez sélectionner un besoin opérationnel',
        variant: 'destructive',
      });
      return;
    }

    setLoading(true);
    try {
      // Determine which periods to delete based on current assignment
      const periodsToDelete: ('matin' | 'apres_midi')[] = 
        selectedSecretaire.current_periode === 'toute_journee'
          ? ['matin', 'apres_midi']
          : [selectedSecretaire.current_periode];

      const periodsToCreate: ('matin' | 'apres_midi')[] = 
        periode === 'journee' 
          ? ['matin', 'apres_midi']
          : [periode as 'matin' | 'apres_midi'];

      // Delete old capacite_effective
      const { error: deleteError } = await supabase
        .from('capacite_effective')
        .delete()
        .eq('secretaire_id', selectedSecretaireId)
        .eq('date', date)
        .in('demi_journee', periodsToDelete);

      if (deleteError) throw deleteError;

      // Create new capacite_effective
      const newCapacites = periodsToCreate.map(p => ({
        date,
        secretaire_id: selectedSecretaireId,
        site_id: targetSiteId,
        demi_journee: p,
        is_1r: responsibility === '1r',
        is_2f: responsibility === '2f',
        is_3f: responsibility === '3f',
        besoin_operation_id: isBlocOperatoire ? besoinOperationId : null,
        actif: true,
      }));

      const { error: insertError } = await supabase
        .from('capacite_effective')
        .insert(newCapacites);

      if (insertError) throw insertError;

      toast({
        title: 'Succès',
        description: `L'assistant médical a été réaffecté à ${targetSiteName}`,
      });
      onSuccess();
      onOpenChange(false);
    } catch (error) {
      console.error('Error reassigning secretaire:', error);
      toast({
        title: 'Erreur',
        description: 'Impossible de réaffecter l\'assistant médical',
        variant: 'destructive',
      });
    } finally {
      setLoading(false);
    }
  };

  const selectedSecretaire = secretaires.find(s => s.id === selectedSecretaireId);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-[500px]">
        <DialogHeader>
          <DialogTitle>Réaffecter un assistant médical</DialogTitle>
          <DialogDescription>
            Réaffecter un assistant médical depuis un autre site vers {targetSiteName}
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4 py-4">
          {/* Période selection - FIRST */}
          <div className="space-y-2">
            <Label>Période souhaitée *</Label>
            <RadioGroup value={periode} onValueChange={(value: any) => {
              setPeriode(value);
              setSelectedSecretaireId(''); // Reset selection when period changes
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

          {/* Secretaire selection - SECOND */}
          <div className="space-y-2">
            <Label>Assistant médical à réaffecter</Label>
            <Popover open={comboOpen} onOpenChange={setComboOpen}>
              <PopoverTrigger asChild>
                <Button
                  variant="outline"
                  role="combobox"
                  aria-expanded={comboOpen}
                  className="w-full justify-between"
                >
                  {selectedSecretaireId
                    ? `${secretaires.find(s => s.id === selectedSecretaireId)?.first_name} ${secretaires.find(s => s.id === selectedSecretaireId)?.name}`
                    : "Sélectionner un assistant..."}
                  <ChevronsUpDown className="ml-2 h-4 w-4 shrink-0 opacity-50" />
                </Button>
              </PopoverTrigger>
              <PopoverContent className="w-[var(--radix-popover-trigger-width)] p-0" align="start">
                <Command className="max-h-[300px]">
                  <CommandInput placeholder="Rechercher..." />
                  <CommandEmpty>Aucun assistant trouvé.</CommandEmpty>
                  <CommandGroup className="overflow-auto">
                    {Array.from(new Map(secretaires
                      .filter(s => s.is_compatible)
                      .map(s => [s.id, s])
                    ).values()).map((secretaire) => (
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
                            "mr-2 h-4 w-4",
                            selectedSecretaireId === secretaire.id ? "opacity-100" : "opacity-0"
                          )}
                        />
                        <div className="flex flex-col flex-1">
                          <span>{secretaire.first_name} {secretaire.name}</span>
                          <span className="text-xs text-muted-foreground">
                            {secretaire.current_site_name} - {
                              secretaire.current_periode === 'matin' ? 'Matin' : 
                              secretaire.current_periode === 'apres_midi' ? 'Après-midi' :
                              'Toute la journée'
                            }
                            {(secretaire.is_1r || secretaire.is_2f || secretaire.is_3f) && (
                              <Badge variant="outline" className="ml-2">
                                {secretaire.is_1r && '1R'}
                                {secretaire.is_2f && '2F'}
                                {secretaire.is_3f && '3F'}
                              </Badge>
                            )}
                          </span>
                        </div>
                      </CommandItem>
                    ))}
                  </CommandGroup>
                </Command>
              </PopoverContent>
            </Popover>
          </div>

          {selectedSecretaire && (
            <Alert variant={selectedSecretaire.is_compatible ? 'default' : 'destructive'}>
              <AlertTriangle className="h-4 w-4" />
              <AlertDescription>
                {selectedSecretaire.is_compatible ? (
                  <>
                    Actuellement assigné à <Badge variant="secondary">{selectedSecretaire.current_site_name}</Badge> 
                    {' '}pour la période <Badge variant="secondary">
                      {selectedSecretaire.current_periode === 'matin' ? 'Matin' : 
                       selectedSecretaire.current_periode === 'apres_midi' ? 'Après-midi' :
                       'Toute la journée'}
                    </Badge>
                  </>
                ) : (
                  "Cet assistant n'est pas compatible avec le site cible"
                )}
              </AlertDescription>
            </Alert>
          )}

          {/* Responsabilités (only for journee) */}
          {periode === 'journee' && (
            <div className="space-y-2">
              <Label>Responsabilité (optionnel)</Label>
              <div className="space-y-2">
                <div className="flex items-center space-x-2">
                  <Checkbox
                    id="resp-1r"
                    checked={responsibility === '1r'}
                    onCheckedChange={(checked) => setResponsibility(checked ? '1r' : null)}
                  />
                  <Label htmlFor="resp-1r" className="font-normal cursor-pointer">1R (Responsable 1er rang)</Label>
                </div>
                <div className="flex items-center space-x-2">
                  <Checkbox
                    id="resp-2f"
                    checked={responsibility === '2f'}
                    onCheckedChange={(checked) => setResponsibility(checked ? '2f' : null)}
                  />
                  <Label htmlFor="resp-2f" className="font-normal cursor-pointer">2F (Responsable 2ème rang fermeture)</Label>
                </div>
                <div className="flex items-center space-x-2">
                  <Checkbox
                    id="resp-3f"
                    checked={responsibility === '3f'}
                    onCheckedChange={(checked) => setResponsibility(checked ? '3f' : null)}
                  />
                  <Label htmlFor="resp-3f" className="font-normal cursor-pointer">3F (Responsable 3ème rang fermeture)</Label>
                </div>
              </div>
            </div>
          )}

          {/* Besoin opérationnel (only for Bloc opératoire) */}
          {isBlocOperatoire && selectedSecretaireId && (
            <div className="space-y-2">
              <Label>Besoin opérationnel *</Label>
              <Select value={besoinOperationId} onValueChange={setBesoinOperationId}>
                <SelectTrigger>
                  <SelectValue placeholder="Sélectionner un besoin..." />
                </SelectTrigger>
                <SelectContent>
                  {besoinsOperations.map((besoin) => (
                    <SelectItem key={besoin.id} value={besoin.id}>
                      {besoin.nom}
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
          <Button onClick={handleSubmit} disabled={loading || !selectedSecretaire?.is_compatible}>
            {loading && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
            Réaffecter
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
