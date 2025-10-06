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
  responsable_1r_id?: string;
  responsable_2f_id?: string;
  responsable_3f_id?: string;
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
  const { toast } = useToast();
  const [loading, setLoading] = useState(false);
  const [heureDebut, setHeureDebut] = useState('');
  const [heureFin, setHeureFin] = useState('');
  const [typeAssignation, setTypeAssignation] = useState<'site' | 'administratif'>('site');
  const [sites, setSites] = useState<any[]>([]);
  const [siteId, setSiteId] = useState<string>('');
  const [secretaires, setSecretaires] = useState<any[]>([]);
  const [selectedSecretaires, setSelectedSecretaires] = useState<string[]>([]);
  const [responsable1R, setResponsable1R] = useState<string>('');
  const [responsable2F, setResponsable2F] = useState<string>('');
  const [responsable3F, setResponsable3F] = useState<string>('');

  useEffect(() => {
    if (creneau) {
      setHeureDebut(creneau.heure_debut);
      setHeureFin(creneau.heure_fin);
      setTypeAssignation(creneau.type_assignation as 'site' | 'administratif' || 'site');
      setSiteId(creneau.site_id || '');
      setSelectedSecretaires([...(creneau.secretaires_ids || []), ...(creneau.backups_ids || [])]);
      setResponsable1R(creneau.responsable_1r_id || '');
      setResponsable2F(creneau.responsable_2f_id || '');
      setResponsable3F(creneau.responsable_3f_id || '');
    }
  }, [creneau]);

  useEffect(() => {
    const fetchData = async () => {
      const [sitesRes, secretairesRes, backupsRes] = await Promise.all([
        supabase.from('sites').select('*').eq('actif', true),
        supabase.from('secretaires').select('*').eq('actif', true),
        supabase.from('backup').select('*').eq('actif', true),
      ]);

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
        responsable_1r_id: responsable1R || null,
        responsable_2f_id: responsable2F || null,
        responsable_3f_id: responsable3F || null,
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

          <div className="space-y-2">
            <Label>Responsables de Fermeture</Label>
            <div className="grid grid-cols-3 gap-2">
              <div className="space-y-1">
                <Label htmlFor="responsable1R" className="text-xs">1R</Label>
                <Select value={responsable1R} onValueChange={setResponsable1R}>
                  <SelectTrigger id="responsable1R">
                    <SelectValue placeholder="1R" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="">Aucun</SelectItem>
                    {secretaires.filter(s => !s.isBackup).map(sec => (
                      <SelectItem key={sec.id} value={sec.id}>
                        {sec.first_name} {sec.name}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-1">
                <Label htmlFor="responsable2F" className="text-xs">2F</Label>
                <Select value={responsable2F} onValueChange={setResponsable2F}>
                  <SelectTrigger id="responsable2F">
                    <SelectValue placeholder="2F" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="">Aucun</SelectItem>
                    {secretaires.filter(s => !s.isBackup).map(sec => (
                      <SelectItem key={sec.id} value={sec.id}>
                        {sec.first_name} {sec.name}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-1">
                <Label htmlFor="responsable3F" className="text-xs">3F</Label>
                <Select value={responsable3F} onValueChange={setResponsable3F}>
                  <SelectTrigger id="responsable3F">
                    <SelectValue placeholder="3F" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="">Aucun</SelectItem>
                    {secretaires.filter(s => !s.isBackup).map(sec => (
                      <SelectItem key={sec.id} value={sec.id}>
                        {sec.first_name} {sec.name}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
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
