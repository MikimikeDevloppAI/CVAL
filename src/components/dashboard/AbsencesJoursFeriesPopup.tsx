import { useState, useEffect } from 'react';
import { Plus, Edit, Search, Calendar, Trash2, CalendarOff, X } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Badge } from '@/components/ui/badge';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle } from '@/components/ui/alert-dialog';
import { AbsenceForm } from '@/components/absences/AbsenceForm';
import { supabase } from '@/integrations/supabase/client';
import { useToast } from '@/hooks/use-toast';
import { useCanManagePlanning } from '@/hooks/useCanManagePlanning';
import { format } from 'date-fns';
import { fr } from 'date-fns/locale';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import * as z from 'zod';
import { Form, FormControl, FormField, FormItem, FormLabel, FormMessage } from '@/components/ui/form';

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
  demi_journee?: string;
  medecins?: {
    first_name: string;
    name: string;
  };
  secretaires?: {
    first_name: string;
    name: string;
  };
}

interface JourFerie {
  id: string;
  date: string;
  nom: string;
  actif: boolean;
}

interface AbsencesJoursFeriesPopupProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onAbsenceChange?: () => void;
}

const jourFerieSchema = z.object({
  nom: z.string().min(1, "Le nom est requis"),
  date: z.string().min(1, "Veuillez sélectionner une date"),
});

type JourFerieFormData = z.infer<typeof jourFerieSchema>;

