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

interface CapaciteEffective {
  id: string;
  date: string;
  demi_journee: 'matin' | 'apres_midi' | 'toute_journee';
  secretaire_id?: string;
  secretaire?: {
    first_name: string;
    name: string;
    sites_assignes?: string[];
  };
}

interface EditCapaciteDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  capacites: CapaciteEffective[];
  onSuccess: () => void;
}

interface CapaciteEditState extends CapaciteEffective {
  modified?: boolean;
}

export function EditCapaciteDialog({ open, onOpenChange, capacites, onSuccess }: EditCapaciteDialogProps) {
  const [loading, setLoading] = useState(false);
  const [editedCapacites, setEditedCapacites] = useState<CapaciteEditState[]>([]);
  const [capaciteToDelete, setCapaciteToDelete] = useState<string | null>(null);
  const [showAddDay, setShowAddDay] = useState(false);
  const [newDate, setNewDate] = useState('');
  const [newDemiJournee, setNewDemiJournee] = useState<'matin' | 'apres_midi' | 'toute_journee'>('matin');
  const { toast } = useToast();

  useEffect(() => {
    if (capacites && capacites.length > 0) {
      const sorted = [...capacites].sort((a, b) => 
        new Date(a.date).getTime() - new Date(b.date).getTime()
      );
      setEditedCapacites(sorted);
    }
  }, [capacites]);

  const handleFieldChange = (id: string, field: keyof CapaciteEditState, value: any) => {
    setEditedCapacites(prev => 
      prev.map(c => c.id === id ? { ...c, [field]: value, modified: true } : c)
    );
  };

  const handleDeleteDay = async () => {
    if (!capaciteToDelete) return;

    try {
      const { error } = await supabase
        .from('capacite_effective')
        .delete()
        .eq('id', capaciteToDelete);

      if (error) throw error;

      // Rafraîchir les vues matérialisées
      await supabase.functions.invoke('refresh-besoins-view');

      setEditedCapacites(prev => prev.filter(c => c.id !== capaciteToDelete));
      toast({
        title: "Succès",
        description: "Jour supprimé avec succès",
      });
      setCapaciteToDelete(null);
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
      const premiereCapacite = capacites[0];
      const insertData: any = {
        date: newDate,
        demi_journee: newDemiJournee,
      };

      if (premiereCapacite.secretaire_id) {
        insertData.secretaire_id = premiereCapacite.secretaire_id;
      }

      const { data, error } = await supabase
        .from('capacite_effective')
        .insert(insertData)
        .select(`
          *,
          secretaire:secretaires(first_name, name)
        `)
        .single();

      if (error) throw error;

      // Rafraîchir les vues matérialisées
      await supabase.functions.invoke('refresh-besoins-view');

      setEditedCapacites(prev => [...prev, data].sort((a, b) => 
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
    const modifiedCapacites = editedCapacites.filter(c => c.modified);
    
    if (modifiedCapacites.length === 0) {
      onOpenChange(false);
      return;
    }

    setLoading(true);
    try {
      await Promise.all(
        modifiedCapacites.map(capacite =>
          supabase
            .from('capacite_effective')
            .update({
              demi_journee: capacite.demi_journee,
            })
            .eq('id', capacite.id)
        )
      );

      // Rafraîchir les vues matérialisées
      await supabase.functions.invoke('refresh-besoins-view');

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

  if (!capacites || capacites.length === 0) return null;

  const person = capacites[0].secretaire;
  const personName = person ? `${person.first_name} ${person.name}` : '';

  return (
    <>
      <Dialog open={open} onOpenChange={onOpenChange}>
        <DialogContent className="max-w-3xl max-h-[80vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <Calendar className="h-5 w-5" />
              Modifier les jours de présence - {personName}
            </DialogTitle>
            <DialogDescription>
              Gérez les jours de présence: modifiez les horaires, supprimez ou ajoutez des jours.
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-4">
            <div className="space-y-3">
              {editedCapacites.map((capacite) => {
                const date = new Date(capacite.date);
                const jourNom = format(date, 'EEEE d MMMM yyyy', { locale: fr });
                
                return (
                  <div key={capacite.id} className="p-4 border rounded-lg bg-muted/30 space-y-3">
                    <div className="flex items-center justify-between">
                      <div className="flex items-center gap-2">
                        <Badge variant="outline">
                          {jourNom.charAt(0).toUpperCase() + jourNom.slice(1)}
                        </Badge>
                        {capacite.modified && (
                          <Badge variant="secondary" className="text-xs">Modifié</Badge>
                        )}
                      </div>
                      <Button
                        variant="ghost"
                        size="sm"
                        onClick={() => setCapaciteToDelete(capacite.id)}
                        className="text-destructive hover:text-destructive"
                      >
                        <Trash2 className="h-4 w-4" />
                      </Button>
                    </div>

                    <div>
                      <Label className="text-xs">Demi-journée</Label>
                      <select
                        value={capacite.demi_journee}
                        onChange={(e) => handleFieldChange(capacite.id, 'demi_journee', e.target.value as 'matin' | 'apres_midi' | 'toute_journee')}
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

      <AlertDialog open={!!capaciteToDelete} onOpenChange={(open) => !open && setCapaciteToDelete(null)}>
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
