import { useState, useEffect } from 'react';
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle } from "@/components/ui/alert-dialog";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Plus, Edit2, Trash2, X } from "lucide-react";
import { triggerRoomReassignment } from "@/lib/roomReassignment";

interface TypeIntervention {
  id: string;
  nom: string;
  code: string;
  actif: boolean;
}

interface Salle {
  id: string;
  name: string;
}

interface ConfigurationIntervention {
  type_intervention_id: string;
  ordre: number;
  salle: string;
}

interface Configuration {
  id: string;
  nom: string;
  code: string;
  type_flux: 'double_flux' | 'triple_flux';
  actif: boolean;
  interventions: Array<{
    id: string;
    type_intervention_id: string;
    ordre: number;
    salle: string | null;
    type_intervention: {
      nom: string;
      code: string;
    };
  }>;
}

export function ConfigurationsMultiFluxManagement() {
  const [configurations, setConfigurations] = useState<Configuration[]>([]);
  const [typesIntervention, setTypesIntervention] = useState<TypeIntervention[]>([]);
  const [salles, setSalles] = useState<Salle[]>([]);

  const [loading, setLoading] = useState(true);
  const [isFormOpen, setIsFormOpen] = useState(false);
  const [selectedConfig, setSelectedConfig] = useState<Configuration | null>(null);
  const [formData, setFormData] = useState({
    type_flux: 'double_flux' as 'double_flux' | 'triple_flux',
  });
  const [interventions, setInterventions] = useState<ConfigurationIntervention[]>([
    { type_intervention_id: '', ordre: 1, salle: 'rouge' },
    { type_intervention_id: '', ordre: 2, salle: 'verte' },
  ]);
  const [deleteDialogOpen, setDeleteDialogOpen] = useState(false);
  const [configToDelete, setConfigToDelete] = useState<string | null>(null);
  const [editingConfig, setEditingConfig] = useState<Configuration | null>(null);
  const [formDialogOpen, setFormDialogOpen] = useState(false);
  const [deleteDialogOpen, setDeleteDialogOpen] = useState(false);
  const [configToDelete, setConfigToDelete] = useState<string | null>(null);
  const [editingConfig, setEditingConfig] = useState<Configuration | null>(null);
  const [formData, setFormData] = useState({
    type_flux: 'double_flux' as 'double_flux' | 'triple_flux',
    interventions: [] as ConfigurationIntervention[],
  });

  useEffect(() => {
    fetchConfigurations();
    fetchTypesIntervention();
    fetchSalles();
  }, []);

  const fetchConfigurations = async () => {
    const { data, error } = await supabase
      .from('configurations_multi_flux')
      .select(`
        *,
        configurations_multi_flux_interventions (
          id,
          type_intervention_id,
          ordre,
          salle,
          types_intervention (
            nom,
            code
          )
        )
      `)
      .eq('actif', true)
      .order('nom');

    if (error) {
      console.error('Error fetching configurations:', error);
      toast.error('Erreur lors du chargement des configurations');
      return;
    }

    setConfigurations((data || []).map(config => ({
      ...config,
      interventions: config.configurations_multi_flux_interventions || []
    })) as Configuration[]);
  };

  const fetchTypesIntervention = async () => {
    const { data, error } = await supabase
      .from('types_intervention')
      .select('*')
      .eq('actif', true)
      .order('nom');

    if (error) {
      console.error('Error fetching types intervention:', error);
      toast.error('Erreur lors du chargement des types d\'intervention');
      return;
    }

    setTypesIntervention(data || []);
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

  const openAddDialog = (typeFlux: 'double_flux' | 'triple_flux') => {
    setEditingConfig(null);
    const numInterventions = typeFlux === 'double_flux' ? 2 : 3;
    setFormData({
      type_flux: typeFlux,
      interventions: Array(numInterventions).fill(null).map((_, idx) => ({
        type_intervention_id: '',
        ordre: idx + 1,
        salle: salles[idx]?.id || '',
      })),
    });
    setFormDialogOpen(true);
  };

  const openEditDialog = (config: Configuration) => {
    setEditingConfig(config);
    setFormData({
      type_flux: config.type_flux,
      interventions: config.interventions.map(i => ({
        type_intervention_id: i.type_intervention_id,
        ordre: i.ordre,
        salle: i.salle || '',
      })),
    });
    setFormDialogOpen(true);
  };

  const handleSubmit = async () => {
    const filledInterventions = formData.interventions.filter(i => i.type_intervention_id);
    const expectedCount = formData.type_flux === 'double_flux' ? 2 : 3;

    if (filledInterventions.length !== expectedCount) {
      toast.error(`Vous devez sélectionner ${expectedCount} interventions`);
      return;
    }

    const interventionCodes = filledInterventions
      .sort((a, b) => a.ordre - b.ordre)
      .map(i => {
        const type = typesIntervention.find(t => t.id === i.type_intervention_id);
        return type?.code || '';
      });

    const nom = interventionCodes.join(' + ');
    const code = interventionCodes.join('_');

    try {
      let configId = editingConfig?.id;

      if (editingConfig) {
        const { error } = await supabase
          .from('configurations_multi_flux')
          .update({ nom, code, type_flux: formData.type_flux })
          .eq('id', editingConfig.id);

        if (error) throw error;

        await supabase
          .from('configurations_multi_flux_interventions')
          .delete()
          .eq('configuration_id', editingConfig.id);
      } else {
        const { data, error } = await supabase
          .from('configurations_multi_flux')
          .insert({ nom, code, type_flux: formData.type_flux, actif: true })
          .select()
          .single();

        if (error) throw error;
        configId = data.id;
      }

      const { error: interventionsError } = await supabase
        .from('configurations_multi_flux_interventions')
        .insert(
          filledInterventions.map(i => ({
            configuration_id: configId,
            type_intervention_id: i.type_intervention_id,
            salle: i.salle || null,
            ordre: i.ordre,
          }))
        );

      if (interventionsError) throw interventionsError;

      toast.success(editingConfig ? 'Configuration modifiée avec succès' : 'Configuration créée avec succès');
      fetchConfigurations();
      setFormDialogOpen(false);

      // Trigger room reassignment
      try {
        await triggerRoomReassignment();
        toast.success('Salles réassignées avec succès');
      } catch (error) {
        console.error('Error reassigning rooms:', error);
        toast.error('Erreur lors de la réassignation des salles');
      }
    } catch (error) {
      console.error('Error saving configuration:', error);
      toast.error('Erreur lors de l\'enregistrement');
    }
  };

  const handleDelete = async () => {
    if (!configToDelete) return;

    try {
      const { error } = await supabase
        .from('configurations_multi_flux')
        .update({ actif: false })
        .eq('id', configToDelete);

      if (error) throw error;

      toast.success('Configuration supprimée avec succès');
      fetchConfigurations();
      setDeleteDialogOpen(false);
      setConfigToDelete(null);

      // Trigger room reassignment
      try {
        await triggerRoomReassignment();
        toast.success('Salles réassignées avec succès');
      } catch (error) {
        console.error('Error reassigning rooms:', error);
        toast.error('Erreur lors de la réassignation des salles');
      }
    } catch (error) {
      console.error('Error deleting configuration:', error);
      toast.error('Erreur lors de la suppression');
    }
  };

  const updateIntervention = (index: number, field: keyof ConfigurationIntervention, value: string) => {
    const newInterventions = [...formData.interventions];
    newInterventions[index] = { ...newInterventions[index], [field]: value };
    setFormData({ ...formData, interventions: newInterventions });
  };

  const getSalleName = (salleId: string | null) => {
    if (!salleId) return 'Non assignée';
    const salle = salles.find(s => s.id === salleId);
    return salle?.name || 'Inconnue';
  };

  const getSalleColor = (salle: string | null) => {
    const salleName = getSalleName(salle);
    switch (salleName.toLowerCase()) {
      case 'rouge':
        return 'bg-red-100 text-red-800 border-red-300';
      case 'jaune':
        return 'bg-yellow-100 text-yellow-800 border-yellow-300';
      case 'vert':
      case 'verte':
        return 'bg-green-100 text-green-800 border-green-300';
      default:
        return 'bg-muted text-muted-foreground';
    }
  };

  return (
    <div className="space-y-6">
      <Tabs defaultValue="double_flux">
        <TabsList className="grid w-full grid-cols-2">
          <TabsTrigger value="double_flux">Double Flux</TabsTrigger>
          <TabsTrigger value="triple_flux">Triple Flux</TabsTrigger>
        </TabsList>

        <TabsContent value="double_flux" className="space-y-4">
          <div className="flex justify-between items-center">
            <h3 className="text-lg font-semibold">Configurations Double Flux</h3>
            <Button onClick={() => openAddDialog('double_flux')}>
              <Plus className="h-4 w-4 mr-2" />
              Ajouter
            </Button>
          </div>

          {configurations.filter(c => c.type_flux === 'double_flux').map((config) => (
            <Card key={config.id}>
              <CardHeader>
                <div className="flex justify-between items-center">
                  <div>
                    <CardTitle>{config.nom}</CardTitle>
                    <CardDescription>{config.code}</CardDescription>
                  </div>
                  <div className="flex gap-2">
                    <Button variant="ghost" size="icon" onClick={() => openEditDialog(config)}>
                      <Edit2 className="h-4 w-4" />
                    </Button>
                    <Button
                      variant="ghost"
                      size="icon"
                      onClick={() => {
                        setConfigToDelete(config.id);
                        setDeleteDialogOpen(true);
                      }}
                    >
                      <Trash2 className="h-4 w-4" />
                    </Button>
                  </div>
                </div>
              </CardHeader>
              <CardContent>
                <div className="grid grid-cols-2 gap-3">
                  {config.interventions.sort((a, b) => a.ordre - b.ordre).map((interv, idx) => (
                    <div key={idx} className="space-y-2">
                      <div className="font-medium">{interv.type_intervention.nom}</div>
                      <span className={`px-2 py-1 rounded border text-xs ${getSalleColor(interv.salle)}`}>
                        {getSalleName(interv.salle)}
                      </span>
                    </div>
                  ))}
                </div>
              </CardContent>
            </Card>
          ))}
        </TabsContent>

        <TabsContent value="triple_flux" className="space-y-4">
          <div className="flex justify-between items-center">
            <h3 className="text-lg font-semibold">Configurations Triple Flux</h3>
            <Button onClick={() => openAddDialog('triple_flux')}>
              <Plus className="h-4 w-4 mr-2" />
              Ajouter
            </Button>
          </div>

          {configurations.filter(c => c.type_flux === 'triple_flux').map((config) => (
            <Card key={config.id}>
              <CardHeader>
                <div className="flex justify-between items-center">
                  <div>
                    <CardTitle>{config.nom}</CardTitle>
                    <CardDescription>{config.code}</CardDescription>
                  </div>
                  <div className="flex gap-2">
                    <Button variant="ghost" size="icon" onClick={() => openEditDialog(config)}>
                      <Edit2 className="h-4 w-4" />
                    </Button>
                    <Button
                      variant="ghost"
                      size="icon"
                      onClick={() => {
                        setConfigToDelete(config.id);
                        setDeleteDialogOpen(true);
                      }}
                    >
                      <Trash2 className="h-4 w-4" />
                    </Button>
                  </div>
                </div>
              </CardHeader>
              <CardContent>
                <div className="grid grid-cols-3 gap-3">
                  {config.interventions.sort((a, b) => a.ordre - b.ordre).map((interv, idx) => (
                    <div key={idx} className="space-y-2">
                      <div className="font-medium">{interv.type_intervention.nom}</div>
                      <span className={`px-2 py-1 rounded border text-xs ${getSalleColor(interv.salle)}`}>
                        {getSalleName(interv.salle)}
                      </span>
                    </div>
                  ))}
                </div>
              </CardContent>
            </Card>
          ))}
        </TabsContent>
      </Tabs>

      <Dialog open={formDialogOpen} onOpenChange={setFormDialogOpen}>
        <DialogContent className="max-w-2xl">
          <DialogHeader>
            <DialogTitle>
              {editingConfig ? 'Modifier' : 'Ajouter'} une configuration {formData.type_flux === 'double_flux' ? 'double' : 'triple'} flux
            </DialogTitle>
          </DialogHeader>
          <div className="space-y-4 py-4">
            {formData.interventions.map((intervention, idx) => (
              <div key={idx} className="grid grid-cols-2 gap-4 p-4 border rounded">
                <div>
                  <label className="text-sm font-medium block mb-2">Intervention {idx + 1}</label>
                  <Select
                    value={intervention.type_intervention_id}
                    onValueChange={(value) => updateIntervention(idx, 'type_intervention_id', value)}
                  >
                    <SelectTrigger>
                      <SelectValue placeholder="Sélectionner" />
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
                <div>
                  <label className="text-sm font-medium block mb-2">Salle</label>
                  <Select
                    value={intervention.salle || ''}
                    onValueChange={(value) => updateIntervention(idx, 'salle', value)}
                  >
                    <SelectTrigger>
                      <SelectValue placeholder="Sélectionner une salle" />
                    </SelectTrigger>
                    <SelectContent>
                      {salles.map((salle) => (
                        <SelectItem key={salle.id} value={salle.id}>
                          {salle.name}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
              </div>
            ))}
          </div>
          <div className="flex justify-end gap-2">
            <Button variant="outline" onClick={() => setFormDialogOpen(false)}>
              Annuler
            </Button>
            <Button onClick={handleSubmit}>
              {editingConfig ? 'Modifier' : 'Créer'}
            </Button>
          </div>
        </DialogContent>
      </Dialog>

      <AlertDialog open={deleteDialogOpen} onOpenChange={setDeleteDialogOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Confirmer la suppression</AlertDialogTitle>
            <AlertDialogDescription>
              Êtes-vous sûr de vouloir supprimer cette configuration ?
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
}

