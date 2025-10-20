import { useState, useEffect } from 'react';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
  DialogDescription,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { RadioGroup, RadioGroupItem } from '@/components/ui/radio-group';
import { Label } from '@/components/ui/label';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Badge } from '@/components/ui/badge';
import { supabase } from '@/integrations/supabase/client';
import { useToast } from '@/hooks/use-toast';
import { Loader2, AlertCircle, RefreshCw, UserPlus, User, Trash2 } from 'lucide-react';

interface ChangePersonnelDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  assignment: {
    id: string;
    besoin_operation_id?: string | null;
    besoin_operation_nom?: string;
    secretaire_id: string | null;
    secretaire_nom?: string;
    date: string;
    periode: 'matin' | 'apres_midi';
    operation_nom: string;
    planning_genere_bloc_operatoire_id?: string;
    type_assignation: 'bloc' | 'site' | 'administratif';
    site_id?: string | null;
  };
  onSuccess: () => void;
}

interface PersonnelOption {
  id: string;
  first_name: string;
  name: string;
  secretaires_besoins_operations?: Array<{
    besoin_operation_id: string;
  }>;
}

interface SwapOption extends PersonnelOption {
  assignment_id: string;
  besoin_operation_id?: string | null;
  besoin_operation_nom?: string;
  operation_nom: string;
  is_same_operation?: boolean;
}

interface ReassignOption {
  id: string;
  type: 'bloc' | 'site' | 'administratif';
  label: string;
  assignment_id?: string;
  site_id?: string;
  besoin_operation_id?: string | null;
  besoin_operation_nom?: string;
}

