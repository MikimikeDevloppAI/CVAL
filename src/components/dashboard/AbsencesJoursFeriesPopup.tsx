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
  heure_debut?: string;
  heure_fin?: string;
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
}

const jourFerieSchema = z.object({
  nom: z.string().min(1, "Le nom est requis"),
  date: z.string().min(1, "Veuillez sélectionner une date"),
});

type JourFerieFormData = z.infer<typeof jourFerieSchema>;

export const AbsencesJoursFeriesPopup = ({ open, onOpenChange }: AbsencesJoursFeriesPopupProps) => {
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
          heure_debut,
          heure_fin,
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
            absence.heure_debut === lastGroup.heure_debut &&
            absence.heure_fin === lastGroup.heure_fin) {
          
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
            <TabsList className="grid w-full grid-cols-2 mb-4 bg-card/50 backdrop-blur-sm border border-border/50 p-1">
              <TabsTrigger 
                value="absences" 
                className="data-[state=active]:bg-gradient-to-r data-[state=active]:from-red-500 data-[state=active]:to-orange-500 data-[state=active]:text-white data-[state=active]:shadow-lg transition-all"
              >
                Absences
              </TabsTrigger>
              <TabsTrigger 
                value="jours-feries" 
                className="data-[state=active]:bg-gradient-to-r data-[state=active]:from-green-500 data-[state=active]:to-emerald-500 data-[state=active]:text-white data-[state=active]:shadow-lg transition-all"
              >
                Jours Fériés
              </TabsTrigger>
            </TabsList>

            {/* Absences Tab */}
            <TabsContent value="absences" className="flex-1 flex flex-col space-y-4 overflow-hidden mt-0">
              <div className="flex flex-col sm:flex-row gap-3">
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
                    className="gap-2 bg-gradient-to-r from-red-500 to-orange-500 hover:from-red-600 hover:to-orange-600 text-white border-0 shadow-lg hover:shadow-xl transition-all hover:scale-105"
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
                  <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4 animate-fade-in">
                    {filteredAbsences.map((absence, idx) => (
                      <div
                        key={absence.id}
                        className="group relative overflow-hidden rounded-xl bg-card/50 backdrop-blur-xl border border-border/50 shadow-lg hover:shadow-xl transition-all duration-300 hover:-translate-y-1"
                        style={{ animationDelay: `${idx * 50}ms` }}
                      >
                        {/* Gradient Glow */}
                        <div className="absolute -top-10 -right-10 w-32 h-32 rounded-full blur-3xl opacity-20 bg-gradient-to-br from-red-500 to-orange-500" />
                        
                        {/* Header */}
                        <div className="relative p-5 border-b border-border/50 bg-gradient-to-r from-primary/5 to-transparent">
                          <div className="flex items-start justify-between">
                            <div className="flex-1 min-w-0">
                              <h4 className="font-bold text-lg text-foreground mb-2">
                                {absence.type_personne === 'medecin' 
                                  ? `${absence.medecins?.first_name} ${absence.medecins?.name}`
                                  : `${absence.secretaires?.first_name} ${absence.secretaires?.name}`
                                }
                              </h4>
                              <div className="flex gap-2 flex-wrap">
                                <Badge 
                                  className="text-xs bg-gradient-to-r from-cyan-500 to-blue-500 text-white border-0"
                                >
                                  {absence.type_personne === 'medecin' ? 'Médecin' : 'Secrétaire'}
                                </Badge>
                                <Badge 
                                  variant="outline" 
                                  className="text-xs bg-primary/10 text-primary border-primary/20"
                                >
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
                                  className="opacity-0 group-hover:opacity-100 transition-all hover:bg-primary/10 hover:scale-110"
                                >
                                  <Edit className="h-4 w-4" />
                                </Button>
                                <Button
                                  variant="ghost"
                                  size="sm"
                                  onClick={() => setAbsenceToDelete(absence)}
                                  className="opacity-0 group-hover:opacity-100 transition-all text-destructive hover:text-destructive hover:bg-destructive/10 hover:scale-110"
                                >
                                  <Trash2 className="h-4 w-4" />
                                </Button>
                              </div>
                            )}
                          </div>
                        </div>
                        
                        {/* Content */}
                        <div className="relative p-5 space-y-4">
                          <div className="flex items-center gap-3">
                            <div className="p-2 rounded-lg bg-gradient-to-br from-cyan-500/10 to-blue-500/10">
                              <Calendar className="h-4 w-4 text-cyan-600" />
                            </div>
                            <div className="flex-1">
                              <p className="text-xs font-medium text-muted-foreground mb-0.5">
                                Période
                              </p>
                              <p className="text-sm font-medium">
                                {format(new Date(absence.date_debut), 'dd MMM', { locale: fr })} - {format(new Date(absence.date_fin), 'dd MMM yyyy', { locale: fr })}
                              </p>
                              {absence.heure_debut && absence.heure_fin && (
                                <Badge variant="outline" className="mt-1 text-xs">
                                  {absence.heure_debut.slice(0, 5)} - {absence.heure_fin.slice(0, 5)}
                                </Badge>
                              )}
                            </div>
                          </div>

                          {absence.motif && (
                            <div className="pt-3 border-t border-border/50">
                              <p className="text-xs font-medium text-muted-foreground mb-1">
                                Motif
                              </p>
                              <p className="text-sm text-foreground/80">{absence.motif}</p>
                            </div>
                          )}
                        </div>
                      </div>
                    ))}
                  </div>
                )}

                {!loading && filteredAbsences.length === 0 && (
                  <div className="text-center py-16">
                    <div className="inline-flex p-4 rounded-full bg-gradient-to-br from-red-500/10 to-orange-500/10 mb-4">
                      <CalendarOff className="h-12 w-12 text-red-500" />
                    </div>
                    <p className="text-lg font-medium text-foreground mb-2">
                      {searchTerm ? 'Aucune absence trouvée' : 'Aucune absence enregistrée'}
                    </p>
                    <p className="text-sm text-muted-foreground">
                      {searchTerm ? 'Essayez avec d\'autres mots-clés' : 'Commencez par déclarer une absence'}
                    </p>
                  </div>
                )}
              </div>
            </TabsContent>

            {/* Jours Fériés Tab */}
            <TabsContent value="jours-feries" className="flex-1 flex flex-col space-y-4 overflow-hidden mt-0">
              <div className="flex flex-col sm:flex-row gap-3">
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
                    className="gap-2 bg-gradient-to-r from-green-500 to-emerald-500 hover:from-green-600 hover:to-emerald-600 text-white border-0 shadow-lg hover:shadow-xl transition-all hover:scale-105"
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
                  <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4 animate-fade-in">
                    {filteredJoursFeries.map((jourFerie, idx) => (
                      <div
                        key={jourFerie.id}
                        className="group relative overflow-hidden rounded-xl bg-card/50 backdrop-blur-xl border border-border/50 shadow-lg hover:shadow-xl transition-all duration-300 hover:-translate-y-1"
                        style={{ animationDelay: `${idx * 50}ms` }}
                      >
                        {/* Gradient Glow */}
                        <div className="absolute -top-10 -right-10 w-32 h-32 rounded-full blur-3xl opacity-20 bg-gradient-to-br from-green-500 to-emerald-500" />
                        
                        {/* Content */}
                        <div className="relative p-5">
                          <div className="flex items-start justify-between mb-4">
                            <div className="flex-1 min-w-0">
                              <h4 className="font-bold text-lg text-foreground mb-3">
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
                                  className="opacity-0 group-hover:opacity-100 transition-all hover:bg-primary/10 hover:scale-110"
                                >
                                  <Edit className="h-4 w-4" />
                                </Button>
                                <Button
                                  variant="ghost"
                                  size="sm"
                                  onClick={() => setJourFerieToDelete(jourFerie)}
                                  className="opacity-0 group-hover:opacity-100 transition-all text-destructive hover:text-destructive hover:bg-destructive/10 hover:scale-110"
                                >
                                  <Trash2 className="h-4 w-4" />
                                </Button>
                              </div>
                            )}
                          </div>
                          
                          <div className="flex items-center gap-3 p-3 rounded-lg bg-gradient-to-r from-green-500/10 to-emerald-500/10 border border-green-500/20">
                            <div className="p-2 rounded-lg bg-gradient-to-br from-green-500 to-emerald-500 shadow-lg">
                              <Calendar className="h-4 w-4 text-white" />
                            </div>
                            <div className="flex-1">
                              <p className="text-xs font-medium text-muted-foreground mb-0.5">
                                Date
                              </p>
                              <p className="text-sm font-bold text-foreground">
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
                  <div className="text-center py-16">
                    <div className="inline-flex p-4 rounded-full bg-gradient-to-br from-green-500/10 to-emerald-500/10 mb-4">
                      <Calendar className="h-12 w-12 text-green-500" />
                    </div>
                    <p className="text-lg font-medium text-foreground mb-2">
                      {searchTerm ? 'Aucun jour férié trouvé' : 'Aucun jour férié enregistré'}
                    </p>
                    <p className="text-sm text-muted-foreground">
                      {searchTerm ? 'Essayez avec d\'autres mots-clés' : 'Commencez par ajouter un jour férié'}
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
        <DialogContent className="max-w-2xl w-full max-h-[90vh] overflow-y-auto backdrop-blur-xl bg-background/95 border-border/50">
          <DialogHeader className="border-b border-border/50 pb-4">
            <DialogTitle className="text-xl font-bold flex items-center gap-2">
              <div className="p-2 rounded-lg bg-gradient-to-br from-red-500 to-orange-500">
                <CalendarOff className="h-5 w-5 text-white" />
              </div>
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
        <DialogContent className="max-w-md backdrop-blur-xl bg-background/95 border-border/50">
          <DialogHeader className="border-b border-border/50 pb-4">
            <DialogTitle className="text-xl font-bold flex items-center gap-2">
              <div className="p-2 rounded-lg bg-gradient-to-br from-green-500 to-emerald-500">
                <Calendar className="h-5 w-5 text-white" />
              </div>
              {selectedJourFerie ? 'Modifier le jour férié' : 'Ajouter un jour férié'}
            </DialogTitle>
          </DialogHeader>
        
          <Form {...form}>
            <form onSubmit={form.handleSubmit(onJourFerieSubmit)} className="space-y-5 pt-2">
              <FormField
                control={form.control}
                name="nom"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel className="text-sm font-semibold">Nom du jour férié</FormLabel>
                    <FormControl>
                      <Input 
                        placeholder="Ex: Noël, Jour de l'An..." 
                        {...field}
                        className="bg-card/50 backdrop-blur-sm border-border/50"
                      />
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
                    <FormLabel className="text-sm font-semibold">Date</FormLabel>
                    <FormControl>
                      <Input 
                        type="date" 
                        {...field}
                        className="bg-card/50 backdrop-blur-sm border-border/50"
                      />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />

              <div className="flex justify-end gap-2 pt-4 border-t border-border/50">
                <Button
                  type="button"
                  variant="outline"
                  onClick={() => {
                    setIsJourFerieDialogOpen(false);
                    setSelectedJourFerie(null);
                    form.reset();
                  }}
                  className="hover:bg-muted/50"
                >
                  Annuler
                </Button>
                <Button 
                  type="submit"
                  className="bg-gradient-to-r from-green-500 to-emerald-500 hover:from-green-600 hover:to-emerald-600 text-white border-0 shadow-lg"
                >
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