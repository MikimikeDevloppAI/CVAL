import { useState, useEffect } from 'react';
import { Plus, Edit, Trash2, Search, Mail, Phone } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from '@/components/ui/dialog';
import { Badge } from '@/components/ui/badge';
import { ModernCard, ModernCardHeader, ModernCardContent, ModernCardTitle, ContactInfo } from '@/components/ui/modern-card';
import { MedecinForm } from '@/components/medecins/MedecinForm';
import { supabase } from '@/integrations/supabase/client';
import { useToast } from '@/hooks/use-toast';

interface Medecin {
  id: string;
  first_name: string;
  name: string;
  email: string;
  phone_number: string;
  specialites: {
    nom: string;
    code: string;
  };
}

import { Layout } from '@/components/layout/Layout';

export default function MedecinsPage() {
  const [medecins, setMedecins] = useState<Medecin[]>([]);
  const [loading, setLoading] = useState(true);
  const [searchTerm, setSearchTerm] = useState('');
  const [selectedMedecin, setSelectedMedecin] = useState<Medecin | null>(null);
  const [isDialogOpen, setIsDialogOpen] = useState(false);
  const { toast } = useToast();

  const fetchMedecins = async () => {
    try {
      const { data, error } = await supabase
        .from('medecins')
        .select(`
          id,
          first_name,
          name,
          email,
          phone_number,
          specialites!medecins_specialite_id_fkey (
            nom,
            code
          )
        `);

      if (error) throw error;
      setMedecins(data || []);
    } catch (error) {
      console.error('Erreur lors du chargement des médecins:', error);
      toast({
        title: "Erreur",
        description: "Impossible de charger les médecins",
        variant: "destructive",
      });
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchMedecins();
  }, []);

  const handleDelete = async (medecinId: string) => {
    try {
      const { error } = await supabase
        .from('medecins')
        .delete()
        .eq('id', medecinId);

      if (error) throw error;

      toast({
        title: "Succès",
        description: "Médecin supprimé avec succès",
      });
      
      fetchMedecins();
    } catch (error) {
      console.error('Erreur lors de la suppression:', error);
      toast({
        title: "Erreur",
        description: "Impossible de supprimer le médecin",
        variant: "destructive",
      });
    }
  };

  const filteredMedecins = medecins.filter(medecin =>
    medecin.first_name?.toLowerCase().includes(searchTerm.toLowerCase()) ||
    medecin.name?.toLowerCase().includes(searchTerm.toLowerCase()) ||
    medecin.email?.toLowerCase().includes(searchTerm.toLowerCase()) ||
    medecin.specialites?.nom.toLowerCase().includes(searchTerm.toLowerCase())
  );

  const handleFormSuccess = () => {
    setIsDialogOpen(false);
    setSelectedMedecin(null);
    fetchMedecins();
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
          <h1 className="text-2xl font-bold text-foreground">Gestion des Médecins</h1>
          
          <Dialog open={isDialogOpen} onOpenChange={setIsDialogOpen}>
            <DialogTrigger asChild>
              <Button className="gap-2" onClick={() => setSelectedMedecin(null)}>
                <Plus className="h-4 w-4" />
                Ajouter un médecin
              </Button>
            </DialogTrigger>
            <DialogContent className="max-w-md">
              <DialogHeader>
                <DialogTitle>
                  {selectedMedecin ? 'Modifier le médecin' : 'Ajouter un médecin'}
                </DialogTitle>
              </DialogHeader>
              <MedecinForm 
                medecin={selectedMedecin} 
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
              placeholder="Rechercher un médecin..."
              value={searchTerm}
              onChange={(e) => setSearchTerm(e.target.value)}
              className="pl-10"
            />
          </div>
        </div>

        {/* Médecins Grid */}
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
          {filteredMedecins.map((medecin) => (
            <ModernCard key={medecin.id}>
              <ModernCardHeader>
                <div className="flex items-start justify-between">
                  <div className="flex-1 min-w-0">
                    <ModernCardTitle>
                      {medecin.first_name} {medecin.name}
                    </ModernCardTitle>
                    
                    <div className="space-y-3 mt-4">
                      {medecin.email && (
                        <ContactInfo 
                          icon={<Mail />} 
                          text={medecin.email} 
                        />
                      )}
                      
                      {medecin.phone_number && (
                        <ContactInfo 
                          icon={<Phone />} 
                          text={medecin.phone_number} 
                        />
                      )}
                    </div>
                  </div>
                  
                  <div className="flex space-x-1 ml-3">
                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={() => {
                        setSelectedMedecin(medecin);
                        setIsDialogOpen(true);
                      }}
                      className="opacity-0 group-hover:opacity-100 transition-opacity"
                    >
                      <Edit className="h-4 w-4" />
                    </Button>
                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={() => handleDelete(medecin.id)}
                      className="text-destructive hover:text-destructive opacity-0 group-hover:opacity-100 transition-opacity"
                    >
                      <Trash2 className="h-4 w-4" />
                    </Button>
                  </div>
                </div>
              </ModernCardHeader>
              
              <ModernCardContent>
                <div className="space-y-4">
                  {/* Spécialité */}
                  <div>
                    <p className="text-xs font-medium text-muted-foreground uppercase tracking-wide mb-2">
                      Spécialité
                    </p>
                    <Badge variant="secondary" className="text-xs">
                      {medecin.specialites?.nom}
                    </Badge>
                  </div>
                </div>
              </ModernCardContent>
            </ModernCard>
          ))}
        </div>

        {filteredMedecins.length === 0 && (
          <div className="text-center py-12">
            <p className="text-muted-foreground">
              {searchTerm ? 'Aucun médecin trouvé pour cette recherche' : 'Aucun médecin enregistré'}
            </p>
          </div>
        )}
      </div>
    </Layout>
  );
}