export default function ChangePersonnelDialog({
  open,
  onOpenChange,
  assignment,
  onSuccess,
}: ChangePersonnelDialogProps) {
  const { toast } = useToast();
  const [loading, setLoading] = useState(false);
  const [availablePersonnel, setAvailablePersonnel] = useState<PersonnelOption[]>([]);
  const [swapPersonnel, setSwapPersonnel] = useState<SwapOption[]>([]);
  const [reassignOptions, setReassignOptions] = useState<ReassignOption[]>([]);
  const [selectedPersonId, setSelectedPersonId] = useState<string>('');
  const [selectedReassignOption, setSelectedReassignOption] = useState<string>('none');
  const [action, setAction] = useState<'reassign' | 'swap' | 'remove'>('reassign');

  useEffect(() => {
    if (open) {
      setSelectedPersonId('');
      setSelectedReassignOption('none');
      setAction('reassign');
      fetchPersonnel();
    }
  }, [open, assignment.id]);

  const fetchPersonnel = async () => {
    if (!open) return;
    
    setLoading(true);
    try {
      if (assignment.type_assignation === 'bloc') {
        // Logique pour assignations bloc
        if (!assignment.besoin_operation_id) return;
        
        // 1. Récupérer tous les secrétaires avec leurs compétences bloc
        const { data: allSecretaires, error: secError } = await supabase
          .from('secretaires')
          .select(`
            id, first_name, name,
            secretaires_besoins_operations!inner(besoin_operation_id)
          `)
          .eq('actif', true)
          .eq('secretaires_besoins_operations.besoin_operation_id', assignment.besoin_operation_id);

        if (secError) throw secError;

        // 2. Récupérer toutes les assignations du même jour/période
        const { data: assigned, error: assignError } = await supabase
          .from('planning_genere_personnel')
          .select('secretaire_id')
          .eq('date', assignment.date)
          .eq('periode', assignment.periode)
          .eq('type_assignation', 'bloc')
          .not('secretaire_id', 'is', null);

        if (assignError) throw assignError;

        const assignedIds = new Set((assigned || []).map(a => a.secretaire_id));
        
        // Personnel disponible = compétent ET non assigné
        const available = (allSecretaires || []).filter(p => !assignedIds.has(p.id));
        setAvailablePersonnel(available);
      } else if (assignment.type_assignation === 'site') {
        // Logique pour assignations site
        // 1. Récupérer tous les secrétaires actifs
        const { data: allSecretaires, error: secError } = await supabase
          .from('secretaires')
          .select('id, first_name, name')
          .eq('actif', true);

        if (secError) throw secError;

        // 2. Récupérer toutes les assignations du même jour/période
        const { data: assigned, error: assignError } = await supabase
          .from('planning_genere_personnel')
          .select('secretaire_id')
          .eq('date', assignment.date)
          .eq('periode', assignment.periode)
          .not('secretaire_id', 'is', null);

        if (assignError) throw assignError;

        const assignedIds = new Set((assigned || []).map(a => a.secretaire_id));
        
        // Personnel disponible = non assigné
        const available = (allSecretaires || []).filter(p => !assignedIds.has(p.id));
        setAvailablePersonnel(available);
      }

      // 3. Récupérer le personnel échangeable
      if (assignment.secretaire_id) {
        if (assignment.type_assignation === 'bloc') {
          // Logique d'échange pour le bloc
          // 3a. Personnel de la même opération (rôles différents)
          const { data: sameOp, error: sameOpError } = await supabase
            .from('planning_genere_personnel')
            .select(`
              id,
              secretaire_id,
              besoin_operation_id,
              besoin_operation:besoins_operations!besoin_operation_id(nom),
              secretaires:secretaires!planning_genere_personnel_secretaire_id_fkey(
                id, first_name, name,
                secretaires_besoins_operations(besoin_operation_id)
              )
            `)
            .eq('planning_genere_bloc_operatoire_id', assignment.planning_genere_bloc_operatoire_id)
            .eq('type_assignation', 'bloc')
            .neq('id', assignment.id)
            .neq('besoin_operation_id', assignment.besoin_operation_id)
            .not('secretaire_id', 'is', null);

          if (sameOpError) throw sameOpError;

          // Récupérer les compétences de la personne actuelle
          const { data: currentSecretaire } = await supabase
            .from('secretaires')
            .select('id, secretaires_besoins_operations(besoin_operation_id)')
            .eq('id', assignment.secretaire_id)
            .single();

          // Vérification bidirectionnelle pour même opération
          const validSameOp = (sameOp || [])
            .filter(s => {
              if (!s.secretaires || !currentSecretaire || !assignment.besoin_operation_id || !s.besoin_operation_id) return false;
              
              const targetHasCurrentSkill = currentSecretaire.secretaires_besoins_operations?.some(
                (sb: any) => sb.besoin_operation_id === s.besoin_operation_id
              );
              const currentHasTargetSkill = s.secretaires.secretaires_besoins_operations?.some(
                (sb: any) => sb.besoin_operation_id === assignment.besoin_operation_id
              );
              
              return targetHasCurrentSkill && currentHasTargetSkill;
            })
            .map(s => ({
              ...s.secretaires!,
              assignment_id: s.id,
              besoin_operation_id: s.besoin_operation_id,
              besoin_operation_nom: s.besoin_operation?.nom,
              operation_nom: `${assignment.operation_nom} (même opération)`,
              is_same_operation: true
            }));

          // 3b. Personnel d'autres opérations bloc
          const { data: otherOps, error: otherOpsError } = await supabase
            .from('planning_genere_personnel')
            .select(`
              id,
              secretaire_id,
              besoin_operation_id,
              besoin_operation:besoins_operations!besoin_operation_id(nom),
              planning_genere_bloc_operatoire_id,
              secretaires:secretaires!planning_genere_personnel_secretaire_id_fkey(
                id, first_name, name,
                secretaires_besoins_operations(besoin_operation_id)
              ),
              operation:planning_genere_bloc_operatoire_id(
                type_intervention:type_intervention_id(nom)
              )
            `)
            .eq('date', assignment.date)
            .eq('periode', assignment.periode)
            .eq('type_assignation', 'bloc')
            .neq('planning_genere_bloc_operatoire_id', assignment.planning_genere_bloc_operatoire_id)
            .neq('id', assignment.id)
            .not('secretaire_id', 'is', null);

          if (otherOpsError) throw otherOpsError;

          // 3c. Personnel en administratif avec compétences bloc
          const { data: adminPersonnel, error: adminError } = await supabase
            .from('planning_genere_personnel')
            .select(`
              id,
              secretaire_id,
              secretaires:secretaires!planning_genere_personnel_secretaire_id_fkey(
                id, first_name, name,
                secretaires_besoins_operations(besoin_operation_id)
              )
            `)
            .eq('date', assignment.date)
            .eq('periode', assignment.periode)
            .eq('type_assignation', 'administratif')
            .not('secretaire_id', 'is', null);

          if (adminError) throw adminError;

          // Vérification pour autres opérations bloc
          const validOtherOps = (otherOps || [])
            .filter(s => {
              if (!s.secretaires || !currentSecretaire || !s.besoin_operation_id) return false;
              
              const targetHasCurrentSkill = assignment.besoin_operation_id && currentSecretaire.secretaires_besoins_operations?.some(
                (sb: any) => sb.besoin_operation_id === s.besoin_operation_id
              );
              const currentHasTargetSkill = s.secretaires.secretaires_besoins_operations?.some(
                (sb: any) => sb.besoin_operation_id === assignment.besoin_operation_id
              );
              
              return targetHasCurrentSkill && currentHasTargetSkill;
            })
            .map(s => ({
              ...s.secretaires!,
              assignment_id: s.id,
              besoin_operation_id: s.besoin_operation_id,
              besoin_operation_nom: s.besoin_operation?.nom,
              operation_nom: s.operation?.type_intervention?.nom || 'Opération',
              is_same_operation: false
            }));

          // Vérification pour personnel administratif avec compétences bloc
          const validAdminPersonnel = (adminPersonnel || [])
            .filter(s => {
              if (!s.secretaires || !currentSecretaire) return false;
              // Le personnel admin doit pouvoir faire le rôle actuel
              const targetHasCurrentSkill = assignment.besoin_operation_id && s.secretaires.secretaires_besoins_operations?.some(
                (sb: any) => sb.besoin_operation_id === assignment.besoin_operation_id
              );
              
              return targetHasCurrentSkill;
            })
            .map(s => ({
              ...s.secretaires!,
              assignment_id: s.id,
              besoin_operation_id: null,
              besoin_operation_nom: undefined,
              operation_nom: 'Administratif',
              is_same_operation: false
            }));

          // Combiner les trois listes
          setSwapPersonnel([...validSameOp, ...validOtherOps, ...validAdminPersonnel]);
        } else if (assignment.type_assignation === 'site') {
          // Logique d'échange pour les sites
          // 3a. Personnel d'autres sites
          const { data: otherSites, error: otherSitesError } = await supabase
            .from('planning_genere_personnel')
            .select(`
              id,
              secretaire_id,
              site_id,
              secretaires:secretaires!planning_genere_personnel_secretaire_id_fkey(
                id, first_name, name
              ),
              sites:sites!planning_genere_personnel_site_id_fkey(
                nom
              )
            `)
            .eq('date', assignment.date)
            .eq('periode', assignment.periode)
            .eq('type_assignation', 'site')
            .neq('id', assignment.id)
            .not('secretaire_id', 'is', null);

          if (otherSitesError) throw otherSitesError;

          // 3b. Personnel en administratif
          const { data: adminPersonnel, error: adminError } = await supabase
            .from('planning_genere_personnel')
            .select(`
              id,
              secretaire_id,
              secretaires:secretaires!planning_genere_personnel_secretaire_id_fkey(
                id, first_name, name
              )
            `)
            .eq('date', assignment.date)
            .eq('periode', assignment.periode)
            .eq('type_assignation', 'administratif')
            .not('secretaire_id', 'is', null);

          if (adminError) throw adminError;

          const validOtherSites = (otherSites || [])
            .map(s => ({
              ...s.secretaires!,
              assignment_id: s.id,
              besoin_operation_id: null,
              besoin_operation_nom: undefined,
              operation_nom: `Site: ${s.sites?.nom || 'Inconnu'}`,
              is_same_operation: false,
              site_id: s.site_id
            }));

          const validAdminPersonnel = (adminPersonnel || [])
            .map(s => ({
              ...s.secretaires!,
              assignment_id: s.id,
              besoin_operation_id: null,
              besoin_operation_nom: undefined,
              operation_nom: 'Administratif',
              is_same_operation: false
            }));

          // Combiner les deux listes
          setSwapPersonnel([...validOtherSites, ...validAdminPersonnel]);
        }

        // 5. Récupérer les options de réassignation si l'utilisateur veut retirer
        await fetchReassignOptions();
      }
    } catch (error) {
      console.error('Erreur lors du chargement du personnel:', error);
      toast({
        title: 'Erreur',
        description: 'Impossible de charger le personnel disponible',
        variant: 'destructive',
      });
    } finally {
      setLoading(false);
    }
  };

  const fetchReassignOptions = async () => {
    if (!assignment.secretaire_id) return;

    const options: ReassignOption[] = [];

    try {
      // Récupérer les compétences de la personne
      const { data: currentSecretaire } = await supabase
        .from('secretaires')
        .select('id, secretaires_besoins_operations(besoin_operation_id)')
        .eq('id', assignment.secretaire_id)
        .single();

      if (!currentSecretaire) return;

      // 1. Postes libres dans d'autres opérations bloc
      const { data: emptyBlocPosts } = await supabase
        .from('planning_genere_personnel')
        .select(`
          id,
          besoin_operation_id,
          besoin_operation:besoins_operations!besoin_operation_id(nom),
          planning_genere_bloc_operatoire_id,
          operation:planning_genere_bloc_operatoire_id(
            type_intervention:type_intervention_id(nom)
          )
        `)
        .eq('date', assignment.date)
        .eq('periode', assignment.periode)
        .eq('type_assignation', 'bloc')
        .neq('planning_genere_bloc_operatoire_id', assignment.planning_genere_bloc_operatoire_id)
        .is('secretaire_id', null);

      const validBlocPosts = (emptyBlocPosts || []).filter(post => 
        post.besoin_operation_id && currentSecretaire.secretaires_besoins_operations?.some(
          (sb: any) => sb.besoin_operation_id === post.besoin_operation_id
        )
      );

      validBlocPosts.forEach(post => {
        options.push({
          id: post.id,
          type: 'bloc',
          label: `${post.operation?.type_intervention?.nom || 'Opération'} - ${post.besoin_operation?.nom || 'Personnel'}`,
          assignment_id: post.id,
          besoin_operation_id: post.besoin_operation_id,
          besoin_operation_nom: post.besoin_operation?.nom,
        });
      });

      // 2. Récupérer les sites disponibles (qui ont au moins un médecin ce jour)
      const { data: sitesWithNeeds } = await supabase
        .from('besoin_effectif')
        .select('site_id, sites:sites(id, nom)')
        .eq('date', assignment.date)
        .eq('type', 'medecin')
        .not('site_id', 'is', null);

      const uniqueSites = Array.from(
        new Set((sitesWithNeeds || []).map(s => s.site_id))
      ).map(siteId => {
        const siteData = sitesWithNeeds?.find(s => s.site_id === siteId)?.sites;
        return siteData;
      }).filter(Boolean);

      // Vérifier si la personne n'est pas déjà assignée à ces sites
      const { data: existingSiteAssignments } = await supabase
        .from('planning_genere_personnel')
        .select('site_id')
        .eq('date', assignment.date)
        .eq('periode', assignment.periode)
        .eq('secretaire_id', assignment.secretaire_id)
        .eq('type_assignation', 'site');

      const assignedSiteIds = new Set((existingSiteAssignments || []).map(a => a.site_id));

      uniqueSites.forEach(site => {
        if (site && !assignedSiteIds.has(site.id)) {
          options.push({
            id: `site-${site.id}`,
            type: 'site',
            label: `Site: ${site.nom}`,
            site_id: site.id,
          });
        }
      });

      // 3. Option administrative (si pas déjà assignée)
      const { data: existingAdmin } = await supabase
        .from('planning_genere_personnel')
        .select('id')
        .eq('date', assignment.date)
        .eq('periode', assignment.periode)
        .eq('secretaire_id', assignment.secretaire_id)
        .eq('type_assignation', 'administratif')
        .maybeSingle();

      if (!existingAdmin) {
        options.push({
          id: 'admin',
          type: 'administratif',
          label: 'Assignation administrative',
        });
      }

      setReassignOptions(options);
    } catch (error) {
      console.error('Erreur lors du chargement des options de réassignation:', error);
    }
  };

  const handleSubmit = async () => {
    if (action !== 'remove' && !selectedPersonId) {
      toast({
        title: 'Attention',
        description: 'Veuillez sélectionner un personnel',
        variant: 'destructive',
      });
      return;
    }

    setLoading(true);
    try {
      if (action === 'reassign') {
        // Réassignation simple
        const { error } = await supabase
          .from('planning_genere_personnel')
          .update({ secretaire_id: selectedPersonId })
          .eq('id', assignment.id);

        if (error) throw error;

        toast({
          title: 'Succès',
          description: assignment.secretaire_id ? 'Personnel réassigné avec succès' : 'Personnel assigné avec succès',
        });
      } else if (action === 'swap') {
        // Échange (même opération, autre opération, ou avec administratif)
        const targetPerson = swapPersonnel.find(p => p.id === selectedPersonId);
        if (!targetPerson) throw new Error('Personnel cible introuvable');

        if (assignment.type_assignation === 'bloc' && targetPerson.operation_nom === 'Administratif') {
          // Échange bloc <-> administratif
          // 1. Retirer la personne actuelle du bloc
          const { error: error1 } = await supabase
            .from('planning_genere_personnel')
            .update({ secretaire_id: null })
            .eq('id', assignment.id);

          if (error1) throw error1;

          // 2. Assigner la personne actuelle en administratif (créer nouvelle ligne)
          const { error: error2 } = await supabase
            .from('planning_genere_personnel')
            .insert({
              date: assignment.date,
              periode: assignment.periode,
              secretaire_id: assignment.secretaire_id,
              type_assignation: 'administratif',
            });

          if (error2) throw error2;

          // 3. Supprimer l'assignation administrative de la cible
          const { error: error3 } = await supabase
            .from('planning_genere_personnel')
            .delete()
            .eq('id', targetPerson.assignment_id);

          if (error3) throw error3;

          // 4. Assigner la cible au bloc
          const { error: error4 } = await supabase
            .from('planning_genere_personnel')
            .update({ secretaire_id: targetPerson.id })
            .eq('id', assignment.id);

          if (error4) throw error4;

          toast({
            title: 'Succès',
            description: 'Échange effectué avec le personnel administratif',
          });
        } else if (assignment.type_assignation === 'site' && targetPerson.operation_nom === 'Administratif') {
          // Échange site <-> administratif
          // 1. Retirer la personne actuelle du site
          const { error: error1 } = await supabase
            .from('planning_genere_personnel')
            .update({ secretaire_id: null })
            .eq('id', assignment.id);

          if (error1) throw error1;

          // 2. Assigner la personne actuelle en administratif (créer nouvelle ligne)
          const { error: error2 } = await supabase
            .from('planning_genere_personnel')
            .insert({
              date: assignment.date,
              periode: assignment.periode,
              secretaire_id: assignment.secretaire_id,
              type_assignation: 'administratif',
            });

          if (error2) throw error2;

          // 3. Supprimer l'assignation administrative de la cible
          const { error: error3 } = await supabase
            .from('planning_genere_personnel')
            .delete()
            .eq('id', targetPerson.assignment_id);

          if (error3) throw error3;

          // 4. Assigner la cible au site
          const { error: error4 } = await supabase
            .from('planning_genere_personnel')
            .update({ secretaire_id: targetPerson.id })
            .eq('id', assignment.id);

          if (error4) throw error4;

          toast({
            title: 'Succès',
            description: 'Échange effectué avec le personnel administratif',
          });
        } else {
          // Échange classique entre postes (bloc <-> bloc ou site <-> site)
          const { error: error1 } = await supabase
            .from('planning_genere_personnel')
            .update({ secretaire_id: targetPerson.id })
            .eq('id', assignment.id);

          if (error1) throw error1;

          const { error: error2 } = await supabase
            .from('planning_genere_personnel')
            .update({ secretaire_id: assignment.secretaire_id })
            .eq('id', targetPerson.assignment_id);

          if (error2) throw error2;

          toast({
            title: 'Succès',
            description: targetPerson.is_same_operation 
              ? 'Échange effectué dans la même opération' 
              : 'Échange effectué',
          });
        }
      } else if (action === 'remove') {
        // Retirer le personnel du poste actuel
        const { error: removeError } = await supabase
          .from('planning_genere_personnel')
          .update({ secretaire_id: null })
          .eq('id', assignment.id);

        if (removeError) throw removeError;

        // Si une option de réassignation est sélectionnée, créer/assigner
        if (selectedReassignOption && selectedReassignOption !== 'none') {
          const option = reassignOptions.find(o => o.id === selectedReassignOption);
          if (option) {
            if (option.type === 'bloc') {
              // Assigner à un poste bloc vide
              const { error: assignError } = await supabase
                .from('planning_genere_personnel')
                .update({ secretaire_id: assignment.secretaire_id })
                .eq('id', option.assignment_id);

              if (assignError) throw assignError;
            } else if (option.type === 'site') {
              // Créer une nouvelle assignation site
              const { error: createError } = await supabase
                .from('planning_genere_personnel')
                .insert({
                  date: assignment.date,
                  periode: assignment.periode,
                  secretaire_id: assignment.secretaire_id,
                  type_assignation: 'site',
                  site_id: option.site_id,
                });

              if (createError) throw createError;
            } else if (option.type === 'administratif') {
              // Créer une nouvelle assignation administrative
              const { error: createError } = await supabase
                .from('planning_genere_personnel')
                .insert({
                  date: assignment.date,
                  periode: assignment.periode,
                  secretaire_id: assignment.secretaire_id,
                  type_assignation: 'administratif',
                });

              if (createError) throw createError;
            }
          }
        }

        toast({
          title: 'Succès',
          description: selectedReassignOption && selectedReassignOption !== 'none'
            ? 'Personnel retiré et réassigné ailleurs'
            : 'Personnel retiré du poste',
        });
      }

      onSuccess();
      onOpenChange(false);
    } catch (error) {
      console.error('Erreur lors de la modification:', error);
      toast({
        title: 'Erreur',
        description: 'Impossible de modifier le personnel',
        variant: 'destructive',
      });
    } finally {
      setLoading(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Modifier l'assignation de personnel</DialogTitle>
          <DialogDescription>
            Opération : {assignment.operation_nom} - {assignment.date} ({assignment.periode === 'matin' ? 'Matin' : 'Après-midi'})
          </DialogDescription>
        </DialogHeader>

        {loading && availablePersonnel.length === 0 ? (
          <div className="flex items-center justify-center py-8">
            <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
          </div>
        ) : (
          <div className="space-y-4">
            {assignment.type_assignation === 'bloc' && assignment.besoin_operation_nom && (
              <div className="flex items-center gap-2 text-sm text-muted-foreground">
                <User className="h-4 w-4" />
                <span>Rôle requis: <strong>{assignment.besoin_operation_nom}</strong></span>
              </div>
            )}
            
            {assignment.type_assignation === 'site' && (
              <div className="flex items-center gap-2 text-sm text-muted-foreground">
                <User className="h-4 w-4" />
                <span>Type: <strong>Assignation Site</strong></span>
              </div>
            )}

            {assignment.secretaire_nom && (
              <div className="flex items-center gap-2 text-sm">
                <span>Actuellement assigné: <strong>{assignment.secretaire_nom}</strong></span>
              </div>
            )}

            {!assignment.secretaire_id ? (
              // Poste vide : uniquement assignation
              <>
                <RadioGroup value={action} onValueChange={(value) => setAction(value as any)}>
                  <div className="flex items-center space-x-2">
                    <RadioGroupItem value="reassign" id="reassign" />
                    <Label htmlFor="reassign" className="flex items-center gap-2 cursor-pointer">
                      <UserPlus className="h-4 w-4" />
                      Assigner une personne disponible ({availablePersonnel.length})
                    </Label>
                  </div>
                </RadioGroup>

                {availablePersonnel.length === 0 ? (
                  <Alert>
                    <AlertCircle className="h-4 w-4" />
                    <AlertDescription>
                      Aucun personnel disponible avec les compétences requises pour ce rôle.
                    </AlertDescription>
                  </Alert>
                ) : (
                  <div className="space-y-2">
                    <Label>Sélectionner un personnel disponible</Label>
                    <RadioGroup value={selectedPersonId} onValueChange={setSelectedPersonId}>
                      {availablePersonnel.map(person => (
                        <div key={person.id} className="flex items-center space-x-2">
                          <RadioGroupItem value={person.id} id={person.id} />
                          <Label htmlFor={person.id} className="cursor-pointer flex-1">
                            {person.first_name} {person.name}
                          </Label>
                        </div>
                      ))}
                    </RadioGroup>
                  </div>
                )}
              </>
            ) : (
              // Poste occupé : toutes les options
              <>
                <RadioGroup value={action} onValueChange={(value) => setAction(value as any)}>
                  <div className="space-y-3">
                    <div className="flex items-center space-x-2">
                      <RadioGroupItem value="reassign" id="reassign" />
                      <Label htmlFor="reassign" className="flex items-center gap-2 cursor-pointer">
                        <UserPlus className="h-4 w-4" />
                        Réassigner à une personne disponible ({availablePersonnel.length})
                      </Label>
                    </div>

                    {swapPersonnel.length > 0 && (
                      <div className="flex items-center space-x-2">
                        <RadioGroupItem value="swap" id="swap" />
                        <Label htmlFor="swap" className="flex items-center gap-2 cursor-pointer">
                          <RefreshCw className="h-4 w-4" />
                          Échanger avec un autre personnel ({swapPersonnel.length})
                        </Label>
                      </div>
                    )}

                    <div className="flex items-center space-x-2">
                      <RadioGroupItem value="remove" id="remove" />
                      <Label htmlFor="remove" className="flex items-center gap-2 cursor-pointer text-destructive">
                        <Trash2 className="h-4 w-4" />
                        Retirer du poste
                      </Label>
                    </div>
                  </div>
                </RadioGroup>

                {action === 'reassign' && (
                  <>
                    {availablePersonnel.length === 0 ? (
                      <Alert>
                        <AlertCircle className="h-4 w-4" />
                        <AlertDescription>
                          Aucun personnel disponible avec les compétences requises pour ce rôle.
                        </AlertDescription>
                      </Alert>
                    ) : (
                      <div className="space-y-2">
                        <Label>Sélectionner un personnel disponible</Label>
                        <RadioGroup value={selectedPersonId} onValueChange={setSelectedPersonId}>
                          {availablePersonnel.map(person => (
                            <div key={person.id} className="flex items-center space-x-2">
                              <RadioGroupItem value={person.id} id={person.id} />
                              <Label htmlFor={person.id} className="cursor-pointer flex-1">
                                {person.first_name} {person.name}
                              </Label>
                            </div>
                          ))}
                        </RadioGroup>
                      </div>
                    )}
                  </>
                )}

                {action === 'swap' && (
                  <>
                    {swapPersonnel.length === 0 ? (
                      <Alert>
                        <AlertCircle className="h-4 w-4" />
                        <AlertDescription>
                          Aucun échange possible pour ce rôle.
                        </AlertDescription>
                      </Alert>
                    ) : (
                      <div className="space-y-2">
                        <Label>Sélectionner un personnel à échanger</Label>
                        <RadioGroup value={selectedPersonId} onValueChange={setSelectedPersonId}>
                          {swapPersonnel.map(person => (
                            <div key={person.id} className="flex items-center space-x-2">
                              <RadioGroupItem value={person.id} id={person.id} />
                              <Label htmlFor={person.id} className="cursor-pointer flex-1">
                                <div>
                                  <div>{person.first_name} {person.name}</div>
                                  <div className="text-xs text-muted-foreground">
                                    {person.operation_nom} - {person.besoin_operation_nom || 'Personnel'}
                                  </div>
                                </div>
                              </Label>
                            </div>
                          ))}
                        </RadioGroup>
                      </div>
                    )}
                  </>
                )}

                {action === 'remove' && (
                  <>
                    <Alert variant="destructive">
                      <AlertCircle className="h-4 w-4" />
                      <AlertDescription>
                        Le poste sera libéré. Vous pouvez optionnellement réassigner {assignment.secretaire_nom?.split(' ')[0]} ailleurs.
                      </AlertDescription>
                    </Alert>

                    {reassignOptions.length > 0 && (
                      <div className="space-y-2">
                        <Label>Réassigner ailleurs (optionnel)</Label>
                        <RadioGroup value={selectedReassignOption} onValueChange={setSelectedReassignOption}>
                          <div className="flex items-center space-x-2">
                            <RadioGroupItem value="none" id="none" />
                            <Label htmlFor="none" className="cursor-pointer flex-1">
                              Ne pas réassigner
                            </Label>
                          </div>
                          
                          {reassignOptions.map(option => (
                            <div key={option.id} className="flex items-center space-x-2">
                              <RadioGroupItem value={option.id} id={option.id} />
                              <Label htmlFor={option.id} className="cursor-pointer flex-1">
                                <div className="flex items-center gap-2">
                                  {option.type === 'bloc' && <Badge variant="outline" className="text-xs">Bloc</Badge>}
                                  {option.type === 'site' && <Badge variant="outline" className="text-xs bg-blue-50">Site</Badge>}
                                  {option.type === 'administratif' && <Badge variant="outline" className="text-xs bg-gray-100">Admin</Badge>}
                                  <span>{option.label}</span>
                                </div>
                              </Label>
                            </div>
                          ))}
                        </RadioGroup>
                      </div>
                    )}
                  </>
                )}
              </>
            )}
          </div>
        )}

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            Annuler
          </Button>
          <Button 
            onClick={handleSubmit} 
            disabled={loading || (action !== 'remove' && !selectedPersonId)}
            variant={action === 'remove' ? 'destructive' : 'default'}
          >
            {loading ? 'Chargement...' : 
              action === 'reassign' ? (assignment.secretaire_id ? 'Réassigner' : 'Assigner') :
              action === 'swap' ? 'Échanger' :
              'Retirer'
            }
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
