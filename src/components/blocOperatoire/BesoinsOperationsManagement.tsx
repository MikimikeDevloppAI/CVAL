import { useState, useEffect } from 'react';
import { Plus, Edit, Trash2, Users } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from '@/components/ui/dialog';
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle, AlertDialogTrigger } from '@/components/ui/alert-dialog';
import { Badge } from '@/components/ui/badge';
import { supabase } from '@/integrations/supabase/client';
import { useToast } from '@/hooks/use-toast';
import { SecretairesForBesoinDialog } from './SecretairesForBesoinDialog';

interface BesoinOperation {
  id: string;
  code: string;
  nom: string;
  description?: string;
  categorie?: string;
  actif: boolean;
  secretaires_besoins_operations?: Array<{
    preference: number;
    secretaires: {
      first_name: string;
      name: string;
    };
  }>;
}

export function BesoinsOperationsManagement() {
  const [besoins, setBesoins] = useState<BesoinOperation[]>([]);
  const [loading, setLoading] = useState(true);
  const [isDialogOpen, setIsDialogOpen] = useState(false);
  const [isSecretairesDialogOpen, setIsSecretairesDialogOpen] = useState(false);
  const [selectedBesoin, setSelectedBesoin] = useState<BesoinOperation | null>(null);
  const [selectedBesoinForSecretaires, setSelectedBesoinForSecretaires] = useState<BesoinOperation | null>(null);
  const [formData, setFormData] = useState({
    code: '',
    nom: '',
    description: '',
    categorie: 'bloc_operatoire'
  });
  const { toast } = useToast();

  useEffect(() => {
    fetchBesoins();
  }, []);

  const fetchBesoins = async () => {
    try {
      const { data, error } = await supabase
        .from('besoins_operations')
        .select(`
          *,
          secretaires_besoins_operations (
            preference,
            secretaires (
              first_name,
              name
            )
          )
        `)
        .order('categorie', { ascending: true })
        .order('nom', { ascending: true });

      if (error) throw error;
      setBesoins(data || []);
    } catch (error) {
      console.error('Erreur:', error);
      toast({
        title: 'Erreur',
        description: 'Impossible de charger les besoins d\'opération',
        variant: 'destructive',
      });
    } finally {
      setLoading(false);
    }
  };

  const handleSubmit = async () => {
    try {
      if (selectedBesoin) {
        const { error } = await supabase
          .from('besoins_operations')
          .update({
            code: formData.code,
            nom: formData.nom,
            description: formData.description || null,
            categorie: formData.categorie || null,
          })
          .eq('id', selectedBesoin.id);

        if (error) throw error;
        toast({
          title: 'Succès',
          description: 'Besoin modifié avec succès',
        });
      } else {
        const { error } = await supabase
          .from('besoins_operations')
          .insert({
            code: formData.code,
            nom: formData.nom,
            description: formData.description || null,
            categorie: formData.categorie || null,
            actif: true,
          });

        if (error) throw error;
        toast({
          title: 'Succès',
          description: 'Besoin ajouté avec succès',
        });
      }

      setIsDialogOpen(false);
      setSelectedBesoin(null);
      setFormData({ code: '', nom: '', description: '', categorie: 'bloc_operatoire' });
      fetchBesoins();
    } catch (error) {
      console.error('Erreur:', error);
      toast({
        title: 'Erreur',
        description: 'Impossible d\'enregistrer le besoin',
        variant: 'destructive',
      });
    }
  };

  const handleDelete = async (id: string) => {
    try {
      const { error } = await supabase
        .from('besoins_operations')
        .update({ actif: false })
        .eq('id', id);

      if (error) throw error;
      
      toast({
        title: 'Succès',
        description: 'Besoin désactivé avec succès',
      });
      fetchBesoins();
    } catch (error) {
      console.error('Erreur:', error);
      toast({
        title: 'Erreur',
        description: 'Impossible de désactiver le besoin',
        variant: 'destructive',
      });
    }
  };

  const openEditDialog = (besoin: BesoinOperation) => {
    setSelectedBesoin(besoin);
    setFormData({
      code: besoin.code,
      nom: besoin.nom,
      description: besoin.description || '',
      categorie: besoin.categorie || 'bloc_operatoire'
    });
    setIsDialogOpen(true);
  };

  const openAddDialog = () => {
    setSelectedBesoin(null);
    setFormData({ code: '', nom: '', description: '', categorie: 'bloc_operatoire' });
    setIsDialogOpen(true);
  };

  const openSecretairesDialog = (besoin: BesoinOperation) => {
    setSelectedBesoinForSecretaires(besoin);
    setIsSecretairesDialogOpen(true);
  };

  if (loading) {
    return <div className="text-center p-4">Chargement...</div>;
  }

  const getCategorieColor = (categorie?: string) => {
    switch (categorie) {
      case 'bloc_operatoire': return 'bg-blue-500';
      case 'accueil': return 'bg-green-500';
      case 'administratif': return 'bg-purple-500';
      default: return 'bg-gray-500';
    }
  };

  return (
    <div className="space-y-4">
      <div className="flex justify-between items-center">
        <h3 className="text-lg font-medium">Types de besoins</h3>
        <Dialog open={isDialogOpen} onOpenChange={setIsDialogOpen}>
          <DialogTrigger asChild>
            <Button onClick={openAddDialog} size="sm">
              <Plus className="h-4 w-4 mr-2" />
              Ajouter
            </Button>
          </DialogTrigger>
          <DialogContent>
            <DialogHeader>
              <DialogTitle>
                {selectedBesoin ? 'Modifier le besoin' : 'Ajouter un besoin'}
              </DialogTitle>
            </DialogHeader>
            <div className="space-y-4 py-4">
              <div className="space-y-2">
                <Label htmlFor="code">Code</Label>
                <Input
                  id="code"
                  value={formData.code}
                  onChange={(e) => setFormData({ ...formData, code: e.target.value })}
                  placeholder="Ex: anesthesiste"
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="nom">Nom</Label>
                <Input
                  id="nom"
                  value={formData.nom}
                  onChange={(e) => setFormData({ ...formData, nom: e.target.value })}
                  placeholder="Ex: Anesthésiste"
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="description">Description</Label>
                <Input
                  id="description"
                  value={formData.description}
                  onChange={(e) => setFormData({ ...formData, description: e.target.value })}
                  placeholder="Description optionnelle"
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="categorie">Catégorie</Label>
                <select
                  id="categorie"
                  value={formData.categorie}
                  onChange={(e) => setFormData({ ...formData, categorie: e.target.value })}
                  className="w-full px-3 py-2 border rounded-md"
                >
                  <option value="bloc_operatoire">Bloc opératoire</option>
                  <option value="accueil">Accueil</option>
                  <option value="administratif">Administratif</option>
                </select>
              </div>
            </div>
            <div className="flex justify-end gap-2">
              <Button variant="outline" onClick={() => setIsDialogOpen(false)}>
                Annuler
              </Button>
              <Button onClick={handleSubmit}>
                Enregistrer
              </Button>
            </div>
          </DialogContent>
        </Dialog>
      </div>

      <div className="space-y-2">
        {besoins.filter(b => b.actif).map((besoin) => (
          <div
            key={besoin.id}
            className="p-3 border rounded-lg bg-card space-y-3"
          >
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-3">
                <div>
                  <div className="font-medium">{besoin.nom}</div>
                </div>
                <Badge variant="outline" className="text-xs">
                  {besoin.categorie}
                </Badge>
              </div>
              <div className="flex gap-2">
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() => openSecretairesDialog(besoin)}
                  title="Gérer les secrétaires"
                >
                  <Users className="h-4 w-4" />
                </Button>
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() => openEditDialog(besoin)}
                >
                  <Edit className="h-4 w-4" />
                </Button>
                <AlertDialog>
                  <AlertDialogTrigger asChild>
                    <Button variant="ghost" size="sm">
                      <Trash2 className="h-4 w-4" />
                    </Button>
                  </AlertDialogTrigger>
                  <AlertDialogContent>
                    <AlertDialogHeader>
                      <AlertDialogTitle>Confirmer la désactivation</AlertDialogTitle>
                      <AlertDialogDescription>
                        Êtes-vous sûr de vouloir désactiver ce besoin ? Il ne sera plus disponible dans les formulaires.
                      </AlertDialogDescription>
                    </AlertDialogHeader>
                    <AlertDialogFooter>
                      <AlertDialogCancel>Annuler</AlertDialogCancel>
                      <AlertDialogAction onClick={() => handleDelete(besoin.id)}>
                        Désactiver
                      </AlertDialogAction>
                    </AlertDialogFooter>
                  </AlertDialogContent>
                </AlertDialog>
              </div>
            </div>
            
            {/* Liste des secrétaires assignées */}
            {besoin.secretaires_besoins_operations && besoin.secretaires_besoins_operations.length > 0 && (
              <div className="pt-2 border-t">
                <div className="text-xs text-muted-foreground mb-2">Secrétaires assignées:</div>
                <div className="flex flex-wrap gap-2">
                  {besoin.secretaires_besoins_operations
                    .sort((a, b) => a.preference - b.preference)
                    .map((sa, idx) => (
                      <Badge key={idx} variant="secondary" className="text-xs bg-white text-black border border-border hover:bg-white hover:text-black">
                        {sa.secretaires.first_name} {sa.secretaires.name} (Pref: {sa.preference})
                      </Badge>
                    ))}
                </div>
              </div>
            )}
          </div>
        ))}
      </div>

      {/* Dialog pour gérer les secrétaires d'un besoin */}
      {selectedBesoinForSecretaires && (
        <SecretairesForBesoinDialog
          open={isSecretairesDialogOpen}
          onOpenChange={setIsSecretairesDialogOpen}
          besoinOperationId={selectedBesoinForSecretaires.id}
          besoinOperationNom={selectedBesoinForSecretaires.nom}
        />
      )}
    </div>
  );
}