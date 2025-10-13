import { useState, useEffect } from 'react';
import { Plus, Edit, Trash2, Save, X } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Badge } from '@/components/ui/badge';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { supabase } from '@/integrations/supabase/client';
import { useToast } from '@/hooks/use-toast';
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle } from '@/components/ui/alert-dialog';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';

interface TypeIntervention {
  id: string;
  nom: string;
  code: string;
}

interface ConfigurationIntervention {
  type_intervention_id: string;
  type_personnel: 'anesthesiste' | 'instrumentiste' | 'instrumentiste_aide_salle' | 'aide_salle' | 'accueil' | '';
  salle: 'rouge' | 'verte' | 'jaune';
  ordre: number;
}

interface Configuration {
  id: string;
  nom: string;
  code: string;
  type_flux: 'double_flux' | 'triple_flux';
  actif: boolean;
  configurations_multi_flux_interventions?: Array<{
    type_intervention_id: string;
    salle: string;
    ordre: number;
    types_intervention: {
      nom: string;
      code: string;
    };
  }>;
}

const SALLES = [
  { value: 'rouge', label: 'Salle Rouge' },
  { value: 'verte', label: 'Salle Verte' },
  { value: 'jaune', label: 'Salle Jaune' },
];

const TYPES_PERSONNEL = [
  { value: 'anesthesiste', label: 'Anesthésiste' },
  { value: 'instrumentiste', label: 'Instrumentiste' },
  { value: 'instrumentiste_aide_salle', label: 'Instrumentiste / Aide de salle' },
  { value: 'aide_salle', label: 'Aide de salle' },
  { value: 'accueil', label: 'Accueil' },
];

