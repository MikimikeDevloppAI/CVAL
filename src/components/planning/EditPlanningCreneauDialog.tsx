import { useState, useEffect } from 'react';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { useToast } from '@/hooks/use-toast';
import { supabase } from '@/integrations/supabase/client';
import { format } from 'date-fns';
import { fr } from 'date-fns/locale';
import { Loader2, Trash2 } from 'lucide-react';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';

interface PlanningCreneau {
  id: string;
  date: string;
  heure_debut: string;
  heure_fin: string;
  site_id?: string;
  type_assignation?: string;
  secretaires_ids?: string[];
  backups_ids?: string[];
  type?: string;
  medecins_ids?: string[];
  statut?: string;
  version_planning?: number;
}

interface EditPlanningCreneauDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  creneau: PlanningCreneau | null;
  onSuccess: () => void;
}

export function EditPlanningCreneauDialog({
  open,
  onOpenChange,
  creneau,
  onSuccess,
}: EditPlanningCreneauDialogProps) {
  const [heureDebut, setHeureDebut] = useState('');
  const [heureFin, setHeureFin] = useState('');
  const [typeAssignation, setTypeAssignation] = useState<'site' | 'administratif'>('site');
  const [siteId, setSiteId] = useState('');
  const [sites, setSites] = useState<any[]>([]);
  const [secretaires, setSecretaires] = useState<any[]>([]);
  const [selectedSecretaires, setSelectedSecretaires] = useState<string[]>([]);
  const [loading, setLoading] = useState(false);
  const { toast } = useToast();

  useEffect(() => {
    if (creneau) {
      setHeureDebut(creneau.heure_debut);
      setHeureFin(creneau.heure_fin);
      setTypeAssignation(creneau.type_assignation as 'site' | 'administratif' || 'site');
      setSiteId(creneau.site_id || '');
      setSelectedSecretaires([...(creneau.secretaires_ids || []), ...(creneau.backups_ids || [])]);
    }
  }, [creneau]);

  useEffect(() => {
    const fetchData = async () => {
      const [sitesRes, secretairesRes, backupsRes] = await Promise.all([
        supabase.from('sites').select('*').eq('actif', true).order('nom'),
        supabase.from('secretaires').select('*').eq('actif', true).order('name'),
        supabase.from('backup').select('*').eq('actif', true).order('name'),
      ]);

      // Toujours inclure tous les sites actifs dans le dialogue de modification
      if (sitesRes.data) setSites(sitesRes.data);
      
      const allSecretaires = [
        ...(secretairesRes.data || []).map(s => ({ ...s, isBackup: false })),
        ...(backupsRes.data || []).map(b => ({ ...b, isBackup: true })),
      ];
      setSecretaires(allSecretaires);
    };

    if (open) fetchData();
  }, [open]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!creneau) return;

    setLoading(true);
    try {
      const secretairesIds = selectedSecretaires.filter(id => 
        secretaires.find(s => s.id === id && !s.isBackup)
      );
      const backupsIds = selectedSecretaires.filter(id => 
        secretaires.find(s => s.id === id && s.isBackup)
      );

      // Préparer les données de mise à jour en préservant les champs existants
      const updateData: any = {
        heure_debut: heureDebut,
        heure_fin: heureFin,
        type_assignation: typeAssignation,
        site_id: typeAssignation === 'site' ? (siteId || null) : null,
        secretaires_ids: secretairesIds,
        backups_ids: backupsIds,
        statut: 'planifie',
      };

      // Préserver les champs qui ne doivent pas être modifiés
      if (creneau.type) updateData.type = creneau.type;
      if (creneau.medecins_ids) updateData.medecins_ids = creneau.medecins_ids;
      if (creneau.version_planning) updateData.version_planning = creneau.version_planning;

      const { error } = await supabase
        .from('planning_genere')
        .update(updateData)
        .eq('id', creneau.id);

      if (error) throw error;

      toast({
        title: 'Créneau modifié',
        description: 'Le créneau a été modifié avec succès.',
      });
      onSuccess();
      onOpenChange(false);
    } catch (error: any) {
      toast({
        variant: 'destructive',
        title: 'Erreur',
        description: error.message,
      });
    } finally {
      setLoading(false);
    }
  };

  const handleDelete = async () => {
    if (!creneau || !confirm('Êtes-vous sûr de vouloir supprimer ce créneau ?')) return;

    setLoading(true);
    try {
      const { error } = await supabase
        .from('planning_genere')
        .delete()
        .eq('id', creneau.id);

      if (error) throw error;

      toast({
        title: 'Créneau supprimé',
        description: 'Le créneau a été supprimé avec succès.',
      });
      onSuccess();
      onOpenChange(false);
    } catch (error: any) {
      toast({
        variant: 'destructive',
        title: 'Erreur',
        description: error.message,
      });
    } finally {
      setLoading(false);
    }
  };

  if (!creneau) return null;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>Modifier le créneau - {format(new Date(creneau.date), 'd MMMM yyyy', { locale: fr })}</DialogTitle>
        </DialogHeader>
        <form onSubmit={handleSubmit} className="space-y-4">
          <div className="grid grid-cols-2 gap-4">
            <div className="space-y-2">
              <Label htmlFor="heureDebut">Heure début</Label>
              <Input
                id="heureDebut"
                type="time"
                value={heureDebut}
                onChange={(e) => setHeureDebut(e.target.value)}
                required
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="heureFin">Heure fin</Label>
              <Input
                id="heureFin"
                type="time"
                value={heureFin}
                onChange={(e) => setHeureFin(e.target.value)}
                required
              />
            </div>
          </div>

          <div className="space-y-2">
            <Label htmlFor="typeAssignation">Type d'assignation</Label>
            <Select value={typeAssignation} onValueChange={(v: 'site' | 'administratif') => setTypeAssignation(v)}>
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="site">Site</SelectItem>
                <SelectItem value="administratif">Administratif</SelectItem>
              </SelectContent>
            </Select>
          </div>

          {typeAssignation === 'site' && (
            <div className="space-y-2">
              <Label htmlFor="site">Site</Label>
              <Select value={siteId} onValueChange={setSiteId}>
                <SelectTrigger>
                  <SelectValue placeholder="Sélectionner un site" />
                </SelectTrigger>
                <SelectContent>
                  {sites.map(site => (
                    <SelectItem key={site.id} value={site.id}>
                      {site.nom}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          )}

          <div className="space-y-2">
            <Label>Secrétaires / Backups</Label>
            <div className="max-h-40 overflow-y-auto border rounded p-2 space-y-1">
              {secretaires.map(sec => (
                <label key={sec.id} className="flex items-center gap-2 cursor-pointer hover:bg-muted p-1 rounded">
                  <input
                    type="checkbox"
                    checked={selectedSecretaires.includes(sec.id)}
                    onChange={(e) => {
                      if (e.target.checked) {
                        setSelectedSecretaires([...selectedSecretaires, sec.id]);
                      } else {
                        setSelectedSecretaires(selectedSecretaires.filter(id => id !== sec.id));
                      }
                    }}
                  />
                  <span className="text-sm">
                    {sec.first_name} {sec.name} {sec.isBackup && '(Backup)'}
                  </span>
                </label>
              ))}
            </div>
          </div>

          <div className="flex gap-2">
            <Button type="submit" disabled={loading} className="flex-1">
              {loading && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
              Enregistrer
            </Button>
            <Button type="button" variant="destructive" onClick={handleDelete} disabled={loading}>
              <Trash2 className="h-4 w-4" />
            </Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
}
