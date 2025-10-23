import { useState, useEffect } from 'react';
import { Edit, CalendarDays, Mail, Phone, ChevronDown } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Switch } from '@/components/ui/switch';
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle, AlertDialogTrigger } from '@/components/ui/alert-dialog';
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '@/components/ui/collapsible';
import { HoraireLineEdit } from './HoraireLineEdit';
import { AddHoraireDialog } from './AddHoraireDialog';
import { Medecin } from './useMedecins';
import { supabase } from '@/integrations/supabase/client';
import { useToast } from '@/hooks/use-toast';

interface MedecinCardProps {
  medecin: Medecin;
  index: number;
  onEdit: (medecin: Medecin) => void;
  onToggleStatus: (id: string, status: boolean) => void;
  onOpenCalendar: (medecin: { id: string; nom: string }) => void;
  canManage: boolean;
}

export function MedecinCard({ medecin, index, onEdit, onToggleStatus, onOpenCalendar, canManage }: MedecinCardProps) {
  const [sites, setSites] = useState<any[]>([]);
  const [typesIntervention, setTypesIntervention] = useState<any[]>([]);
  const [localMedecin, setLocalMedecin] = useState(medecin);
  const [newHoraire, setNewHoraire] = useState<any>(null);
  const [isOpen, setIsOpen] = useState(false);
  const { toast } = useToast();

  useEffect(() => {
    setLocalMedecin(medecin);
  }, [medecin]);

  useEffect(() => {
    fetchData();
  }, []);

  const fetchData = async () => {
    const { data: sitesData } = await supabase
      .from('sites')
      .select('id, nom')
      .eq('actif', true)
      .order('nom');

    const { data: typesData } = await supabase
      .from('types_intervention')
      .select('id, nom')
      .eq('actif', true)
      .order('nom');

    if (sitesData) setSites(sitesData);
    if (typesData) setTypesIntervention(typesData);
  };

  const handleDeleteHoraire = async (horaireId: string) => {
    try {
      const { error } = await supabase
        .from('horaires_base_medecins')
        .delete()
        .eq('id', horaireId);

      if (error) throw error;

      toast({
        title: "Succès",
        description: "Horaire supprimé",
      });

      // Refresh medecin data
      const { data: updatedMedecin } = await supabase
        .from('medecins')
        .select(`
          *,
          specialites!medecins_specialite_id_fkey (nom, code),
          horaires_base_medecins (
            id,
            jour_semaine,
            demi_journee,
            site_id,
            actif,
            alternance_type,
            alternance_semaine_modulo,
            date_debut,
            date_fin,
            sites!horaires_base_medecins_site_id_fkey (nom),
            types_intervention (nom)
          )
        `)
        .eq('id', medecin.id)
        .single();

      if (updatedMedecin) {
        setLocalMedecin(updatedMedecin);
      }
    } catch (error) {
      console.error('Erreur:', error);
      toast({
        title: "Erreur",
        description: "Impossible de supprimer l'horaire",
        variant: "destructive",
      });
    }
  };

  const handleHoraireUpdate = async () => {
    setNewHoraire(null);
    // Refresh medecin data
    const { data: updatedMedecin } = await supabase
      .from('medecins')
      .select(`
        *,
        specialites!medecins_specialite_id_fkey (nom, code),
        horaires_base_medecins (
          id,
          jour_semaine,
          demi_journee,
          site_id,
          actif,
          alternance_type,
          alternance_semaine_modulo,
          date_debut,
          date_fin,
          sites!horaires_base_medecins_site_id_fkey (nom),
          types_intervention (nom)
        )
      `)
      .eq('id', medecin.id)
      .single();

    if (updatedMedecin) {
      setLocalMedecin(updatedMedecin);
    }
  };

  const handleAddNewHoraire = () => {
    setNewHoraire({
      id: 'new',
      jour_semaine: 1,
      demi_journee: 'matin',
      site_id: sites[0]?.id || '',
      type_intervention_id: null,
      alternance_type: 'hebdomadaire',
      alternance_semaine_modulo: 0,
      date_debut: '',
      date_fin: '',
      medecin_id: medecin.id,
      actif: true
    });
  };

  const handleCancelNew = () => {
    setNewHoraire(null);
  };

  return (
    <div 
      className={`
        backdrop-blur-xl bg-card/95 rounded-xl border-2 border-cyan-200/50 dark:border-cyan-800/50
        shadow-lg hover:shadow-xl hover:shadow-cyan-500/20 transition-all duration-300 
        hover:scale-[1.02] hover:-translate-y-1 hover:border-cyan-400/70 dark:hover:border-cyan-600/70
        group relative overflow-hidden
        ${medecin.actif === false ? 'opacity-60' : ''}
      `}
      style={{ animationDelay: `${index * 50}ms` }}
    >
      
      <Collapsible open={isOpen} onOpenChange={setIsOpen} className="relative">
        <div className="relative p-6">
          {/* Header */}
          <div className="flex items-start justify-between mb-2">
            <div className="flex-1">
              <div className="flex items-start gap-2 mb-2">
                <div className="flex flex-col">
                  <span className="text-sm font-medium text-muted-foreground group-hover:text-cyan-600 dark:group-hover:text-cyan-400 transition-colors">
                    {medecin.first_name}
                  </span>
                  <h3 className="text-lg font-semibold text-foreground group-hover:text-cyan-600 dark:group-hover:text-cyan-400 transition-colors leading-tight">
                    {medecin.name}
                  </h3>
                </div>
                {medecin.actif === false && (
                  <Badge variant="secondary" className="text-xs">
                    Inactif
                  </Badge>
                )}
              </div>
              <Badge className="bg-teal-500/10 text-teal-700 dark:text-teal-300 hover:bg-teal-500/20 border-teal-500/20">
                {medecin.specialites?.nom}
              </Badge>
            </div>
            
            <div className="flex items-center gap-2">
              {canManage && (
                <>
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={() => onEdit(medecin)}
                    className="hover:bg-cyan-500/10 hover:text-cyan-600"
                  >
                    <Edit className="h-4 w-4" />
                  </Button>
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => onOpenCalendar({ id: medecin.id, nom: `${medecin.first_name} ${medecin.name}` })}
                    className="hover:bg-cyan-500/10 hover:text-cyan-600 hover:border-cyan-500/50"
                  >
                    <CalendarDays className="h-4 w-4" />
                  </Button>
                </>
              )}
              <CollapsibleTrigger asChild>
                <Button
                  variant="ghost"
                  size="sm"
                  className="hover:bg-cyan-500/10 hover:text-cyan-600"
                >
                  <ChevronDown className={`h-4 w-4 transition-transform duration-200 ${isOpen ? 'rotate-180' : ''}`} />
                </Button>
              </CollapsibleTrigger>
            </div>
          </div>

        <CollapsibleContent className="animate-accordion-down">
          {/* Contact Info */}
          <div className="space-y-3 mb-4 mt-4">
          {medecin.email && (
            <div className="flex items-center space-x-3 text-sm text-muted-foreground group-hover:text-foreground transition-colors">
              <div className="flex-shrink-0 w-8 h-8 rounded-full bg-cyan-500/10 flex items-center justify-center group-hover:bg-cyan-500/20 transition-colors">
                <Mail className="w-3 h-3 text-cyan-600 dark:text-cyan-400" />
              </div>
              <span className="truncate">{medecin.email}</span>
            </div>
          )}
          
          {medecin.phone_number && (
            <div className="flex items-center space-x-3 text-sm text-muted-foreground group-hover:text-foreground transition-colors">
              <div className="flex-shrink-0 w-8 h-8 rounded-full bg-teal-500/10 flex items-center justify-center group-hover:bg-teal-500/20 transition-colors">
                <Phone className="w-3 h-3 text-teal-600 dark:text-teal-400" />
              </div>
              <span className="truncate">{medecin.phone_number}</span>
            </div>
          )}
        </div>

        {/* Jours de travail */}
        <div>
          <p className="text-xs font-medium text-muted-foreground uppercase tracking-wide mb-3">
            Jours de travail
          </p>
          <div className="space-y-2">
            {[1, 2, 3, 4, 5].map((jour) => {
              const jours = ['', 'Lun', 'Mar', 'Mer', 'Jeu', 'Ven'];
              const horairesJour = (localMedecin.horaires_base_medecins?.filter(h => h.jour_semaine === jour) || [])
                .sort((a, b) => {
                  const ordre = { 'matin': 1, 'apres_midi': 2, 'toute_journee': 3 };
                  return (ordre[a.demi_journee] || 4) - (ordre[b.demi_journee] || 4);
                });
              
              return (
                <div key={jour}>
                  {horairesJour.length > 0 && (
                    <div className="space-y-1">
                      {horairesJour.map((h, idx) => (
                        <HoraireLineEdit
                          key={idx}
                          horaire={h}
                          jour={jours[jour]}
                          sites={sites}
                          typesIntervention={typesIntervention}
                          onUpdate={handleHoraireUpdate}
                          onDelete={handleDeleteHoraire}
                        />
                      ))}
                    </div>
                  )}
                </div>
              );
            })}

            {/* New horaire line in edit mode */}
            {newHoraire && (
              <HoraireLineEdit
                horaire={newHoraire}
                jour="Nouveau"
                sites={sites}
                typesIntervention={typesIntervention}
                onUpdate={handleHoraireUpdate}
                onDelete={handleCancelNew}
                isNew={true}
              />
            )}

            {/* Add Button */}
            {canManage && !newHoraire && (
              <div className="pt-2 mt-2 border-t border-border/30">
                <AddHoraireDialog onAddNew={handleAddNewHoraire} />
              </div>
            )}
          </div>
        </div>

        {/* Status Toggle */}
        {canManage && (
          <div className="mt-4 pt-4 border-t border-border/50 flex items-center justify-between">
            <span className="text-sm text-muted-foreground">Statut</span>
            {medecin.actif !== false ? (
              <AlertDialog>
                <AlertDialogTrigger asChild>
                  <div className="flex items-center space-x-2">
                    <Switch
                      checked={true}
                      className="data-[state=checked]:bg-cyan-600"
                    />
                  </div>
                </AlertDialogTrigger>
                <AlertDialogContent>
                  <AlertDialogHeader>
                    <AlertDialogTitle>Confirmer la désactivation</AlertDialogTitle>
                    <AlertDialogDescription>
                      Êtes-vous sûr de vouloir passer ce médecin en inactif ?
                    </AlertDialogDescription>
                  </AlertDialogHeader>
                  <AlertDialogFooter>
                    <AlertDialogCancel>Annuler</AlertDialogCancel>
                    <AlertDialogAction 
                      onClick={() => onToggleStatus(medecin.id, true)}
                      className="bg-muted text-muted-foreground hover:bg-muted/90"
                    >
                      Passer en inactif
                    </AlertDialogAction>
                  </AlertDialogFooter>
                </AlertDialogContent>
              </AlertDialog>
            ) : (
              <div className="flex items-center space-x-2">
                <Switch
                  checked={false}
                  onCheckedChange={() => onToggleStatus(medecin.id, false)}
                  className="data-[state=unchecked]:bg-muted"
                />
              </div>
            )}
          </div>
        )}
        </CollapsibleContent>
        </div>
      </Collapsible>
    </div>
  );
}
