import { useState, useEffect } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { toast } from 'sonner';
import { Loader2, Plus, Trash2, Edit } from 'lucide-react';
import { Button } from '@/components/ui/button';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from '@/components/ui/dialog';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { Label } from '@/components/ui/label';
import { Input } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';

interface BesoinOperation {
  id: string;
  nom: string;
  code: string;
}

interface Secretaire {
  id: string;
  first_name: string;
  name: string;
}

interface SecretaireBesoin {
  id: string;
  secretaire_id: string;
  besoin_operation_id: string;
  preference: number | null;
  secretaire?: {
    first_name: string;
    name: string;
  };
}

interface AssociationDialogData {
  besoinId: string;
  besoinNom: string;
  secretaireId?: string;
  preference?: number;
  associationId?: string;
}

export function BesoinsOperationsManagement() {
  const [besoins, setBesoins] = useState<BesoinOperation[]>([]);
  const [secretaires, setSecretaires] = useState<Secretaire[]>([]);
  const [associations, setAssociations] = useState<SecretaireBesoin[]>([]);
  const [loading, setLoading] = useState(true);
  const [dialogOpen, setDialogOpen] = useState(false);
  const [dialogData, setDialogData] = useState<AssociationDialogData | null>(null);
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    fetchData();
  }, []);

  const fetchData = async () => {
    setLoading(true);
    try {
      const { data: besoinsData, error: besoinsError } = await supabase
        .from('besoins_operations')
        .select('id, nom, code')
        .eq('actif', true)
        .order('nom');

      if (besoinsError) throw besoinsError;

      const { data: secretairesData, error: secretairesError } = await supabase
        .from('secretaires')
        .select('id, first_name, name')
        .eq('actif', true)
        .order('name');

      if (secretairesError) throw secretairesError;

      const { data: associationsData, error: associationsError } = await supabase
        .from('secretaires_besoins_operations')
        .select(`
          id,
          secretaire_id,
          besoin_operation_id,
          preference,
          secretaire:secretaires(first_name, name)
        `);

      if (associationsError) throw associationsError;

      setBesoins(besoinsData || []);
      setSecretaires(secretairesData || []);
      setAssociations(associationsData || []);
    } catch (error: any) {
      console.error('Erreur lors du chargement des données:', error);
      toast.error('Erreur lors du chargement des données');
    } finally {
      setLoading(false);
    }
  };

  const getSecretairesForBesoin = (besoinId: string) => {
    return associations.filter((a) => a.besoin_operation_id === besoinId);
  };

  const handleAddAssociation = (besoinId: string, besoinNom: string) => {
    setDialogData({
      besoinId,
      besoinNom,
      secretaireId: undefined,
      preference: 1,
    });
    setDialogOpen(true);
  };

  const handleEditAssociation = (association: SecretaireBesoin, besoinNom: string) => {
    setDialogData({
      besoinId: association.besoin_operation_id,
      besoinNom,
      secretaireId: association.secretaire_id,
      preference: association.preference || 1,
      associationId: association.id,
    });
    setDialogOpen(true);
  };

  const handleDeleteAssociation = async (associationId: string) => {
    try {
      const { error } = await supabase
        .from('secretaires_besoins_operations')
        .delete()
        .eq('id', associationId);

      if (error) throw error;

      toast.success('Association supprimée avec succès');
      fetchData();
    } catch (error: any) {
      console.error('Erreur lors de la suppression:', error);
      toast.error('Erreur lors de la suppression');
    }
  };

  const handleSubmitDialog = async () => {
    if (!dialogData || !dialogData.secretaireId) {
      toast.error('Veuillez sélectionner une secrétaire');
      return;
    }

    setSubmitting(true);
    try {
      if (dialogData.associationId) {
        const { error } = await supabase
          .from('secretaires_besoins_operations')
          .update({
            preference: dialogData.preference || null,
          })
          .eq('id', dialogData.associationId);

        if (error) throw error;
        toast.success('Association modifiée avec succès');
      } else {
        const { error } = await supabase
          .from('secretaires_besoins_operations')
          .insert({
            secretaire_id: dialogData.secretaireId,
            besoin_operation_id: dialogData.besoinId,
            preference: dialogData.preference || null,
          });

        if (error) throw error;
        toast.success('Association ajoutée avec succès');
      }

      setDialogOpen(false);
      setDialogData(null);
      fetchData();
    } catch (error: any) {
      console.error('Erreur lors de la sauvegarde:', error);
      toast.error('Erreur lors de la sauvegarde');
    } finally {
      setSubmitting(false);
    }
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center py-8">
        <Loader2 className="h-6 w-6 animate-spin text-primary" />
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div className="space-y-4">
        {besoins.map((besoin) => {
          const secretairesList = getSecretairesForBesoin(besoin.id);
          
          return (
            <div key={besoin.id} className="border border-border/50 rounded-lg p-4 space-y-3">
              <div className="flex items-center justify-between">
                <div>
                  <h3 className="font-semibold text-lg">{besoin.nom}</h3>
                  <p className="text-sm text-muted-foreground">Code: {besoin.code}</p>
                </div>
                <Button
                  size="sm"
                  onClick={() => handleAddAssociation(besoin.id, besoin.nom)}
                  className="gap-2"
                >
                  <Plus className="h-4 w-4" />
                  Ajouter secrétaire
                </Button>
              </div>

              {secretairesList.length > 0 ? (
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Secrétaire</TableHead>
                      <TableHead>Préférence</TableHead>
                      <TableHead className="w-[100px]">Actions</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {secretairesList.map((association) => (
                      <TableRow key={association.id}>
                        <TableCell>
                          {association.secretaire?.first_name} {association.secretaire?.name}
                        </TableCell>
                        <TableCell>
                          {association.preference ? (
                            <Badge variant="secondary">{association.preference}</Badge>
                          ) : (
                            <span className="text-muted-foreground">-</span>
                          )}
                        </TableCell>
                        <TableCell>
                          <div className="flex gap-2">
                            <Button
                              size="sm"
                              variant="outline"
                              onClick={() => handleEditAssociation(association, besoin.nom)}
                            >
                              <Edit className="h-4 w-4" />
                            </Button>
                            <Button
                              size="sm"
                              variant="outline"
                              onClick={() => handleDeleteAssociation(association.id)}
                            >
                              <Trash2 className="h-4 w-4" />
                            </Button>
                          </div>
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              ) : (
                <p className="text-sm text-muted-foreground text-center py-4">
                  Aucune secrétaire associée
                </p>
              )}
            </div>
          );
        })}
      </div>

      <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>
              {dialogData?.associationId ? 'Modifier' : 'Ajouter'} une association
            </DialogTitle>
          </DialogHeader>

          {dialogData && (
            <div className="space-y-4 py-4">
              <div className="space-y-2">
                <Label>Besoin d'opération</Label>
                <Input value={dialogData.besoinNom} disabled />
              </div>

              <div className="space-y-2">
                <Label htmlFor="secretaire">Secrétaire</Label>
                <Select
                  value={dialogData.secretaireId}
                  onValueChange={(value) =>
                    setDialogData({ ...dialogData, secretaireId: value })
                  }
                  disabled={!!dialogData.associationId}
                >
                  <SelectTrigger id="secretaire">
                    <SelectValue placeholder="Sélectionner une secrétaire" />
                  </SelectTrigger>
                  <SelectContent>
                    {secretaires.map((secretaire) => (
                      <SelectItem key={secretaire.id} value={secretaire.id}>
                        {secretaire.first_name} {secretaire.name}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>

              <div className="space-y-2">
                <Label htmlFor="preference">Préférence (optionnel)</Label>
                <Input
                  id="preference"
                  type="number"
                  min="1"
                  value={dialogData.preference || ''}
                  onChange={(e) =>
                    setDialogData({
                      ...dialogData,
                      preference: e.target.value ? parseInt(e.target.value) : undefined,
                    })
                  }
                  placeholder="1, 2, 3..."
                />
              </div>
            </div>
          )}

          <DialogFooter>
            <Button variant="outline" onClick={() => setDialogOpen(false)} disabled={submitting}>
              Annuler
            </Button>
            <Button onClick={handleSubmitDialog} disabled={submitting}>
              {submitting && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
              {dialogData?.associationId ? 'Modifier' : 'Ajouter'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
