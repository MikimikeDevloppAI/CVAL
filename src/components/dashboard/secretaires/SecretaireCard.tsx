import { Mail, Phone, Edit, Calendar, MapPin, User, Power, PowerOff, Stethoscope, Briefcase } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle, AlertDialogTrigger } from '@/components/ui/alert-dialog';
import { ModernCard, ModernCardHeader, ModernCardContent, ModernCardTitle, ContactInfo } from '@/components/ui/modern-card';
import { QuickEditSitesDialog } from '@/components/secretaires/QuickEditSitesDialog';
import { QuickEditMedecinDialog } from '@/components/secretaires/QuickEditMedecinDialog';
import type { Secretaire } from './useSecretaires';

interface SecretaireCardProps {
  secretaire: Secretaire;
  onEdit: (secretaire: Secretaire) => void;
  onToggleStatus: (secretaireId: string, currentStatus: boolean, skipConfirmation?: boolean) => void;
  onOpenCalendar: (secretaire: { id: string; nom: string }) => void;
  onSuccess: () => void;
  canManage: boolean;
}

export function SecretaireCard({ 
  secretaire, 
  onEdit, 
  onToggleStatus, 
  onOpenCalendar,
  onSuccess,
  canManage 
}: SecretaireCardProps) {
  const nomComplet = `${secretaire.first_name || ''} ${secretaire.name || ''}`.trim() || 
    `Secrétaire ${secretaire.id.slice(0, 8)}`;

  return (
    <ModernCard className={`group ${secretaire.actif === false ? 'opacity-60' : ''}`}>
      <ModernCardHeader>
        <div className="flex items-start justify-between">
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-2 flex-wrap">
              <ModernCardTitle>{nomComplet}</ModernCardTitle>
              {secretaire.actif === false && (
                <Badge variant="secondary" className="text-xs">
                  Inactif
                </Badge>
              )}
              {secretaire.prefered_admin && (
                <Badge className="text-xs bg-purple-100 dark:bg-purple-900/30 text-purple-700 dark:text-purple-300 border-purple-200 dark:border-purple-800">
                  Préfère admin
                </Badge>
              )}
              {secretaire.horaire_flexible && (
                <Badge className="text-xs bg-blue-100 dark:bg-blue-900/30 text-blue-700 dark:text-blue-300 border-blue-200 dark:border-blue-800">
                  Flexible {secretaire.pourcentage_temps && `(${secretaire.pourcentage_temps}%)`}
                </Badge>
              )}
              {secretaire.flexible_jours_supplementaires && (
                <Badge className="text-xs bg-amber-100 dark:bg-amber-900/30 text-amber-700 dark:text-amber-300 border-amber-200 dark:border-amber-800">
                  +{secretaire.nombre_jours_supplementaires || 1}j supp.
                </Badge>
              )}
              {canManage && (
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() => onEdit(secretaire)}
                  className="ml-auto opacity-0 group-hover:opacity-100 transition-opacity"
                >
                  <Edit className="h-4 w-4" />
                </Button>
              )}
            </div>
            
            <div className="space-y-3 mt-4">
              {secretaire.email && (
                <ContactInfo 
                  icon={<Mail />} 
                  text={secretaire.email} 
                />
              )}
              {secretaire.phone_number && (
                <ContactInfo 
                  icon={<Phone />} 
                  text={secretaire.phone_number} 
                />
              )}
            </div>
          </div>
        </div>
      </ModernCardHeader>

      <ModernCardContent>
        {/* Sites assignés */}
        {secretaire.sites_assignes_details && secretaire.sites_assignes_details.length > 0 && (
          <div className="space-y-2 mb-3">
            <div className="flex items-center justify-between">
              <span className="text-sm font-medium flex items-center gap-2">
                <MapPin className="h-4 w-4 text-primary" />
                Sites assignés
              </span>
              {canManage && (
              <QuickEditSitesDialog 
                secretaireId={secretaire.id}
                sitesActuelsDetails={secretaire.sites_assignes_details || []}
                onSuccess={onSuccess}
              />
              )}
            </div>
            <div className="flex flex-wrap gap-1">
              {secretaire.sites_assignes_details.map((site, idx) => (
                <Badge key={idx} variant="outline" className="text-xs">
                  {site.nom}
                  {site.priorite && site.priorite !== '1' && (
                    <span className="ml-1 text-muted-foreground">
                      (P{site.priorite})
                    </span>
                  )}
                </Badge>
              ))}
            </div>
          </div>
        )}

        {/* Médecins assignés */}
        {secretaire.medecins_assignes_details && secretaire.medecins_assignes_details.length > 0 && (
          <div className="space-y-2 mb-3">
            <div className="flex items-center justify-between">
              <span className="text-sm font-medium flex items-center gap-2">
                <Stethoscope className="h-4 w-4 text-cyan-600 dark:text-cyan-400" />
                Médecins assignés
              </span>
              {canManage && (
              <QuickEditMedecinDialog 
                secretaireId={secretaire.id}
                medecinsActuelsDetails={secretaire.medecins_assignes_details || []}
                onSuccess={onSuccess}
              />
              )}
            </div>
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
          </div>
        )}

        {/* Besoins opérationnels */}
        {secretaire.besoins_operations && secretaire.besoins_operations.length > 0 && (
          <div className="space-y-2 mb-3">
            <span className="text-sm font-medium flex items-center gap-2">
              <Briefcase className="h-4 w-4 text-emerald-600 dark:text-emerald-400" />
              Besoins opérationnels
            </span>
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
        )}

        {/* Actions */}
        <div className="flex gap-2 mt-4 pt-4 border-t">
          <Button
            variant="outline"
            size="sm"
            onClick={() => onOpenCalendar({ id: secretaire.id, nom: nomComplet })}
            className="gap-2 flex-1"
          >
            <Calendar className="h-4 w-4" />
            Calendrier
          </Button>
          
          {canManage && secretaire.actif !== false && (
            <AlertDialog>
              <AlertDialogTrigger asChild>
                <Button variant="outline" size="sm" className="gap-2 text-orange-600 hover:text-orange-700 hover:bg-orange-50 dark:hover:bg-orange-950/20">
                  <PowerOff className="h-4 w-4" />
                  Désactiver
                </Button>
              </AlertDialogTrigger>
              <AlertDialogContent>
                <AlertDialogHeader>
                  <AlertDialogTitle>Désactiver la secrétaire</AlertDialogTitle>
                  <AlertDialogDescription>
                    Êtes-vous sûr de vouloir désactiver cette secrétaire ? Tous ses horaires seront supprimés.
                  </AlertDialogDescription>
                </AlertDialogHeader>
                <AlertDialogFooter>
                  <AlertDialogCancel>Annuler</AlertDialogCancel>
                  <AlertDialogAction onClick={() => onToggleStatus(secretaire.id, true, true)}>
                    Désactiver
                  </AlertDialogAction>
                </AlertDialogFooter>
              </AlertDialogContent>
            </AlertDialog>
          )}
          
          {canManage && secretaire.actif === false && (
            <Button 
              variant="outline" 
              size="sm"
              onClick={() => onToggleStatus(secretaire.id, false)}
              className="gap-2 text-green-600 hover:text-green-700 hover:bg-green-50 dark:hover:bg-green-950/20"
            >
              <Power className="h-4 w-4" />
              Réactiver
            </Button>
          )}
        </div>
      </ModernCardContent>
    </ModernCard>
  );
}
