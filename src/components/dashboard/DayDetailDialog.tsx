import { useState, useEffect } from 'react';
import { format } from 'date-fns';
import { fr } from 'date-fns/locale';
import { supabase } from '@/integrations/supabase/client';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Stethoscope, Users, Plus, Pencil, Trash2, Loader2, ArrowLeftRight } from 'lucide-react';
import { cn } from '@/lib/utils';
import { AddMedecinToDayDialog } from './AddMedecinToDayDialog';
import { AddSecretaireToDayDialog } from './AddSecretaireToDayDialog';
import { EditMedecinAssignmentDialog } from './EditMedecinAssignmentDialog';
import { EditSecretaireAssignmentDialog } from './EditSecretaireAssignmentDialog';
import { ExchangeSecretaireDialog } from './ExchangeSecretaireDialog';
import { toast } from '@/hooks/use-toast';
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog';

interface Medecin {
  id: string;
  besoin_id: string;
  nom: string;
  periode: 'matin' | 'apres_midi' | 'journee';
}

interface Secretaire {
  id: string;
  capacite_id: string;
  nom: string;
  periode: 'matin' | 'apres_midi' | 'journee';
  is_1r: boolean;
  is_2f: boolean;
  is_3f: boolean;
}

interface DayDetailDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  date: Date;
  siteId: string;
  siteName: string;
  onRefresh: () => void;
}

