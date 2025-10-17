import { useState, useEffect } from 'react';
import { Plus, Edit, Search, Calendar, Trash2, CalendarOff } from 'lucide-react';
import { PageHeader } from '@/components/ui/page-header';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from '@/components/ui/dialog';
import { Badge } from '@/components/ui/badge';
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle } from '@/components/ui/alert-dialog';
import { ModernCard, ModernCardHeader, ModernCardContent, ModernCardTitle } from '@/components/ui/modern-card';
import { AbsenceForm } from '@/components/absences/AbsenceForm';
import { supabase } from '@/integrations/supabase/client';
import { useToast } from '@/hooks/use-toast';
import { useCanManagePlanning } from '@/hooks/useCanManagePlanning';
import { format } from 'date-fns';
import { fr } from 'date-fns/locale';

interface Absence {
  id: string;
  type_personne: 'medecin' | 'secretaire';
  medecin_id?: string;
  secretaire_id?: string;
  type: string;
  date_debut: string;
  date_fin: string;
  motif?: string;
  statut: string;
  heure_debut?: string;
  heure_fin?: string;
  created_at?: string;
  medecins?: {
    first_name: string;
    name: string;
  };
  secretaires?: {
    first_name: string;
    name: string;
  };
}

export default function AbsencesPage() {
  const [absences, setAbsences] = useState<Absence[]>([]);
  const [loading, setLoading] = useState(true);
  const [searchTerm, setSearchTerm] = useState('');
  const [selectedAbsence, setSelectedAbsence] = useState<Absence | null>(null);
  const [absenceToDelete, setAbsenceToDelete] = useState<Absence | null>(null);
  const [isDialogOpen, setIsDialogOpen] = useState(false);
  const { toast } = useToast();
  const { canManage } = useCanManagePlanning();

  const fetchAbsences = async () => {
    try {
      const { data: absencesData, error: absencesError } = await supabase
        .from('absences')
        .select(`
          id,
          type_personne,
          medecin_id,
          secretaire_id,
          type,
          date_debut,
          date_fin,
          motif,
          statut,
          heure_debut,
          heure_fin,
          created_at,
          medecins:medecin_id (
            first_name,
            name
          ),
          secretaires:secretaire_id (
            first_name,
            name
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

  // Group consecutive absences together by person
  const groupConsecutiveAbsences = (absences: Absence[]) => {
    // First, group by person
    const byPerson = new Map<string, Absence[]>();
    
    absences.forEach(absence => {
      const personKey = `${absence.type_personne}_${absence.medecin_id || absence.secretaire_id}`;
      if (!byPerson.has(personKey)) {
        byPerson.set(personKey, []);
      }
      byPerson.get(personKey)!.push(absence);
    });

    // Then, merge consecutive absences for each person
    const grouped: Absence[] = [];
    
    byPerson.forEach(personAbsences => {
      const sorted = personAbsences.sort((a, b) => 
        new Date(a.date_debut).getTime() - new Date(b.date_debut).getTime()
      );

      for (const absence of sorted) {
        const lastGroup = grouped[grouped.length - 1];
        
        // Check if this absence can be merged with the last group
        if (lastGroup && 
            absence.type_personne === lastGroup.type_personne &&
            absence.medecin_id === lastGroup.medecin_id &&
            absence.secretaire_id === lastGroup.secretaire_id &&
            absence.type === lastGroup.type &&
            absence.statut === lastGroup.statut &&
            absence.heure_debut === lastGroup.heure_debut &&
            absence.heure_fin === lastGroup.heure_fin) {
          
          const lastEndDate = new Date(lastGroup.date_fin);
          const currentStartDate = new Date(absence.date_debut);
          lastEndDate.setHours(0, 0, 0, 0);
          currentStartDate.setHours(0, 0, 0, 0);
          
          const dayDiff = Math.floor((currentStartDate.getTime() - lastEndDate.getTime()) / (1000 * 60 * 60 * 24));
          
          // If absences are consecutive (1 day apart), merge them
          if (dayDiff === 1) {
            lastGroup.date_fin = absence.date_fin;
            continue;
          }
        }
        
        // Otherwise, add as a new group
        grouped.push({ ...absence });
      }
    });
    
    // Return sorted by date_debut descending (most recent first)
    return grouped.sort((a, b) => 
      new Date(b.date_debut).getTime() - new Date(a.date_debut).getTime()
    );
  };

  const filteredAbsences = groupConsecutiveAbsences(absences).filter(absence => {
    const person = absence.type_personne === 'medecin' ? absence.medecins : absence.secretaires;
    if (!person) return false;
    
    // Filter out past absences (date_fin is in the past)
    const dateFin = new Date(absence.date_fin);
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    if (dateFin < today) return false;
    
    const searchLower = searchTerm.toLowerCase();
    return (
      person.first_name?.toLowerCase().includes(searchLower) ||
      person.name?.toLowerCase().includes(searchLower) ||
      absence.type.toLowerCase().includes(searchLower) ||
      absence.motif?.toLowerCase().includes(searchLower)
    );
  });

  const handleFormSuccess = () => {
    setIsDialogOpen(false);
    setSelectedAbsence(null);
    fetchAbsences();
  };

  const handleDelete = async () => {
    if (!absenceToDelete) return;

    try {
      const { error } = await supabase
        .from('absences')
        .delete()
        .eq('id', absenceToDelete.id);

      if (error) throw error;

      toast({
        title: "Succès",
        description: "Absence supprimée avec succès",
      });

      setAbsenceToDelete(null);
      fetchAbsences();
    } catch (error) {
      console.error('Erreur lors de la suppression:', error);
      toast({
        title: "Erreur",
        description: "Impossible de supprimer l'absence",
        variant: "destructive",
      });
    }
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
      <div className="flex items-center justify-center h-64">
        <div className="text-muted-foreground">Chargement...</div>
      </div>
    );
  }

  return (
    <div className="container mx-auto py-6 space-y-6">
      <PageHeader 
        title="Gestion des Absences" 
        icon={CalendarOff}
        action={
          canManage ? (
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
          ) : undefined
        }
      />

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
                      {absence.type_personne === 'medecin' 
                        ? `${absence.medecins?.first_name} ${absence.medecins?.name}`
                        : `${absence.secretaires?.first_name} ${absence.secretaires?.name}`
                      }
                    </ModernCardTitle>
                    <div className="flex gap-2 flex-wrap mt-2">
                      <Badge variant="secondary" className="text-xs">
                        {absence.type_personne === 'medecin' ? 'Médecin' : 'Secrétaire'}
                      </Badge>
                    </div>
                  </div>
                  
                  {canManage && (
                    <div className="flex gap-1">
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
                      <Button
                        variant="ghost"
                        size="sm"
                        onClick={() => setAbsenceToDelete(absence)}
                        className="opacity-0 group-hover:opacity-100 transition-opacity text-destructive hover:text-destructive"
                      >
                        <Trash2 className="h-4 w-4" />
                      </Button>
                    </div>
                  )}
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
                      <Calendar className="h-3 w-3" />
                      <span>
                        {format(new Date(absence.date_debut), 'dd MMM yyyy', { locale: fr })} - {format(new Date(absence.date_fin), 'dd MMM yyyy', { locale: fr })}
                      </span>
                    </div>
                    {absence.heure_debut && absence.heure_fin && (
                      <Badge variant="outline" className="mt-2">
                        {absence.heure_debut.slice(0, 5)} - {absence.heure_fin.slice(0, 5)}
                      </Badge>
                    )}
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

        {/* Delete confirmation dialog */}
        <AlertDialog open={!!absenceToDelete} onOpenChange={() => setAbsenceToDelete(null)}>
          <AlertDialogContent>
            <AlertDialogHeader>
              <AlertDialogTitle>Confirmer la suppression</AlertDialogTitle>
              <AlertDialogDescription>
                Êtes-vous sûr de vouloir supprimer cette absence ? Cette action est irréversible et les capacités/besoins seront régénérés automatiquement.
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
