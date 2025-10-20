import React, { useState, useEffect, useImperativeHandle } from "react";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle } from "@/components/ui/alert-dialog";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Plus, Settings, Edit2, Trash2, MapPin } from "lucide-react";
import { TypeInterventionBesoinsForm } from "./TypeInterventionBesoinsForm";
import { triggerRoomReassignment } from "@/lib/roomReassignment";
import { ConfigurationsMultiFluxManagement } from "./ConfigurationsMultiFluxManagement";

interface TypeIntervention {
  id: string;
  nom: string;
  code: string;
  actif: boolean;
  salle_preferentielle?: string | null;
  types_intervention_besoins_personnel?: Array<{
    besoin_operation_id: string;
    nombre_requis: number;
    besoins_operations?: {
      nom: string;
      code: string;
    };
  }>;
}

interface Salle {
  id: string;
  name: string;
}

export interface TypesInterventionManagementRef {
  openAddDialog: () => void;
}

const TypesInterventionManagement = React.forwardRef<TypesInterventionManagementRef>((props, ref) => {
  const [types, setTypes] = useState<TypeIntervention[]>([]);
  const [salles, setSalles] = useState<Salle[]>([]);
  const [loading, setLoading] = useState(true);
  const [formOpen, setFormOpen] = useState(false);
  const [besoinsOpen, setBesoinsOpen] = useState(false);
  const [editingType, setEditingType] = useState<TypeIntervention | null>(null);
  const [selectedTypeForBesoins, setSelectedTypeForBesoins] = useState<TypeIntervention | null>(null);
  const [formData, setFormData] = useState({
    nom: '',
    code: '',
    salle_preferentielle: null as string | null,
  });
  const [deleteDialogOpen, setDeleteDialogOpen] = useState(false);
  const [typeToDelete, setTypeToDelete] = useState<string | null>(null);

  useEffect(() => {
    fetchTypes();
    fetchSalles();
  }, []);

  const fetchTypes = async () => {
    const { data, error } = await supabase
      .from('types_intervention')
      .select(`
        *,
        types_intervention_besoins_personnel (
          besoin_operation_id,
          nombre_requis,
          besoins_operations (
            nom,
            code
          )
        )
      `)
      .eq('actif', true)
      .order('nom');

    if (error) {
      console.error('Error fetching types intervention:', error);
      toast.error('Erreur lors du chargement des types d\'intervention');
      return;
    }

    setTypes(data || []);
    setLoading(false);
  };

  const fetchSalles = async () => {
    const { data, error } = await supabase
      .from('salles_operation')
      .select('*')
      .order('name');

    if (error) {
      console.error('Error fetching salles:', error);
      toast.error('Erreur lors du chargement des salles');
      return;
    }

    setSalles(data || []);
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();

    if (!formData.nom || !formData.code) {
      toast.error('Le nom et le code sont obligatoires');
      return;
    }

    const oldSalle = editingType?.salle_preferentielle;

    try {
      if (editingType) {
        const { error } = await supabase
          .from('types_intervention')
          .update({
            nom: formData.nom,
            code: formData.code,
            salle_preferentielle: formData.salle_preferentielle,
          })
          .eq('id', editingType.id);

        if (error) throw error;
      } else {
        const { error } = await supabase
          .from('types_intervention')
          .insert({
            nom: formData.nom,
            code: formData.code,
            salle_preferentielle: formData.salle_preferentielle,
            actif: true,
          });

        if (error) throw error;
      }

      toast.success(editingType ? 'Type modifié avec succès' : 'Type créé avec succès');
      fetchTypes();
      setFormOpen(false);
      setEditingType(null);
      setFormData({ nom: '', code: '', salle_preferentielle: null });

      // Trigger room reassignment if preferred room changed
      if (editingType && oldSalle !== formData.salle_preferentielle) {
        try {
          await triggerRoomReassignment();
          toast.success('Salles réassignées avec succès');
        } catch (error) {
          console.error('Error reassigning rooms:', error);
          toast.error('Erreur lors de la réassignation des salles');
        }
      }
    } catch (error) {
      console.error('Error saving type:', error);
      toast.error('Erreur lors de l\'enregistrement');
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

      toast.success('Type supprimé avec succès');
      fetchTypes();
      setDeleteDialogOpen(false);
      setTypeToDelete(null);
    } catch (error) {
      console.error('Error deleting type:', error);
      toast.error('Erreur lors de la suppression');
    }
  };

  const openBesoinsDialog = (type: TypeIntervention) => {
    setSelectedTypeForBesoins(type);
    setBesoinsOpen(true);
  };

  const openEditDialog = (type: TypeIntervention) => {
    setEditingType(type);
    setFormData({
      nom: type.nom,
      code: type.code,
      salle_preferentielle: type.salle_preferentielle,
    });
    setFormOpen(true);
  };

  const openAddDialog = () => {
    setEditingType(null);
    setFormData({ nom: '', code: '', salle_preferentielle: null });
    setFormOpen(true);
  };

  useImperativeHandle(ref, () => ({
    openAddDialog,
  }));

  const getSalleName = (salleId: string | null) => {
    if (!salleId) return 'Non définie';
    const salle = salles.find(s => s.id === salleId);
    return salle?.name || 'Inconnue';
  };

  const getSalleColor = (salle: string | null) => {
    const salleName = getSalleName(salle);

    switch (salleName.toLowerCase()) {
      case 'rouge':
        return 'bg-red-50 text-red-700 border border-red-200';
      case 'jaune':
        return 'bg-yellow-50 text-yellow-700 border border-yellow-200';
      case 'verte':
      case 'vert':
        return 'bg-green-50 text-green-700 border border-green-200';
      default:
        return 'bg-muted/50 text-muted-foreground border border-border/50';
    }
  };

  if (loading) {
    return <div className="text-center py-8">Chargement...</div>;
  }

  return (
    <div className="space-y-6">
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        {types.map((type, index) => (
          <div
            key={type.id}
            className="group rounded-xl overflow-hidden bg-gradient-to-br from-card/80 to-card/40 backdrop-blur-sm border border-border/50 hover:border-primary/30 hover:shadow-xl transition-all duration-300 animate-fade-in"
            style={{ animationDelay: `${index * 50}ms` }}
          >
            <div className="p-5 space-y-4">
              {/* Header */}
              <div className="flex justify-between items-start">
                <div className="flex-1 space-y-2">
                  <h4 className="font-bold text-lg text-foreground group-hover:text-primary transition-colors">{type.nom}</h4>
                  <div className="flex items-center gap-3">
                    <span className="px-3 py-1 rounded-lg bg-primary/10 text-primary text-xs font-semibold uppercase tracking-wide">
                      {type.code}
                    </span>
                    {type.salle_preferentielle && (
                      <span className={`px-3 py-1 rounded-lg text-xs font-semibold flex items-center gap-1.5 ${getSalleColor(type.salle_preferentielle)}`}>
                        <MapPin className="h-3 w-3" />
                        {getSalleName(type.salle_preferentielle)}
                      </span>
                    )}
                  </div>
                </div>
                <div className="flex gap-1">
                  <Button 
                    variant="ghost" 
                    size="icon" 
                    onClick={() => openBesoinsDialog(type)}
                    className="h-9 w-9 hover:bg-primary/10 hover:text-primary transition-colors"
                    title="Configurer les besoins"
                  >
                    <Settings className="h-4 w-4" />
                  </Button>
                  <Button 
                    variant="ghost" 
                    size="icon" 
                    onClick={() => openEditDialog(type)}
                    className="h-9 w-9 hover:bg-primary/10 hover:text-primary transition-colors"
                    title="Modifier"
                  >
                    <Edit2 className="h-4 w-4" />
                  </Button>
                  <Button
                    variant="ghost"
                    size="icon"
                    onClick={() => {
                      setTypeToDelete(type.id);
                      setDeleteDialogOpen(true);
                    }}
                    className="h-9 w-9 hover:bg-destructive/10 hover:text-destructive transition-colors"
                    title="Supprimer"
                  >
                    <Trash2 className="h-4 w-4" />
                  </Button>
                </div>
              </div>
              
              {/* Besoins en personnel */}
              {type.types_intervention_besoins_personnel && type.types_intervention_besoins_personnel.length > 0 && (
                <div className="pt-3 border-t border-border/30">
                  <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wider mb-2">Personnel requis</p>
                  <div className="flex flex-wrap gap-2">
                    {type.types_intervention_besoins_personnel.map((besoin, idx) => (
                      <div 
                        key={idx} 
                        className="px-3 py-1.5 rounded-lg bg-card border border-border/50 hover:border-primary/30 hover:shadow-md transition-all duration-200"
                      >
                        <span className="text-xs font-medium text-foreground">
                          {besoin.besoins_operations?.nom || 'N/A'}
                        </span>
                        <span className="ml-2 px-2 py-0.5 rounded-md bg-primary/10 text-primary text-xs font-bold">
                          {besoin.nombre_requis}
                        </span>
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </div>
          </div>
        ))}
      </div>

      {types.length === 0 && (
        <div className="text-center py-16 rounded-xl bg-card/30 backdrop-blur-sm border border-dashed border-border/50">
          <p className="text-muted-foreground text-sm">Aucun type d'intervention configuré</p>
        </div>
      )}

      <ConfigurationsMultiFluxManagement />

      <Dialog open={formOpen} onOpenChange={setFormOpen}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle className="text-xl font-bold">{editingType ? 'Modifier' : 'Ajouter'} un type d'intervention</DialogTitle>
          </DialogHeader>
          <form onSubmit={handleSubmit} className="space-y-5 py-4">
            <div className="space-y-2">
              <label className="text-sm font-semibold text-foreground">Nom</label>
              <Input
                value={formData.nom}
                onChange={(e) => setFormData({ ...formData, nom: e.target.value })}
                placeholder="Ex: Arthroscopie"
                className="h-11"
              />
            </div>
            <div className="space-y-2">
              <label className="text-sm font-semibold text-foreground">Code</label>
              <Input
                value={formData.code}
                onChange={(e) => setFormData({ ...formData, code: e.target.value })}
                placeholder="Ex: ARTH"
                className="h-11"
              />
            </div>
            <div className="space-y-2">
              <label className="text-sm font-semibold text-foreground">Salle préférentielle</label>
              <Select
                value={formData.salle_preferentielle || ''}
                onValueChange={(value) => setFormData({ ...formData, salle_preferentielle: value || null })}
              >
                <SelectTrigger className="h-11">
                  <SelectValue placeholder="Sélectionner une salle" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="">Aucune préférence</SelectItem>
                  {salles.map((salle) => (
                    <SelectItem key={salle.id} value={salle.id}>
                      {salle.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="flex justify-end gap-3 pt-2">
              <Button type="button" variant="outline" onClick={() => setFormOpen(false)}>
                Annuler
              </Button>
              <Button type="submit" className="px-6">{editingType ? 'Modifier' : 'Créer'}</Button>
            </div>
          </form>
        </DialogContent>
      </Dialog>

      {selectedTypeForBesoins && (
        <TypeInterventionBesoinsForm
          open={besoinsOpen}
          onOpenChange={(open) => {
            setBesoinsOpen(open);
            if (!open) {
              fetchTypes();
            }
          }}
          typeInterventionId={selectedTypeForBesoins.id}
          typeInterventionNom={selectedTypeForBesoins.nom}
        />
      )}

      <AlertDialog open={deleteDialogOpen} onOpenChange={setDeleteDialogOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Confirmer la suppression</AlertDialogTitle>
            <AlertDialogDescription>
              Êtes-vous sûr de vouloir supprimer ce type d'intervention ?
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Annuler</AlertDialogCancel>
            <AlertDialogAction onClick={handleDelete}>Supprimer</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
});

TypesInterventionManagement.displayName = 'TypesInterventionManagement';

export { TypesInterventionManagement };
export default TypesInterventionManagement;
