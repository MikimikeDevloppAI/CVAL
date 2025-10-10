import { useState, useEffect } from 'react';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter, DialogDescription } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { supabase } from '@/integrations/supabase/client';
import { useToast } from '@/hooks/use-toast';
import { Calendar, Trash2, Plus } from 'lucide-react';
import { format } from 'date-fns';
import { fr } from 'date-fns/locale';
import { Badge } from '@/components/ui/badge';
import { Label } from '@/components/ui/label';
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";

interface BesoinEffectif {
  id: string;
  date: string;
  type: string;
  demi_journee: 'matin' | 'apres_midi' | 'toute_journee';
  medecin_id?: string;
  site_id: string;
  medecin?: { first_name: string; name: string; besoin_secretaires: number };
  site?: { nom: string };
}

interface EditBesoinDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  besoins: BesoinEffectif[];
  onSuccess: () => void;
}

interface BesoinEditState extends BesoinEffectif {
  modified?: boolean;
}

export function EditBesoinDialog({ open, onOpenChange, besoins, onSuccess }: EditBesoinDialogProps) {
  const [loading, setLoading] = useState(false);
  const [editedBesoins, setEditedBesoins] = useState<BesoinEditState[]>([]);
  const [besoinToDelete, setBesoinToDelete] = useState<string | null>(null);
  const [showAddDay, setShowAddDay] = useState(false);
  const [newDate, setNewDate] = useState('');
  const [newDemiJournee, setNewDemiJournee] = useState<'matin' | 'apres_midi' | 'toute_journee'>('matin');
  const { toast } = useToast();

  useEffect(() => {
    if (besoins && besoins.length > 0) {
      const sorted = [...besoins].sort((a, b) => 
        new Date(a.date).getTime() - new Date(b.date).getTime()
      );
      setEditedBesoins(sorted);
    }
  }, [besoins]);

  const handleFieldChange = (id: string, field: keyof BesoinEditState, value: any) => {
    setEditedBesoins(prev => 
      prev.map(b => b.id === id ? { ...b, [field]: value, modified: true } : b)
    );
  };

  const handleDeleteDay = async () => {
    if (!besoinToDelete) return;

    try {
      const besoin = editedBesoins.find(b => b.id === besoinToDelete);
      if (!besoin) return;

      const { error } = await supabase
        .from('besoin_effectif')
        .delete()
        .eq('id', besoin.id);

      if (error) throw error;

      setEditedBesoins(prev => prev.filter(b => b.id !== besoinToDelete));
      toast({
        title: "Succès",
        description: "Jour supprimé avec succès",
      });
      setBesoinToDelete(null);
      onSuccess();
    } catch (error) {
      console.error('Erreur:', error);
      toast({
        title: "Erreur",
        description: "Erreur lors de la suppression",
        variant: "destructive",
      });
    }
  };

  const handleAddDay = async () => {
    if (!newDate) {
      toast({
        title: "Erreur",
        description: "Veuillez remplir tous les champs",
        variant: "destructive",
      });
      return;
    }

    try {
      const premierBesoin = besoins[0];
      const insertData: any = {
        date: newDate,
        type: premierBesoin.type,
        demi_journee: newDemiJournee,
        site_id: premierBesoin.site_id,
      };

      if (premierBesoin.medecin_id) {
        insertData.medecin_id = premierBesoin.medecin_id;
      }

      const { data, error } = await supabase
        .from('besoin_effectif')
        .insert(insertData)
        .select(`
          *,
          medecin:medecins(first_name, name, besoin_secretaires),
          site:sites(nom)
        `)
        .single();

      if (error) throw error;

      setEditedBesoins(prev => [...prev, data].sort((a, b) => 
        new Date(a.date).getTime() - new Date(b.date).getTime()
      ));

      toast({
        title: "Succès",
        description: "Jour ajouté avec succès",
      });

      setShowAddDay(false);
      setNewDate('');
      setNewDemiJournee('matin');
      onSuccess();
    } catch (error) {
      console.error('Erreur:', error);
      toast({
        title: "Erreur",
        description: "Erreur lors de l'ajout du jour",
        variant: "destructive",
      });
    }
  };

  const handleSubmit = async () => {
    const modifiedBesoins = editedBesoins.filter(b => b.modified);
    
    if (modifiedBesoins.length === 0) {
      onOpenChange(false);
      return;
    }

    setLoading(true);
    try {
      await Promise.all(
        modifiedBesoins.map(besoin =>
          supabase
            .from('besoin_effectif')
            .update({
              demi_journee: besoin.demi_journee,
            })
            .eq('id', besoin.id)
        )
      );

      toast({
        title: "Succès",
        description: "Modifications enregistrées avec succès",
      });

      onSuccess();
      onOpenChange(false);
    } catch (error: any) {
      console.error('Erreur:', error);
      toast({
        title: "Erreur",
        description: "Erreur lors de la modification",
        variant: "destructive",
      });
    } finally {
      setLoading(false);
    }
  };

  if (!besoins || besoins.length === 0) return null;

  return (
    <>
      <Dialog open={open} onOpenChange={onOpenChange}>
        <DialogContent className="max-w-3xl max-h-[80vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <Calendar className="h-5 w-5" />
              Modifier les jours de présence
            </DialogTitle>
            <DialogDescription>
              Gérez les jours de présence par site: modifiez les horaires, supprimez ou ajoutez des jours.
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-4">
            <div className="space-y-3">
              {editedBesoins.map((besoin, index) => {
                const date = new Date(besoin.date);
                const jourNom = format(date, 'EEEE d MMMM yyyy', { locale: fr });
                
                return (
                  <div key={besoin.id} className="p-4 border rounded-lg bg-muted/30 space-y-3">
                    <div className="flex items-center justify-between">
                      <div className="flex items-center gap-2">
                        <Badge variant="outline">
                          {jourNom.charAt(0).toUpperCase() + jourNom.slice(1)}
                        </Badge>
                        {besoin.modified && (
                          <Badge variant="secondary" className="text-xs">Modifié</Badge>
                        )}
                      </div>
                      <Button
                        variant="ghost"
                        size="sm"
                        onClick={() => setBesoinToDelete(besoin.id)}
                        className="text-destructive hover:text-destructive"
                      >
                        <Trash2 className="h-4 w-4" />
                      </Button>
                    </div>

                    <div>
                      <Label className="text-xs">Demi-journée</Label>
                      <select
                        value={besoin.demi_journee}
                        onChange={(e) => handleFieldChange(besoin.id, 'demi_journee', e.target.value as 'matin' | 'apres_midi' | 'toute_journee')}
                        className="w-full mt-1 flex h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-sm ring-offset-background file:border-0 file:bg-transparent file:text-sm file:font-medium file:text-foreground placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-50"
                      >
                        <option value="matin">Matin</option>
                        <option value="apres_midi">Après-midi</option>
                        <option value="toute_journee">Toute la journée</option>
                      </select>
                    </div>
                  </div>
                );
              })}
            </div>

            {!showAddDay ? (
              <Button
                variant="outline"
                className="w-full"
                onClick={() => setShowAddDay(true)}
              >
                <Plus className="h-4 w-4 mr-2" />
                Ajouter un jour
              </Button>
            ) : (
              <div className="p-4 border rounded-lg bg-primary/5 space-y-3">
                <div className="flex items-center justify-between">
                  <h4 className="font-medium">Nouveau jour</h4>
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={() => setShowAddDay(false)}
                  >
                    Annuler
                  </Button>
                </div>

                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <Label className="text-xs">Date</Label>
                    <Input
                      type="date"
                      value={newDate}
                      onChange={(e) => setNewDate(e.target.value)}
                      className="mt-1"
                    />
                  </div>
                  <div>
                    <Label className="text-xs">Demi-journée</Label>
                    <select
                      value={newDemiJournee}
                      onChange={(e) => setNewDemiJournee(e.target.value as 'matin' | 'apres_midi' | 'toute_journee')}
                      className="w-full mt-1 flex h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-sm ring-offset-background file:border-0 file:bg-transparent file:text-sm file:font-medium file:text-foreground placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-50"
                    >
                      <option value="matin">Matin</option>
                      <option value="apres_midi">Après-midi</option>
                      <option value="toute_journee">Toute la journée</option>
                    </select>
                  </div>
                </div>

                <Button onClick={handleAddDay} className="w-full" size="sm">
                  Confirmer l'ajout
                </Button>
              </div>
            )}
          </div>

          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
              Annuler
            </Button>
            <Button onClick={handleSubmit} disabled={loading}>
              {loading ? 'Enregistrement...' : 'Enregistrer'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <AlertDialog open={!!besoinToDelete} onOpenChange={(open) => !open && setBesoinToDelete(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Confirmer la suppression</AlertDialogTitle>
            <AlertDialogDescription>
              Êtes-vous sûr de vouloir supprimer ce jour ? Cette action est irréversible.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Annuler</AlertDialogCancel>
            <AlertDialogAction onClick={handleDeleteDay} className="bg-destructive text-destructive-foreground hover:bg-destructive/90">
              Supprimer
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}