export function ConfigurationsMultiFluxManagement() {
  const [configurations, setConfigurations] = useState<Configuration[]>([]);
  const [typesIntervention, setTypesIntervention] = useState<TypeIntervention[]>([]);
  const [loading, setLoading] = useState(true);
  const [isFormOpen, setIsFormOpen] = useState(false);
  const [selectedConfig, setSelectedConfig] = useState<Configuration | null>(null);
  const [formData, setFormData] = useState({
    nom: '',
    code: '',
    type_flux: 'double_flux' as 'double_flux' | 'triple_flux',
  });
  const [interventions, setInterventions] = useState<ConfigurationIntervention[]>([
    { type_intervention_id: '', type_personnel: '', salle: 'rouge' as const, ordre: 1 },
    { type_intervention_id: '', type_personnel: '', salle: 'verte' as const, ordre: 2 },
  ]);
  const [deleteDialogOpen, setDeleteDialogOpen] = useState(false);
  const [configToDelete, setConfigToDelete] = useState<string | null>(null);
  const { toast } = useToast();

  useEffect(() => {
    fetchConfigurations();
    fetchTypesIntervention();
  }, []);

  const fetchConfigurations = async () => {
    try {
      const { data, error } = await supabase
        .from('configurations_multi_flux')
        .select(`
          *,
          configurations_multi_flux_interventions (
            type_intervention_id,
            salle,
            ordre,
            types_intervention (
              nom,
              code
            )
          )
        `)
        .eq('actif', true)
        .order('nom');

      if (error) throw error;
      setConfigurations((data || []) as Configuration[]);
    } catch (error) {
      console.error('Erreur:', error);
      toast({
        title: 'Erreur',
        description: 'Impossible de charger les configurations',
        variant: 'destructive',
      });
    } finally {
      setLoading(false);
    }
  };

  const fetchTypesIntervention = async () => {
    try {
      const { data, error } = await supabase
        .from('types_intervention')
        .select('id, nom, code')
        .eq('actif', true)
        .order('nom');

      if (error) throw error;
      setTypesIntervention(data || []);
    } catch (error) {
      console.error('Erreur:', error);
    }
  };

  const resetForm = () => {
    setFormData({ nom: '', code: '', type_flux: 'double_flux' });
    setInterventions([
      { type_intervention_id: '', type_personnel: '', salle: 'rouge', ordre: 1 },
      { type_intervention_id: '', type_personnel: '', salle: 'verte', ordre: 2 },
    ]);
  };

  const openAddDialog = (typeFlux: 'double_flux' | 'triple_flux') => {
    setSelectedConfig(null);
    resetForm();
    setFormData({ ...formData, type_flux: typeFlux });
    
    if (typeFlux === 'triple_flux') {
      setInterventions([
        { type_intervention_id: '', type_personnel: '', salle: 'rouge', ordre: 1 },
        { type_intervention_id: '', type_personnel: '', salle: 'verte', ordre: 2 },
        { type_intervention_id: '', type_personnel: '', salle: 'jaune', ordre: 3 },
      ]);
    }
    
    setIsFormOpen(true);
  };

  const openEditDialog = (config: Configuration) => {
    setSelectedConfig(config);
    setFormData({
      nom: config.nom,
      code: config.code,
      type_flux: config.type_flux,
    });
    
    const interventionsData = config.configurations_multi_flux_interventions?.map(ci => ({
      type_intervention_id: ci.type_intervention_id,
      type_personnel: '' as const,
      salle: ci.salle as 'rouge' | 'verte' | 'jaune',
      ordre: ci.ordre,
    })) || [];
    
    setInterventions(interventionsData);
    setIsFormOpen(true);
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

    const interventionsCount = formData.type_flux === 'double_flux' ? 2 : 3;
    const filledInterventions = interventions.filter(i => i.type_intervention_id);
    
    if (filledInterventions.length !== interventionsCount) {
      toast({
        title: 'Erreur',
        description: `Vous devez sélectionner ${interventionsCount} types d'intervention`,
        variant: 'destructive',
      });
      return;
    }

    try {
      if (selectedConfig) {
        // Modification
        const { error: configError } = await supabase
          .from('configurations_multi_flux')
          .update({
            nom: formData.nom,
            code: formData.code,
            type_flux: formData.type_flux,
          })
          .eq('id', selectedConfig.id);

        if (configError) throw configError;

        // Supprimer les anciennes interventions
        await supabase
          .from('configurations_multi_flux_interventions')
          .delete()
          .eq('configuration_id', selectedConfig.id);

        // Ajouter les nouvelles interventions
        const { error: interventionsError } = await supabase
          .from('configurations_multi_flux_interventions')
          .insert(
            filledInterventions.map(i => ({
              configuration_id: selectedConfig.id,
              type_intervention_id: i.type_intervention_id,
              salle: i.salle,
              ordre: i.ordre,
            }))
          );

        if (interventionsError) throw interventionsError;

        toast({ title: 'Succès', description: 'Configuration modifiée' });
      } else {
        // Création
        const { data: configData, error: configError } = await supabase
          .from('configurations_multi_flux')
          .insert({
            nom: formData.nom,
            code: formData.code,
            type_flux: formData.type_flux,
            actif: true,
          })
          .select()
          .single();

        if (configError) throw configError;

        // Ajouter les interventions
        const { error: interventionsError } = await supabase
          .from('configurations_multi_flux_interventions')
          .insert(
            filledInterventions.map(i => ({
              configuration_id: configData.id,
              type_intervention_id: i.type_intervention_id,
              salle: i.salle,
              ordre: i.ordre,
            }))
          );

        if (interventionsError) throw interventionsError;

        toast({ title: 'Succès', description: 'Configuration créée' });
      }

      setIsFormOpen(false);
      resetForm();
      setSelectedConfig(null);
      fetchConfigurations();
    } catch (error) {
      console.error('Erreur:', error);
      toast({
        title: 'Erreur',
        description: 'Impossible d\'enregistrer la configuration',
        variant: 'destructive',
      });
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

      toast({ title: 'Succès', description: 'Configuration supprimée' });
      setDeleteDialogOpen(false);
      setConfigToDelete(null);
      fetchConfigurations();
    } catch (error) {
      console.error('Erreur:', error);
      toast({
        title: 'Erreur',
        description: 'Impossible de supprimer la configuration',
        variant: 'destructive',
      });
    }
  };

  const updateIntervention = (index: number, field: keyof ConfigurationIntervention, value: string) => {
    const newInterventions = [...interventions];
    newInterventions[index] = { ...newInterventions[index], [field]: value };
    setInterventions(newInterventions);
  };

  const getSalleColor = (salle: string) => {
    switch (salle) {
      case 'rouge': return 'bg-red-100 text-red-800 border-red-300';
      case 'verte': return 'bg-green-100 text-green-800 border-green-300';
      case 'jaune': return 'bg-yellow-100 text-yellow-800 border-yellow-300';
      default: return 'bg-gray-100 text-gray-800 border-gray-300';
    }
  };

  const doubleFlux = configurations.filter(c => c.type_flux === 'double_flux');
  const tripleFlux = configurations.filter(c => c.type_flux === 'triple_flux');

  if (loading) {
    return <div className="text-center py-8 text-muted-foreground">Chargement...</div>;
  }

  return (
    <div className="space-y-6">
      <Tabs defaultValue="double_flux" className="w-full">
        <TabsList className="grid w-full grid-cols-2">
          <TabsTrigger value="double_flux">Double Flux</TabsTrigger>
          <TabsTrigger value="triple_flux">Triple Flux</TabsTrigger>
        </TabsList>

        <TabsContent value="double_flux" className="space-y-4">
          <div className="flex items-center justify-between">
            <h3 className="text-lg font-semibold">Configurations Double Flux</h3>
            <Button onClick={() => openAddDialog('double_flux')} className="gap-2">
              <Plus className="h-4 w-4" />
              Ajouter une configuration
            </Button>
          </div>

          <div className="grid gap-3">
            {doubleFlux.map((config) => (
              <div
                key={config.id}
                className="p-4 border rounded-lg bg-card hover:bg-accent/50 transition-colors"
              >
                <div className="flex items-start justify-between">
                  <div className="flex-1">
                    <div className="flex items-center gap-2 mb-3">
                      <h4 className="font-medium">{config.nom}</h4>
                      <Badge variant="outline" className="text-xs">{config.code}</Badge>
                    </div>
                    
                    <div className="grid grid-cols-2 gap-2">
                      {config.configurations_multi_flux_interventions
                        ?.sort((a, b) => a.ordre - b.ordre)
                        .map((ci, idx) => (
                          <div key={idx} className={`p-2 rounded border ${getSalleColor(ci.salle)}`}>
                            <div className="text-xs font-medium mb-1">{ci.salle.charAt(0).toUpperCase() + ci.salle.slice(1)}</div>
                            <div className="text-sm">{ci.types_intervention.nom}</div>
                          </div>
                        ))}
                    </div>
                  </div>

                  <div className="flex gap-1">
                    <Button
                      variant="ghost"
                      size="icon"
                      onClick={() => openEditDialog(config)}
                      title="Modifier"
                    >
                      <Edit className="h-4 w-4" />
                    </Button>
                    <Button
                      variant="ghost"
                      size="icon"
                      onClick={() => {
                        setConfigToDelete(config.id);
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

          {doubleFlux.length === 0 && (
            <div className="text-center py-8 text-muted-foreground">
              Aucune configuration double flux
            </div>
          )}
        </TabsContent>

        <TabsContent value="triple_flux" className="space-y-4">
          <div className="flex items-center justify-between">
            <h3 className="text-lg font-semibold">Configurations Triple Flux</h3>
            <Button onClick={() => openAddDialog('triple_flux')} className="gap-2">
              <Plus className="h-4 w-4" />
              Ajouter une configuration
            </Button>
          </div>

          <div className="grid gap-3">
            {tripleFlux.map((config) => (
              <div
                key={config.id}
                className="p-4 border rounded-lg bg-card hover:bg-accent/50 transition-colors"
              >
                <div className="flex items-start justify-between">
                  <div className="flex-1">
                    <div className="flex items-center gap-2 mb-3">
                      <h4 className="font-medium">{config.nom}</h4>
                      <Badge variant="outline" className="text-xs">{config.code}</Badge>
                    </div>
                    
                    <div className="grid grid-cols-3 gap-2">
                      {config.configurations_multi_flux_interventions
                        ?.sort((a, b) => a.ordre - b.ordre)
                        .map((ci, idx) => (
                          <div key={idx} className={`p-2 rounded border ${getSalleColor(ci.salle)}`}>
                            <div className="text-xs font-medium mb-1">{ci.salle.charAt(0).toUpperCase() + ci.salle.slice(1)}</div>
                            <div className="text-sm">{ci.types_intervention.nom}</div>
                          </div>
                        ))}
                    </div>
                  </div>

                  <div className="flex gap-1">
                    <Button
                      variant="ghost"
                      size="icon"
                      onClick={() => openEditDialog(config)}
                      title="Modifier"
                    >
                      <Edit className="h-4 w-4" />
                    </Button>
                    <Button
                      variant="ghost"
                      size="icon"
                      onClick={() => {
                        setConfigToDelete(config.id);
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

          {tripleFlux.length === 0 && (
            <div className="text-center py-8 text-muted-foreground">
              Aucune configuration triple flux
            </div>
          )}
        </TabsContent>
      </Tabs>

      {/* Dialog pour ajouter/modifier une configuration */}
      <Dialog open={isFormOpen} onOpenChange={(open) => {
        if (!open) resetForm();
        setIsFormOpen(open);
      }}>
        <DialogContent className="max-w-2xl">
          <DialogHeader>
            <DialogTitle>
              {selectedConfig ? 'Modifier' : 'Ajouter'} une configuration {formData.type_flux === 'double_flux' ? 'double' : 'triple'} flux
            </DialogTitle>
          </DialogHeader>
          
          <div className="space-y-4 py-4">
            <div className="grid grid-cols-2 gap-4">
              <div>
                <label className="text-sm font-medium mb-2 block">Nom</label>
                <Input
                  value={formData.nom}
                  onChange={(e) => setFormData({ ...formData, nom: e.target.value })}
                  placeholder="Ex: 2 IVT"
                />
              </div>
              <div>
                <label className="text-sm font-medium mb-2 block">Code</label>
                <Input
                  value={formData.code}
                  onChange={(e) => setFormData({ ...formData, code: e.target.value })}
                  placeholder="Ex: 2IVT"
                />
              </div>
            </div>

            <div className="space-y-3">
              <label className="text-sm font-medium">Attribution des salles</label>
              {interventions.map((intervention, index) => (
                <div key={index} className="grid grid-cols-3 gap-3 p-3 border rounded-lg bg-card">
                  <div>
                    <label className="text-xs text-muted-foreground mb-1 block">Type de personnel</label>
                    <Select
                      value={intervention.type_personnel}
                      onValueChange={(value) => updateIntervention(index, 'type_personnel', value)}
                    >
                      <SelectTrigger className="bg-background">
                        <SelectValue placeholder="Sélectionner" />
                      </SelectTrigger>
                      <SelectContent className="bg-popover z-50">
                        {TYPES_PERSONNEL.map((type) => (
                          <SelectItem key={type.value} value={type.value}>
                            {type.label}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>
                  <div>
                    <label className="text-xs text-muted-foreground mb-1 block">Type d'intervention</label>
                    <Select
                      value={intervention.type_intervention_id}
                      onValueChange={(value) => updateIntervention(index, 'type_intervention_id', value)}
                    >
                      <SelectTrigger className="bg-background">
                        <SelectValue placeholder="Sélectionner" />
                      </SelectTrigger>
                      <SelectContent className="bg-popover z-50">
                        {typesIntervention.map((type) => (
                          <SelectItem key={type.id} value={type.id}>
                            {type.nom}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>
                  <div>
                    <label className="text-xs text-muted-foreground mb-1 block">Salle</label>
                    <Select
                      value={intervention.salle}
                      onValueChange={(value) => updateIntervention(index, 'salle', value)}
                    >
                      <SelectTrigger className="bg-background">
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent className="bg-popover z-50">
                        {SALLES.map((salle) => (
                          <SelectItem key={salle.value} value={salle.value}>
                            {salle.label}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>
                </div>
              ))}
            </div>
          </div>

          <div className="flex justify-end gap-2">
            <Button variant="outline" onClick={() => {
              setIsFormOpen(false);
              resetForm();
            }}>
              <X className="h-4 w-4 mr-2" />
              Annuler
            </Button>
            <Button onClick={handleSubmit}>
              <Save className="h-4 w-4 mr-2" />
              {selectedConfig ? 'Modifier' : 'Créer'}
            </Button>
          </div>
        </DialogContent>
      </Dialog>

      {/* Dialog de confirmation de suppression */}
      <AlertDialog open={deleteDialogOpen} onOpenChange={setDeleteDialogOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Confirmer la suppression</AlertDialogTitle>
            <AlertDialogDescription>
              Êtes-vous sûr de vouloir supprimer cette configuration ? Cette action est irréversible.
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
}
