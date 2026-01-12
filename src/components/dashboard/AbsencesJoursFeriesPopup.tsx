import { useState, useEffect } from 'react';
import { Plus, Edit, Search, Calendar, Trash2, CalendarOff, CalendarX, User } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { PrimaryButton, TabButton } from '@/components/ui/primary-button';
import { Input } from '@/components/ui/input';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Badge } from '@/components/ui/badge';
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
  embedded?: boolean;
}

const jourFerieSchema = z.object({
  nom: z.string().min(1, "Le nom est requis"),
  date: z.string().min(1, "Veuillez sélectionner une date"),
});

type JourFerieFormData = z.infer<typeof jourFerieSchema>;

export const AbsencesJoursFeriesPopup = ({ open, onOpenChange, onAbsenceChange, embedded = false }: AbsencesJoursFeriesPopupProps) => {
  const [absences, setAbsences] = useState<Absence[]>([]);
  const [joursFeries, setJoursFeries] = useState<JourFerie[]>([]);
  const [loading, setLoading] = useState(true);
  const [searchTerm, setSearchTerm] = useState('');
  const [activeTab, setActiveTab] = useState<'absences' | 'jours-feries'>('absences');
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
    if (open || embedded) {
      setLoading(true);
      Promise.all([fetchAbsences(), fetchJoursFeries()]).finally(() => setLoading(false));
    }
  }, [open, embedded]);

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

      let lastGroupForPerson: Absence | null = null;

      for (const absence of sorted) {
        if (lastGroupForPerson &&
            absence.type === lastGroupForPerson.type &&
            absence.statut === lastGroupForPerson.statut &&
            absence.demi_journee === lastGroupForPerson.demi_journee) {

          const lastEndDate = new Date(lastGroupForPerson.date_fin);
          const currentStartDate = new Date(absence.date_debut);
          lastEndDate.setHours(0, 0, 0, 0);
          currentStartDate.setHours(0, 0, 0, 0);

          const dayDiff = Math.floor((currentStartDate.getTime() - lastEndDate.getTime()) / (1000 * 60 * 60 * 24));

          if (dayDiff <= 1) {
            lastGroupForPerson.date_fin = absence.date_fin;
            continue;
          }
        }

        const newGroup = { ...absence };
        grouped.push(newGroup);
        lastGroupForPerson = newGroup;
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
      let query = supabase
        .from('absences')
        .delete()
        .eq('type_personne', absenceToDelete.type_personne as 'medecin' | 'secretaire')
        .eq('type', absenceToDelete.type as 'conges' | 'maladie' | 'formation' | 'autre' | 'conge_maternite')
        .eq('statut', absenceToDelete.statut as 'en_attente' | 'approuve' | 'refuse')
        .gte('date_debut', absenceToDelete.date_debut)
        .lte('date_fin', absenceToDelete.date_fin);

      if (absenceToDelete.medecin_id) {
        query = query.eq('medecin_id', absenceToDelete.medecin_id);
      } else if (absenceToDelete.secretaire_id) {
        query = query.eq('secretaire_id', absenceToDelete.secretaire_id);
      }

      if (absenceToDelete.demi_journee) {
        query = query.eq('demi_journee', absenceToDelete.demi_journee as 'matin' | 'apres_midi' | 'toute_journee');
      }

      const { error } = await query;

      if (error) throw error;

      toast({
        title: "Succès",
        description: "Absence(s) supprimée(s) avec succès",
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

  const getTypeBadgeColor = (type: string) => {
    const colors: Record<string, string> = {
      conges: 'bg-blue-500/10 text-blue-700 dark:text-blue-300 border-blue-500/20',
      maladie: 'bg-red-500/10 text-red-700 dark:text-red-300 border-red-500/20',
      formation: 'bg-purple-500/10 text-purple-700 dark:text-purple-300 border-purple-500/20',
      conge_maternite: 'bg-pink-500/10 text-pink-700 dark:text-pink-300 border-pink-500/20',
      autre: 'bg-gray-500/10 text-gray-700 dark:text-gray-300 border-gray-500/20',
    };
    return colors[type] || 'bg-muted text-muted-foreground border-border';
  };

  // Absence Card Component
  const AbsenceCard = ({ absence, index }: { absence: Absence; index: number }) => {
    const person = absence.type_personne === 'medecin' ? absence.medecins : absence.secretaires;
    const personName = person ? `${person.first_name} ${person.name}` : 'Inconnu';
    const isMedecin = absence.type_personne === 'medecin';

    return (
      <div
        className="backdrop-blur-xl bg-card/95 rounded-2xl border border-border/50 shadow-sm hover:shadow-xl hover:shadow-primary/5 transition-all duration-300 hover:scale-[1.02] hover:-translate-y-1 hover:border-primary/30 group relative overflow-hidden"
        style={{ animationDelay: `${index * 50}ms` }}
      >
        <div className="absolute inset-0 bg-gradient-to-br from-primary/5 via-transparent to-transparent opacity-0 group-hover:opacity-100 transition-opacity duration-300" />

        <div className="relative p-5">
          {/* Header */}
          <div className="flex items-start justify-between gap-3">
            <div className="flex items-start gap-4 flex-1 min-w-0">
              {/* Avatar - teal/emerald pour médecins, cyan/blue pour assistants */}
              <div className={`w-12 h-12 rounded-xl bg-gradient-to-br ${isMedecin ? 'from-teal-500 to-emerald-600 shadow-teal-500/20 group-hover:shadow-teal-500/30' : 'from-cyan-500 to-blue-600 shadow-cyan-500/20 group-hover:shadow-cyan-500/30'} flex items-center justify-center shrink-0 shadow-md group-hover:shadow-lg transition-shadow`}>
                <User className="h-6 w-6 text-white" />
              </div>

              <div className="flex-1 min-w-0">
                <h3 className="text-base font-semibold text-foreground group-hover:text-primary transition-colors leading-tight">
                  {personName}
                </h3>
                <div className="flex gap-2 flex-wrap mt-2">
                  <Badge variant="outline" className="text-xs">
                    {absence.type_personne === 'medecin' ? 'Médecin' : 'Assistant médical'}
                  </Badge>
                  <Badge className={`text-xs ${getTypeBadgeColor(absence.type)}`}>
                    {getTypeLabel(absence.type)}
                  </Badge>
                </div>
              </div>
            </div>

            {/* Actions */}
            {canManage && (
              <div className="flex gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() => {
                    setSelectedAbsence(absence);
                    setIsAbsenceDialogOpen(true);
                  }}
                  className="h-8 w-8 p-0 hover:bg-primary/10 hover:text-primary"
                >
                  <Edit className="h-4 w-4" />
                </Button>
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() => setAbsenceToDelete(absence)}
                  className="h-8 w-8 p-0 text-destructive hover:text-destructive hover:bg-destructive/10"
                >
                  <Trash2 className="h-4 w-4" />
                </Button>
              </div>
            )}
          </div>

          {/* Content */}
          <div className="mt-4 pt-4 border-t border-border/30 space-y-3">
            <div className="flex items-center gap-3">
              <div className="w-8 h-8 rounded-lg bg-primary/10 flex items-center justify-center shrink-0">
                <Calendar className="h-4 w-4 text-primary" />
              </div>
              <div>
                <p className="text-xs text-muted-foreground">Période</p>
                <p className="text-sm font-medium">
                  {format(new Date(absence.date_debut), 'dd MMM', { locale: fr })} - {format(new Date(absence.date_fin), 'dd MMM yyyy', { locale: fr })}
                </p>
              </div>
            </div>

            {absence.demi_journee && absence.demi_journee !== 'toute_journee' && (
              <Badge variant="outline" className="text-xs">
                {absence.demi_journee === 'matin' ? 'Matin uniquement' : 'Après-midi uniquement'}
              </Badge>
            )}

            {absence.motif && (
              <div className="pt-2">
                <p className="text-xs text-muted-foreground mb-1">Motif</p>
                <p className="text-sm">{absence.motif}</p>
              </div>
            )}
          </div>
        </div>
      </div>
    );
  };

  // Jour Férié Card Component
  const JourFerieCard = ({ jourFerie, index }: { jourFerie: JourFerie; index: number }) => (
    <div
      className="backdrop-blur-xl bg-card/95 rounded-2xl border border-border/50 shadow-sm hover:shadow-xl hover:shadow-primary/5 transition-all duration-300 hover:scale-[1.02] hover:-translate-y-1 hover:border-primary/30 group relative overflow-hidden"
      style={{ animationDelay: `${index * 50}ms` }}
    >
      <div className="absolute inset-0 bg-gradient-to-br from-primary/5 via-transparent to-transparent opacity-0 group-hover:opacity-100 transition-opacity duration-300" />

      <div className="relative p-5">
        {/* Header */}
        <div className="flex items-start justify-between gap-3">
          <div className="flex items-start gap-4 flex-1 min-w-0">
            {/* Avatar */}
            <div className="w-12 h-12 rounded-xl bg-gradient-to-br from-teal-500 to-emerald-600 flex items-center justify-center shrink-0 shadow-md shadow-teal-500/20 group-hover:shadow-lg group-hover:shadow-teal-500/30 transition-shadow">
              <Calendar className="h-6 w-6 text-white" />
            </div>

            <div className="flex-1 min-w-0">
              <h3 className="text-base font-semibold text-foreground group-hover:text-primary transition-colors leading-tight">
                {jourFerie.nom}
              </h3>
              <p className="text-sm text-muted-foreground mt-1">
                {format(new Date(jourFerie.date), 'EEEE dd MMMM yyyy', { locale: fr })}
              </p>
            </div>
          </div>

          {/* Actions */}
          {canManage && (
            <div className="flex gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
              <Button
                variant="ghost"
                size="sm"
                onClick={() => {
                  setSelectedJourFerie(jourFerie);
                  setIsJourFerieDialogOpen(true);
                }}
                className="h-8 w-8 p-0 hover:bg-primary/10 hover:text-primary"
              >
                <Edit className="h-4 w-4" />
              </Button>
              <Button
                variant="ghost"
                size="sm"
                onClick={() => setJourFerieToDelete(jourFerie)}
                className="h-8 w-8 p-0 text-destructive hover:text-destructive hover:bg-destructive/10"
              >
                <Trash2 className="h-4 w-4" />
              </Button>
            </div>
          )}
        </div>
      </div>
    </div>
  );

  // Empty State Component
  const EmptyState = ({ type }: { type: 'absences' | 'jours-feries' }) => (
    <div className="flex flex-col items-center justify-center py-16 text-center">
      <div className="w-20 h-20 rounded-2xl bg-gradient-to-br from-teal-500/10 to-emerald-500/10 flex items-center justify-center mb-5">
        {type === 'absences' ? (
          <CalendarX className="w-10 h-10 text-teal-600/60 dark:text-teal-400/60" />
        ) : (
          <Calendar className="w-10 h-10 text-teal-600/60 dark:text-teal-400/60" />
        )}
      </div>
      <h3 className="text-lg font-semibold text-foreground mb-2">
        {type === 'absences' ? 'Aucune absence trouvée' : 'Aucun jour férié trouvé'}
      </h3>
      <p className="text-sm text-muted-foreground max-w-md">
        {searchTerm
          ? 'Essayez de modifier vos critères de recherche'
          : type === 'absences'
            ? 'Aucune absence à venir enregistrée'
            : 'Commencez par ajouter un jour férié'}
      </p>
    </div>
  );

  // Loading State
  const LoadingState = () => (
    <div className="flex items-center justify-center py-16">
      <div className="flex items-center gap-3 text-muted-foreground">
        <div className="w-5 h-5 border-2 border-primary border-t-transparent rounded-full animate-spin" />
        <span className="text-sm font-medium">Chargement...</span>
      </div>
    </div>
  );

  const content = (
    <div className="flex flex-col flex-1 min-h-0">
      {/* Tabs + Search + Button Row */}
      <div className="flex flex-col md:flex-row items-stretch md:items-center gap-4 mb-6 shrink-0">
        {/* Tabs */}
        <div className="flex gap-2 p-1 rounded-xl bg-muted/50 backdrop-blur-sm border border-border/30 shrink-0">
          <TabButton
            active={activeTab === 'absences'}
            onClick={() => setActiveTab('absences')}
            icon={<CalendarX className="h-4 w-4" />}
          >
            Absences
          </TabButton>
          <TabButton
            active={activeTab === 'jours-feries'}
            onClick={() => setActiveTab('jours-feries')}
            icon={<Calendar className="h-4 w-4" />}
          >
            Jours Fériés
          </TabButton>
        </div>

        {/* Search */}
        <div className="relative flex-1">
          <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
          <Input
            placeholder={activeTab === 'absences' ? "Rechercher une absence..." : "Rechercher un jour férié..."}
            value={searchTerm}
            onChange={(e) => setSearchTerm(e.target.value)}
            className="pl-10 h-11 rounded-xl border-border/50 bg-background/50 focus:bg-background transition-colors"
          />
        </div>

        {/* Add Button */}
        {canManage && (
          <PrimaryButton
            onClick={() => {
              if (activeTab === 'absences') {
                setSelectedAbsence(null);
                setIsAbsenceDialogOpen(true);
              } else {
                setSelectedJourFerie(null);
                setIsJourFerieDialogOpen(true);
              }
            }}
          >
            <Plus className="h-4 w-4" />
            <span className="hidden sm:inline">
              {activeTab === 'absences' ? 'Déclarer une absence' : 'Ajouter un jour férié'}
            </span>
          </PrimaryButton>
        )}
      </div>

      {/* Content Area */}
      <div className="flex-1 overflow-y-auto overflow-x-visible min-h-0 -mx-2 px-2 pt-2 pb-2">
        {loading ? (
          <LoadingState />
        ) : activeTab === 'absences' ? (
          filteredAbsences.length === 0 ? (
            <EmptyState type="absences" />
          ) : (
            <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-5 animate-fade-in">
              {filteredAbsences.map((absence, index) => (
                <AbsenceCard key={absence.id} absence={absence} index={index} />
              ))}
            </div>
          )
        ) : (
          filteredJoursFeries.length === 0 ? (
            <EmptyState type="jours-feries" />
          ) : (
            <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-5 animate-fade-in">
              {filteredJoursFeries.map((jourFerie, index) => (
                <JourFerieCard key={jourFerie.id} jourFerie={jourFerie} index={index} />
              ))}
            </div>
          )
        )}
      </div>
    </div>
  );

  // Dialogs (shared between embedded and dialog mode)
  const dialogs = (
    <>
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
              Êtes-vous sûr de vouloir supprimer cette absence ? Cette action est irréversible.
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
              Êtes-vous sûr de vouloir supprimer ce jour férié ?
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

  if (embedded) {
    return (
      <>
        <div className="bg-card/50 backdrop-blur-xl border border-border/50 shadow-xl rounded-2xl p-6 h-[calc(100vh-48px)] flex flex-col">
          <h1 className="text-2xl font-bold mb-6 shrink-0">Gestion des Absences</h1>
          {content}
        </div>
        {dialogs}
      </>
    );
  }

  return (
    <>
      <Dialog open={open} onOpenChange={onOpenChange}>
        <DialogContent className="max-w-[98vw] w-[98vw] max-h-[95vh] overflow-hidden flex flex-col p-0">
          <DialogHeader className="px-6 pt-4 pb-3 border-b border-border/50">
            <DialogTitle className="text-2xl font-bold">
              Gestion des Absences
            </DialogTitle>
          </DialogHeader>

          <div className="flex-1 overflow-hidden px-6 pt-4 pb-6 flex flex-col">
            {content}
          </div>
        </DialogContent>
      </Dialog>
      {dialogs}
    </>
  );
};
