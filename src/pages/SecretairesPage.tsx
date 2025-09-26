import { useState, useEffect } from 'react';
import { Plus, Edit, Trash2, Search } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from '@/components/ui/dialog';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { SecretaireForm } from '@/components/secretaires/SecretaireForm';
import { supabase } from '@/integrations/supabase/client';
import { useToast } from '@/hooks/use-toast';

interface Secretaire {
  id: string;
  specialites: string[];
  profiles: {
    prenom: string;
    nom: string;
    email: string;
  };
  sites?: {
    nom: string;
  };
}

import { Layout } from '@/components/layout/Layout';

export default function SecretairesPage() {
  const [secretaires, setSecretaires] = useState<Secretaire[]>([]);
  const [loading, setLoading] = useState(true);
  const [searchTerm, setSearchTerm] = useState('');
  const [selectedSecretaire, setSelectedSecretaire] = useState<Secretaire | null>(null);
  const [isDialogOpen, setIsDialogOpen] = useState(false);
  const { toast } = useToast();

  const fetchSecretaires = async () => {
    try {
      const { data, error } = await supabase
        .from('secretaires')
        .select(`
          id,
          specialites,
          profiles!secretaires_profile_id_fkey (
            prenom,
            nom,
            email
          ),
          sites!secretaires_site_preferentiel_id_fkey (
            nom
          )
        `);

      if (error) throw error;
      setSecretaires(data || []);
    } catch (error) {
      console.error('Erreur lors du chargement des secrétaires:', error);
      toast({
        title: "Erreur",
        description: "Impossible de charger les secrétaires",
        variant: "destructive",
      });
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchSecretaires();
  }, []);

  const handleDelete = async (secretaireId: string) => {
    try {
      const { error } = await supabase
        .from('secretaires')
        .delete()
        .eq('id', secretaireId);

      if (error) throw error;

      toast({
        title: "Succès",
        description: "Secrétaire supprimé avec succès",
      });
      
      fetchSecretaires();
    } catch (error) {
      console.error('Erreur lors de la suppression:', error);
      toast({
        title: "Erreur",
        description: "Impossible de supprimer le secrétaire",
        variant: "destructive",
      });
    }
  };

  const filteredSecretaires = secretaires.filter(secretaire =>
    secretaire.profiles?.prenom.toLowerCase().includes(searchTerm.toLowerCase()) ||
    secretaire.profiles?.nom.toLowerCase().includes(searchTerm.toLowerCase()) ||
    secretaire.profiles?.email.toLowerCase().includes(searchTerm.toLowerCase())
  );

  const handleFormSuccess = () => {
    setIsDialogOpen(false);
    setSelectedSecretaire(null);
    fetchSecretaires();
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center h-64">
        <div className="text-muted-foreground">Chargement...</div>
      </div>
    );
  }

  return (
    <Layout>
      <div className="container mx-auto py-6 space-y-6">
        <div className="flex items-center justify-between">
          <h1 className="text-2xl font-bold text-foreground">Gestion des Secrétaires</h1>
          
          <Dialog open={isDialogOpen} onOpenChange={setIsDialogOpen}>
            <DialogTrigger asChild>
              <Button className="gap-2" onClick={() => setSelectedSecretaire(null)}>
                <Plus className="h-4 w-4" />
                Ajouter un secrétaire
              </Button>
            </DialogTrigger>
            <DialogContent className="max-w-md">
              <DialogHeader>
                <DialogTitle>
                  {selectedSecretaire ? 'Modifier le secrétaire' : 'Ajouter un secrétaire'}
                </DialogTitle>
              </DialogHeader>
              <SecretaireForm 
                secretaire={selectedSecretaire} 
                onSuccess={handleFormSuccess}
              />
            </DialogContent>
          </Dialog>
        </div>

        {/* Search */}
        <div className="flex items-center space-x-2">
          <div className="relative flex-1 max-w-md">
            <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
            <Input
              placeholder="Rechercher un secrétaire..."
              value={searchTerm}
              onChange={(e) => setSearchTerm(e.target.value)}
              className="pl-10"
            />
          </div>
        </div>

        {/* Secrétaires Grid */}
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
          {filteredSecretaires.map((secretaire) => (
            <Card key={secretaire.id} className="hover:shadow-soft transition-shadow">
              <CardHeader>
                <div className="flex items-start justify-between">
                  <div>
                    <CardTitle className="text-lg">
                      {secretaire.profiles?.prenom} {secretaire.profiles?.nom}
                    </CardTitle>
                    <p className="text-sm text-muted-foreground mt-1">
                      {secretaire.profiles?.email}
                    </p>
                  </div>
                  <div className="flex space-x-1">
                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={() => {
                        setSelectedSecretaire(secretaire);
                        setIsDialogOpen(true);
                      }}
                    >
                      <Edit className="h-4 w-4" />
                    </Button>
                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={() => handleDelete(secretaire.id)}
                      className="text-destructive hover:text-destructive"
                    >
                      <Trash2 className="h-4 w-4" />
                    </Button>
                  </div>
                </div>
              </CardHeader>
              <CardContent>
                <div className="space-y-2">
                  <div className="flex flex-wrap gap-1">
                    {secretaire.specialites?.length > 0 ? (
                      secretaire.specialites.map((spec, index) => (
                        <Badge key={index} variant="secondary" className="text-xs">
                          {spec}
                        </Badge>
                      ))
                    ) : (
                      <Badge variant="outline" className="text-xs">
                        Aucune spécialité
                      </Badge>
                    )}
                  </div>
                  {secretaire.sites && (
                    <p className="text-sm text-muted-foreground">
                      Site préférentiel: {secretaire.sites.nom}
                    </p>
                  )}
                </div>
              </CardContent>
            </Card>
          ))}
        </div>

        {filteredSecretaires.length === 0 && (
          <div className="text-center py-12">
            <p className="text-muted-foreground">
              {searchTerm ? 'Aucun secrétaire trouvé pour cette recherche' : 'Aucun secrétaire enregistré'}
            </p>
          </div>
        )}
      </div>
    </Layout>
  );
}