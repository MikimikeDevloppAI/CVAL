import { useState, useEffect } from 'react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Trash2, Check, X } from 'lucide-react';
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
  const [isEditing, setIsEditing] = useState(false);
  const [loading, setLoading] = useState(false);
  const [formData, setFormData] = useState({
    jour_semaine: horaire.jour_semaine,
    demi_journee: horaire.demi_journee,
    site_id: horaire.site_id,
    type_intervention_id: horaire.type_intervention_id || 'none',
  });
  const [blocOperatoireSiteId, setBlocOperatoireSiteId] = useState<string | null>(null);
  const { toast } = useToast();

  useEffect(() => {
    const blocSite = sites.find(s => s.nom.toLowerCase().includes('bloc'));
    if (blocSite) setBlocOperatoireSiteId(blocSite.id);
  }, [sites]);

  useEffect(() => {
    setFormData({
      jour_semaine: horaire.jour_semaine,
      demi_journee: horaire.demi_journee,
      site_id: horaire.site_id,
      type_intervention_id: horaire.type_intervention_id || 'none',
    });
  }, [horaire]);

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

  const jours = ['', 'Lun', 'Mar', 'Mer', 'Jeu', 'Ven'];

  const handleSave = async () => {
    setLoading(true);
    try {
      const updateData: any = {
        jour_semaine: formData.jour_semaine,
        demi_journee: formData.demi_journee,
        site_id: formData.site_id,
        type_intervention_id: formData.type_intervention_id === 'none' ? null : formData.type_intervention_id,
      };

      const { error } = await supabase
        .from('horaires_base_medecins')
        .update(updateData)
        .eq('id', horaire.id);

      if (error) throw error;

      toast({
        title: "Succès",
        description: "Horaire mis à jour",
      });
      onUpdate();
      setIsEditing(false);
    } catch (error) {
      console.error('Erreur:', error);
      toast({
        title: "Erreur",
        description: "Impossible de mettre à jour l'horaire",
        variant: "destructive",
      });
    } finally {
      setLoading(false);
    }
  };

  const handleCancel = () => {
    setFormData({
      jour_semaine: horaire.jour_semaine,
      demi_journee: horaire.demi_journee,
      site_id: horaire.site_id,
      type_intervention_id: horaire.type_intervention_id || 'none',
    });
    setIsEditing(false);
  };

  if (isEditing) {
    return (
      <div className="flex items-center gap-2 p-2 bg-cyan-500/5 rounded-lg border border-cyan-200/30">
        <Select 
          value={formData.jour_semaine.toString()} 
          onValueChange={(value) => setFormData({ ...formData, jour_semaine: parseInt(value) })}
        >
          <SelectTrigger className="h-8 w-24 text-xs border-cyan-200/50">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {[1, 2, 3, 4, 5].map((j) => (
              <SelectItem key={j} value={j.toString()}>
                {jours[j]}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>

        <Select 
          value={formData.demi_journee} 
          onValueChange={(value) => setFormData({ ...formData, demi_journee: value })}
        >
          <SelectTrigger className="h-8 flex-1 text-xs border-cyan-200/50">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="matin">Matin</SelectItem>
            <SelectItem value="apres_midi">Après-midi</SelectItem>
            <SelectItem value="toute_journee">Journée complète</SelectItem>
          </SelectContent>
        </Select>

        <Select 
          value={formData.site_id} 
          onValueChange={(value) => {
            setFormData({ 
              ...formData, 
              site_id: value,
              type_intervention_id: value !== blocOperatoireSiteId ? 'none' : formData.type_intervention_id
            });
          }}
        >
          <SelectTrigger className="h-8 flex-1 text-xs border-cyan-200/50">
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

        {formData.site_id === blocOperatoireSiteId && (
          <Select 
            value={formData.type_intervention_id} 
            onValueChange={(value) => setFormData({ ...formData, type_intervention_id: value })}
          >
            <SelectTrigger className="h-8 flex-1 text-xs border-cyan-200/50">
              <SelectValue placeholder="Type intervention" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="none">Aucun</SelectItem>
              {typesIntervention.map((type) => (
                <SelectItem key={type.id} value={type.id}>
                  {type.nom}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        )}

        <Button
          variant="ghost"
          size="sm"
          onClick={handleSave}
          disabled={loading}
          className="h-7 w-7 p-0 hover:bg-green-500/10 hover:text-green-600"
        >
          <Check className="h-3 w-3" />
        </Button>
        <Button
          variant="ghost"
          size="sm"
          onClick={handleCancel}
          disabled={loading}
          className="h-7 w-7 p-0 hover:bg-red-500/10 hover:text-red-600"
        >
          <X className="h-3 w-3" />
        </Button>
      </div>
    );
  }

  return (
    <div 
      className="group/line flex items-center gap-2 p-2 rounded-lg hover:bg-cyan-500/5 transition-all duration-200 cursor-pointer"
      onClick={() => setIsEditing(true)}
    >
      <Badge variant="outline" className="w-12 justify-center bg-muted/30 shrink-0">
        {jour}
      </Badge>

      <Badge 
        variant="secondary" 
        className={`${periodColors[horaire.demi_journee]} shrink-0`}
      >
        {periodLabels[horaire.demi_journee]}
      </Badge>

      <span className="flex-1 text-sm text-muted-foreground truncate">
        {horaire.sites?.nom}
        {horaire.types_intervention && (
          <span className="text-xs ml-1">({horaire.types_intervention.nom})</span>
        )}
      </span>

      {horaire.alternance_type && horaire.alternance_type !== 'hebdomadaire' && (
        <Badge variant="outline" className="text-[10px] px-1.5 py-0 h-5 shrink-0">
          {alternanceLabels[horaire.alternance_type]}
        </Badge>
      )}

      <Button
        variant="ghost"
        size="sm"
        onClick={(e) => {
          e.stopPropagation();
          onDelete(horaire.id);
        }}
        className="opacity-0 group-hover/line:opacity-100 transition-opacity h-7 w-7 p-0 hover:bg-destructive/10 hover:text-destructive shrink-0"
      >
        <Trash2 className="h-3 w-3" />
      </Button>
    </div>
  );
}
