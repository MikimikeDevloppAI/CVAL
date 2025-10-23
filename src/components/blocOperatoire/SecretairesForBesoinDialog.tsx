import { useState, useEffect } from 'react';
import { Users, Plus, Trash2 } from 'lucide-react';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { supabase } from '@/integrations/supabase/client';
import { useToast } from '@/hooks/use-toast';
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle } from '@/components/ui/alert-dialog';

interface SecretairesForBesoinDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  besoinOperationId: string;
  besoinOperationNom: string;
}

interface Secretaire {
  id: string;
  name: string;
  first_name: string;
}

interface SecretaireBesoin {
  id: string;
  secretaire_id: string;
  preference: number;
  secretaires: {
    id: string;
    name: string;
    first_name: string;
  };
}

export function SecretairesForBesoinDialog({
  open,
  onOpenChange,
  besoinOperationId,
  besoinOperationNom,
}: SecretairesForBesoinDialogProps) {
  const [secretaireBesoins, setSecretaireBesoins] = useState<SecretaireBesoin[]>([]);
  const [availableSecretaires, setAvailableSecretaires] = useState<Secretaire[]>([]);
  const [selectedSecretaireId, setSelectedSecretaireId] = useState<string>('');
  const [newPreference, setNewPreference] = useState<string>('3');
  const [loading, setLoading] = useState(false);
  const [deleteId, setDeleteId] = useState<string | null>(null);
  const { toast } = useToast();

  useEffect(() => {
    if (open) {
      fetchData();
    }
  }, [open, besoinOperationId]);

  const fetchData = async () => {
    setLoading(true);
    try {
      // Récupérer les assistants médicaux associés à ce besoin
      const { data: besoinsData, error: besoinsError } = await supabase
        .from('secretaires_besoins_operations')
        .select(`
          id,
          secretaire_id,
          preference,
          secretaires (
            id,
            name,
            first_name
          )
        `)
        .eq('besoin_operation_id', besoinOperationId);

      if (besoinsError) throw besoinsError;
      setSecretaireBesoins(besoinsData || []);

      // Récupérer tous les assistants médicaux actifs
      const { data: secretairesData, error: secretairesError } = await supabase
        .from('secretaires')
        .select('id, name, first_name')
        .eq('actif', true)
        .order('first_name');

      if (secretairesError) throw secretairesError;

      // Filtrer pour ne garder que celles qui ne sont pas déjà assignées
      const assignedIds = besoinsData?.map(b => b.secretaire_id) || [];
      const available = (secretairesData || []).filter(s => !assignedIds.includes(s.id));
      setAvailableSecretaires(available);
    } catch (error) {
      console.error('Erreur:', error);
      toast({
        title: 'Erreur',
        description: 'Impossible de charger les données',
        variant: 'destructive',
      });
    } finally {
      setLoading(false);
    }
  };

  const handleAddSecretaire = async () => {
    if (!selectedSecretaireId) {
      toast({
        title: 'Erreur',
        description: 'Veuillez sélectionner un assistant médical',
        variant: 'destructive',
      });
      return;
    }

    try {
      const { error } = await supabase
        .from('secretaires_besoins_operations')
        .insert({
          secretaire_id: selectedSecretaireId,
          besoin_operation_id: besoinOperationId,
          preference: parseInt(newPreference),
        });

      if (error) throw error;

      toast({
        title: 'Succès',
        description: 'Assistant médical ajouté avec succès',
      });

      setSelectedSecretaireId('');
      setNewPreference('3');
      fetchData();
    } catch (error) {
      console.error('Erreur:', error);
      toast({
        title: 'Erreur',
        description: 'Impossible d\'ajouter l\'assistant médical',
        variant: 'destructive',
      });
    }
  };

  const handleUpdatePreference = async (id: string, newPref: number) => {
    try {
      const { error } = await supabase
        .from('secretaires_besoins_operations')
        .update({ preference: newPref })
        .eq('id', id);

      if (error) throw error;

      toast({
        title: 'Succès',
        description: 'Préférence mise à jour',
      });

      fetchData();
    } catch (error) {
      console.error('Erreur:', error);
      toast({
        title: 'Erreur',
        description: 'Impossible de mettre à jour la préférence',
        variant: 'destructive',
      });
    }
  };

  const handleDelete = async () => {
    if (!deleteId) return;

    try {
      const { error } = await supabase
        .from('secretaires_besoins_operations')
        .delete()
        .eq('id', deleteId);

      if (error) throw error;

      toast({
        title: 'Succès',
        description: 'Assistant médical retiré avec succès',
      });

      setDeleteId(null);
      fetchData();
    } catch (error) {
      console.error('Erreur:', error);
      toast({
        title: 'Erreur',
        description: 'Impossible de retirer l\'assistant médical',
        variant: 'destructive',
      });
    }
  };

  return (
    <>
      <Dialog open={open} onOpenChange={onOpenChange}>
        <DialogContent className="max-w-2xl max-h-[80vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <Users className="h-5 w-5" />
              Assistants médicaux pour {besoinOperationNom}
            </DialogTitle>
          </DialogHeader>

          <div className="space-y-6">
            {/* Liste des assistants médicaux assignés */}
            <div className="space-y-3">
              <h3 className="text-sm font-medium text-muted-foreground">
                Assistants médicaux assignés ({secretaireBesoins.length})
              </h3>
              {loading ? (
                <div className="text-center py-4 text-muted-foreground">Chargement...</div>
              ) : secretaireBesoins.length > 0 ? (
                <div className="space-y-2">
                  {secretaireBesoins.map((sb) => (
                    <div
                      key={sb.id}
                      className="flex items-center justify-between p-3 border rounded-lg bg-card"
                    >
                      <div className="flex-1">
                        <div className="font-medium">
                          {sb.secretaires.first_name} {sb.secretaires.name}
                        </div>
                      </div>
                      <div className="flex items-center gap-3">
                        <div className="flex items-center gap-2">
                          <label className="text-sm text-muted-foreground">
                            Préférence:
                          </label>
                          <Select
                            value={sb.preference?.toString() || '3'}
                            onValueChange={(value) =>
                              handleUpdatePreference(sb.id, parseInt(value))
                            }
                          >
                            <SelectTrigger className="w-20 bg-background">
                              <SelectValue />
                            </SelectTrigger>
                            <SelectContent className="bg-popover z-50">
                              {[1, 2, 3].map((num) => (
                                <SelectItem key={num} value={num.toString()}>
                                  {num}
                                </SelectItem>
                              ))}
                            </SelectContent>
                          </Select>
                        </div>
                        <Button
                          variant="ghost"
                          size="icon"
                          onClick={() => setDeleteId(sb.id)}
                          className="text-destructive hover:text-destructive"
                        >
                          <Trash2 className="h-4 w-4" />
                        </Button>
                      </div>
                    </div>
                  ))}
                </div>
              ) : (
                <div className="text-center py-8 text-muted-foreground border rounded-lg">
                  Aucun assistant médical assigné à ce besoin
                </div>
              )}
            </div>

            {/* Ajouter un nouvel assistant médical */}
            {availableSecretaires.length > 0 && (
              <div className="space-y-3 pt-4 border-t">
                <h3 className="text-sm font-medium text-muted-foreground">
                  Ajouter un assistant médical
                </h3>
                <div className="flex items-end gap-3">
                  <div className="flex-1 space-y-2">
                    <label className="text-sm font-medium">Assistant médical</label>
                    <Select
                      value={selectedSecretaireId}
                      onValueChange={setSelectedSecretaireId}
                    >
                      <SelectTrigger className="bg-background">
                        <SelectValue placeholder="Sélectionner un assistant médical" />
                      </SelectTrigger>
                      <SelectContent className="bg-popover z-50">
                        {availableSecretaires.map((sec) => (
                          <SelectItem key={sec.id} value={sec.id}>
                            {sec.first_name} {sec.name}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>
                  <div className="w-32 space-y-2">
                    <label className="text-sm font-medium">Préférence</label>
                    <Select value={newPreference} onValueChange={setNewPreference}>
                      <SelectTrigger className="bg-background">
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent className="bg-popover z-50">
                        {[1, 2, 3].map((num) => (
                          <SelectItem key={num} value={num.toString()}>
                            {num}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>
                  <Button onClick={handleAddSecretaire}>
                    <Plus className="h-4 w-4 mr-2" />
                    Ajouter
                  </Button>
                </div>
              </div>
            )}
          </div>

          <div className="flex justify-end pt-4 border-t">
            <Button variant="outline" onClick={() => onOpenChange(false)}>
              Fermer
            </Button>
          </div>
        </DialogContent>
      </Dialog>

      {/* Dialog de confirmation de suppression */}
      <AlertDialog open={!!deleteId} onOpenChange={(open) => !open && setDeleteId(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Confirmer la suppression</AlertDialogTitle>
            <AlertDialogDescription>
              Êtes-vous sûr de vouloir retirer cet assistant médical de ce besoin ?
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Annuler</AlertDialogCancel>
            <AlertDialogAction
              onClick={handleDelete}
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
            >
              Retirer
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}
