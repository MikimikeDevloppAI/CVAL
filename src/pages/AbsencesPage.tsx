import { useState, useEffect } from 'react';
import { Plus, Edit, Search, Calendar as CalendarIcon } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from '@/components/ui/dialog';
import { Badge } from '@/components/ui/badge';
import { ModernCard, ModernCardHeader, ModernCardContent, ModernCardTitle } from '@/components/ui/modern-card';
import { AbsenceForm } from '@/components/absences/AbsenceForm';
import { supabase } from '@/integrations/supabase/client';
import { useToast } from '@/hooks/use-toast';
import { Layout } from '@/components/layout/Layout';
import { format } from 'date-fns';
import { fr } from 'date-fns/locale';

interface Absence {
  id: string;
  profile_id: string;
  type: string;
  date_debut: string;
  date_fin: string;
  motif?: string;
  statut: string;
  created_at?: string;
  profiles?: {
    prenom: string;
    nom: string;
    role: string;
  };
}

export default function AbsencesPage() {
  const [absences, setAbsences] = useState<Absence[]>([]);
  const [loading, setLoading] = useState(true);
  const [searchTerm, setSearchTerm] = useState('');
  const [selectedAbsence, setSelectedAbsence] = useState<Absence | null>(null);
  const [isDialogOpen, setIsDialogOpen] = useState(false);
  const { toast } = useToast();

  const fetchAbsences = async () => {
    try {
      const { data: absencesData, error: absencesError } = await supabase
        .from('absences')
        .select(`
          id,
          profile_id,
          type,
          date_debut,
          date_fin,
          motif,
          statut,
          created_at,
          profiles:profile_id (
            prenom,
            nom,
            role
          )
        `)
        .order('date_debut', { ascending: false });

      if (absencesError) throw absencesError;
      setAbsences(absencesData || []);
    } catch (error) {
      console.error('Erreur lors du chargement des absences:', error);
      toast({
        title: "Erreur",
        description: "Impossible de charger les absences",
        variant: "destructive",
      });
      setAbsences([]);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchAbsences();
  }, []);

  const filteredAbsences = absences.filter(absence => {
    if (!absence.profiles) return false;
    
    const searchLower = searchTerm.toLowerCase();
    return (
      absence.profiles.prenom?.toLowerCase().includes(searchLower) ||
      absence.profiles.nom?.toLowerCase().includes(searchLower) ||
      absence.type.toLowerCase().includes(searchLower) ||
      absence.motif?.toLowerCase().includes(searchLower)
    );
  });

  const handleFormSuccess = () => {
    setIsDialogOpen(false);
    setSelectedAbsence(null);
    fetchAbsences();
  };

  const getTypeLabel = (type: string) => {
    const labels: Record<string, string> = {
      conges: 'Congé',
      maladie: 'Maladie',
      formation: 'Formation',
      autre: 'Autre',
    };
    return labels[type] || type;
  };

  const getStatutLabel = (statut: string) => {
    const labels: Record<string, string> = {
      en_attente: 'En attente',
      approuve: 'Approuvée',
      refuse: 'Refusée',
    };
    return labels[statut] || statut;
  };

  const getStatutVariant = (statut: string): "default" | "secondary" | "destructive" => {
    const variants: Record<string, "default" | "secondary" | "destructive"> = {
      en_attente: 'secondary',
      approuve: 'default',
      refuse: 'destructive',
    };
    return variants[statut] || 'secondary';
  };

  if (loading) {
    return (
      <Layout>
        <div className="flex items-center justify-center h-64">
          <div className="text-muted-foreground">Chargement...</div>
        </div>
      </Layout>
    );
  }

  return (
    <Layout>
      <div className="container mx-auto py-6 space-y-6">
        <div className="flex items-center justify-between">
          <h1 className="text-2xl font-bold text-foreground">Gestion des Absences</h1>
          
          <Dialog open={isDialogOpen} onOpenChange={setIsDialogOpen}>
            <DialogTrigger asChild>
              <Button className="gap-2" onClick={() => setSelectedAbsence(null)}>
                <Plus className="h-4 w-4" />
                Déclarer une absence
              </Button>
            </DialogTrigger>
            <DialogContent className="max-w-2xl w-full max-h-[90vh] overflow-y-auto">
              <DialogHeader>
                <DialogTitle>
                  {selectedAbsence ? 'Modifier l\'absence' : 'Déclarer une absence'}
                </DialogTitle>
              </DialogHeader>
              <AbsenceForm 
                absence={selectedAbsence} 
                onSuccess={handleFormSuccess}
              />
            </DialogContent>
          </Dialog>
        </div>

        {/* Search */}
        <div className="relative max-w-md">
          <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
          <Input
            placeholder="Rechercher une absence..."
            value={searchTerm}
            onChange={(e) => setSearchTerm(e.target.value)}
            className="pl-10"
          />
        </div>

        {/* Absences Grid */}
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
          {filteredAbsences.map((absence) => (
            <ModernCard key={absence.id}>
              <ModernCardHeader>
                <div className="flex items-start justify-between">
                  <div className="flex-1 min-w-0">
                    <ModernCardTitle>
                      {absence.profiles?.prenom} {absence.profiles?.nom}
                    </ModernCardTitle>
                    <div className="flex gap-2 flex-wrap mt-2">
                      <Badge variant="secondary" className="text-xs">
                        {absence.profiles?.role === 'medecin' ? 'Médecin' : 'Secrétaire'}
                      </Badge>
                      <Badge variant={getStatutVariant(absence.statut)} className="text-xs">
                        {getStatutLabel(absence.statut)}
                      </Badge>
                    </div>
                  </div>
                  
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={() => {
                      setSelectedAbsence(absence);
                      setIsDialogOpen(true);
                    }}
                    className="opacity-0 group-hover:opacity-100 transition-opacity"
                  >
                    <Edit className="h-4 w-4" />
                  </Button>
                </div>
              </ModernCardHeader>
              
              <ModernCardContent>
                <div className="space-y-3">
                  <div>
                    <p className="text-xs font-medium text-muted-foreground uppercase tracking-wide mb-1">
                      Type
                    </p>
                    <p className="text-sm">{getTypeLabel(absence.type)}</p>
                  </div>

                  <div>
                    <p className="text-xs font-medium text-muted-foreground uppercase tracking-wide mb-1">
                      Période
                    </p>
                    <div className="flex items-center gap-2 text-sm">
                      <CalendarIcon className="h-3 w-3" />
                      <span>
                        {format(new Date(absence.date_debut), 'dd MMM yyyy', { locale: fr })} - {format(new Date(absence.date_fin), 'dd MMM yyyy', { locale: fr })}
                      </span>
                    </div>
                  </div>

                  {absence.motif && (
                    <div>
                      <p className="text-xs font-medium text-muted-foreground uppercase tracking-wide mb-1">
                        Motif
                      </p>
                      <p className="text-sm">{absence.motif}</p>
                    </div>
                  )}
                </div>
              </ModernCardContent>
            </ModernCard>
          ))}
        </div>

        {filteredAbsences.length === 0 && (
          <div className="text-center py-12">
            <p className="text-muted-foreground">
              {searchTerm ? 'Aucune absence trouvée pour cette recherche' : 'Aucune absence enregistrée'}
            </p>
          </div>
        )}
      </div>
    </Layout>
  );
}
