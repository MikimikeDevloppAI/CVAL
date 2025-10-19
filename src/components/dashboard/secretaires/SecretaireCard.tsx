import { useState, useEffect } from 'react';
import { Edit, CalendarDays, Mail, Phone, MapPin, Stethoscope, Briefcase, Plus } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Switch } from '@/components/ui/switch';
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle, AlertDialogTrigger } from '@/components/ui/alert-dialog';
import { HoraireSecretaireLineEdit } from './HoraireSecretaireLineEdit';
import { AddHoraireSecretaireDialog } from './AddHoraireSecretaireDialog';
import { QuickEditSitesDialog } from '@/components/secretaires/QuickEditSitesDialog';
import { QuickEditMedecinDialog } from '@/components/secretaires/QuickEditMedecinDialog';
import type { Secretaire } from './useSecretaires';
import { supabase } from '@/integrations/supabase/client';
import { useToast } from '@/hooks/use-toast';

interface SecretaireCardProps {
  secretaire: Secretaire;
  index: number;
  onEdit: (secretaire: Secretaire) => void;
  onToggleStatus: (secretaireId: string, currentStatus: boolean, skipConfirmation?: boolean) => void;
  onOpenCalendar: (secretaire: { id: string; nom: string }) => void;
  onSuccess: () => void;
  canManage: boolean;
}

