import { useState, useEffect } from 'react';
import { Mail, Phone, User, UserCircle, Briefcase, MapPin, Stethoscope, Plus, X, Check, Pencil } from 'lucide-react';
import { Dialog, DialogContent } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Input } from '@/components/ui/input';
import { Switch } from '@/components/ui/switch';
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle, AlertDialogTrigger } from '@/components/ui/alert-dialog';
import { HoraireSecretaireLineEdit } from './HoraireSecretaireLineEdit';
import { AddHoraireSecretaireDialog } from './AddHoraireSecretaireDialog';
import { MedecinAssigneLineEdit } from './MedecinAssigneLineEdit';
import { SiteAssigneLineEdit } from './SiteAssigneLineEdit';
import { BesoinOperationnelLineEdit } from './BesoinOperationnelLineEdit';
import { supabase } from '@/integrations/supabase/client';
import { useToast } from '@/hooks/use-toast';
import { useCanManagePlanning } from '@/hooks/useCanManagePlanning';
import type { Secretaire } from './useSecretaires';

interface SecretaireDetailDialogProps {
  secretaire: Secretaire | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onUpdate: () => void;
}

export function SecretaireDetailDialog({ secretaire, open, onOpenChange, onUpdate }: SecretaireDetailDialogProps) {
  const { toast } = useToast();
  const { canManage } = useCanManagePlanning();

  const [sites, setSites] = useState<any[]>([]);
  const [medecins, setMedecins] = useState<any[]>([]);
  const [besoins, setBesoins] = useState<any[]>([]);
  const [localSecretaire, setLocalSecretaire] = useState<Secretaire | null>(null);
  const [newHoraire, setNewHoraire] = useState<any>(null);
  const [newMedecin, setNewMedecin] = useState<any>(null);
  const [newBesoin, setNewBesoin] = useState<any>(null);
  const [newSite, setNewSite] = useState<any>(null);

  // Edit mode
  const [isEditMode, setIsEditMode] = useState(false);
  const [editValues, setEditValues] = useState({
    first_name: '',
    name: '',
    email: '',
    phone_number: '',
    horaire_flexible: false,
    pourcentage_temps: 100,
    prefered_admin: false,
    nombre_demi_journees_admin: 0,
    flexible_jours_supplementaires: false,
    nombre_jours_supplementaires: 0,
  });
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (open && secretaire) {
      setLocalSecretaire(secretaire);
      fetchData();
      setEditValues({
        first_name: secretaire.first_name || '',
        name: secretaire.name || '',
        email: secretaire.email || '',
        phone_number: secretaire.phone_number || '',
        horaire_flexible: secretaire.horaire_flexible || false,
        pourcentage_temps: secretaire.pourcentage_temps || 100,
        prefered_admin: secretaire.prefered_admin || false,
        nombre_demi_journees_admin: secretaire.nombre_demi_journees_admin || 0,
        flexible_jours_supplementaires: secretaire.flexible_jours_supplementaires || false,
        nombre_jours_supplementaires: secretaire.nombre_jours_supplementaires || 0,
      });
      setIsEditMode(false);
    }
  }, [open, secretaire]);

  const fetchData = async () => {
    const [sitesData, medecinsData, besoinsData] = await Promise.all([
      supabase
        .from('sites')
        .select('id, nom')
        .eq('actif', true)
        .not('nom', 'ilike', '%bloc opératoire%')
        .order('nom'),
      supabase
        .from('medecins')
        .select('id, first_name, name')
        .eq('actif', true)
        .order('first_name'),
      supabase
        .from('besoins_operations')
        .select('id, nom')
        .eq('actif', true)
        .order('nom')
    ]);

    if (sitesData.data) setSites(sitesData.data);
    if (medecinsData.data) setMedecins(medecinsData.data);
    if (besoinsData.data) setBesoins(besoinsData.data);
  };

  const handleSaveAll = async () => {
    if (!secretaire || !canManage) return;

    setSaving(true);
    try {
      const { error } = await supabase
        .from('secretaires')
        .update({
          first_name: editValues.first_name || null,
          name: editValues.name || null,
          email: editValues.email || null,
          phone_number: editValues.phone_number || null,
          horaire_flexible: editValues.horaire_flexible,
          pourcentage_temps: editValues.pourcentage_temps,
          prefered_admin: editValues.prefered_admin,
          nombre_demi_journees_admin: editValues.nombre_demi_journees_admin,
          flexible_jours_supplementaires: editValues.flexible_jours_supplementaires,
          nombre_jours_supplementaires: editValues.nombre_jours_supplementaires,
        })
        .eq('id', secretaire.id);

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
    if (secretaire) {
      setEditValues({
        first_name: secretaire.first_name || '',
        name: secretaire.name || '',
        email: secretaire.email || '',
        phone_number: secretaire.phone_number || '',
        horaire_flexible: secretaire.horaire_flexible || false,
        pourcentage_temps: secretaire.pourcentage_temps || 100,
        prefered_admin: secretaire.prefered_admin || false,
        nombre_demi_journees_admin: secretaire.nombre_demi_journees_admin || 0,
        flexible_jours_supplementaires: secretaire.flexible_jours_supplementaires || false,
        nombre_jours_supplementaires: secretaire.nombre_jours_supplementaires || 0,
      });
    }
    setIsEditMode(false);
  };

  const handleToggleStatus = async () => {
    if (!secretaire) return;

    try {
      const { error } = await supabase
        .from('secretaires')
        .update({ actif: !secretaire.actif })
        .eq('id', secretaire.id);

      if (error) throw error;

      toast({
        title: "Succès",
        description: `Assistant ${!secretaire.actif ? 'activé' : 'désactivé'}`,
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

  // Handlers for horaires
  const handleDeleteHoraire = async (horaireId: string) => {
    try {
      const { error } = await supabase
        .from('horaires_base_secretaires')
        .delete()
        .eq('id', horaireId);

      if (error) throw error;
      toast({ title: "Succès", description: "Horaire supprimé" });
      refreshHoraires();
    } catch (error) {
      toast({ title: "Erreur", description: "Impossible de supprimer", variant: "destructive" });
    }
  };

  const refreshHoraires = async () => {
    if (!secretaire) return;
    setNewHoraire(null);

    const { data } = await supabase
      .from('horaires_base_secretaires')
      .select('id, jour_semaine, demi_journee, site_id, actif, alternance_type, alternance_semaine_modulo, date_debut, date_fin, sites(nom)')
      .eq('secretaire_id', secretaire.id);

    if (data) {
      setLocalSecretaire(prev => prev ? { ...prev, horaires_base_secretaires: data } : null);
    }
  };

  const handleAddNewHoraire = () => {
    if (!secretaire) return;
    setNewHoraire({
      id: 'new',
      jour_semaine: 1,
      demi_journee: 'matin',
      site_id: sites[0]?.id || '',
      alternance_type: 'hebdomadaire',
      alternance_semaine_modulo: 0,
      date_debut: '',
      date_fin: '',
      secretaire_id: secretaire.id,
      actif: true
    });
  };

  // Handlers for medecins
  const refreshMedecinsAssignes = async () => {
    if (!secretaire) return;
    setNewMedecin(null);

    const { data } = await supabase
      .from('secretaires_medecins')
      .select('id, medecin_id, priorite, medecins(first_name, name)')
      .eq('secretaire_id', secretaire.id);

    if (data) {
      setLocalSecretaire(prev => prev ? {
        ...prev,
        medecins_assignes_details: data.map(d => ({
          id: d.id,
          medecin_id: d.medecin_id,
          priorite: d.priorite,
          first_name: d.medecins?.first_name || '',
          name: d.medecins?.name || '',
        }))
      } : null);
    }
  };

  const handleDeleteMedecin = async (assignmentId: string) => {
    if (assignmentId === 'new') { setNewMedecin(null); return; }
    try {
      const { error } = await supabase.from('secretaires_medecins').delete().eq('id', assignmentId);
      if (error) throw error;
      toast({ title: "Succès", description: "Médecin supprimé" });
      refreshMedecinsAssignes();
    } catch (error) {
      toast({ title: "Erreur", description: "Impossible de supprimer", variant: "destructive" });
    }
  };

  const handleAddNewMedecin = () => {
    if (!secretaire) return;
    setNewMedecin({ id: 'new', medecin_id: medecins[0]?.id || '', priorite: '1', secretaire_id: secretaire.id });
  };

  // Handlers for sites
  const refreshSitesAssignes = async () => {
    if (!secretaire) return;
    setNewSite(null);

    const { data } = await supabase
      .from('secretaires_sites')
      .select('id, site_id, priorite, sites(nom)')
      .eq('secretaire_id', secretaire.id);

    if (data) {
      setLocalSecretaire(prev => prev ? {
        ...prev,
        sites_assignes_details: data.map(d => ({
          id: d.id,
          site_id: d.site_id,
          priorite: d.priorite,
          nom: d.sites?.nom || '',
        }))
      } : null);
    }
  };

  const handleDeleteSite = async (assignmentId: string) => {
    if (assignmentId === 'new') { setNewSite(null); return; }
    try {
      const { error } = await supabase.from('secretaires_sites').delete().eq('id', assignmentId);
      if (error) throw error;
      toast({ title: "Succès", description: "Site supprimé" });
      refreshSitesAssignes();
    } catch (error) {
      toast({ title: "Erreur", description: "Impossible de supprimer", variant: "destructive" });
    }
  };

  const handleAddNewSite = () => {
    if (!secretaire) return;
    setNewSite({ id: 'new', site_id: sites[0]?.id || '', priorite: '1', secretaire_id: secretaire.id });
  };

  // Handlers for besoins
  const refreshBesoinsOperations = async () => {
    if (!secretaire) return;
    setNewBesoin(null);

    const { data } = await supabase
      .from('secretaires_besoins_operations')
      .select('id, besoin_operation_id, preference, besoins_operations(nom, code, categorie)')
      .eq('secretaire_id', secretaire.id);

    if (data) {
      setLocalSecretaire(prev => prev ? {
        ...prev,
        besoins_operations: data.map(d => ({
          id: d.id,
          besoin_operation_id: d.besoin_operation_id,
          preference: d.preference ?? 1,
          besoins_operations: {
            nom: d.besoins_operations?.nom ?? '',
            code: d.besoins_operations?.code ?? '',
            categorie: d.besoins_operations?.categorie,
          },
        }))
      } : null);
    }
  };

  const handleDeleteBesoin = async (assignmentId: string) => {
    if (assignmentId === 'new') { setNewBesoin(null); return; }
    try {
      const { error } = await supabase.from('secretaires_besoins_operations').delete().eq('id', assignmentId);
      if (error) throw error;
      toast({ title: "Succès", description: "Compétence supprimée" });
      refreshBesoinsOperations();
    } catch (error) {
      toast({ title: "Erreur", description: "Impossible de supprimer", variant: "destructive" });
    }
  };

  const handleAddNewBesoin = () => {
    if (!secretaire) return;
    setNewBesoin({ id: 'new', besoin_operation_id: besoins[0]?.id || '', preference: 1, secretaire_id: secretaire.id });
  };

  if (!secretaire || !localSecretaire) return null;

  const jours = ['', 'Lundi', 'Mardi', 'Mercredi', 'Jeudi', 'Vendredi'];

  const EditableField = ({ field, label, icon: Icon, type = 'text' }: {
    field: keyof typeof editValues;
    label: string;
    icon: any;
    type?: string;
  }) => {
    const value = editValues[field];
    const displayValue = secretaire[field as keyof Secretaire] as string | number;

    return (
      <div className="flex items-center gap-3 py-3 px-1 rounded-lg">
        <Icon className="h-4 w-4 text-muted-foreground shrink-0" />
        <div className="flex-1 min-w-0">
          <p className="text-[11px] font-medium text-muted-foreground uppercase tracking-wide">{label}</p>
          {isEditMode ? (
            <Input
              type={type}
              value={value as string | number}
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

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-5xl max-h-[90vh] overflow-hidden flex flex-col p-0 gap-0">
        {/* Header */}
        <div className="px-6 pt-6 pb-4 border-b border-border/50">
          <div className="flex items-start gap-4 pr-8">
            <div className="flex-1 min-w-0">
              <div className="flex items-center gap-3 mb-1 flex-wrap">
                <h2 className="text-xl font-semibold text-foreground">
                  {secretaire.first_name} {secretaire.name}
                </h2>
                {/* Status Toggle */}
                {canManage && (
                  <>
                    {secretaire.actif !== false ? (
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
                              Êtes-vous sûr de vouloir passer cet assistant en inactif ?
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
                {!canManage && secretaire.actif === false && (
                  <Badge variant="secondary" className="text-xs">Inactif</Badge>
                )}
              </div>
              <div className="flex items-center gap-2 flex-wrap">
                {secretaire.horaire_flexible && (
                  <Badge className="bg-blue-500/10 text-blue-700 dark:text-blue-300 border-blue-500/20 text-xs">
                    Flexible {secretaire.pourcentage_temps && `(${secretaire.pourcentage_temps}%)`}
                  </Badge>
                )}
                {secretaire.prefered_admin && (
                  <Badge className="bg-purple-500/10 text-purple-700 dark:text-purple-300 border-purple-500/20 text-xs">
                    Admin
                  </Badge>
                )}
              </div>
            </div>
          </div>
        </div>

        {/* Content */}
        <div className="flex-1 overflow-y-auto px-6 py-5">
          <div className="grid gap-0 lg:grid-cols-3">
            {/* Left Column - Info */}
            <div className="pr-6">
              <div className="flex items-center justify-between mb-3 px-1">
                <h3 className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">
                  Informations
                </h3>
                {canManage && !isEditMode && (
                  <Button variant="ghost" size="sm" onClick={() => setIsEditMode(true)} className="h-7 px-2 text-xs gap-1.5 text-muted-foreground hover:text-foreground">
                    <Pencil className="h-3 w-3" />
                    Modifier
                  </Button>
                )}
                {isEditMode && (
                  <div className="flex items-center gap-1">
                    <Button variant="ghost" size="sm" onClick={handleCancelEdit} className="h-7 px-2 text-xs text-muted-foreground">
                      <X className="h-3 w-3 mr-1" />
                      Annuler
                    </Button>
                    <Button size="sm" onClick={handleSaveAll} disabled={saving} className="h-7 px-2 text-xs bg-green-600 hover:bg-green-700 text-white">
                      <Check className="h-3 w-3 mr-1" />
                      Enregistrer
                    </Button>
                  </div>
                )}
              </div>

              <div className="space-y-1">
                <EditableField field="first_name" label="Prénom" icon={User} />
                <EditableField field="name" label="Nom" icon={UserCircle} />
                <EditableField field="email" label="Email" icon={Mail} type="email" />
                <EditableField field="phone_number" label="Téléphone" icon={Phone} type="tel" />
              </div>
            </div>

            {/* Middle Column - Assignations */}
            <div className="space-y-6 px-6 border-l border-r border-border/50">
              {/* Médecins assignés */}
              <div>
                <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wider mb-3 flex items-center gap-2">
                  <Stethoscope className="h-3 w-3" />
                  Médecins assignés
                </p>
                <div className="space-y-1">
                  {localSecretaire.medecins_assignes_details?.sort((a, b) => {
                    const p = { '1': 1, '2': 2 };
                    return (p[a.priorite || '1'] || 1) - (p[b.priorite || '1'] || 1);
                  }).map((m) => (
                    <MedecinAssigneLineEdit key={m.id} assignment={m} medecins={medecins} onUpdate={refreshMedecinsAssignes} onDelete={handleDeleteMedecin} />
                  ))}
                  {newMedecin && <MedecinAssigneLineEdit assignment={newMedecin} medecins={medecins} onUpdate={refreshMedecinsAssignes} onDelete={handleDeleteMedecin} isNew />}
                  {canManage && !newMedecin && (
                    <Button variant="outline" size="sm" onClick={handleAddNewMedecin} className="w-full border-dashed mt-1">
                      <Plus className="h-3 w-3 mr-2" />Ajouter
                    </Button>
                  )}
                </div>
              </div>

              {/* Sites préférés */}
              <div>
                <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wider mb-3 flex items-center gap-2">
                  <MapPin className="h-3 w-3" />
                  Sites préférés
                </p>
                <div className="space-y-1">
                  {localSecretaire.sites_assignes_details?.sort((a, b) => {
                    const p = { '1': 1, '2': 2, '3': 3 };
                    return (p[a.priorite || '1'] || 1) - (p[b.priorite || '1'] || 1);
                  }).map((s) => (
                    <SiteAssigneLineEdit key={s.id} assignment={s} sites={sites} onUpdate={refreshSitesAssignes} onDelete={handleDeleteSite} />
                  ))}
                  {newSite && <SiteAssigneLineEdit assignment={newSite} sites={sites} onUpdate={refreshSitesAssignes} onDelete={handleDeleteSite} isNew />}
                  {canManage && !newSite && (
                    <Button variant="outline" size="sm" onClick={handleAddNewSite} className="w-full border-dashed mt-1">
                      <Plus className="h-3 w-3 mr-2" />Ajouter
                    </Button>
                  )}
                </div>
              </div>

              {/* Compétences */}
              <div>
                <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wider mb-3 flex items-center gap-2">
                  <Briefcase className="h-3 w-3" />
                  Compétences opération
                </p>
                <div className="space-y-1">
                  {localSecretaire.besoins_operations?.sort((a, b) => (a.preference || 1) - (b.preference || 1)).map((b) => (
                    <BesoinOperationnelLineEdit key={b.id} assignment={b} besoins={besoins} onUpdate={refreshBesoinsOperations} onDelete={handleDeleteBesoin} />
                  ))}
                  {newBesoin && <BesoinOperationnelLineEdit assignment={newBesoin} besoins={besoins} onUpdate={refreshBesoinsOperations} onDelete={handleDeleteBesoin} isNew />}
                  {canManage && !newBesoin && (
                    <Button variant="outline" size="sm" onClick={handleAddNewBesoin} className="w-full border-dashed mt-1">
                      <Plus className="h-3 w-3 mr-2" />Ajouter
                    </Button>
                  )}
                </div>
              </div>
            </div>

            {/* Right Column - Horaires */}
            <div className="pl-6">
              {/* Horaire flexible */}
              <div className="mb-5 pb-4 border-b border-border/30">
                <div className="flex items-center justify-between gap-3">
                  <div className="flex items-center gap-2">
                    <Switch
                      checked={localSecretaire.horaire_flexible || false}
                      disabled={!canManage}
                      onCheckedChange={async (checked) => {
                        try {
                          const { error } = await supabase
                            .from('secretaires')
                            .update({ horaire_flexible: checked, pourcentage_temps: checked ? (localSecretaire.pourcentage_temps || 100) : 100 })
                            .eq('id', secretaire!.id);
                          if (error) throw error;
                          setLocalSecretaire(prev => prev ? { ...prev, horaire_flexible: checked } : null);
                          onUpdate();
                        } catch (error) {
                          toast({ title: "Erreur", variant: "destructive" });
                        }
                      }}
                      className="scale-90"
                    />
                    <span className="text-sm font-medium">Horaire flexible</span>
                  </div>
                  {localSecretaire.horaire_flexible && (
                    <div className="flex items-center gap-1.5">
                      <Input
                        type="number"
                        value={localSecretaire.pourcentage_temps || 100}
                        disabled={!canManage}
                        onChange={async (e) => {
                          const val = parseInt(e.target.value) || 100;
                          try {
                            const { error } = await supabase
                              .from('secretaires')
                              .update({ pourcentage_temps: val })
                              .eq('id', secretaire!.id);
                            if (error) throw error;
                            setLocalSecretaire(prev => prev ? { ...prev, pourcentage_temps: val } : null);
                            onUpdate();
                          } catch (error) {
                            toast({ title: "Erreur", variant: "destructive" });
                          }
                        }}
                        className="w-16 h-7 text-sm text-center"
                      />
                      <span className="text-xs text-muted-foreground">%</span>
                    </div>
                  )}
                </div>
              </div>

              {/* Préférence Admin */}
              <div className="mb-5 pb-4 border-b border-border/30">
                <div className="flex items-center justify-between gap-3">
                  <div className="flex items-center gap-2">
                    <Switch
                      checked={localSecretaire.prefered_admin || false}
                      disabled={!canManage}
                      onCheckedChange={async (checked) => {
                        try {
                          const { error } = await supabase
                            .from('secretaires')
                            .update({ prefered_admin: checked, nombre_demi_journees_admin: checked ? (localSecretaire.nombre_demi_journees_admin || 0) : 0 })
                            .eq('id', secretaire!.id);
                          if (error) throw error;
                          setLocalSecretaire(prev => prev ? { ...prev, prefered_admin: checked } : null);
                          onUpdate();
                        } catch (error) {
                          toast({ title: "Erreur", variant: "destructive" });
                        }
                      }}
                      className="scale-90"
                    />
                    <span className="text-sm font-medium">Préfère admin</span>
                  </div>
                  {localSecretaire.prefered_admin && (
                    <div className="flex items-center gap-1.5">
                      <Input
                        type="number"
                        value={localSecretaire.nombre_demi_journees_admin || 0}
                        disabled={!canManage}
                        onChange={async (e) => {
                          const val = parseInt(e.target.value) || 0;
                          try {
                            const { error } = await supabase
                              .from('secretaires')
                              .update({ nombre_demi_journees_admin: val })
                              .eq('id', secretaire!.id);
                            if (error) throw error;
                            setLocalSecretaire(prev => prev ? { ...prev, nombre_demi_journees_admin: val } : null);
                            onUpdate();
                          } catch (error) {
                            toast({ title: "Erreur", variant: "destructive" });
                          }
                        }}
                        className="w-16 h-7 text-sm text-center"
                      />
                      <span className="text-xs text-muted-foreground">½j/sem</span>
                    </div>
                  )}
                </div>
              </div>

              <h3 className="text-xs font-semibold text-muted-foreground uppercase tracking-wider mb-3">
                Jours de travail
              </h3>
              <div className="space-y-2">
                {[1, 2, 3, 4, 5].map((jour) => {
                  const horairesJour = (localSecretaire.horaires_base_secretaires?.filter(h => h.jour_semaine === jour) || [])
                    .sort((a, b) => {
                      const ordre = { 'matin': 1, 'apres_midi': 2, 'toute_journee': 3 };
                      return (ordre[a.demi_journee as keyof typeof ordre] || 4) - (ordre[b.demi_journee as keyof typeof ordre] || 4);
                    });

                  return (
                    <div key={jour} className="space-y-1">
                      {horairesJour.length > 0 ? (
                        horairesJour.map((h) => (
                          <HoraireSecretaireLineEdit
                            key={h.id}
                            horaire={h}
                            jour={jours[jour]}
                            sites={sites}
                            onUpdate={refreshHoraires}
                            onDelete={handleDeleteHoraire}
                            hideSiteSelection={true}
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

                {newHoraire && (
                  <HoraireSecretaireLineEdit
                    horaire={newHoraire}
                    jour="Nouveau"
                    sites={sites}
                    onUpdate={refreshHoraires}
                    onDelete={() => setNewHoraire(null)}
                    isNew={true}
                    hideSiteSelection={true}
                  />
                )}

                {canManage && !newHoraire && (
                  <div className="pt-3">
                    <AddHoraireSecretaireDialog onAddNew={handleAddNewHoraire} />
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
