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
  first_name?: string;
  name?: string;
  email?: string;
  phone_number?: string;
  specialites: string[];
  specialites_details?: { nom: string }[];
  horaires_base_secretaires?: { jour_semaine: number }[];
  profile_id?: string;
  sites?: {
    nom: string;
  } | null;
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
      // D'abord récupérer les secrétaires avec leurs horaires de base
      const { data: secretairesData, error: secretairesError } = await supabase
        .from('secretaires')
        .select(`
          id,
          first_name,
          name,
          email,
          phone_number,
          profile_id,
          specialites,
          sites (
            nom
          ),
          horaires_base_secretaires (
            jour_semaine
          )
        `);

      if (secretairesError) {
        console.error('Erreur de requête secrétaires:', secretairesError);
        throw secretairesError;
      }

      // Ensuite enrichir avec les noms des spécialités
      if (secretairesData && secretairesData.length > 0) {
        const secretairesWithSpecialites = await Promise.all(
          secretairesData.map(async (secretaire: any) => {
            if (secretaire.specialites && secretaire.specialites.length > 0) {
              const { data: specialitesData } = await supabase
                .from('specialites')
                .select('nom')
                .in('id', secretaire.specialites);
              
              return {
                ...secretaire,
                specialites_details: specialitesData || []
              };
            }
            return { ...secretaire, specialites_details: [] };
          })
        );
        setSecretaires(secretairesWithSpecialites as Secretaire[]);
      } else {
        setSecretaires([]);
      }
    } catch (error) {
      console.error('Erreur lors du chargement des secrétaires:', error);
      toast({
        title: "Erreur",
        description: "Impossible de charger les secrétaires",
        variant: "destructive",
      });
      setSecretaires([]);
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

  const filteredSecretaires = secretaires.filter(secretaire => {
    const prenom = secretaire.first_name || '';
    const nom = secretaire.name || '';
    const email = secretaire.email || '';
    const telephone = secretaire.phone_number || '';
    
    return prenom.toLowerCase().includes(searchTerm.toLowerCase()) ||
           nom.toLowerCase().includes(searchTerm.toLowerCase()) ||
           email.toLowerCase().includes(searchTerm.toLowerCase()) ||
           telephone.toLowerCase().includes(searchTerm.toLowerCase()) ||
           secretaire.id.toLowerCase().includes(searchTerm.toLowerCase());
  });

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
            <DialogContent className="max-w-4xl w-full max-h-[90vh] overflow-y-auto">
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
                      {secretaire.first_name && secretaire.name ? 
                        `${secretaire.first_name} ${secretaire.name}` : 
                        `Secrétaire ${secretaire.id.slice(0, 8)}`
                      }
                    </CardTitle>
                    <p className="text-sm text-muted-foreground mt-1">
                      📧 {secretaire.email || 'Pas d\'email'}
                    </p>
                    {secretaire.phone_number && (
                      <p className="text-sm text-muted-foreground">
                        📞 {secretaire.phone_number}
                      </p>
                    )}
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
                    {secretaire.specialites_details && secretaire.specialites_details.length > 0 ? (
                      secretaire.specialites_details.map((spec, index) => (
                        <Badge key={index} variant="secondary" className="text-xs">
                          {spec.nom}
                        </Badge>
                      ))
                    ) : (
                      <Badge variant="outline" className="text-xs">
                        Aucune spécialité
                      </Badge>
                    )}
                  </div>
                  
                  {/* Jours de travail */}
                  {secretaire.horaires_base_secretaires && secretaire.horaires_base_secretaires.length > 0 && (
                    <div className="mt-2">
                      <p className="text-sm text-muted-foreground mb-1">Jours de travail:</p>
                      <div className="flex flex-wrap gap-1">
                        {secretaire.horaires_base_secretaires.map((horaire, index) => {
                          const jours = ['', 'Lun', 'Mar', 'Mer', 'Jeu', 'Ven', 'Sam', 'Dim'];
                          return (
                            <Badge key={index} variant="outline" className="text-xs">
                              {jours[horaire.jour_semaine]}
                            </Badge>
                          );
                        })}
                      </div>
                    </div>
                  )}
                  
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