export const AbsencesJoursFeriesPopup = ({ open, onOpenChange, onAbsenceChange }: AbsencesJoursFeriesPopupProps) => {
  const [absences, setAbsences] = useState<Absence[]>([]);
  const [joursFeries, setJoursFeries] = useState<JourFerie[]>([]);
  const [loading, setLoading] = useState(true);
  const [searchTerm, setSearchTerm] = useState('');
  const [selectedAbsence, setSelectedAbsence] = useState<Absence | null>(null);
  const [selectedJourFerie, setSelectedJourFerie] = useState<JourFerie | null>(null);
  const [absenceToDelete, setAbsenceToDelete] = useState<Absence | null>(null);
  const [jourFerieToDelete, setJourFerieToDelete] = useState<JourFerie | null>(null);
  const [isAbsenceDialogOpen, setIsAbsenceDialogOpen] = useState(false);
  const [isJourFerieDialogOpen, setIsJourFerieDialogOpen] = useState(false);
  const { toast } = useToast();
  const { canManage } = useCanManagePlanning();

  const form = useForm<JourFerieFormData>({
    resolver: zodResolver(jourFerieSchema),
    defaultValues: {
      date: '',
      nom: '',
    },
  });

  const fetchAbsences = async () => {
    try {
      const { data, error } = await supabase
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
          demi_journee,
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

      if (error) throw error;
      setAbsences(data || []);
    } catch (error) {
      console.error('Erreur lors du chargement des absences:', error);
      toast({
        title: "Erreur",
        description: "Impossible de charger les absences",
        variant: "destructive",
      });
    }
  };

  const fetchJoursFeries = async () => {
    try {
      const { data, error } = await supabase
        .from('jours_feries')
        .select('*')
        .eq('actif', true)
        .order('date', { ascending: true });

      if (error) throw error;
      setJoursFeries(data || []);
    } catch (error) {
      console.error('Erreur lors du chargement des jours fériés:', error);
      toast({
        title: "Erreur",
        description: "Impossible de charger les jours fériés",
        variant: "destructive",
      });
    }
  };

  useEffect(() => {
    if (open) {
      setLoading(true);
      Promise.all([fetchAbsences(), fetchJoursFeries()]).finally(() => setLoading(false));
    }
  }, [open]);

  useEffect(() => {
    if (selectedJourFerie) {
      form.reset({
        date: selectedJourFerie.date,
        nom: selectedJourFerie.nom,
      });
    } else {
      form.reset({
        date: '',
        nom: '',
      });
    }
  }, [selectedJourFerie, form]);

  // Group consecutive absences
  const groupConsecutiveAbsences = (absences: Absence[]) => {
    const byPerson = new Map<string, Absence[]>();
    
    absences.forEach(absence => {
      const personKey = `${absence.type_personne}_${absence.medecin_id || absence.secretaire_id}`;
      if (!byPerson.has(personKey)) {
        byPerson.set(personKey, []);
      }
      byPerson.get(personKey)!.push(absence);
    });

    const grouped: Absence[] = [];
    
    byPerson.forEach(personAbsences => {
      const sorted = personAbsences.sort((a, b) => 
        new Date(a.date_debut).getTime() - new Date(b.date_debut).getTime()
      );

      for (const absence of sorted) {
        const lastGroup = grouped[grouped.length - 1];
        
        if (lastGroup && 
            absence.type_personne === lastGroup.type_personne &&
            absence.medecin_id === lastGroup.medecin_id &&
            absence.secretaire_id === lastGroup.secretaire_id &&
            absence.type === lastGroup.type &&
            absence.statut === lastGroup.statut &&
            absence.demi_journee === lastGroup.demi_journee) {
          
          const lastEndDate = new Date(lastGroup.date_fin);
          const currentStartDate = new Date(absence.date_debut);
          lastEndDate.setHours(0, 0, 0, 0);
          currentStartDate.setHours(0, 0, 0, 0);
          
          const dayDiff = Math.floor((currentStartDate.getTime() - lastEndDate.getTime()) / (1000 * 60 * 60 * 24));
          
          if (dayDiff === 1) {
            lastGroup.date_fin = absence.date_fin;
            continue;
          }
        }
        
        grouped.push({ ...absence });
      }
    });
    
    return grouped.sort((a, b) => 
      new Date(b.date_debut).getTime() - new Date(a.date_debut).getTime()
    );
  };

  const filteredAbsences = groupConsecutiveAbsences(absences).filter(absence => {
    const person = absence.type_personne === 'medecin' ? absence.medecins : absence.secretaires;
    if (!person) return false;
    
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

  const filteredJoursFeries = joursFeries.filter(jf => {
    const searchLower = searchTerm.toLowerCase();
    return (
      jf.nom.toLowerCase().includes(searchLower) ||
      format(new Date(jf.date), 'dd MMMM yyyy', { locale: fr }).toLowerCase().includes(searchLower)
    );
  });

  const handleAbsenceFormSuccess = () => {
    setIsAbsenceDialogOpen(false);
    setSelectedAbsence(null);
    fetchAbsences();
    onAbsenceChange?.();
  };

  const handleAbsenceDelete = async () => {
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
      onAbsenceChange?.();
    } catch (error) {
      console.error('Erreur lors de la suppression:', error);
      toast({
        title: "Erreur",
        description: "Impossible de supprimer l'absence",
        variant: "destructive",
      });
    }
  };

  const onJourFerieSubmit = async (data: JourFerieFormData) => {
    try {
      if (selectedJourFerie) {
        const { error } = await supabase
          .from('jours_feries')
          .update({
            date: data.date,
            nom: data.nom,
          })
          .eq('id', selectedJourFerie.id);

        if (error) throw error;

        toast({
          title: "Succès",
          description: "Jour férié modifié avec succès",
        });
      } else {
        const { error } = await supabase
          .from('jours_feries')
          .insert({
            date: data.date,
            nom: data.nom,
          });

        if (error) throw error;

        toast({
          title: "Succès",
          description: "Jour férié ajouté avec succès",
        });
      }

      setIsJourFerieDialogOpen(false);
      setSelectedJourFerie(null);
      form.reset();
      fetchJoursFeries();
    } catch (error) {
      console.error('Erreur lors de l\'enregistrement:', error);
      toast({
        title: "Erreur",
        description: "Impossible d'enregistrer le jour férié",
        variant: "destructive",
      });
    }
  };

  const handleJourFerieDelete = async () => {
    if (!jourFerieToDelete) return;

    try {
      const { error } = await supabase
        .from('jours_feries')
        .delete()
        .eq('id', jourFerieToDelete.id);

      if (error) throw error;

      toast({
        title: "Succès",
        description: "Jour férié supprimé avec succès",
      });

      setJourFerieToDelete(null);
      fetchJoursFeries();
    } catch (error) {
      console.error('Erreur lors de la suppression:', error);
      toast({
        title: "Erreur",
        description: "Impossible de supprimer le jour férié",
        variant: "destructive",
      });
    }
  };

  const getTypeLabel = (type: string) => {
    const labels: Record<string, string> = {
      conges: 'Congé',
      maladie: 'Maladie',
      formation: 'Formation',
      conge_maternite: 'Congé maternité',
      autre: 'Autre',
    };
    return labels[type] || type;
  };

  return (
    <>
      <Dialog open={open} onOpenChange={onOpenChange}>
        <DialogContent className="max-w-6xl w-full max-h-[90vh] overflow-hidden flex flex-col backdrop-blur-xl bg-background/95 border-border/50">
          <DialogHeader className="border-b border-border/50 pb-4">
            <div className="flex items-center justify-between">
              <DialogTitle className="text-2xl font-bold flex items-center gap-2">
                <CalendarOff className="h-6 w-6 text-primary" />
                Gestion des Absences & Jours Fériés
              </DialogTitle>
            </div>
          </DialogHeader>

          <Tabs defaultValue="absences" className="flex-1 flex flex-col overflow-hidden">
            <TabsList className="grid w-full grid-cols-2 mb-4">
              <TabsTrigger value="absences" className="data-[state=active]:bg-background">
                Absences
              </TabsTrigger>
              <TabsTrigger value="jours-feries" className="data-[state=active]:bg-background">
                Jours Fériés
              </TabsTrigger>
            </TabsList>

            {/* Absences Tab */}
            <TabsContent value="absences" className="flex-1 flex flex-col space-y-4 overflow-hidden mt-0">
              <div className="flex flex-col sm:flex-row gap-3 pt-1 px-1">
                <div className="relative flex-1">
                  <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
                  <Input
                    placeholder="Rechercher une absence..."
                    value={searchTerm}
                    onChange={(e) => setSearchTerm(e.target.value)}
                    className="pl-10 bg-card/50 backdrop-blur-sm border-border/50"
                  />
                </div>
                {canManage && (
                  <Button
                    className="gap-2"
                    onClick={() => {
                      setSelectedAbsence(null);
                      setIsAbsenceDialogOpen(true);
                    }}
                  >
                    <Plus className="h-4 w-4" />
                    Déclarer une absence
                  </Button>
                )}
              </div>

              <div className="flex-1 overflow-y-auto pr-2">
                {loading ? (
                  <div className="flex items-center justify-center py-12">
                    <div className="text-muted-foreground">Chargement...</div>
                  </div>
                ) : (
                  <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4 animate-fade-in p-1">
                    {filteredAbsences.map((absence, idx) => (
                      <div
                        key={absence.id}
                        className="backdrop-blur-xl bg-card/95 rounded-xl border-2 border-primary/20 dark:border-primary/30 shadow-lg hover:shadow-xl hover:shadow-primary/10 transition-all duration-300 hover:-translate-y-1 hover:border-primary/40 dark:hover:border-primary/50 group"
                        style={{ animationDelay: `${idx * 50}ms` }}
                      >
                        <div className="p-5">
                          <div className="flex items-start justify-between mb-4">
                            <div className="flex-1 min-w-0">
                              <h4 className="text-lg font-semibold text-foreground group-hover:text-primary transition-colors mb-2">
                                {absence.type_personne === 'medecin' 
                                  ? `${absence.medecins?.first_name} ${absence.medecins?.name}`
                                  : `${absence.secretaires?.first_name} ${absence.secretaires?.name}`
                                }
                              </h4>
                              <div className="flex gap-2 flex-wrap">
                                <Badge className="bg-muted text-muted-foreground hover:bg-muted/80 border-border text-xs">
                                  {absence.type_personne === 'medecin' ? 'Médecin' : 'Assistant médical'}
                                </Badge>
                                <Badge className="bg-accent/50 text-accent-foreground hover:bg-accent/60 border-accent/30 text-xs">
                                  {getTypeLabel(absence.type)}
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
                                    setIsAbsenceDialogOpen(true);
                                  }}
                                  className="opacity-0 group-hover:opacity-100 transition-opacity hover:bg-primary/10 hover:text-primary"
                                >
                                  <Edit className="h-4 w-4" />
                                </Button>
                                <Button
                                  variant="ghost"
                                  size="sm"
                                  onClick={() => setAbsenceToDelete(absence)}
                                  className="opacity-0 group-hover:opacity-100 transition-opacity text-destructive hover:text-destructive hover:bg-destructive/10"
                                >
                                  <Trash2 className="h-4 w-4" />
                                </Button>
                              </div>
                            )}
                          </div>

                          <div className="space-y-3">
                            <div className="flex items-center space-x-3 text-sm text-muted-foreground group-hover:text-foreground transition-colors">
                              <div className="flex-shrink-0 w-8 h-8 rounded-full bg-primary/10 flex items-center justify-center group-hover:bg-primary/20 transition-colors">
                                <Calendar className="w-3 h-3 text-primary" />
                              </div>
                              <div className="flex-1">
                                <p className="text-xs font-medium text-muted-foreground mb-0.5">Période</p>
                                <p className="text-sm font-medium">
                              {format(new Date(absence.date_debut), 'dd MMM', { locale: fr })} - {format(new Date(absence.date_fin), 'dd MMM yyyy', { locale: fr })}
                            </p>
                          </div>
                        </div>

                        {absence.demi_journee && absence.demi_journee !== 'toute_journee' && (
                          <Badge variant="outline" className="text-xs">
                            {absence.demi_journee === 'matin' ? 'Matin' : 'Après-midi'}
                          </Badge>
                        )}

                        {absence.motif && (
                              <div className="pt-3 border-t border-border/50">
                                <p className="text-xs font-medium text-muted-foreground uppercase tracking-wide mb-1">
                                  Motif
                                </p>
                                <p className="text-sm">{absence.motif}</p>
                              </div>
                            )}
                          </div>
                        </div>
                      </div>
                    ))}
                  </div>
                )}

                {!loading && filteredAbsences.length === 0 && (
                  <div className="text-center py-12">
                    <p className="text-muted-foreground">
                      {searchTerm ? 'Aucune absence trouvée pour cette recherche' : 'Aucune absence enregistrée'}
                    </p>
                  </div>
                )}
              </div>
            </TabsContent>

            {/* Jours Fériés Tab */}
            <TabsContent value="jours-feries" className="flex-1 flex flex-col space-y-4 overflow-hidden mt-0">
              <div className="flex flex-col sm:flex-row gap-3 pt-1 px-1">
                <div className="relative flex-1">
                  <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
                  <Input
                    placeholder="Rechercher un jour férié..."
                    value={searchTerm}
                    onChange={(e) => setSearchTerm(e.target.value)}
                    className="pl-10 bg-card/50 backdrop-blur-sm border-border/50"
                  />
                </div>
                {canManage && (
                  <Button
                    className="gap-2"
                    onClick={() => {
                      setSelectedJourFerie(null);
                      setIsJourFerieDialogOpen(true);
                    }}
                  >
                    <Plus className="h-4 w-4" />
                    Ajouter un jour férié
                  </Button>
                )}
              </div>

              <div className="flex-1 overflow-y-auto pr-2">
                {loading ? (
                  <div className="flex items-center justify-center py-12">
                    <div className="text-muted-foreground">Chargement...</div>
                  </div>
                ) : (
                  <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4 animate-fade-in p-1">
                    {filteredJoursFeries.map((jourFerie, idx) => (
                      <div
                        key={jourFerie.id}
                        className="backdrop-blur-xl bg-card/95 rounded-xl border-2 border-primary/20 dark:border-primary/30 shadow-lg hover:shadow-xl hover:shadow-primary/10 transition-all duration-300 hover:-translate-y-1 hover:border-primary/40 dark:hover:border-primary/50 group"
                        style={{ animationDelay: `${idx * 50}ms` }}
                      >
                        <div className="p-5">
                          <div className="flex items-start justify-between mb-4">
                            <div className="flex-1 min-w-0">
                              <h4 className="text-lg font-semibold text-foreground group-hover:text-primary transition-colors">
                                {jourFerie.nom}
                              </h4>
                            </div>
                            
                            {canManage && (
                              <div className="flex gap-1">
                                <Button
                                  variant="ghost"
                                  size="sm"
                                  onClick={() => {
                                    setSelectedJourFerie(jourFerie);
                                    setIsJourFerieDialogOpen(true);
                                  }}
                                  className="opacity-0 group-hover:opacity-100 transition-opacity hover:bg-primary/10 hover:text-primary"
                                >
                                  <Edit className="h-4 w-4" />
                                </Button>
                                <Button
                                  variant="ghost"
                                  size="sm"
                                  onClick={() => setJourFerieToDelete(jourFerie)}
                                  className="opacity-0 group-hover:opacity-100 transition-opacity text-destructive hover:text-destructive hover:bg-destructive/10"
                                >
                                  <Trash2 className="h-4 w-4" />
                                </Button>
                              </div>
                            )}
                          </div>
                          
                          <div className="flex items-center space-x-3 text-sm text-muted-foreground group-hover:text-foreground transition-colors">
                            <div className="flex-shrink-0 w-8 h-8 rounded-full bg-primary/10 flex items-center justify-center group-hover:bg-primary/20 transition-colors">
                              <Calendar className="w-3 h-3 text-primary" />
                            </div>
                            <div className="flex-1">
                              <p className="text-xs font-medium text-muted-foreground mb-0.5">Date</p>
                              <p className="text-sm font-medium">
                                {format(new Date(jourFerie.date), 'dd MMMM yyyy', { locale: fr })}
                              </p>
                            </div>
                          </div>
                        </div>
                      </div>
                    ))}
                  </div>
                )}

                {!loading && filteredJoursFeries.length === 0 && (
                  <div className="text-center py-12">
                    <p className="text-muted-foreground">
                      {searchTerm ? 'Aucun jour férié trouvé pour cette recherche' : 'Aucun jour férié enregistré'}
                    </p>
                  </div>
                )}
              </div>
            </TabsContent>
          </Tabs>
        </DialogContent>
      </Dialog>

      {/* Absence Form Dialog */}
      <Dialog open={isAbsenceDialogOpen} onOpenChange={setIsAbsenceDialogOpen}>
        <DialogContent className="max-w-2xl w-full max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>
              {selectedAbsence ? 'Modifier l\'absence' : 'Déclarer une absence'}
            </DialogTitle>
          </DialogHeader>
          <AbsenceForm 
            absence={selectedAbsence} 
            onSuccess={handleAbsenceFormSuccess}
          />
        </DialogContent>
      </Dialog>

      {/* Jour Férié Form Dialog */}
      <Dialog open={isJourFerieDialogOpen} onOpenChange={(open) => {
        setIsJourFerieDialogOpen(open);
        if (!open) {
          setSelectedJourFerie(null);
          form.reset();
        }
      }}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>
              {selectedJourFerie ? 'Modifier le jour férié' : 'Ajouter un jour férié'}
            </DialogTitle>
          </DialogHeader>
        
          <Form {...form}>
            <form onSubmit={form.handleSubmit(onJourFerieSubmit)} className="space-y-4">
              <FormField
                control={form.control}
                name="nom"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Nom</FormLabel>
                    <FormControl>
                      <Input placeholder="Ex: Noël" {...field} />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />

              <FormField
                control={form.control}
                name="date"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Date</FormLabel>
                    <FormControl>
                      <Input type="date" {...field} />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />

              <div className="flex justify-end gap-2">
                <Button
                  type="button"
                  variant="outline"
                  onClick={() => {
                    setIsJourFerieDialogOpen(false);
                    setSelectedJourFerie(null);
                    form.reset();
                  }}
                >
                  Annuler
                </Button>
                <Button type="submit">
                  {selectedJourFerie ? 'Modifier' : 'Ajouter'}
                </Button>
              </div>
            </form>
          </Form>
        </DialogContent>
      </Dialog>

      {/* Absence Delete Confirmation */}
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
            <AlertDialogAction onClick={handleAbsenceDelete} className="bg-destructive text-destructive-foreground hover:bg-destructive/90">
              Supprimer
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      {/* Jour Férié Delete Confirmation */}
      <AlertDialog open={!!jourFerieToDelete} onOpenChange={() => setJourFerieToDelete(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Confirmer la suppression</AlertDialogTitle>
            <AlertDialogDescription>
              Êtes-vous sûr de vouloir supprimer ce jour férié ? Les besoins et capacités pour cette date seront automatiquement régénérés.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Annuler</AlertDialogCancel>
            <AlertDialogAction onClick={handleJourFerieDelete} className="bg-destructive text-destructive-foreground hover:bg-destructive/90">
              Supprimer
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
};