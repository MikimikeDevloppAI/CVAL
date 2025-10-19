import { useState } from 'react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Trash2, Edit } from 'lucide-react';
import { supabase } from '@/integrations/supabase/client';
import { useToast } from '@/hooks/use-toast';

interface HoraireLineEditProps {
  horaire: any;
  jour: string;
  sites: any[];
  typesIntervention: any[];
  onUpdate: () => void;
  onDelete: (horaireId: string) => void;
}

export function HoraireLineEdit({ horaire, jour, sites, typesIntervention, onUpdate, onDelete }: HoraireLineEditProps) {
  const [isEditingPeriod, setIsEditingPeriod] = useState(false);
  const [isEditingSite, setIsEditingSite] = useState(false);
  const [loading, setLoading] = useState(false);
  const { toast } = useToast();

  const periodLabels = {
    'toute_journee': 'Journée',
    'matin': 'Matin',
    'apres_midi': 'Après-midi'
  };

  const periodColors = {
    'matin': 'bg-amber-500/10 text-amber-700 dark:text-amber-300 border-amber-500/20',
    'apres_midi': 'bg-blue-500/10 text-blue-700 dark:text-blue-300 border-blue-500/20',
    'toute_journee': 'bg-emerald-500/10 text-emerald-700 dark:text-emerald-300 border-emerald-500/20'
  };

  const alternanceLabels = {
    'hebdomadaire': 'Hebdo',
    'une_sur_deux': '1/2',
    'une_sur_trois': '1/3',
    'une_sur_quatre': '1/4'
  };

  const handleUpdatePeriod = async (newPeriod: 'matin' | 'apres_midi' | 'toute_journee') => {
    setLoading(true);
    try {
      const { error } = await supabase
        .from('horaires_base_medecins')
        .update({ demi_journee: newPeriod })
        .eq('id', horaire.id);

      if (error) throw error;

      toast({
        title: "Succès",
        description: "Période mise à jour",
      });
      onUpdate();
      setIsEditingPeriod(false);
    } catch (error) {
      console.error('Erreur:', error);
      toast({
        title: "Erreur",
        description: "Impossible de mettre à jour la période",
        variant: "destructive",
      });
    } finally {
      setLoading(false);
    }
  };

  const handleUpdateSite = async (newSiteId: string) => {
    setLoading(true);
    try {
      const { error } = await supabase
        .from('horaires_base_medecins')
        .update({ site_id: newSiteId })
        .eq('id', horaire.id);

      if (error) throw error;

      toast({
        title: "Succès",
        description: "Site mis à jour",
      });
      onUpdate();
      setIsEditingSite(false);
    } catch (error) {
      console.error('Erreur:', error);
      toast({
        title: "Erreur",
        description: "Impossible de mettre à jour le site",
        variant: "destructive",
      });
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="group/line flex items-center gap-2 p-2 rounded-lg hover:bg-cyan-500/5 transition-all duration-200">
      <Badge variant="outline" className="w-12 justify-center bg-muted/30 shrink-0">
        {jour}
      </Badge>

      {/* Period Badge - Editable */}
      <Popover open={isEditingPeriod} onOpenChange={setIsEditingPeriod}>
        <PopoverTrigger asChild>
          <Badge 
            variant="secondary" 
            className={`cursor-pointer hover:shadow-md transition-all ${periodColors[horaire.demi_journee]} shrink-0`}
          >
            {periodLabels[horaire.demi_journee]}
          </Badge>
        </PopoverTrigger>
        <PopoverContent className="w-auto p-2" align="start">
          <div className="space-y-1">
            <p className="text-xs font-medium text-muted-foreground mb-2 px-2">Modifier la période</p>
            {Object.entries(periodLabels).map(([value, label]) => (
              <Button
                key={value}
                variant={horaire.demi_journee === value ? "default" : "ghost"}
                size="sm"
                className="w-full justify-start"
                onClick={() => handleUpdatePeriod(value as 'matin' | 'apres_midi' | 'toute_journee')}
                disabled={loading}
              >
                {label}
              </Button>
            ))}
          </div>
        </PopoverContent>
      </Popover>

      {/* Site Badge - Editable */}
      <Popover open={isEditingSite} onOpenChange={setIsEditingSite}>
        <PopoverTrigger asChild>
          <button className="flex-1 text-left text-sm text-muted-foreground hover:text-foreground truncate hover:bg-cyan-500/10 px-2 py-1 rounded transition-colors">
            {horaire.sites?.nom}
            {horaire.types_intervention && (
              <span className="text-xs ml-1">({horaire.types_intervention.nom})</span>
            )}
          </button>
        </PopoverTrigger>
        <PopoverContent className="w-80 p-3" align="start">
          <div className="space-y-3">
            <p className="text-xs font-medium text-muted-foreground">Modifier le site</p>
            <Select value={horaire.site_id} onValueChange={handleUpdateSite} disabled={loading}>
              <SelectTrigger className="border-cyan-200/50 focus:border-cyan-500">
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
        </PopoverContent>
      </Popover>

      {/* Alternance Badge */}
      {horaire.alternance_type && horaire.alternance_type !== 'hebdomadaire' && (
        <Badge variant="outline" className="text-[10px] px-1.5 py-0 h-5 shrink-0">
          {alternanceLabels[horaire.alternance_type]}
        </Badge>
      )}

      {/* Delete Button - Visible on Hover */}
      <Button
        variant="ghost"
        size="sm"
        onClick={() => onDelete(horaire.id)}
        className="opacity-0 group-hover/line:opacity-100 transition-opacity h-7 w-7 p-0 hover:bg-destructive/10 hover:text-destructive shrink-0"
      >
        <Trash2 className="h-3 w-3" />
      </Button>
    </div>
  );
}
