import { useState, useEffect } from 'react';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { supabase } from '@/integrations/supabase/client';
import { useToast } from '@/hooks/use-toast';
import { Plus, Trash2 } from 'lucide-react';

interface TypeInterventionBesoinsFormProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  typeInterventionId: string;
  typeInterventionNom: string;
}

interface BesoinOperation {
  id: string;
  code: string;
  nom: string;
  categorie?: string;
}

interface BesoinPersonnel {
  besoin_operation_id: string;
  nombre_requis: number;
}

export function TypeInterventionBesoinsForm({
  open,
  onOpenChange,
  typeInterventionId,
  typeInterventionNom,
}: TypeInterventionBesoinsFormProps) {
  const [besoins, setBesoins] = useState<Record<string, number>>({});
  const [loading, setLoading] = useState(false);
  const [besoinsOperations, setBesoinsOperations] = useState<BesoinOperation[]>([]);
  const [showAddBesoin, setShowAddBesoin] = useState(false);
  const [selectedNewBesoin, setSelectedNewBesoin] = useState<string>('');
  const [newBesoinNombre, setNewBesoinNombre] = useState<number>(1);
  const { toast } = useToast();

  useEffect(() => {
    if (open) {
      fetchBesoinsOperations();
    }
  }, [open]);

  useEffect(() => {
    if (open && typeInterventionId && besoinsOperations.length > 0) {
      fetchBesoins();
    }
  }, [open, typeInterventionId, besoinsOperations]);

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
      toast({
        title: 'Erreur',
        description: 'Impossible de charger les types de besoins',
        variant: 'destructive',
      });
    }
  };

  const fetchBesoins = async () => {
    try {
      const { data, error } = await supabase
        .from('types_intervention_besoins_personnel')
        .select('besoin_operation_id, nombre_requis')
        .eq('type_intervention_id', typeInterventionId)
        .eq('actif', true);

      if (error) throw error;

      const besoinsMap: Record<string, number> = {};
      data?.forEach((besoin) => {
        besoinsMap[besoin.besoin_operation_id] = besoin.nombre_requis;
      });
      setBesoins(besoinsMap);
    } catch (error) {
      console.error('Erreur lors du chargement des besoins:', error);
      toast({
        title: 'Erreur',
        description: 'Impossible de charger les besoins en personnel',
        variant: 'destructive',
      });
    }
  };

  const handleChange = (besoinId: string, value: string) => {
    const nombre = parseInt(value) || 0;
    setBesoins((prev) => ({
      ...prev,
      [besoinId]: nombre,
    }));
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

  const availableBesoins = besoinsOperations
    .filter((besoin) => !besoins[besoin.id])
    .sort((a, b) => a.nom.localeCompare(b.nom));

  const configuredBesoins = besoinsOperations.filter(
    (besoin) => besoins[besoin.id] > 0
  );

  const handleSubmit = async () => {
    setLoading(true);
    try {
      // Supprimer tous les besoins existants pour ce type d'intervention
      await supabase
        .from('types_intervention_besoins_personnel')
        .delete()
        .eq('type_intervention_id', typeInterventionId);

      // Insérer les nouveaux besoins (seulement ceux avec nombre > 0)
      const besoinsToInsert = Object.entries(besoins)
        .filter(([_, nombre]) => nombre > 0)
        .map(([besoin_operation_id, nombre_requis]) => ({
          type_intervention_id: typeInterventionId,
          besoin_operation_id,
          nombre_requis,
          actif: true,
        }));

      if (besoinsToInsert.length > 0) {
        const { error } = await supabase
          .from('types_intervention_besoins_personnel')
          .insert(besoinsToInsert);

        if (error) throw error;
      }

      toast({
        title: 'Succès',
        description: 'Besoins en personnel enregistrés',
      });
      onOpenChange(false);
    } catch (error) {
      console.error('Erreur lors de l\'enregistrement:', error);
      toast({
        title: 'Erreur',
        description: 'Impossible d\'enregistrer les besoins',
        variant: 'destructive',
      });
    } finally {
      setLoading(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-2xl">
        <DialogHeader>
          <DialogTitle>
            Besoins en personnel - {typeInterventionNom}
          </DialogTitle>
        </DialogHeader>

        <div className="space-y-4 py-4">
          <p className="text-sm text-muted-foreground">
            Définissez le nombre de personnes nécessaires pour chaque rôle lors de ce type d'intervention.
          </p>

          {/* Liste des besoins configurés */}
          <div className="space-y-2">
            {configuredBesoins.length > 0 ? (
              configuredBesoins.map((besoin) => (
                <div key={besoin.id} className="flex items-center gap-3 p-3 border rounded-lg">
                  <div className="flex-1">
                    <div className="font-medium">{besoin.nom}</div>
                    {besoin.categorie && (
                      <div className="text-xs text-muted-foreground">
                        {besoin.categorie}
                      </div>
                    )}
                  </div>
                  <div className="flex items-center gap-2">
                    <Label htmlFor={`nombre-${besoin.id}`} className="text-sm text-muted-foreground">
                      Nombre:
                    </Label>
                    <Input
                      id={`nombre-${besoin.id}`}
                      type="number"
                      min="1"
                      max="10"
                      value={besoins[besoin.id]}
                      onChange={(e) => handleChange(besoin.id, e.target.value)}
                      className="w-20"
                    />
                  </div>
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={() => handleRemoveBesoin(besoin.id)}
                  >
                    <Trash2 className="h-4 w-4 text-destructive" />
                  </Button>
                </div>
              ))
            ) : (
              <p className="text-sm text-muted-foreground text-center py-4">
                Aucun besoin configuré. Cliquez sur "Ajouter un besoin" pour commencer.
              </p>
            )}
          </div>

          {/* Zone d'ajout de nouveau besoin */}
          {showAddBesoin ? (
            <div className="p-4 border rounded-lg bg-muted/50 space-y-3">
              <div className="space-y-2">
                <Label>Sélectionner un rôle</Label>
                <Select 
                  value={selectedNewBesoin || undefined} 
                  onValueChange={(value) => {
                    console.log('Selected besoin:', value);
                    setSelectedNewBesoin(value);
                  }}
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

        <div className="flex justify-end gap-2">
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={loading}>
            Annuler
          </Button>
          <Button onClick={handleSubmit} disabled={loading}>
            {loading ? 'Enregistrement...' : 'Enregistrer'}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