export function DayDetailDialog({
  open,
  onOpenChange,
  date,
  siteId,
  siteName,
  onRefresh,
}: DayDetailDialogProps) {
  const [medecins, setMedecins] = useState<Medecin[]>([]);
  const [secretaires, setSecretaires] = useState<Secretaire[]>([]);
  const [loading, setLoading] = useState(true);
  const [addMedecinOpen, setAddMedecinOpen] = useState(false);
  const [addSecretaireOpen, setAddSecretaireOpen] = useState(false);
  const [editMedecin, setEditMedecin] = useState<Medecin | null>(null);
  const [editSecretaire, setEditSecretaire] = useState<Secretaire | null>(null);
  const [exchangeSecretaire, setExchangeSecretaire] = useState<Secretaire | null>(null);
  const [deleteItem, setDeleteItem] = useState<{ type: 'medecin' | 'secretaire'; id: string } | null>(null);

  const dateStr = format(date, 'yyyy-MM-dd');
  const isAdminSite = siteId === '00000000-0000-0000-0000-000000000001';

  const fetchData = async () => {
    setLoading(true);
    try {
      // Fetch médecins
      const { data: besoinsData } = await supabase
        .from('besoin_effectif')
        .select('*, medecins(id, first_name, name)')
        .eq('site_id', siteId)
        .eq('date', dateStr)
        .eq('type', 'medecin');

      if (besoinsData) {
        const medecinsMap = new Map<string, Medecin>();
        besoinsData.forEach((besoin) => {
          if (besoin.medecins) {
            const medecinId = besoin.medecins.id;
            const nom = `${besoin.medecins.first_name || ''} ${besoin.medecins.name || ''}`.trim();
            
            if (medecinsMap.has(medecinId)) {
              const existing = medecinsMap.get(medecinId)!;
              existing.periode = 'journee';
            } else {
              medecinsMap.set(medecinId, {
                id: medecinId,
                besoin_id: besoin.id,
                nom,
                periode: besoin.demi_journee === 'matin' ? 'matin' : 'apres_midi',
              });
            }
          }
        });
        setMedecins(Array.from(medecinsMap.values()));
      }

      // Fetch assistants médicaux
      const capaciteQuery = supabase
        .from('capacite_effective')
        .select('*, secretaires(id, first_name, name)')
        .eq('date', dateStr)
        .eq('actif', true);

      if (!isAdminSite) {
        capaciteQuery.eq('site_id', siteId);
      }

      const { data: capaciteData } = await capaciteQuery;

      if (capaciteData) {
        const secretairesMap = new Map<string, Secretaire>();
        capaciteData.forEach((cap) => {
          if (cap.secretaires) {
            const secretaireId = cap.secretaires.id;
            const nom = `${cap.secretaires.first_name || ''} ${cap.secretaires.name || ''}`.trim();
            
            if (secretairesMap.has(secretaireId)) {
              const existing = secretairesMap.get(secretaireId)!;
              existing.periode = 'journee';
              if (cap.is_1r) existing.is_1r = true;
              if (cap.is_2f) existing.is_2f = true;
              if (cap.is_3f) existing.is_3f = true;
            } else {
              secretairesMap.set(secretaireId, {
                id: secretaireId,
                capacite_id: cap.id,
                nom,
                periode: cap.demi_journee === 'matin' ? 'matin' : 'apres_midi',
                is_1r: cap.is_1r,
                is_2f: cap.is_2f,
                is_3f: cap.is_3f,
              });
            }
          }
        });
        setSecretaires(Array.from(secretairesMap.values()));
      }
    } catch (error) {
      console.error('Error fetching day data:', error);
      toast({
        title: 'Erreur',
        description: 'Impossible de charger les données',
        variant: 'destructive',
      });
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    if (open) {
      fetchData();
    }
  }, [open, dateStr, siteId]);

  const handleDelete = async () => {
    if (!deleteItem) return;

    try {
      if (deleteItem.type === 'medecin') {
        const { error } = await supabase
          .from('besoin_effectif')
          .delete()
          .eq('medecin_id', deleteItem.id)
          .eq('date', dateStr)
          .eq('site_id', siteId);

        if (error) throw error;
      } else {
        const { error } = await supabase
          .from('capacite_effective')
          .delete()
          .eq('secretaire_id', deleteItem.id)
          .eq('date', dateStr);

        if (error) throw error;
      }

      toast({
        title: 'Succès',
        description: `${deleteItem.type === 'medecin' ? 'Médecin' : 'Assistant médical'} retiré(e) avec succès`,
      });

      fetchData();
      onRefresh();
    } catch (error) {
      console.error('Error deleting:', error);
      toast({
        title: 'Erreur',
        description: 'Impossible de supprimer',
        variant: 'destructive',
      });
    } finally {
      setDeleteItem(null);
    }
  };

  const getDotColor = (periode: string) => {
    switch (periode) {
      case 'matin':
        return 'bg-blue-500';
      case 'apres_midi':
        return 'bg-yellow-500';
      case 'journee':
        return 'bg-green-500';
      default:
        return 'bg-muted';
    }
  };

  const getPeriodeLabel = (periode: string) => {
    switch (periode) {
      case 'matin':
        return 'Matin';
      case 'apres_midi':
        return 'Après-midi';
      case 'journee':
        return 'Journée';
      default:
        return '';
    }
  };

  const handleSuccess = () => {
    fetchData();
    onRefresh();
    setAddMedecinOpen(false);
    setAddSecretaireOpen(false);
    setEditMedecin(null);
    setEditSecretaire(null);
    setExchangeSecretaire(null);
  };

  return (
    <>
      <Dialog open={open} onOpenChange={onOpenChange}>
        <DialogContent className="max-w-4xl max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle className="text-2xl font-bold bg-gradient-to-r from-cyan-500 to-teal-600 bg-clip-text text-transparent">
              {format(date, 'EEEE dd MMMM yyyy', { locale: fr })}
            </DialogTitle>
            <p className="text-sm text-muted-foreground">{siteName}</p>
          </DialogHeader>

          {loading ? (
            <div className="flex items-center justify-center py-12">
              <Loader2 className="h-8 w-8 animate-spin text-primary" />
            </div>
          ) : (
            <div className="space-y-6">
              {/* Médecins Section */}
              <div className="space-y-3">
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-2">
                    <Stethoscope className="h-5 w-5 text-cyan-600" />
                    <h3 className="text-lg font-semibold">Médecins</h3>
                    <Badge variant="secondary">{medecins.length}</Badge>
                  </div>
                  <Button
                    size="sm"
                    onClick={() => setAddMedecinOpen(true)}
                    className="bg-gradient-to-r from-cyan-500 to-teal-600"
                  >
                    <Plus className="h-4 w-4 mr-1" />
                    Ajouter
                  </Button>
                </div>

                <div className="grid gap-2">
                  {medecins.length === 0 ? (
                    <p className="text-sm text-muted-foreground text-center py-4">
                      Aucun médecin pour ce jour
                    </p>
                  ) : (
                    medecins.map((medecin) => (
                      <div
                        key={medecin.id}
                        className="flex items-center justify-between p-3 rounded-lg border border-border bg-card hover:bg-accent/5 transition-colors"
                      >
                        <div className="flex items-center gap-3">
                          <span className={cn("w-2 h-2 rounded-full flex-shrink-0", getDotColor(medecin.periode))} />
                          <div className="font-medium">{medecin.nom}</div>
                          <span className="text-sm text-muted-foreground">({getPeriodeLabel(medecin.periode)})</span>
                        </div>
                        <div className="flex items-center gap-2">
                          <Button
                            size="sm"
                            variant="ghost"
                            onClick={() => setEditMedecin(medecin)}
                          >
                            <Pencil className="h-4 w-4" />
                          </Button>
                          <Button
                            size="sm"
                            variant="ghost"
                            onClick={() => setDeleteItem({ type: 'medecin', id: medecin.id })}
                          >
                            <Trash2 className="h-4 w-4 text-destructive" />
                          </Button>
                        </div>
                      </div>
                    ))
                  )}
                </div>
              </div>

              {/* Assistants médicaux Section */}
              <div className="space-y-3">
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-2">
                    <Users className="h-5 w-5 text-teal-600" />
                    <h3 className="text-lg font-semibold">Assistants médicaux</h3>
                    <Badge variant="secondary">{secretaires.length}</Badge>
                  </div>
                  <Button
                    size="sm"
                    onClick={() => setAddSecretaireOpen(true)}
                    className="bg-gradient-to-r from-teal-500 to-cyan-600"
                  >
                    <Plus className="h-4 w-4 mr-1" />
                    Ajouter
                  </Button>
                </div>

                <div className="grid gap-2">
                  {secretaires.length === 0 ? (
                    <p className="text-sm text-muted-foreground text-center py-4">
                      Aucun assistant médical pour ce jour
                    </p>
                  ) : (
                    secretaires.map((secretaire) => (
                      <div
                        key={secretaire.id}
                        className="flex items-center justify-between p-3 rounded-lg border border-border bg-card hover:bg-accent/5 transition-colors"
                      >
                        <div className="flex items-center gap-3 flex-wrap">
                          <span className={cn("w-2 h-2 rounded-full flex-shrink-0", getDotColor(secretaire.periode))} />
                          <div className="font-medium">{secretaire.nom}</div>
                          <span className="text-sm text-muted-foreground">({getPeriodeLabel(secretaire.periode)})</span>
                          {secretaire.is_1r && (
                            <Badge className="bg-emerald-500/10 text-emerald-700 border-emerald-500">
                              1R
                            </Badge>
                          )}
                          {secretaire.is_2f && (
                            <Badge className="bg-orange-500/10 text-orange-700 border-orange-500">
                              2F
                            </Badge>
                          )}
                          {secretaire.is_3f && (
                            <Badge className="bg-violet-500/10 text-violet-700 border-violet-500">
                              3F
                            </Badge>
                          )}
                        </div>
                        <div className="flex items-center gap-2">
                          <Button
                            size="sm"
                            variant="ghost"
                            onClick={() => setExchangeSecretaire(secretaire)}
                            title="Échanger"
                          >
                            <ArrowLeftRight className="h-4 w-4" />
                          </Button>
                          <Button
                            size="sm"
                            variant="ghost"
                            onClick={() => setEditSecretaire(secretaire)}
                          >
                            <Pencil className="h-4 w-4" />
                          </Button>
                          <Button
                            size="sm"
                            variant="ghost"
                            onClick={() => setDeleteItem({ type: 'secretaire', id: secretaire.id })}
                          >
                            <Trash2 className="h-4 w-4 text-destructive" />
                          </Button>
                        </div>
                      </div>
                    ))
                  )}
                </div>
              </div>
            </div>
          )}
        </DialogContent>
      </Dialog>

      <AddMedecinToDayDialog
        open={addMedecinOpen}
        onOpenChange={setAddMedecinOpen}
        date={dateStr}
        siteId={siteId}
        onSuccess={handleSuccess}
      />

      <AddSecretaireToDayDialog
        open={addSecretaireOpen}
        onOpenChange={setAddSecretaireOpen}
        date={dateStr}
        siteId={siteId}
        siteName={siteName}
        onSuccess={handleSuccess}
      />

      {editMedecin && (
        <EditMedecinAssignmentDialog
          open={!!editMedecin}
          onOpenChange={(open) => !open && setEditMedecin(null)}
          medecinId={editMedecin.id}
          medecinNom={editMedecin.nom}
          date={dateStr}
          currentSiteId={siteId}
          periode={editMedecin.periode}
          onSuccess={handleSuccess}
        />
      )}

      {editSecretaire && (
        <EditSecretaireAssignmentDialog
          open={!!editSecretaire}
          onOpenChange={(open) => !open && setEditSecretaire(null)}
          secretaire={editSecretaire}
          date={dateStr}
          siteId={siteId}
          onSuccess={handleSuccess}
        />
      )}

      {exchangeSecretaire && (
        <ExchangeSecretaireDialog
          open={!!exchangeSecretaire}
          onOpenChange={(open) => !open && setExchangeSecretaire(null)}
          secretaireId={exchangeSecretaire.id}
          secretaireNom={exchangeSecretaire.nom}
          date={dateStr}
          siteId={siteId}
          periode={exchangeSecretaire.periode}
          onSuccess={handleSuccess}
        />
      )}

      <AlertDialog open={!!deleteItem} onOpenChange={() => setDeleteItem(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Confirmer la suppression</AlertDialogTitle>
            <AlertDialogDescription>
              Êtes-vous sûr de vouloir retirer{' '}
              {deleteItem?.type === 'medecin' ? 'ce médecin' : 'cet assistant médical'} de ce jour ?
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Annuler</AlertDialogCancel>
            <AlertDialogAction onClick={handleDelete} className="bg-destructive text-destructive-foreground">
              Supprimer
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}
