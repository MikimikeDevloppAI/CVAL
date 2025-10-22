import { useState, useEffect } from 'react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Trash2, Check, X } from 'lucide-react';
import { supabase } from '@/integrations/supabase/client';
import { useToast } from '@/hooks/use-toast';

interface HoraireSecretaireLineEditProps {
  horaire: any;
  jour: string;
  sites: any[];
  onUpdate: () => void;
  onDelete: (horaireId: string) => void;
  isNew?: boolean;
}

export function HoraireSecretaireLineEdit({ horaire, jour, sites, onUpdate, onDelete, isNew = false }: HoraireSecretaireLineEditProps) {
  const [isEditing, setIsEditing] = useState(isNew);
  const [loading, setLoading] = useState(false);
  const [formData, setFormData] = useState({
    jour_semaine: horaire.jour_semaine,
    demi_journee: horaire.demi_journee,
    site_id: horaire.site_id,
    alternance_type: horaire.alternance_type || 'hebdomadaire',
    alternance_semaine_modulo: horaire.alternance_semaine_modulo || 0,
    date_debut: horaire.date_debut || '',
    date_fin: horaire.date_fin || '',
  });
  const { toast } = useToast();

  useEffect(() => {
    setFormData({
      jour_semaine: horaire.jour_semaine,
      demi_journee: horaire.demi_journee,
      site_id: horaire.site_id,
      alternance_type: horaire.alternance_type || 'hebdomadaire',
      alternance_semaine_modulo: horaire.alternance_semaine_modulo || 0,
      date_debut: horaire.date_debut || '',
      date_fin: horaire.date_fin || '',
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
    'hebdomadaire': '',
    'une_sur_deux': horaire.alternance_semaine_modulo === 0 ? 'Pair' : 'Impair',
    'une_sur_trois': `S${horaire.alternance_semaine_modulo + 1}`,
    'une_sur_quatre': `S${horaire.alternance_semaine_modulo + 1}`,
    'trois_sur_quatre': `Sauf S${horaire.alternance_semaine_modulo + 1}`
  };

  const jours = ['', 'Lun', 'Mar', 'Mer', 'Jeu', 'Ven'];

  const formatSiteName = (siteName: string) => {
    if (!siteName) return '';
    
    // Si ça commence par "Clinique La Vallée"
    if (siteName.toLowerCase().startsWith('clinique la vallée')) {
      const parts = siteName.split('-');
      if (parts.length > 1) {
        return 'CLIVAL - ' + parts.slice(1).join('-').trim();
      }
      return siteName;
    }
    
    // Sinon afficher ce qui est avant le "-"
    const parts = siteName.split('-');
    return parts[0].trim();
  };

  const handleSave = async () => {
    setLoading(true);
    try {
      const saveData: any = {
        jour_semaine: formData.jour_semaine,
        demi_journee: formData.demi_journee,
        site_id: formData.site_id,
        alternance_type: formData.alternance_type,
        alternance_semaine_modulo: formData.alternance_semaine_modulo,
        date_debut: formData.date_debut || null,
        date_fin: formData.date_fin || null,
        actif: true
      };

      if (isNew) {
        // Insert new horaire
        const { error } = await supabase
          .from('horaires_base_secretaires')
          .insert([{ ...saveData, secretaire_id: horaire.secretaire_id }]);

        if (error) throw error;

        toast({
          title: "Succès",
          description: "Horaire ajouté",
        });
      } else {
        // Update existing horaire
        const { error } = await supabase
          .from('horaires_base_secretaires')
          .update(saveData)
          .eq('id', horaire.id);

        if (error) throw error;

        toast({
          title: "Succès",
          description: "Horaire mis à jour",
        });
      }
      
      setIsEditing(false);
      onUpdate();
    } catch (error) {
      console.error('Erreur:', error);
      toast({
        title: "Erreur",
        description: isNew ? "Impossible d'ajouter l'horaire" : "Impossible de mettre à jour l'horaire",
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
      alternance_type: horaire.alternance_type || 'hebdomadaire',
      alternance_semaine_modulo: horaire.alternance_semaine_modulo || 0,
      date_debut: horaire.date_debut || '',
      date_fin: horaire.date_fin || '',
    });
    setIsEditing(false);
  };

  if (isEditing) {
    return (
      <div className="p-2 bg-teal-500/5 rounded-lg border border-teal-200/30" onKeyDown={(e) => { if (e.key === 'Enter') e.preventDefault(); }}>
        {/* Première ligne: Jour, Période, Alternance */}
        <div className="flex items-center gap-1.5 mb-2">
          <Select 
            value={formData.jour_semaine.toString()} 
            onValueChange={(value) => setFormData({ ...formData, jour_semaine: parseInt(value) })}
          >
            <SelectTrigger className="h-8 w-20 text-xs border-teal-200/50">
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
            <SelectTrigger className="h-8 w-28 text-xs border-teal-200/50" type="button">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="matin">Matin</SelectItem>
              <SelectItem value="apres_midi">Après-midi</SelectItem>
              <SelectItem value="toute_journee">Journée</SelectItem>
            </SelectContent>
          </Select>

          <Select
            value={formData.alternance_type}
            onValueChange={(value: any) => 
              setFormData({ 
                ...formData, 
                alternance_type: value,
                alternance_semaine_modulo: 0 
              })
            }
          >
            <SelectTrigger className="w-20 h-8 text-xs border-teal-200/50 bg-teal-500/5" type="button">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="hebdomadaire">Hebdo</SelectItem>
              <SelectItem value="une_sur_deux">1/2</SelectItem>
              <SelectItem value="une_sur_trois">1/3</SelectItem>
              <SelectItem value="une_sur_quatre">1/4</SelectItem>
              <SelectItem value="trois_sur_quatre">3/4</SelectItem>
            </SelectContent>
          </Select>

          {formData.alternance_type !== 'hebdomadaire' && (
            <Select
              value={formData.alternance_semaine_modulo.toString()}
              onValueChange={(value) => 
                setFormData({ ...formData, alternance_semaine_modulo: parseInt(value) })
              }
            >
              <SelectTrigger className="w-20 h-8 text-xs border-teal-200/50 bg-teal-500/5" type="button">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {formData.alternance_type === 'une_sur_deux' ? (
                  <>
                    <SelectItem value="0">Pair</SelectItem>
                    <SelectItem value="1">Impair</SelectItem>
                  </>
                ) : formData.alternance_type === 'une_sur_trois' ? (
                  <>
                    <SelectItem value="0">S1</SelectItem>
                    <SelectItem value="1">S2</SelectItem>
                    <SelectItem value="2">S3</SelectItem>
                  </>
                ) : formData.alternance_type === 'une_sur_quatre' ? (
                  <>
                    <SelectItem value="0">S1</SelectItem>
                    <SelectItem value="1">S2</SelectItem>
                    <SelectItem value="2">S3</SelectItem>
                    <SelectItem value="3">S4</SelectItem>
                  </>
                ) : (
                  <>
                    <SelectItem value="0">Sauf S1</SelectItem>
                    <SelectItem value="1">Sauf S2</SelectItem>
                    <SelectItem value="2">Sauf S3</SelectItem>
                    <SelectItem value="3">Sauf S4</SelectItem>
                  </>
                )}
              </SelectContent>
            </Select>
          )}
        </div>

        {/* Deuxième ligne: Site */}
        <div className="flex items-center gap-1.5 mb-2">
          <Select 
            value={formData.site_id} 
            onValueChange={(value) => setFormData({ ...formData, site_id: value })}
          >
            <SelectTrigger className="h-8 w-full text-xs border-teal-200/50">
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
        </div>

        {/* Troisième ligne: Dates + Boutons */}
        <div className="flex items-center gap-1.5">
          <label className="text-xs text-muted-foreground w-7 shrink-0">Du</label>
          <input
            type="date"
            value={formData.date_debut}
            onChange={(e) => setFormData({ ...formData, date_debut: e.target.value })}
            className="h-8 w-32 text-xs rounded-md border border-teal-200/50 bg-background px-2"
          />
          <label className="text-xs text-muted-foreground w-7 shrink-0">Au</label>
          <input
            type="date"
            value={formData.date_fin}
            onChange={(e) => setFormData({ ...formData, date_fin: e.target.value })}
            className="h-8 w-32 text-xs rounded-md border border-teal-200/50 bg-background px-2"
          />
          
          <Button
            type="button"
            variant="ghost"
            size="sm"
            onClick={handleSave}
            disabled={loading}
            className="h-7 w-7 p-0 hover:bg-green-500/10 hover:text-green-600 shrink-0"
          >
            <Check className="h-3 w-3" />
          </Button>
          <Button
            type="button"
            variant="ghost"
            size="sm"
            onClick={handleCancel}
            disabled={loading}
            className="h-7 w-7 p-0 hover:bg-red-500/10 hover:text-red-600 shrink-0"
          >
            <X className="h-3 w-3" />
          </Button>
        </div>
      </div>
    );
  }

  return (
    <div 
      className="group/line p-2 rounded-lg hover:bg-teal-500/5 transition-all duration-200 cursor-pointer"
      onClick={() => setIsEditing(true)}
    >
      {/* Première ligne: Jour, Créneau, Alternance, Site */}
      <div className="flex items-center gap-2 mb-1">
        <Badge variant="outline" className="w-12 justify-center bg-muted/30 shrink-0">
          {jour}
        </Badge>

        <Badge 
          variant="secondary" 
          className={`${periodColors[horaire.demi_journee]} shrink-0`}
        >
          {periodLabels[horaire.demi_journee]}
        </Badge>

        {horaire.alternance_type && horaire.alternance_type !== 'hebdomadaire' && (
          <>
            <Badge variant="outline" className="text-[10px] px-2 py-0 h-5 bg-purple-500/10 text-purple-700 dark:text-purple-300 border-purple-500/20 shrink-0">
              {horaire.alternance_type === 'une_sur_deux' ? '1/2' : 
               horaire.alternance_type === 'une_sur_trois' ? '1/3' : 
               horaire.alternance_type === 'une_sur_quatre' ? '1/4' : '3/4'}
            </Badge>
            <Badge variant="outline" className="text-[10px] px-2 py-0 h-5 bg-indigo-500/10 text-indigo-700 dark:text-indigo-300 border-indigo-500/20 shrink-0">
              {alternanceLabels[horaire.alternance_type]}
            </Badge>
          </>
        )}

        <span className="text-sm text-muted-foreground truncate flex-1">
          {formatSiteName(horaire.sites?.nom)}
        </span>

        <Button
          type="button"
          variant="ghost"
          size="sm"
          onClick={(e) => {
            e.stopPropagation();
            onDelete(horaire.id);
          }}
          className="opacity-0 group-hover/line:opacity-100 transition-opacity h-6 w-6 p-0 hover:bg-destructive/10 hover:text-destructive shrink-0"
        >
          <Trash2 className="h-3 w-3" />
        </Button>
      </div>

      {/* Deuxième ligne: Dates (si présentes) */}
      {(horaire.date_debut || horaire.date_fin) && (
        <div className="text-[10px] text-muted-foreground/60 ml-14">
          {horaire.date_debut && `Du ${new Date(horaire.date_debut).toLocaleDateString('fr-FR')}`}
          {horaire.date_debut && horaire.date_fin && ' '}
          {horaire.date_fin && `au ${new Date(horaire.date_fin).toLocaleDateString('fr-FR')}`}
        </div>
      )}
    </div>
  );
}