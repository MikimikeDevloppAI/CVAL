import { useState, useEffect } from 'react';
import { Plus, Edit, Search, Calendar as CalendarIcon, Trash2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from '@/components/ui/dialog';
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle } from '@/components/ui/alert-dialog';
import { ModernCard, ModernCardHeader, ModernCardContent, ModernCardTitle } from '@/components/ui/modern-card';
import { supabase } from '@/integrations/supabase/client';
import { useToast } from '@/hooks/use-toast';
import { useCanManagePlanning } from '@/hooks/useCanManagePlanning';
import { format } from 'date-fns';
import { fr } from 'date-fns/locale';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import * as z from 'zod';
import { Form, FormControl, FormField, FormItem, FormLabel, FormMessage } from '@/components/ui/form';

const jourFerieSchema = z.object({
  nom: z.string().min(1, "Le nom est requis"),
  date: z.string().min(1, "Veuillez sélectionner une date"),
});

type JourFerieFormData = z.infer<typeof jourFerieSchema>;

interface JourFerie {
  id: string;
  date: string;
  nom: string;
  actif: boolean;
  created_at: string;
}

export default function JoursFeriesPage() {
  const [joursFeries, setJoursFeries] = useState<JourFerie[]>([]);
  const [loading, setLoading] = useState(true);
  const [searchTerm, setSearchTerm] = useState('');
  const [selectedJourFerie, setSelectedJourFerie] = useState<JourFerie | null>(null);
  const [jourFerieToDelete, setJourFerieToDelete] = useState<JourFerie | null>(null);
  const [isDialogOpen, setIsDialogOpen] = useState(false);
  const { toast } = useToast();
  const { canManage } = useCanManagePlanning();

  const form = useForm<JourFerieFormData>({
    resolver: zodResolver(jourFerieSchema),
    defaultValues: {
      date: '',
      nom: '',
    },
  });

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
      setJoursFeries([]);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchJoursFeries();
  }, []);

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

  const filteredJoursFeries = joursFeries.filter(jf => {
    const searchLower = searchTerm.toLowerCase();
    return (
      jf.nom.toLowerCase().includes(searchLower) ||
      format(new Date(jf.date), 'dd MMMM yyyy', { locale: fr }).toLowerCase().includes(searchLower)
    );
  });

  const onSubmit = async (data: JourFerieFormData) => {
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

      setIsDialogOpen(false);
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

  const handleDelete = async () => {
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

  if (loading) {
    return (
      <div className="flex items-center justify-center h-64">
        <div className="text-muted-foreground">Chargement...</div>
      </div>
    );
  }

  return (
    <div className="container mx-auto py-6 space-y-6">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-bold text-foreground">Gestion des Jours Fériés</h1>
        
        {canManage && (
          <Dialog open={isDialogOpen} onOpenChange={(open) => {
            setIsDialogOpen(open);
            if (!open) {
              setSelectedJourFerie(null);
              form.reset();
            }
          }}>
            <DialogTrigger asChild>
              <Button className="gap-2">
                <Plus className="h-4 w-4" />
                Ajouter un jour férié
              </Button>
            </DialogTrigger>
            <DialogContent className="max-w-md">
              <DialogHeader>
                <DialogTitle>
                  {selectedJourFerie ? 'Modifier le jour férié' : 'Ajouter un jour férié'}
                </DialogTitle>
              </DialogHeader>
              
              <Form {...form}>
                <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-4">
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
                        setIsDialogOpen(false);
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
        )}
      </div>

      {/* Search */}
      <div className="relative max-w-md">
        <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
        <Input
          placeholder="Rechercher un jour férié..."
          value={searchTerm}
          onChange={(e) => setSearchTerm(e.target.value)}
          className="pl-10"
        />
      </div>

      {/* Jours Fériés Grid */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
        {filteredJoursFeries.map((jourFerie) => (
          <ModernCard key={jourFerie.id} className="group">
            <ModernCardHeader>
              <div className="flex items-start justify-between">
                <div className="flex-1 min-w-0">
                  <ModernCardTitle>{jourFerie.nom}</ModernCardTitle>
                  <div className="flex items-center gap-2 text-sm text-muted-foreground mt-2">
                    <CalendarIcon className="h-3 w-3" />
                    <span>
                      {format(new Date(jourFerie.date), 'dd MMMM yyyy', { locale: fr })}
                    </span>
                  </div>
                </div>
                
                {canManage && (
                  <div className="flex gap-1">
                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={() => {
                        setSelectedJourFerie(jourFerie);
                        setIsDialogOpen(true);
                      }}
                      className="opacity-0 group-hover:opacity-100 transition-opacity"
                    >
                      <Edit className="h-4 w-4" />
                    </Button>
                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={() => setJourFerieToDelete(jourFerie)}
                      className="opacity-0 group-hover:opacity-100 transition-opacity text-destructive hover:text-destructive"
                    >
                      <Trash2 className="h-4 w-4" />
                    </Button>
                  </div>
                )}
              </div>
            </ModernCardHeader>
          </ModernCard>
        ))}
      </div>

      {filteredJoursFeries.length === 0 && (
        <div className="text-center py-12">
          <p className="text-muted-foreground">
            {searchTerm ? 'Aucun jour férié trouvé pour cette recherche' : 'Aucun jour férié enregistré'}
          </p>
        </div>
      )}

      {/* Delete confirmation dialog */}
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
            <AlertDialogAction onClick={handleDelete} className="bg-destructive text-destructive-foreground hover:bg-destructive/90">
              Supprimer
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}