export function SecretaireCard({ 
  secretaire,
  index,
  onEdit, 
  onToggleStatus, 
  onOpenCalendar,
  onSuccess,
  canManage 
}: SecretaireCardProps) {
  const [sites, setSites] = useState<any[]>([]);
  const [localSecretaire, setLocalSecretaire] = useState(secretaire);
  const { toast } = useToast();

  useEffect(() => {
    setLocalSecretaire(secretaire);
  }, [secretaire]);

  useEffect(() => {
    fetchData();
  }, []);

  const fetchData = async () => {
    const { data: sitesData } = await supabase
      .from('sites')
      .select('id, nom')
      .eq('actif', true)
      .not('nom', 'ilike', '%bloc opératoire%')
      .order('nom');

    if (sitesData) setSites(sitesData);
  };

  const handleDeleteHoraire = async (horaireId: string) => {
    try {
      const { error } = await supabase
        .from('horaires_base_secretaires')
        .delete()
        .eq('id', horaireId);

      if (error) throw error;

      toast({
        title: "Succès",
        description: "Horaire supprimé",
      });

      await handleHoraireUpdate();
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
    onSuccess();
    
    // Refresh local secretaire data
    const { data: updatedSecretaire } = await supabase
      .from('secretaires')
      .select(`
        *,
        horaires_base_secretaires (
          id,
          jour_semaine,
          demi_journee,
          site_id,
          actif,
          alternance_type,
          alternance_semaine_modulo,
          sites (nom)
        )
      `)
      .eq('id', secretaire.id)
      .single();

    if (updatedSecretaire) {
      setLocalSecretaire(prev => ({
        ...prev,
        horaires_base_secretaires: updatedSecretaire.horaires_base_secretaires
      }));
    }
  };

  const nomComplet = `${secretaire.first_name || ''} ${secretaire.name || ''}`.trim() || 
    `Secrétaire ${secretaire.id.slice(0, 8)}`;

  return (
    <div 
      className={`
        backdrop-blur-xl bg-card/95 rounded-xl border-2 border-teal-200/50 dark:border-teal-800/50
        shadow-lg hover:shadow-xl hover:shadow-teal-500/20 transition-all duration-300 
        hover:scale-[1.02] hover:-translate-y-1 hover:border-teal-400/70 dark:hover:border-teal-600/70
        group relative overflow-hidden
        ${secretaire.actif === false ? 'opacity-60' : ''}
      `}
      style={{ animationDelay: `${index * 50}ms` }}
    >
      <div className="relative p-6">
        {/* Header */}
        <div className="flex items-start justify-between mb-4">
          <div className="flex-1">
            <div className="flex items-center gap-2 flex-wrap mb-2">
              <h3 className="text-lg font-semibold text-foreground group-hover:text-teal-600 dark:group-hover:text-teal-400 transition-colors">
                {nomComplet}
              </h3>
              {secretaire.actif === false && (
                <Badge variant="secondary" className="text-xs">
                  Inactif
                </Badge>
              )}
              {secretaire.horaire_flexible && (
                <Badge className="bg-blue-500/10 text-blue-700 dark:text-blue-300 hover:bg-blue-500/20 border-blue-500/20 text-xs">
                  Flexible {secretaire.pourcentage_temps && `(${secretaire.pourcentage_temps}%)`}
                </Badge>
              )}
              {secretaire.flexible_jours_supplementaires && (
                <Badge className="bg-amber-500/10 text-amber-700 dark:text-amber-300 hover:bg-amber-500/20 border-amber-500/20 text-xs">
                  +{secretaire.nombre_jours_supplementaires || 1}j
                </Badge>
              )}
            </div>
          </div>
          
          {canManage && (
            <div className="flex items-center gap-2">
              <Button
                variant="ghost"
                size="sm"
                onClick={() => onEdit(secretaire)}
                className="opacity-0 group-hover:opacity-100 transition-opacity hover:bg-teal-500/10 hover:text-teal-600"
              >
                <Edit className="h-4 w-4" />
              </Button>
              <Button
                variant="outline"
                size="sm"
                onClick={() => onOpenCalendar({ id: secretaire.id, nom: nomComplet })}
                className="hover:bg-teal-500/10 hover:text-teal-600 hover:border-teal-500/50"
              >
                <CalendarDays className="h-4 w-4" />
              </Button>
            </div>
          )}
        </div>

        {/* Contact Info */}
        <div className="space-y-3 mb-4">
          {secretaire.email && (
            <div className="flex items-center space-x-3 text-sm text-muted-foreground group-hover:text-foreground transition-colors">
              <div className="flex-shrink-0 w-8 h-8 rounded-full bg-teal-500/10 flex items-center justify-center group-hover:bg-teal-500/20 transition-colors">
                <Mail className="w-3 h-3 text-teal-600 dark:text-teal-400" />
              </div>
              <span className="truncate">{secretaire.email}</span>
            </div>
          )}
          
          {secretaire.phone_number && (
            <div className="flex items-center space-x-3 text-sm text-muted-foreground group-hover:text-foreground transition-colors">
              <div className="flex-shrink-0 w-8 h-8 rounded-full bg-cyan-500/10 flex items-center justify-center group-hover:bg-cyan-500/20 transition-colors">
                <Phone className="w-3 h-3 text-cyan-600 dark:text-cyan-400" />
              </div>
              <span className="truncate">{secretaire.phone_number}</span>
            </div>
          )}
        </div>

        {/* Sites assignés */}
        <div 
          className="mb-4 group/section cursor-pointer hover:bg-teal-500/5 p-3 rounded-lg transition-colors border border-transparent hover:border-teal-200/30"
          onClick={() => document.getElementById(`edit-sites-${secretaire.id}`)?.click()}
        >
          <div className="flex items-center justify-between mb-2">
            <p className="text-xs font-medium text-muted-foreground uppercase tracking-wide flex items-center gap-2">
              <MapPin className="h-3 w-3 text-teal-600 dark:text-teal-400" />
              Sites assignés
            </p>
            {canManage && (
              <div id={`edit-sites-${secretaire.id}`}>
                <QuickEditSitesDialog 
                  secretaireId={secretaire.id}
                  sitesActuelsDetails={secretaire.sites_assignes_details || []}
                  onSuccess={onSuccess}
                />
              </div>
            )}
          </div>
          {secretaire.sites_assignes_details && secretaire.sites_assignes_details.length > 0 ? (
            <div className="flex flex-wrap gap-1">
              {secretaire.sites_assignes_details.map((site, idx) => (
                <Badge key={idx} variant="outline" className="text-xs bg-teal-50 dark:bg-teal-950/20 border-teal-200 dark:border-teal-900">
                  {site.nom}
                  {site.priorite && site.priorite !== '1' && (
                    <span className="ml-1 text-muted-foreground">
                      (P{site.priorite})
                    </span>
                  )}
                </Badge>
              ))}
            </div>
          ) : (
            <p className="text-xs text-muted-foreground">Aucun site assigné</p>
          )}
        </div>

        {/* Médecins assignés */}
        <div 
          className="mb-4 group/section cursor-pointer hover:bg-cyan-500/5 p-3 rounded-lg transition-colors border border-transparent hover:border-cyan-200/30"
          onClick={() => document.getElementById(`edit-medecins-${secretaire.id}`)?.click()}
        >
          <div className="flex items-center justify-between mb-2">
            <p className="text-xs font-medium text-muted-foreground uppercase tracking-wide flex items-center gap-2">
              <Stethoscope className="h-3 w-3 text-cyan-600 dark:text-cyan-400" />
              Médecins assignés
            </p>
            {canManage && (
              <div id={`edit-medecins-${secretaire.id}`}>
                <QuickEditMedecinDialog 
                  secretaireId={secretaire.id}
                  medecinsActuelsDetails={secretaire.medecins_assignes_details || []}
                  onSuccess={onSuccess}
                />
              </div>
            )}
          </div>
          {secretaire.medecins_assignes_details && secretaire.medecins_assignes_details.length > 0 ? (
            <div className="flex flex-wrap gap-1">
              {secretaire.medecins_assignes_details.map((medecin, idx) => (
                <Badge key={idx} variant="outline" className="text-xs bg-cyan-50 dark:bg-cyan-950/20 border-cyan-200 dark:border-cyan-900">
                  {medecin.first_name} {medecin.name}
                  {medecin.priorite && medecin.priorite !== '1' && (
                    <span className="ml-1 text-muted-foreground">
                      (P{medecin.priorite})
                    </span>
                  )}
                </Badge>
              ))}
            </div>
          ) : (
            <p className="text-xs text-muted-foreground">Aucun médecin assigné</p>
          )}
        </div>

        {/* Besoins opérationnels */}
        {canManage ? (
          <div 
            className="mb-4 group/section cursor-pointer hover:bg-emerald-500/5 p-3 rounded-lg transition-colors border border-transparent hover:border-emerald-200/30"
            onClick={() => document.getElementById(`edit-besoins-${secretaire.id}`)?.click()}
          >
            <div className="flex items-center justify-between mb-2">
              <p className="text-xs font-medium text-muted-foreground uppercase tracking-wide flex items-center gap-2">
                <Briefcase className="h-3 w-3 text-emerald-600 dark:text-emerald-400" />
                Besoins opérationnels
              </p>
              <Button
                id={`edit-besoins-${secretaire.id}`}
                variant="ghost"
                size="sm"
                className="h-6 px-2 text-xs hover:bg-emerald-500/10 hover:text-emerald-600 transition-colors"
                onClick={(e) => {
                  e.stopPropagation();
                  onEdit(secretaire);
                }}
              >
                <Plus className="h-3 w-3 mr-1" />
                Modifier
              </Button>
            </div>
            {secretaire.besoins_operations && secretaire.besoins_operations.length > 0 ? (
              <div className="flex flex-wrap gap-1">
                {secretaire.besoins_operations.map((besoin, idx) => (
                  <Badge 
                    key={idx} 
                    variant="outline" 
                    className="text-xs bg-emerald-50 dark:bg-emerald-950/20 border-emerald-200 dark:border-emerald-900"
                  >
                    {besoin.besoins_operations.nom}
                    {besoin.preference && (
                      <span className="ml-1 text-muted-foreground">
                        (Pref: {besoin.preference})
                      </span>
                    )}
                  </Badge>
                ))}
              </div>
            ) : (
              <p className="text-xs text-muted-foreground">Aucun besoin opérationnel</p>
            )}
          </div>
        ) : (
          secretaire.besoins_operations && secretaire.besoins_operations.length > 0 && (
            <div className="mb-4">
              <p className="text-xs font-medium text-muted-foreground uppercase tracking-wide mb-2 flex items-center gap-2">
                <Briefcase className="h-3 w-3 text-emerald-600 dark:text-emerald-400" />
                Besoins opérationnels
              </p>
              <div className="flex flex-wrap gap-1">
                {secretaire.besoins_operations.map((besoin, idx) => (
                  <Badge 
                    key={idx} 
                    variant="outline" 
                    className="text-xs bg-emerald-50 dark:bg-emerald-950/20 border-emerald-200 dark:border-emerald-900"
                  >
                    {besoin.besoins_operations.nom}
                    {besoin.preference && (
                      <span className="ml-1 text-muted-foreground">
                        (Pref: {besoin.preference})
                      </span>
                    )}
                  </Badge>
                ))}
              </div>
            </div>
          )
        )}

        {/* Horaires de base */}
        <div>
          <p className="text-xs font-medium text-muted-foreground uppercase tracking-wide mb-3">
            Jours de travail
          </p>
          <div className="space-y-2">
            {[1, 2, 3, 4, 5].map((jour) => {
              const jours = ['', 'Lun', 'Mar', 'Mer', 'Jeu', 'Ven'];
              const horairesJour = (localSecretaire.horaires_base_secretaires?.filter(h => h.jour_semaine === jour) || [])
                .sort((a, b) => {
                  const ordre = { 'matin': 1, 'apres_midi': 2, 'toute_journee': 3 };
                  return (ordre[a.demi_journee] || 4) - (ordre[b.demi_journee] || 4);
                });
              
              return (
                <div key={jour}>
                  {horairesJour.length > 0 && (
                    <div className="space-y-1">
                      {horairesJour.map((h, idx) => (
                        <HoraireSecretaireLineEdit
                          key={idx}
                          horaire={h}
                          jour={jours[jour]}
                          sites={sites}
                          onUpdate={handleHoraireUpdate}
                          onDelete={handleDeleteHoraire}
                        />
                      ))}
                    </div>
                  )}
                </div>
              );
            })}

            {/* Add Button */}
            {canManage && (
              <div className="pt-2 mt-2 border-t border-border/30">
                <AddHoraireSecretaireDialog
                  secretaireId={secretaire.id}
                  onSuccess={handleHoraireUpdate}
                />
              </div>
            )}
          </div>
        </div>

        {/* Status Toggle */}
        {canManage && (
          <div className="mt-4 pt-4 border-t border-border/50 flex items-center justify-between">
            <span className="text-sm text-muted-foreground">Statut</span>
            {secretaire.actif !== false ? (
              <AlertDialog>
                <AlertDialogTrigger asChild>
                  <div className="flex items-center space-x-2">
                    <Switch
                      checked={true}
                      className="data-[state=checked]:bg-teal-600"
                    />
                  </div>
                </AlertDialogTrigger>
                <AlertDialogContent>
                  <AlertDialogHeader>
                    <AlertDialogTitle>Confirmer la désactivation</AlertDialogTitle>
                    <AlertDialogDescription>
                      Êtes-vous sûr de vouloir passer cette secrétaire en inactif ?
                    </AlertDialogDescription>
                  </AlertDialogHeader>
                  <AlertDialogFooter>
                    <AlertDialogCancel>Annuler</AlertDialogCancel>
                    <AlertDialogAction 
                      onClick={() => onToggleStatus(secretaire.id, true, true)}
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
                  onCheckedChange={() => onToggleStatus(secretaire.id, false)}
                  className="data-[state=unchecked]:bg-muted"
                />
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
