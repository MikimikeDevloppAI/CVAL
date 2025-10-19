import { useState } from 'react';
import { Pencil, Trash2, Check, X } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { supabase } from '@/integrations/supabase/client';
import { useToast } from '@/hooks/use-toast';

interface HoraireSecretaireLineEditProps {
  horaire: any;
  jour: string;
  sites: any[];
  onUpdate: () => void;
  onDelete: (id: string) => void;
}

export function HoraireSecretaireLineEdit({ 
  horaire, 
  jour, 
  sites, 
  onUpdate, 
  onDelete 
}: HoraireSecretaireLineEditProps) {
  const [editing, setEditing] = useState(false);
  const [formData, setFormData] = useState({
    demi_journee: horaire.demi_journee,
    site_id: horaire.site_id,
    alternance_type: horaire.alternance_type || 'hebdomadaire',
    alternance_semaine_modulo: horaire.alternance_semaine_modulo || 0,
  });
  const { toast } = useToast();

  const handleSave = async () => {
    try {
      const { error } = await supabase
        .from('horaires_base_secretaires')
        .update({
          demi_journee: formData.demi_journee,
          site_id: formData.site_id,
          alternance_type: formData.alternance_type,
          alternance_semaine_modulo: formData.alternance_semaine_modulo,
        })
        .eq('id', horaire.id);

      if (error) throw error;

      toast({
        title: "Succès",
        description: "Horaire modifié",
      });

      setEditing(false);
      onUpdate();
    } catch (error) {
      console.error('Erreur:', error);
      toast({
        title: "Erreur",
        description: "Impossible de modifier l'horaire",
        variant: "destructive",
      });
    }
  };

  const getAlternanceLabel = () => {
    if (horaire.alternance_type === 'hebdomadaire') return '';
    
    if (horaire.alternance_type === 'une_sur_deux') {
      return horaire.alternance_semaine_modulo === 0 ? ' (Paire)' : ' (Impaire)';
    }
    
    if (horaire.alternance_type === 'une_sur_trois') {
      return ` (S${(horaire.alternance_semaine_modulo || 0) + 1}/3)`;
    }
    
    if (horaire.alternance_type === 'une_sur_quatre') {
      return ` (S${(horaire.alternance_semaine_modulo || 0) + 1}/4)`;
    }
    
    return '';
  };

  const getPeriodeLabel = (periode: string) => {
    const labels: Record<string, string> = {
      'matin': 'Matin',
      'apres_midi': 'Après-midi',
      'toute_journee': 'Toute journée'
    };
    return labels[periode] || periode;
  };

  if (editing) {
    return (
      <div className="flex items-center gap-2 p-2 bg-muted/30 rounded-lg border border-border/50">
        <span className="text-xs font-medium text-cyan-600 dark:text-cyan-400 min-w-[35px]">
          {jour}
        </span>
        
        <Select value={formData.demi_journee} onValueChange={(value) => setFormData({ ...formData, demi_journee: value })}>
          <SelectTrigger className="h-8 text-xs flex-1">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="matin">Matin</SelectItem>
            <SelectItem value="apres_midi">Après-midi</SelectItem>
            <SelectItem value="toute_journee">Toute journée</SelectItem>
          </SelectContent>
        </Select>

        <Select value={formData.site_id} onValueChange={(value) => setFormData({ ...formData, site_id: value })}>
          <SelectTrigger className="h-8 text-xs flex-1">
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

        <Select value={formData.alternance_type} onValueChange={(value) => setFormData({ ...formData, alternance_type: value })}>
          <SelectTrigger className="h-8 text-xs flex-1">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="hebdomadaire">Hebdomadaire</SelectItem>
            <SelectItem value="une_sur_deux">1 sur 2</SelectItem>
            <SelectItem value="une_sur_trois">1 sur 3</SelectItem>
            <SelectItem value="une_sur_quatre">1 sur 4</SelectItem>
          </SelectContent>
        </Select>

        {formData.alternance_type !== 'hebdomadaire' && (
          <Select 
            value={formData.alternance_semaine_modulo.toString()} 
            onValueChange={(value) => setFormData({ ...formData, alternance_semaine_modulo: parseInt(value) })}
          >
            <SelectTrigger className="h-8 text-xs w-24">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {formData.alternance_type === 'une_sur_deux' && (
                <>
                  <SelectItem value="0">Paire</SelectItem>
                  <SelectItem value="1">Impaire</SelectItem>
                </>
              )}
              {formData.alternance_type === 'une_sur_trois' && (
                <>
                  <SelectItem value="0">S1</SelectItem>
                  <SelectItem value="1">S2</SelectItem>
                  <SelectItem value="2">S3</SelectItem>
                </>
              )}
              {formData.alternance_type === 'une_sur_quatre' && (
                <>
                  <SelectItem value="0">S1</SelectItem>
                  <SelectItem value="1">S2</SelectItem>
                  <SelectItem value="2">S3</SelectItem>
                  <SelectItem value="3">S4</SelectItem>
                </>
              )}
            </SelectContent>
          </Select>
        )}

        <Button 
          variant="ghost" 
          size="sm" 
          onClick={handleSave}
          className="h-7 w-7 p-0 hover:bg-green-500/10 hover:text-green-600"
        >
          <Check className="h-3 w-3" />
        </Button>
        <Button 
          variant="ghost" 
          size="sm" 
          onClick={() => setEditing(false)}
          className="h-7 w-7 p-0 hover:bg-red-500/10 hover:text-red-600"
        >
          <X className="h-3 w-3" />
        </Button>
      </div>
    );
  }

  return (
    <div className="group flex items-center justify-between gap-2 p-2 hover:bg-muted/30 rounded-lg transition-colors">
      <div className="flex items-center gap-2 flex-1 min-w-0">
        <span className="text-xs font-medium text-cyan-600 dark:text-cyan-400 min-w-[35px]">
          {jour}
        </span>
        <span className="text-xs text-muted-foreground truncate">
          {getPeriodeLabel(horaire.demi_journee)}
        </span>
        <span className="text-xs text-muted-foreground truncate">
          • {horaire.sites?.nom}
        </span>
        {getAlternanceLabel() && (
          <span className="text-xs text-teal-600 dark:text-teal-400">
            {getAlternanceLabel()}
          </span>
        )}
      </div>
      
      <div className="flex items-center gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
        <Button 
          variant="ghost" 
          size="sm" 
          onClick={() => setEditing(true)}
          className="h-7 w-7 p-0 hover:bg-cyan-500/10 hover:text-cyan-600"
        >
          <Pencil className="h-3 w-3" />
        </Button>
        <Button 
          variant="ghost" 
          size="sm" 
          onClick={() => onDelete(horaire.id)}
          className="h-7 w-7 p-0 hover:bg-red-500/10 hover:text-red-600"
        >
          <Trash2 className="h-3 w-3" />
        </Button>
      </div>
    </div>
  );
}
