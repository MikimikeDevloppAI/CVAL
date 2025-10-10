import { useState, useEffect } from 'react';
import { Plus } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from '@/components/ui/dialog';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Badge } from '@/components/ui/badge';
import { supabase } from '@/integrations/supabase/client';
import { useToast } from '@/hooks/use-toast';

interface Medecin {
  id: string;
  first_name: string;
  name: string;
}

interface QuickEditMedecinDialogProps {
  secretaireId: string;
  medecinActuelId: string | null | undefined;
  medecinActuel: { first_name: string; name: string } | null | undefined;
  onSuccess: () => void;
}

export function QuickEditMedecinDialog({ 
  secretaireId, 
  medecinActuelId,
  medecinActuel,
  onSuccess 
}: QuickEditMedecinDialogProps) {
  const [open, setOpen] = useState(false);
  const [medecins, setMedecins] = useState<Medecin[]>([]);
  const [selectedMedecinId, setSelectedMedecinId] = useState<string | null>(medecinActuelId || null);
  const [loading, setLoading] = useState(false);
  const { toast } = useToast();

  useEffect(() => {
    const fetchMedecins = async () => {
      const { data, error } = await supabase
        .from('medecins')
        .select('id, first_name, name')
        .eq('actif', true)
        .order('first_name');

      if (error) {
        console.error('Erreur lors du chargement des médecins:', error);
        return;
      }

      setMedecins(data || []);
    };

    fetchMedecins();
  }, []);

  useEffect(() => {
    setSelectedMedecinId(medecinActuelId || null);
  }, [medecinActuelId]);

  const handleSave = async () => {
    setLoading(true);
    try {
      const { error } = await supabase
        .from('secretaires')
        .update({ medecin_assigne_id: selectedMedecinId })
        .eq('id', secretaireId);

      if (error) throw error;

      toast({
        title: "Succès",
        description: "Médecin assigné mis à jour avec succès",
      });

      setOpen(false);
      onSuccess();
    } catch (error) {
      console.error('Erreur lors de la mise à jour:', error);
      toast({
        title: "Erreur",
        description: "Impossible de mettre à jour le médecin assigné",
        variant: "destructive",
      });
    } finally {
      setLoading(false);
    }
  };

  const selectedMedecin = medecins.find(m => m.id === selectedMedecinId);

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button
          variant="ghost"
          size="sm"
          className="h-6 px-2 text-xs opacity-60 hover:opacity-100 transition-opacity"
        >
          <Plus className="h-3 w-3 mr-1" />
          Modifier
        </Button>
      </DialogTrigger>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>Modifier le médecin assigné</DialogTitle>
        </DialogHeader>
        
        <div className="space-y-4">
          <div>
            <label className="text-sm font-medium mb-2 block">
              Médecin assigné
            </label>
            
            <Select 
              value={selectedMedecinId || 'none'} 
              onValueChange={(val) => setSelectedMedecinId(val === 'none' ? null : val)}
            >
              <SelectTrigger>
                <SelectValue placeholder="Sélectionner un médecin" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="none">Aucun médecin</SelectItem>
                {medecins.map((medecin) => (
                  <SelectItem key={medecin.id} value={medecin.id}>
                    {medecin.first_name} {medecin.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          {selectedMedecin && (
            <div className="flex flex-wrap gap-2 p-3 bg-muted/20 rounded-md">
              <Badge variant="secondary" className="text-xs">
                {selectedMedecin.first_name} {selectedMedecin.name}
              </Badge>
            </div>
          )}

          <div className="flex justify-end gap-2 pt-4">
            <Button
              variant="outline"
              onClick={() => setOpen(false)}
              disabled={loading}
            >
              Annuler
            </Button>
            <Button onClick={handleSave} disabled={loading}>
              {loading ? "Enregistrement..." : "Enregistrer"}
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
