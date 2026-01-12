import { useState, useEffect } from 'react';
import { Mail, Phone, Stethoscope, Users, X, Check, User, UserCircle, Pencil } from 'lucide-react';
import { Dialog, DialogContent } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Input } from '@/components/ui/input';
import { Switch } from '@/components/ui/switch';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle, AlertDialogTrigger } from '@/components/ui/alert-dialog';
import { HoraireLineEdit } from './HoraireLineEdit';
import { AddHoraireDialog } from './AddHoraireDialog';
import { supabase } from '@/integrations/supabase/client';
import { useToast } from '@/hooks/use-toast';
import { useCanManagePlanning } from '@/hooks/useCanManagePlanning';
import { Medecin } from './useMedecins';

interface MedecinDetailDialogProps {
  medecin: Medecin | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onUpdate: () => void;
}

interface Specialite {
  id: string;
  nom: string;
}

export function MedecinDetailDialog({ medecin, open, onOpenChange, onUpdate }: MedecinDetailDialogProps) {
  const { toast } = useToast();
  const { canManage } = useCanManagePlanning();

  const [sites, setSites] = useState<any[]>([]);
  const [typesIntervention, setTypesIntervention] = useState<any[]>([]);
  const [specialites, setSpecialites] = useState<Specialite[]>([]);
  const [newHoraire, setNewHoraire] = useState<any>(null);
  const [horaires, setHoraires] = useState<any[]>([]);

  // Edit mode for all fields
  const [isEditMode, setIsEditMode] = useState(false);
  const [editValues, setEditValues] = useState({
    first_name: '',
    name: '',
    email: '',
    phone_number: '',
    specialite_id: '',
    besoin_secretaires: 1,
  });
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (open && medecin) {
      fetchData();
      fetchHoraires();
      setEditValues({
        first_name: medecin.first_name || '',
        name: medecin.name || '',
        email: medecin.email || '',
        phone_number: medecin.phone_number || '',
        specialite_id: medecin.specialite_id || '',
        besoin_secretaires: medecin.besoin_secretaires ?? 1,
      });
      setIsEditMode(false);
    }
  }, [open, medecin]);

  const fetchData = async () => {
    const [sitesRes, typesRes, specialitesRes] = await Promise.all([
      supabase.from('sites').select('id, nom').eq('actif', true).order('nom'),
      supabase.from('types_intervention').select('id, nom').eq('actif', true).order('nom'),
      supabase.from('specialites').select('id, nom').order('nom'),
    ]);

    if (sitesRes.data) setSites(sitesRes.data);
    if (typesRes.data) setTypesIntervention(typesRes.data);
    if (specialitesRes.data) setSpecialites(specialitesRes.data);
  };

  const fetchHoraires = async () => {
    if (!medecin) return;

    const { data } = await supabase
      .from('horaires_base_medecins')
      .select(`
        id,
        jour_semaine,
        demi_journee,
        site_id,
        actif,
        alternance_type,
        alternance_semaine_modulo,
        date_debut,
        date_fin,
        type_intervention_id,
        sites!horaires_base_medecins_site_id_fkey (nom),
        types_intervention (nom)
      `)
      .eq('medecin_id', medecin.id);

    if (data) setHoraires(data);
  };

  const handleSaveAll = async () => {
    if (!medecin || !canManage) return;

    setSaving(true);
    try {
      const { error } = await supabase
        .from('medecins')
        .update({
          first_name: editValues.first_name || null,
          name: editValues.name || null,
          email: editValues.email || null,
          phone_number: editValues.phone_number || null,
          specialite_id: editValues.specialite_id || null,
          besoin_secretaires: editValues.besoin_secretaires,
        })
        .eq('id', medecin.id);

      if (error) throw error;

      toast({
        title: "Enregistré",
        description: "Modifications sauvegardées",
      });

      setIsEditMode(false);
      onUpdate();
    } catch (error) {
      console.error('Erreur:', error);
      toast({
        title: "Erreur",
        description: "Impossible de sauvegarder",
        variant: "destructive",
      });
    } finally {
      setSaving(false);
    }
  };

  const handleCancelEdit = () => {
    if (medecin) {
      setEditValues({
        first_name: medecin.first_name || '',
        name: medecin.name || '',
        email: medecin.email || '',
        phone_number: medecin.phone_number || '',
        specialite_id: medecin.specialite_id || '',
        besoin_secretaires: medecin.besoin_secretaires ?? 1,
      });
    }
    setIsEditMode(false);
  };

  const handleDeleteHoraire = async (horaireId: string) => {
    try {
      const { error } = await supabase
        .from('horaires_base_medecins')
        .delete()
        .eq('id', horaireId);

      if (error) throw error;

      toast({ title: "Succès", description: "Horaire supprimé" });
      fetchHoraires();
      onUpdate();
    } catch (error) {
      toast({
        title: "Erreur",
        description: "Impossible de supprimer l'horaire",
        variant: "destructive",
      });
    }
  };

  const handleHoraireUpdate = () => {
    setNewHoraire(null);
    fetchHoraires();
    onUpdate();
  };

  const handleAddNewHoraire = () => {
    if (!medecin) return;
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

  const handleToggleStatus = async () => {
    if (!medecin) return;

    try {
      const { error } = await supabase
        .from('medecins')
        .update({ actif: !medecin.actif })
        .eq('id', medecin.id);

      if (error) throw error;

      toast({
        title: "Succès",
        description: `Médecin ${!medecin.actif ? 'activé' : 'désactivé'}`,
      });

      onUpdate();
    } catch (error) {
      toast({
        title: "Erreur",
        description: "Impossible de modifier le statut",
        variant: "destructive",
      });
    }
  };

  if (!medecin) return null;

  const jours = ['', 'Lundi', 'Mardi', 'Mercredi', 'Jeudi', 'Vendredi'];

  const EditableField = ({
    field,
    label,
    icon: Icon,
    type = 'text',
  }: {
    field: keyof typeof editValues;
    label: string;
    icon: any;
    type?: string;
  }) => {
    const value = editValues[field];
    const displayValue = medecin[field as keyof Medecin] as string | number;

    return (
      <div className="flex items-center gap-3 py-3 px-1 rounded-lg">
        <Icon className="h-4 w-4 text-muted-foreground shrink-0" />

        <div className="flex-1 min-w-0">
          <p className="text-[11px] font-medium text-muted-foreground uppercase tracking-wide">{label}</p>
          {isEditMode ? (
            <Input
              type={type}
              value={value}
              onChange={(e) => setEditValues(prev => ({
                ...prev,
                [field]: type === 'number' ? parseFloat(e.target.value) || 0 : e.target.value
              }))}
              className="h-8 text-sm mt-1"
            />
          ) : (
            <p className={`text-sm font-medium mt-0.5 ${!displayValue ? 'text-muted-foreground/50 italic' : 'text-foreground'}`}>
              {displayValue || 'Non renseigné'}
            </p>
          )}
        </div>
      </div>
    );
  };

  const SpecialiteField = () => {
    return (
      <div className="flex items-center gap-3 py-3 px-1 rounded-lg">
        <Stethoscope className="h-4 w-4 text-muted-foreground shrink-0" />

        <div className="flex-1 min-w-0">
          <p className="text-[11px] font-medium text-muted-foreground uppercase tracking-wide">Spécialité</p>
          {isEditMode ? (
            <Select
              value={editValues.specialite_id}
              onValueChange={(val) => setEditValues(prev => ({ ...prev, specialite_id: val }))}
            >
              <SelectTrigger className="h-8 text-sm mt-1">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {specialites.map((s) => (
                  <SelectItem key={s.id} value={s.id}>{s.nom}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          ) : (
            <p className={`text-sm font-medium mt-0.5 ${!medecin.specialites?.nom ? 'text-muted-foreground/50 italic' : 'text-foreground'}`}>
              {medecin.specialites?.nom || 'Non renseigné'}
            </p>
          )}
        </div>
      </div>
    );
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-4xl max-h-[90vh] overflow-hidden flex flex-col p-0 gap-0">
        {/* Header */}
        <div className="px-6 pt-6 pb-4 border-b border-border/50">
          <div className="flex items-start gap-4 pr-8">
            <div className="w-14 h-14 rounded-xl bg-gradient-to-br from-cyan-500 to-teal-600 flex items-center justify-center shadow-lg shadow-cyan-500/20">
              <span className="text-lg font-bold text-white">
                {medecin.first_name?.[0]}{medecin.name?.[0]}
              </span>
            </div>
            <div className="flex-1 min-w-0">
              <div className="flex items-center gap-3 mb-1">
                <h2 className="text-xl font-semibold text-foreground">
                  {medecin.first_name} {medecin.name}
                </h2>
                {/* Status Toggle - à côté du nom */}
                {canManage && (
                  <>
                    {medecin.actif !== false ? (
                      <AlertDialog>
                        <AlertDialogTrigger asChild>
                          <div className="flex items-center gap-1.5 px-2.5 py-1 rounded-full bg-green-500/10 cursor-pointer hover:bg-green-500/20 transition-colors">
                            <Switch checked={true} className="scale-[0.65]" />
                            <span className="text-[11px] font-medium text-green-700 dark:text-green-400">Actif</span>
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
                            <AlertDialogAction onClick={handleToggleStatus}>Désactiver</AlertDialogAction>
                          </AlertDialogFooter>
                        </AlertDialogContent>
                      </AlertDialog>
                    ) : (
                      <div
                        className="flex items-center gap-1.5 px-2.5 py-1 rounded-full bg-muted cursor-pointer hover:bg-muted/80 transition-colors"
                        onClick={handleToggleStatus}
                      >
                        <Switch checked={false} className="scale-[0.65]" />
                        <span className="text-[11px] font-medium text-muted-foreground">Inactif</span>
                      </div>
                    )}
                  </>
                )}
                {!canManage && medecin.actif === false && (
                  <Badge variant="secondary" className="text-xs">Inactif</Badge>
                )}
              </div>
              <p className="text-sm text-muted-foreground">{medecin.specialites?.nom}</p>
            </div>
          </div>
        </div>

        {/* Content */}
        <div className="flex-1 overflow-y-auto px-6 py-5">
          <div className="grid gap-0 lg:grid-cols-5">
            {/* Info Column */}
            <div className="lg:col-span-2 pr-6">
              <div className="flex items-center justify-between mb-3 px-1">
                <h3 className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">
                  Informations
                </h3>
                {canManage && !isEditMode && (
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={() => setIsEditMode(true)}
                    className="h-7 px-2 text-xs gap-1.5 text-muted-foreground hover:text-foreground"
                  >
                    <Pencil className="h-3 w-3" />
                    Modifier
                  </Button>
                )}
                {isEditMode && (
                  <div className="flex items-center gap-1">
                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={handleCancelEdit}
                      className="h-7 px-2 text-xs text-muted-foreground hover:text-foreground"
                    >
                      <X className="h-3 w-3 mr-1" />
                      Annuler
                    </Button>
                    <Button
                      size="sm"
                      onClick={handleSaveAll}
                      disabled={saving}
                      className="h-7 px-2 text-xs bg-green-600 hover:bg-green-700 text-white"
                    >
                      <Check className="h-3 w-3 mr-1" />
                      Enregistrer
                    </Button>
                  </div>
                )}
              </div>

              <div className="space-y-1">
                <EditableField
                  field="first_name"
                  label="Prénom"
                  icon={User}
                />

                <EditableField
                  field="name"
                  label="Nom"
                  icon={UserCircle}
                />

                <EditableField
                  field="email"
                  label="Email"
                  icon={Mail}
                  type="email"
                />

                <EditableField
                  field="phone_number"
                  label="Téléphone"
                  icon={Phone}
                  type="tel"
                />

                <SpecialiteField />

                <EditableField
                  field="besoin_secretaires"
                  label="Besoin assistants"
                  icon={Users}
                  type="number"
                />
              </div>
            </div>

            {/* Horaires Column */}
            <div className="lg:col-span-3 pl-6 border-l border-border/50">
              <h3 className="text-xs font-semibold text-muted-foreground uppercase tracking-wider mb-3">
                Horaires de travail
              </h3>

              <div className="space-y-2">
                {[1, 2, 3, 4, 5].map((jour) => {
                  const horairesJour = horaires
                    .filter(h => h.jour_semaine === jour)
                    .sort((a, b) => {
                      const ordre = { 'matin': 1, 'apres_midi': 2, 'toute_journee': 3 };
                      return (ordre[a.demi_journee as keyof typeof ordre] || 4) - (ordre[b.demi_journee as keyof typeof ordre] || 4);
                    });

                  return (
                    <div key={jour} className="space-y-1">
                      {horairesJour.length > 0 ? (
                        horairesJour.map((h) => (
                          <HoraireLineEdit
                            key={h.id}
                            horaire={h}
                            jour={jours[jour]}
                            sites={sites}
                            typesIntervention={typesIntervention}
                            onUpdate={handleHoraireUpdate}
                            onDelete={handleDeleteHoraire}
                          />
                        ))
                      ) : (
                        <div className="flex items-center gap-3 py-2 px-3 rounded-lg bg-muted/20 border border-dashed border-border/40">
                          <span className="text-sm font-medium w-20 shrink-0 text-muted-foreground">{jours[jour]}</span>
                          <span className="text-sm text-muted-foreground/50 italic">Pas d'horaire</span>
                        </div>
                      )}
                    </div>
                  );
                })}

                {/* New horaire line */}
                {newHoraire && (
                  <HoraireLineEdit
                    horaire={newHoraire}
                    jour="Nouveau"
                    sites={sites}
                    typesIntervention={typesIntervention}
                    onUpdate={handleHoraireUpdate}
                    onDelete={() => setNewHoraire(null)}
                    isNew={true}
                  />
                )}

                {/* Add Button */}
                {canManage && !newHoraire && (
                  <div className="pt-3">
                    <AddHoraireDialog onAddNew={handleAddNewHoraire} />
                  </div>
                )}
              </div>
            </div>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
