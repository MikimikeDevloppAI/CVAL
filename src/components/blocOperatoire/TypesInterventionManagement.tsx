import { useState, useEffect, useImperativeHandle, forwardRef } from 'react';
import { Plus, Edit, Settings, Trash2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Badge } from '@/components/ui/badge';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { supabase } from '@/integrations/supabase/client';
import { useToast } from '@/hooks/use-toast';
import { TypeInterventionBesoinsForm } from './TypeInterventionBesoinsForm';
import { ConfigurationsMultiFluxManagement } from './ConfigurationsMultiFluxManagement';
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle } from '@/components/ui/alert-dialog';
import { Separator } from '@/components/ui/separator';

interface TypeIntervention {
  id: string;
  nom: string;
  code: string;
  actif: boolean;
  salle_preferentielle?: string | null;
  types_intervention_besoins_personnel?: Array<{
    type_besoin: string;
    nombre_requis: number;
  }>;
}

interface TypesInterventionManagementProps {}

export interface TypesInterventionManagementRef {
  openAddDialog: () => void;
}

export const TypesInterventionManagement = forwardRef<TypesInterventionManagementRef, TypesInterventionManagementProps>((props, ref) => {
  const [types, setTypes] = useState<TypeIntervention[]>([]);
  const [loading, setLoading] = useState(true);
  const [isFormOpen, setIsFormOpen] = useState(false);
  const [isBesoinsOpen, setIsBesoinsOpen] = useState(false);
  const [selectedType, setSelectedType] = useState<TypeIntervention | null>(null);
  const [formData, setFormData] = useState({ nom: '', code: '', salle_preferentielle: '' });
  const [deleteDialogOpen, setDeleteDialogOpen] = useState(false);
  const [typeToDelete, setTypeToDelete] = useState<string | null>(null);
  const { toast } = useToast();

  useEffect(() => {
    fetchTypes();
  }, []);

  const fetchTypes = async () => {
    try {
      const { data, error } = await supabase
        .from('types_intervention')
        .select(`
          *,
          types_intervention_besoins_personnel (
            type_besoin,
            nombre_requis
          )
        `)
        .eq('actif', true)
        .order('nom');

      if (error) throw error;
      setTypes(data || []);
    } catch (error) {
      console.error('Erreur:', error);
      toast({
        title: 'Erreur',
        description: 'Impossible de charger les types d\'intervention',
        variant: 'destructive',
      });
    } finally {
      setLoading(false);
    }
  };

  const handleSubmit = async () => {
    if (!formData.nom || !formData.code) {
      toast({
        title: 'Erreur',
        description: 'Le nom et le code sont requis',
        variant: 'destructive',
      });
      return;
    }

    try {
      if (selectedType) {
        // Modification
        const { error } = await supabase
          .from('types_intervention')
          .update({ 
            nom: formData.nom, 
            code: formData.code,
            salle_preferentielle: formData.salle_preferentielle || null
          })
          .eq('id', selectedType.id);

        if (error) throw error;
        toast({ title: 'Succès', description: 'Type d\'intervention modifié' });
      } else {
        // Création
        const { error } = await supabase
          .from('types_intervention')
          .insert({ 
            nom: formData.nom, 
            code: formData.code, 
            salle_preferentielle: formData.salle_preferentielle || null,
            actif: true 
          });

        if (error) throw error;
        toast({ title: 'Succès', description: 'Type d\'intervention créé' });
      }

      setIsFormOpen(false);
      setSelectedType(null);
      setFormData({ nom: '', code: '', salle_preferentielle: '' });
      fetchTypes();
    } catch (error) {
      console.error('Erreur:', error);
      toast({
        title: 'Erreur',
        description: 'Impossible d\'enregistrer le type d\'intervention',
        variant: 'destructive',
      });
    }
  };

  const handleDelete = async () => {
    if (!typeToDelete) return;

    try {
      const { error } = await supabase
        .from('types_intervention')
        .update({ actif: false })
        .eq('id', typeToDelete);

      if (error) throw error;

      toast({ title: 'Succès', description: 'Type d\'intervention supprimé' });
      setDeleteDialogOpen(false);
      setTypeToDelete(null);
      fetchTypes();
    } catch (error) {
      console.error('Erreur:', error);
      toast({
        title: 'Erreur',
        description: 'Impossible de supprimer le type d\'intervention',
        variant: 'destructive',
      });
    }
  };

  const openBesoinsDialog = (type: TypeIntervention) => {
    setSelectedType(type);
    setIsBesoinsOpen(true);
  };

  const openEditDialog = (type: TypeIntervention) => {
    setSelectedType(type);
    setFormData({ 
      nom: type.nom, 
      code: type.code, 
      salle_preferentielle: type.salle_preferentielle || '' 
    });
    setIsFormOpen(true);
  };

  const openAddDialog = () => {
    setSelectedType(null);
    setFormData({ nom: '', code: '', salle_preferentielle: '' });
    setIsFormOpen(true);
  };

  useImperativeHandle(ref, () => ({
    openAddDialog
  }));

  if (loading) {
    return <div className="text-center py-8 text-muted-foreground">Chargement...</div>;
  }

  return (
    <div className="space-y-4">
      <div className="grid gap-3">
        {types.map((type) => (
          <div
            key={type.id}
            className="p-4 border rounded-lg bg-card hover:bg-accent/50 transition-colors"
          >
            <div className="flex items-start justify-between">
              <div className="flex-1">
                <div className="flex items-center gap-2 mb-2">
                  <h3 className="font-medium">{type.nom}</h3>
                  <Badge variant="outline" className="text-xs">
                    {type.code}
                  </Badge>
                  {type.salle_preferentielle && (
                    <Badge 
                      className={`text-xs ${
                        type.salle_preferentielle === 'rouge' ? 'bg-red-100 text-red-800 border-red-300' :
                        type.salle_preferentielle === 'verte' ? 'bg-green-100 text-green-800 border-green-300' :
                        'bg-yellow-100 text-yellow-800 border-yellow-300'
                      }`}
                    >
                      Salle {type.salle_preferentielle}
                    </Badge>
                  )}
                </div>
                
                {type.types_intervention_besoins_personnel && type.types_intervention_besoins_personnel.length > 0 && (
                  <div className="flex flex-wrap gap-2 mt-2">
                    {type.types_intervention_besoins_personnel.map((besoin, idx) => (
                      <Badge key={idx} variant="secondary" className="text-xs">
                        {besoin.type_besoin.replace('_', ' ')}: {besoin.nombre_requis}
                      </Badge>
                    ))}
                  </div>
                )}
              </div>

              <div className="flex gap-1">
                <Button
                  variant="ghost"
                  size="icon"
                  onClick={() => openBesoinsDialog(type)}
                  title="Configurer les besoins"
                >
                  <Settings className="h-4 w-4" />
                </Button>
                <Button
                  variant="ghost"
                  size="icon"
                  onClick={() => openEditDialog(type)}
                  title="Modifier"
                >
                  <Edit className="h-4 w-4" />
                </Button>
                <Button
                  variant="ghost"
                  size="icon"
                  onClick={() => {
                    setTypeToDelete(type.id);
                    setDeleteDialogOpen(true);
                  }}
                  className="text-destructive hover:text-destructive"
                  title="Supprimer"
                >
                  <Trash2 className="h-4 w-4" />
                </Button>
              </div>
            </div>
          </div>
        ))}
      </div>

      {types.length === 0 && (
        <div className="text-center py-8 text-muted-foreground">
          Aucun type d'intervention configuré
        </div>
      )}

      <Separator className="my-8" />

      <ConfigurationsMultiFluxManagement />

      {/* Dialog pour ajouter/modifier un type */}
      <Dialog open={isFormOpen} onOpenChange={setIsFormOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>
              {selectedType ? 'Modifier le type' : 'Ajouter un type'} d'intervention
            </DialogTitle>
          </DialogHeader>
          <div className="space-y-4 py-4">
            <div>
              <label className="text-sm font-medium mb-2 block">Nom</label>
              <Input
                value={formData.nom}
                onChange={(e) => setFormData({ ...formData, nom: e.target.value })}
                placeholder="Ex: Opération cardio-vasculaire"
              />
            </div>
            <div>
              <label className="text-sm font-medium mb-2 block">Code</label>
              <Input
                value={formData.code}
                onChange={(e) => setFormData({ ...formData, code: e.target.value })}
                placeholder="Ex: CARDIO"
              />
            </div>
            <div>
              <label className="text-sm font-medium mb-2 block">Salle préférentielle (optionnel)</label>
              <Select
                value={formData.salle_preferentielle || 'none'}
                onValueChange={(value) => setFormData({ ...formData, salle_preferentielle: value === 'none' ? '' : value })}
              >
                <SelectTrigger className="bg-background">
                  <SelectValue placeholder="Sélectionner une salle" />
                </SelectTrigger>
                <SelectContent className="bg-popover z-50">
                  <SelectItem value="none">Aucune</SelectItem>
                  <SelectItem value="rouge">Salle Rouge</SelectItem>
                  <SelectItem value="verte">Salle Verte</SelectItem>
                  <SelectItem value="jaune">Salle Jaune</SelectItem>
                </SelectContent>
              </Select>
            </div>
          </div>
          <div className="flex justify-end gap-2">
            <Button variant="outline" onClick={() => setIsFormOpen(false)}>
              Annuler
            </Button>
            <Button onClick={handleSubmit}>
              {selectedType ? 'Modifier' : 'Ajouter'}
            </Button>
          </div>
        </DialogContent>
      </Dialog>

      {/* Dialog pour configurer les besoins */}
      {selectedType && (
        <TypeInterventionBesoinsForm
          open={isBesoinsOpen}
          onOpenChange={(open) => {
            setIsBesoinsOpen(open);
            if (!open) {
              fetchTypes(); // Rafraîchir pour afficher les badges mis à jour
            }
          }}
          typeInterventionId={selectedType.id}
          typeInterventionNom={selectedType.nom}
        />
      )}

      {/* Dialog de confirmation de suppression */}
      <AlertDialog open={deleteDialogOpen} onOpenChange={setDeleteDialogOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Confirmer la suppression</AlertDialogTitle>
            <AlertDialogDescription>
              Êtes-vous sûr de vouloir supprimer ce type d'intervention ? Cette action est irréversible.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Annuler</AlertDialogCancel>
            <AlertDialogAction onClick={handleDelete} className="bg-destructive text-destructive-foreground hover:bg-destructive/90">
              Supprimer
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
});

TypesInterventionManagement.displayName = 'TypesInterventionManagement';
