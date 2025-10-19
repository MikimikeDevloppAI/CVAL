import { useState, useEffect } from 'react';
import { Plus } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from '@/components/ui/dialog';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Label } from '@/components/ui/label';
import { supabase } from '@/integrations/supabase/client';
import { useToast } from '@/hooks/use-toast';

interface AddHoraireSecretaireDialogProps {
  secretaireId: string;
  onSuccess: () => void;
}

export function AddHoraireSecretaireDialog({ secretaireId, onSuccess }: AddHoraireSecretaireDialogProps) {
  const [open, setOpen] = useState(false);
  const [loading, setLoading] = useState(false);
  const [sites, setSites] = useState<any[]>([]);
  const [formData, setFormData] = useState({
    jour_semaine: 1,
    demi_journee: 'matin' as 'matin' | 'apres_midi' | 'toute_journee',
    site_id: '',
    alternance_type: 'hebdomadaire' as 'hebdomadaire' | 'une_sur_deux' | 'une_sur_trois' | 'une_sur_quatre',
    alternance_semaine_modulo: 0,
  });
  const { toast } = useToast();

  useEffect(() => {
    fetchData();
  }, []);

  const fetchData = async () => {
    const { data: sitesData } = await supabase
      .from('sites')
      .select('id, nom')
      .eq('actif', true)
      .not('nom', 'ilike', '%bloc opératoire%')
      .order('nom');

    if (sitesData) {
      setSites(sitesData);
      if (sitesData.length > 0) {
        setFormData(prev => ({ ...prev, site_id: sitesData[0].id }));
      }
    }
  };

  const handleSubmit = async () => {
    if (!formData.site_id) {
      toast({
        title: "Erreur",
        description: "Veuillez sélectionner un site",
        variant: "destructive",
      });
      return;
    }

    setLoading(true);
    try {
      const { error } = await supabase
        .from('horaires_base_secretaires')
        .insert({
          secretaire_id: secretaireId,
          jour_semaine: formData.jour_semaine,
          demi_journee: formData.demi_journee,
          site_id: formData.site_id,
          alternance_type: formData.alternance_type,
          alternance_semaine_modulo: formData.alternance_semaine_modulo,
          actif: true,
        });

      if (error) throw error;

      toast({
        title: "Succès",
        description: "Horaire ajouté",
      });

      setOpen(false);
      setFormData({
        jour_semaine: 1,
        demi_journee: 'matin',
        site_id: sites[0]?.id || '',
        alternance_type: 'hebdomadaire',
        alternance_semaine_modulo: 0,
      });
      onSuccess();
    } catch (error: any) {
      console.error('Erreur:', error);
      toast({
        title: "Erreur",
        description: error.message || "Impossible d'ajouter l'horaire",
        variant: "destructive",
      });
    } finally {
      setLoading(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button 
          variant="outline" 
          size="sm" 
          className="w-full gap-2 hover:bg-teal-500/10 hover:text-teal-600 hover:border-teal-500/50"
        >
          <Plus className="h-4 w-4" />
          Ajouter un jour
        </Button>
      </DialogTrigger>
      <DialogContent className="sm:max-w-[500px]">
        <DialogHeader>
          <DialogTitle>Ajouter un horaire</DialogTitle>
        </DialogHeader>
        
        <div className="space-y-4 py-4">
          <div className="space-y-2">
            <Label>Jour de la semaine</Label>
            <Select 
              value={formData.jour_semaine.toString()} 
              onValueChange={(value) => setFormData({ ...formData, jour_semaine: parseInt(value) })}
            >
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="1">Lundi</SelectItem>
                <SelectItem value="2">Mardi</SelectItem>
                <SelectItem value="3">Mercredi</SelectItem>
                <SelectItem value="4">Jeudi</SelectItem>
                <SelectItem value="5">Vendredi</SelectItem>
              </SelectContent>
            </Select>
          </div>

          <div className="space-y-2">
            <Label>Période</Label>
            <Select 
              value={formData.demi_journee} 
              onValueChange={(value: any) => setFormData({ ...formData, demi_journee: value })}
            >
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="matin">Matin</SelectItem>
                <SelectItem value="apres_midi">Après-midi</SelectItem>
                <SelectItem value="toute_journee">Toute journée</SelectItem>
              </SelectContent>
            </Select>
          </div>

          <div className="space-y-2">
            <Label>Site</Label>
            <Select 
              value={formData.site_id} 
              onValueChange={(value) => setFormData({ ...formData, site_id: value })}
            >
              <SelectTrigger>
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

          <div className="space-y-2">
            <Label>Alternance</Label>
            <Select 
              value={formData.alternance_type} 
              onValueChange={(value: any) => setFormData({ ...formData, alternance_type: value, alternance_semaine_modulo: 0 })}
            >
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="hebdomadaire">Hebdomadaire</SelectItem>
                <SelectItem value="une_sur_deux">1 semaine sur 2</SelectItem>
                <SelectItem value="une_sur_trois">1 semaine sur 3</SelectItem>
                <SelectItem value="une_sur_quatre">1 semaine sur 4</SelectItem>
              </SelectContent>
            </Select>
          </div>

          {formData.alternance_type !== 'hebdomadaire' && (
            <div className="space-y-2">
              <Label>Semaine</Label>
              <Select 
                value={formData.alternance_semaine_modulo.toString()} 
                onValueChange={(value) => setFormData({ ...formData, alternance_semaine_modulo: parseInt(value) })}
              >
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {formData.alternance_type === 'une_sur_deux' && (
                    <>
                      <SelectItem value="0">Paire (2, 4, 6...)</SelectItem>
                      <SelectItem value="1">Impaire (1, 3, 5...)</SelectItem>
                    </>
                  )}
                  {formData.alternance_type === 'une_sur_trois' && (
                    <>
                      <SelectItem value="0">Semaine 1 (1, 4, 7...)</SelectItem>
                      <SelectItem value="1">Semaine 2 (2, 5, 8...)</SelectItem>
                      <SelectItem value="2">Semaine 3 (3, 6, 9...)</SelectItem>
                    </>
                  )}
                  {formData.alternance_type === 'une_sur_quatre' && (
                    <>
                      <SelectItem value="0">Semaine 1 (1, 5, 9...)</SelectItem>
                      <SelectItem value="1">Semaine 2 (2, 6, 10...)</SelectItem>
                      <SelectItem value="2">Semaine 3 (3, 7, 11...)</SelectItem>
                      <SelectItem value="3">Semaine 4 (4, 8, 12...)</SelectItem>
                    </>
                  )}
                </SelectContent>
              </Select>
            </div>
          )}
        </div>

        <div className="flex justify-end gap-2">
          <Button variant="outline" onClick={() => setOpen(false)}>
            Annuler
          </Button>
          <Button onClick={handleSubmit} disabled={loading}>
            {loading ? 'Ajout...' : 'Ajouter'}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
