import { useState, useEffect } from 'react';
import { Plus } from 'lucide-react';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Label } from '@/components/ui/label';
import { supabase } from '@/integrations/supabase/client';
import { useToast } from '@/hooks/use-toast';

interface AddHoraireDialogProps {
  medecinId: string;
  onSuccess: () => void;
}

export function AddHoraireDialog({ medecinId, onSuccess }: AddHoraireDialogProps) {
  const [open, setOpen] = useState(false);
  const [loading, setLoading] = useState(false);
  const [sites, setSites] = useState<any[]>([]);
  const [typesIntervention, setTypesIntervention] = useState<any[]>([]);
  const [formData, setFormData] = useState({
    jour_semaine: '',
    demi_journee: 'toute_journee',
    site_id: '',
    type_intervention_id: '',
    alternance_type: 'hebdomadaire',
    alternance_semaine_modulo: 0
  });
  const { toast } = useToast();

  const jours = [
    { value: '1', label: 'Lundi' },
    { value: '2', label: 'Mardi' },
    { value: '3', label: 'Mercredi' },
    { value: '4', label: 'Jeudi' },
    { value: '5', label: 'Vendredi' }
  ];

  useEffect(() => {
    if (open) {
      fetchData();
    }
  }, [open]);

  const fetchData = async () => {
    const { data: sitesData } = await supabase
      .from('sites')
      .select('id, nom')
      .eq('actif', true)
      .order('nom');

    const { data: typesData } = await supabase
      .from('types_intervention')
      .select('id, nom')
      .eq('actif', true)
      .order('nom');

    if (sitesData) setSites(sitesData);
    if (typesData) setTypesIntervention(typesData);
  };

  const handleSubmit = async () => {
    if (!formData.jour_semaine || !formData.site_id) {
      toast({
        title: "Erreur",
        description: "Veuillez remplir tous les champs requis",
        variant: "destructive",
      });
      return;
    }

    setLoading(true);
    try {
      const dataToInsert: any = {
        jour_semaine: parseInt(formData.jour_semaine),
        demi_journee: formData.demi_journee,
        site_id: formData.site_id,
        type_intervention_id: formData.type_intervention_id || null,
        alternance_type: formData.alternance_type,
        alternance_semaine_modulo: formData.alternance_semaine_modulo,
        actif: true
      };

      // Add medecin_id to the insert payload
      const { error } = await supabase
        .from('horaires_base_medecins')
        .insert([{ ...dataToInsert, medecin_id: medecinId }]);

      if (error) throw error;

      toast({
        title: "Succès",
        description: "Horaire ajouté avec succès",
      });

      setOpen(false);
      setFormData({
        jour_semaine: '',
        demi_journee: 'toute_journee',
        site_id: '',
        type_intervention_id: '',
        alternance_type: 'hebdomadaire',
        alternance_semaine_modulo: 0
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
          className="w-full border-dashed border-cyan-500/30 hover:border-cyan-500/50 hover:bg-cyan-500/5 text-cyan-600 dark:text-cyan-400"
        >
          <Plus className="h-3 w-3 mr-2" />
          Ajouter un jour
        </Button>
      </DialogTrigger>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle className="text-xl font-semibold bg-gradient-to-r from-cyan-500 to-teal-600 bg-clip-text text-transparent">
            Ajouter un horaire
          </DialogTitle>
        </DialogHeader>

        <div className="space-y-4 py-4">
          <div className="space-y-2">
            <Label>Jour de la semaine</Label>
            <Select value={formData.jour_semaine} onValueChange={(value) => setFormData({ ...formData, jour_semaine: value })}>
              <SelectTrigger className="border-cyan-200/50 focus:border-cyan-500">
                <SelectValue placeholder="Sélectionner un jour" />
              </SelectTrigger>
              <SelectContent>
                {jours.map((jour) => (
                  <SelectItem key={jour.value} value={jour.value}>
                    {jour.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          <div className="space-y-2">
            <Label>Période</Label>
            <Select value={formData.demi_journee} onValueChange={(value) => setFormData({ ...formData, demi_journee: value })}>
              <SelectTrigger className="border-cyan-200/50 focus:border-cyan-500">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="toute_journee">Journée complète</SelectItem>
                <SelectItem value="matin">Matin</SelectItem>
                <SelectItem value="apres_midi">Après-midi</SelectItem>
              </SelectContent>
            </Select>
          </div>

          <div className="space-y-2">
            <Label>Site</Label>
            <Select value={formData.site_id} onValueChange={(value) => setFormData({ ...formData, site_id: value })}>
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

          <div className="space-y-2">
            <Label>Type d'intervention (optionnel)</Label>
            <Select value={formData.type_intervention_id} onValueChange={(value) => setFormData({ ...formData, type_intervention_id: value })}>
              <SelectTrigger className="border-cyan-200/50 focus:border-cyan-500">
                <SelectValue placeholder="Aucun" />
              </SelectTrigger>
              <SelectContent>
                {typesIntervention.map((type) => (
                  <SelectItem key={type.id} value={type.id}>
                    {type.nom}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          <div className="space-y-2">
            <Label>Alternance</Label>
            <Select value={formData.alternance_type} onValueChange={(value) => setFormData({ ...formData, alternance_type: value })}>
              <SelectTrigger className="border-cyan-200/50 focus:border-cyan-500">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="hebdomadaire">Hebdomadaire</SelectItem>
                <SelectItem value="une_sur_deux">Une semaine sur deux</SelectItem>
                <SelectItem value="une_sur_trois">Une semaine sur trois</SelectItem>
                <SelectItem value="une_sur_quatre">Une semaine sur quatre</SelectItem>
              </SelectContent>
            </Select>
          </div>
        </div>

        <div className="flex justify-end gap-2">
          <Button variant="outline" onClick={() => setOpen(false)} disabled={loading}>
            Annuler
          </Button>
          <Button 
            onClick={handleSubmit} 
            disabled={loading}
            className="bg-gradient-to-r from-cyan-500 to-teal-500 hover:from-cyan-600 hover:to-teal-600"
          >
            {loading ? 'Ajout...' : 'Ajouter'}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
