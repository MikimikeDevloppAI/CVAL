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
  backup_id?: string;
  secretaire?: {
    first_name: string;
    name: string;
    specialites: string[];
  };
  backup?: {
    first_name: string;
    name: string;
    specialites: string[];
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
  const [newHeureDebut, setNewHeureDebut] = useState('07:30');
  const [newHeureFin, setNewHeureFin] = useState('17:00');
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
    if (!newDate || !newHeureDebut || !newHeureFin) {
      toast({
        title: "Erreur",
        description: "Veuillez remplir tous les champs",
        variant: "destructive",
      });
      return;
    }

    if (newHeureDebut >= newHeureFin) {
      toast({
        title: "Erreur",
        description: "L'heure de début doit être avant l'heure de fin",
        variant: "destructive",
      });
      return;
    }

    try {
      const premiereCapacite = capacites[0];
      const insertData: any = {
        date: newDate,
        heure_debut: newHeureDebut,
        heure_fin: newHeureFin,
      };

      if (premiereCapacite.secretaire_id) {
        insertData.secretaire_id = premiereCapacite.secretaire_id;
      } else if (premiereCapacite.backup_id) {
        insertData.backup_id = premiereCapacite.backup_id;
      }

      const { data, error } = await supabase
        .from('capacite_effective')
        .insert(insertData)
        .select(`
          *,
          secretaire:secretaires(first_name, name, specialites),
          backup:backup(first_name, name, specialites)
        `)
        .single();

      if (error) throw error;

      setEditedCapacites(prev => [...prev, data].sort((a, b) => 
        new Date(a.date).getTime() - new Date(b.date).getTime()
      ));

      toast({
        title: "Succès",
        description: "Jour ajouté avec succès",
      });

      setShowAddDay(false);
      setNewDate('');
      setNewHeureDebut('07:30');
      setNewHeureFin('17:00');
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
              heure_debut: capacite.heure_debut,
              heure_fin: capacite.heure_fin,
            })
            .eq('id', capacite.id)
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

  if (!capacites || capacites.length === 0) return null;

  const person = capacites[0].secretaire || capacites[0].backup;
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

                    <div className="grid grid-cols-3 gap-3">
                      <div>
                        <Label className="text-xs">Heure de début</Label>
                        <Input
                          type="time"
                          value={capacite.heure_debut}
                          onChange={(e) => handleFieldChange(capacite.id, 'heure_debut', e.target.value)}
                          className="mt-1"
                        />
                      </div>
                      <div>
                        <Label className="text-xs">Heure de fin</Label>
                        <Input
                          type="time"
                          value={capacite.heure_fin}
                          onChange={(e) => handleFieldChange(capacite.id, 'heure_fin', e.target.value)}
                          className="mt-1"
                        />
                      </div>
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
                  <div className="grid grid-cols-2 gap-2">
                    <div>
                      <Label className="text-xs">Début</Label>
                      <Input
                        type="time"
                        value={newHeureDebut}
                        onChange={(e) => setNewHeureDebut(e.target.value)}
                        className="mt-1"
                      />
                    </div>
                    <div>
                      <Label className="text-xs">Fin</Label>
                      <Input
                        type="time"
                        value={newHeureFin}
                        onChange={(e) => setNewHeureFin(e.target.value)}
                        className="mt-1"
                      />
                    </div>
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
