import React, { useState, useEffect, useImperativeHandle } from "react";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle } from "@/components/ui/alert-dialog";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Plus, Edit2, Trash2, MapPin } from "lucide-react";
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

interface BesoinOperation {
  id: string;
  code: string;
  nom: string;
  categorie?: string;
}

export interface TypesInterventionManagementRef {
  openAddDialog: () => void;
}

const TypesInterventionManagement = React.forwardRef<TypesInterventionManagementRef>((props, ref) => {
  const [types, setTypes] = useState<TypeIntervention[]>([]);
  const [salles, setSalles] = useState<Salle[]>([]);
  const [besoinsOperations, setBesoinsOperations] = useState<BesoinOperation[]>([]);
  const [loading, setLoading] = useState(true);
  const [formOpen, setFormOpen] = useState(false);
  const [editingType, setEditingType] = useState<TypeIntervention | null>(null);
  const [formData, setFormData] = useState({
    nom: '',
    code: '',
    salle_preferentielle: null as string | null,
  });
  const [besoins, setBesoins] = useState<Record<string, number>>({});
  const [showAddBesoin, setShowAddBesoin] = useState(false);
  const [selectedNewBesoin, setSelectedNewBesoin] = useState<string>('');
  const [newBesoinNombre, setNewBesoinNombre] = useState<number>(1);
  const [deleteDialogOpen, setDeleteDialogOpen] = useState(false);
  const [typeToDelete, setTypeToDelete] = useState<string | null>(null);

  useEffect(() => {
    fetchTypes();
    fetchSalles();
    fetchBesoinsOperations();
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

  const fetchBesoinsOperations = async () => {
    try {
      const { data, error } = await supabase
        .from('besoins_operations')
        .select('*')
        .eq('actif', true)
        .order('categorie', { ascending: true })
        .order('nom', { ascending: true });

      if (error) throw error;
      setBesoinsOperations(data || []);
    } catch (error) {
      console.error('Erreur lors du chargement des types de besoins:', error);
      toast.error('Impossible de charger les types de besoins');
    }
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();

    if (!formData.nom || !formData.code) {
      toast.error('Le nom et le code sont obligatoires');
      return;
    }

    const oldSalle = editingType?.salle_preferentielle;

    try {
      let typeId: string;
      
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
        typeId = editingType.id;
      } else {
        const { data, error } = await supabase
          .from('types_intervention')
          .insert({
            nom: formData.nom,
            code: formData.code,
            salle_preferentielle: formData.salle_preferentielle,
            actif: true,
          })
          .select()
          .single();

        if (error) throw error;
        typeId = data.id;
      }

      // Save besoins
      await supabase
        .from('types_intervention_besoins_personnel')
        .delete()
        .eq('type_intervention_id', typeId);

      const besoinsToInsert = Object.entries(besoins)
        .filter(([_, nombre]) => nombre > 0)
        .map(([besoin_operation_id, nombre_requis]) => ({
          type_intervention_id: typeId,
          besoin_operation_id,
          nombre_requis,
          actif: true,
        }));

      if (besoinsToInsert.length > 0) {
        const { error: besoinsError } = await supabase
          .from('types_intervention_besoins_personnel')
          .insert(besoinsToInsert);

        if (besoinsError) throw besoinsError;
      }

      toast.success(editingType ? 'Type modifié avec succès' : 'Type créé avec succès');
      fetchTypes();
      setFormOpen(false);
      setEditingType(null);
      setFormData({ nom: '', code: '', salle_preferentielle: null });
      setBesoins({});

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

  const openEditDialog = async (type: TypeIntervention) => {
    setEditingType(type);
    setFormData({
      nom: type.nom,
      code: type.code,
      salle_preferentielle: type.salle_preferentielle,
    });
    
    // Load existing besoins
    try {
      const { data, error } = await supabase
        .from('types_intervention_besoins_personnel')
        .select('besoin_operation_id, nombre_requis')
        .eq('type_intervention_id', type.id)
        .eq('actif', true);

      if (error) throw error;

      const besoinsMap: Record<string, number> = {};
      data?.forEach((besoin) => {
        besoinsMap[besoin.besoin_operation_id] = besoin.nombre_requis;
      });
      setBesoins(besoinsMap);
    } catch (error) {
      console.error('Error loading besoins:', error);
    }
    
    setFormOpen(true);
  };

  const openAddDialog = () => {
    setEditingType(null);
    setFormData({ nom: '', code: '', salle_preferentielle: null });
    setBesoins({});
    setFormOpen(true);
  };

  const handleRemoveBesoin = (besoinId: string) => {
    setBesoins((prev) => {
      const newBesoins = { ...prev };
      delete newBesoins[besoinId];
      return newBesoins;
    });
  };

  const handleAddBesoin = () => {
    if (selectedNewBesoin && newBesoinNombre > 0) {
      setBesoins((prev) => ({
        ...prev,
        [selectedNewBesoin]: newBesoinNombre,
      }));
      setSelectedNewBesoin('');
      setNewBesoinNombre(1);
      setShowAddBesoin(false);
    }
  };

  const handleChangeBesoin = (besoinId: string, value: string) => {
    const nombre = parseInt(value) || 0;
    setBesoins((prev) => ({
      ...prev,
      [besoinId]: nombre,
    }));
  };

  const availableBesoins = besoinsOperations
    .filter((besoin) => !besoins[besoin.id])
    .sort((a, b) => a.nom.localeCompare(b.nom));

  const configuredBesoins = besoinsOperations.filter(
    (besoin) => besoins[besoin.id] > 0
  );

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
        <DialogContent className="sm:max-w-2xl max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle className="text-xl font-bold">{editingType ? 'Modifier' : 'Ajouter'} un type d'intervention</DialogTitle>
          </DialogHeader>
          <form onSubmit={handleSubmit} className="space-y-6 py-4">
            {/* Informations de base */}
            <div className="space-y-4">
              <h3 className="text-sm font-semibold text-foreground uppercase tracking-wide">Informations générales</h3>
              <div className="space-y-2">
                <Label className="text-sm font-semibold text-foreground">Nom</Label>
                <Input
                  value={formData.nom}
                  onChange={(e) => setFormData({ ...formData, nom: e.target.value })}
                  placeholder="Ex: Arthroscopie"
                  className="h-11"
                />
              </div>
              <div className="space-y-2">
                <Label className="text-sm font-semibold text-foreground">Salle préférentielle</Label>
                <Select
                  value={formData.salle_preferentielle || undefined}
                  onValueChange={(value) => setFormData({ ...formData, salle_preferentielle: value || null })}
                >
                  <SelectTrigger className="h-11">
                    <SelectValue placeholder="Aucune préférence" />
                  </SelectTrigger>
                  <SelectContent>
                    {salles.map((salle) => (
                      <SelectItem key={salle.id} value={salle.id}>
                        {salle.name}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                {formData.salle_preferentielle && (
                  <Button
                    type="button"
                    variant="ghost"
                    size="sm"
                    onClick={() => setFormData({ ...formData, salle_preferentielle: null })}
                    className="text-xs"
                  >
                    Effacer la sélection
                  </Button>
                )}
              </div>
            </div>

            {/* Besoins en personnel */}
            <div className="space-y-4 pt-4 border-t border-border/50">
              <h3 className="text-sm font-semibold text-foreground uppercase tracking-wide">Besoins en personnel</h3>
              <p className="text-sm text-muted-foreground">
                Définissez le nombre de personnes nécessaires pour chaque rôle
              </p>

              {/* Liste des besoins configurés */}
              <div className="space-y-2">
                {configuredBesoins.length > 0 ? (
                  configuredBesoins.map((besoin) => (
                    <div key={besoin.id} className="flex items-center gap-3 p-3 rounded-lg bg-card/50 border border-border/50">
                      <div className="flex-1">
                        <div className="font-medium text-sm">{besoin.nom}</div>
                        {besoin.categorie && (
                          <div className="text-xs text-muted-foreground">{besoin.categorie}</div>
                        )}
                      </div>
                      <div className="flex items-center gap-2">
                        <Label htmlFor={`nombre-${besoin.id}`} className="text-sm text-muted-foreground">Nombre:</Label>
                        <Input
                          id={`nombre-${besoin.id}`}
                          type="number"
                          min="1"
                          max="10"
                          value={besoins[besoin.id]}
                          onChange={(e) => handleChangeBesoin(besoin.id, e.target.value)}
                          className="w-20"
                        />
                      </div>
                      <Button
                        type="button"
                        variant="ghost"
                        size="icon"
                        onClick={() => handleRemoveBesoin(besoin.id)}
                        className="h-8 w-8 hover:bg-destructive/10 hover:text-destructive"
                      >
                        <Trash2 className="h-4 w-4" />
                      </Button>
                    </div>
                  ))
                ) : (
                  <p className="text-sm text-muted-foreground text-center py-4">
                    Aucun besoin configuré
                  </p>
                )}
              </div>

              {/* Zone d'ajout de nouveau besoin */}
              {showAddBesoin ? (
                <div className="p-4 rounded-lg bg-muted/50 border border-border/50 space-y-3">
                  <div className="space-y-2">
                    <Label>Sélectionner un rôle</Label>
                    <Select 
                      value={selectedNewBesoin || undefined} 
                      onValueChange={setSelectedNewBesoin}
                    >
                      <SelectTrigger>
                        <SelectValue placeholder="Choisir un rôle..." />
                      </SelectTrigger>
                      <SelectContent>
                        {availableBesoins.length === 0 ? (
                          <div className="p-2 text-sm text-muted-foreground">
                            Tous les rôles ont déjà été ajoutés
                          </div>
                        ) : (
                          availableBesoins.map((besoin) => (
                            <SelectItem key={besoin.id} value={besoin.id}>
                              {besoin.nom}
                              {besoin.categorie && ` (${besoin.categorie})`}
                            </SelectItem>
                          ))
                        )}
                      </SelectContent>
                    </Select>
                  </div>
                  
                  <div className="space-y-2">
                    <Label>Nombre de personnes</Label>
                    <Input
                      type="number"
                      min="1"
                      max="10"
                      value={newBesoinNombre}
                      onChange={(e) => setNewBesoinNombre(parseInt(e.target.value) || 1)}
                      className="w-full"
                    />
                  </div>

                  <div className="flex gap-2">
                    <Button
                      type="button"
                      variant="outline"
                      size="sm"
                      onClick={() => {
                        setShowAddBesoin(false);
                        setSelectedNewBesoin('');
                        setNewBesoinNombre(1);
                      }}
                    >
                      Annuler
                    </Button>
                    <Button
                      type="button"
                      size="sm"
                      onClick={handleAddBesoin}
                      disabled={!selectedNewBesoin || newBesoinNombre < 1}
                    >
                      Ajouter
                    </Button>
                  </div>
                </div>
              ) : (
                <Button
                  type="button"
                  variant="outline"
                  className="w-full"
                  onClick={() => setShowAddBesoin(true)}
                  disabled={availableBesoins.length === 0}
                >
                  <Plus className="h-4 w-4 mr-2" />
                  Ajouter un besoin
                </Button>
              )}
            </div>

            <div className="flex justify-end gap-3 pt-2 border-t border-border/50">
              <Button type="button" variant="outline" onClick={() => setFormOpen(false)}>
                Annuler
              </Button>
              <Button type="submit" className="px-6">{editingType ? 'Modifier' : 'Créer'}</Button>
            </div>
          </form>
        </DialogContent>
      </Dialog>

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
