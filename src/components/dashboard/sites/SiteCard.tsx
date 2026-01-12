import { useState } from 'react';
import { Building, MapPin, Check, X, Pencil } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Switch } from '@/components/ui/switch';
import { supabase } from '@/integrations/supabase/client';
import { toast } from 'sonner';
import { useCanManagePlanning } from '@/hooks/useCanManagePlanning';

interface Site {
  id: string;
  nom: string;
  adresse: string;
  fermeture?: boolean;
  actif?: boolean;
}

interface SiteCardProps {
  site: Site;
  index: number;
  onUpdate: () => void;
}

export function SiteCard({ site, index, onUpdate }: SiteCardProps) {
  const { canManage } = useCanManagePlanning();
  const [isEditing, setIsEditing] = useState(false);
  const [saving, setSaving] = useState(false);
  const [editValues, setEditValues] = useState({
    nom: site.nom || '',
    adresse: site.adresse || '',
    fermeture: site.fermeture || false,
  });

  const handleSave = async () => {
    setSaving(true);
    try {
      const { error } = await supabase
        .from('sites')
        .update({
          nom: editValues.nom,
          adresse: editValues.adresse,
          fermeture: editValues.fermeture,
        })
        .eq('id', site.id);

      if (error) throw error;

      toast.success('Site modifié avec succès');
      setIsEditing(false);
      onUpdate();
    } catch (error) {
      console.error('Erreur:', error);
      toast.error('Erreur lors de la modification');
    } finally {
      setSaving(false);
    }
  };

  const handleCancel = () => {
    setEditValues({
      nom: site.nom || '',
      adresse: site.adresse || '',
      fermeture: site.fermeture || false,
    });
    setIsEditing(false);
  };

  return (
    <div
      className={`
        backdrop-blur-xl bg-card/95 rounded-2xl border border-border/50
        shadow-sm hover:shadow-xl hover:shadow-primary/5 transition-all duration-300
        hover:scale-[1.02] hover:-translate-y-1 hover:border-primary/30
        group relative overflow-hidden
        ${!isEditing ? 'cursor-pointer' : ''}
      `}
      style={{ animationDelay: `${index * 50}ms` }}
      onClick={() => !isEditing && canManage && setIsEditing(true)}
    >
      {/* Subtle gradient overlay on hover */}
      <div className="absolute inset-0 bg-gradient-to-br from-primary/5 via-transparent to-transparent opacity-0 group-hover:opacity-100 transition-opacity duration-300" />

      <div className="relative p-5">
        {/* Header */}
        <div className="flex items-start justify-between gap-3">
          <div className="flex items-start gap-4 flex-1 min-w-0">
            {/* Avatar */}
            <div className="w-12 h-12 rounded-xl bg-gradient-to-br from-teal-500 to-emerald-600 flex items-center justify-center shrink-0 shadow-md shadow-teal-500/20 group-hover:shadow-lg group-hover:shadow-teal-500/30 transition-shadow">
              <Building className="h-6 w-6 text-white" />
            </div>

            <div className="flex-1 min-w-0">
              {isEditing ? (
                <div className="space-y-3">
                  <div>
                    <label className="text-[11px] font-medium text-muted-foreground uppercase tracking-wide">Nom</label>
                    <Input
                      value={editValues.nom}
                      onChange={(e) => setEditValues(prev => ({ ...prev, nom: e.target.value }))}
                      className="h-8 mt-1"
                      onClick={(e) => e.stopPropagation()}
                    />
                  </div>
                  <div>
                    <label className="text-[11px] font-medium text-muted-foreground uppercase tracking-wide">Adresse</label>
                    <Input
                      value={editValues.adresse}
                      onChange={(e) => setEditValues(prev => ({ ...prev, adresse: e.target.value }))}
                      className="h-8 mt-1"
                      onClick={(e) => e.stopPropagation()}
                    />
                  </div>
                  <div className="flex items-center gap-2 pt-1">
                    <Switch
                      checked={editValues.fermeture}
                      onCheckedChange={(checked) => setEditValues(prev => ({ ...prev, fermeture: checked }))}
                      onClick={(e) => e.stopPropagation()}
                      className="scale-90"
                    />
                    <span className="text-sm">Nécessite fermeture de site</span>
                  </div>
                </div>
              ) : (
                <>
                  <h3 className="text-base font-semibold text-foreground group-hover:text-primary transition-colors leading-tight">
                    {site.nom}
                  </h3>
                  {site.adresse && (
                    <p className="text-sm text-muted-foreground mt-1 flex items-center gap-1.5">
                      <MapPin className="h-3 w-3" />
                      {site.adresse}
                    </p>
                  )}
                </>
              )}
            </div>
          </div>

          {/* Actions */}
          {isEditing ? (
            <div className="flex items-center gap-1 shrink-0">
              <Button
                variant="ghost"
                size="sm"
                onClick={(e) => { e.stopPropagation(); handleCancel(); }}
                className="h-8 px-2 text-muted-foreground hover:text-foreground"
              >
                <X className="h-4 w-4" />
              </Button>
              <Button
                size="sm"
                onClick={(e) => { e.stopPropagation(); handleSave(); }}
                disabled={saving}
                className="h-8 px-3 bg-green-600 hover:bg-green-700 text-white"
              >
                <Check className="h-4 w-4 mr-1" />
                Enregistrer
              </Button>
            </div>
          ) : canManage ? (
            <div className="w-8 h-8 rounded-lg flex items-center justify-center text-muted-foreground group-hover:text-primary transition-colors opacity-0 group-hover:opacity-100">
              <Pencil className="h-4 w-4" />
            </div>
          ) : null}
        </div>

        {/* Badges */}
        {!isEditing && site.fermeture && (
          <div className="mt-4 pt-3 border-t border-border/30">
            <Badge className="bg-amber-500/10 text-amber-700 dark:text-amber-300 border-amber-500/20 text-xs">
              Nécessite fermeture de site
            </Badge>
          </div>
        )}
      </div>
    </div>
  );
}
