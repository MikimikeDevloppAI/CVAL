import { useState, useEffect } from 'react';
import { ArrowLeft, Mail, Phone, Stethoscope, Users, User, UserCircle, Check, Loader2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { supabase } from '@/integrations/supabase/client';
import { useToast } from '@/hooks/use-toast';
import { Medecin } from './useMedecins';

interface Specialite {
  id: string;
  nom: string;
}

interface MedecinFormCardProps {
  medecin?: Medecin | null;
  onSuccess: () => void;
  onBack: () => void;
}

export function MedecinFormCard({ medecin, onSuccess, onBack }: MedecinFormCardProps) {
  const { toast } = useToast();
  const [specialites, setSpecialites] = useState<Specialite[]>([]);
  const [saving, setSaving] = useState(false);

  const [formValues, setFormValues] = useState({
    first_name: '',
    name: '',
    email: '',
    phone_number: '',
    specialite_id: '',
    besoin_secretaires: 1,
  });

  const [errors, setErrors] = useState<Record<string, string>>({});

  useEffect(() => {
    fetchSpecialites();
    if (medecin) {
      setFormValues({
        first_name: medecin.first_name || '',
        name: medecin.name || '',
        email: medecin.email || '',
        phone_number: medecin.phone_number || '',
        specialite_id: medecin.specialite_id || '',
        besoin_secretaires: medecin.besoin_secretaires ?? 1,
      });
    }
  }, [medecin]);

  const fetchSpecialites = async () => {
    const { data } = await supabase
      .from('specialites')
      .select('id, nom')
      .order('nom');

    if (data) setSpecialites(data);
  };

  const validate = () => {
    const newErrors: Record<string, string> = {};

    if (!formValues.first_name.trim()) {
      newErrors.first_name = 'Le prénom est requis';
    }
    if (!formValues.name.trim()) {
      newErrors.name = 'Le nom est requis';
    }
    if (!formValues.specialite_id) {
      newErrors.specialite_id = 'La spécialité est requise';
    }
    if (formValues.email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(formValues.email)) {
      newErrors.email = 'Email invalide';
    }

    setErrors(newErrors);
    return Object.keys(newErrors).length === 0;
  };

  const handleSave = async () => {
    if (!validate()) {
      toast({
        title: "Validation",
        description: "Veuillez corriger les champs en erreur",
        variant: "destructive",
      });
      return;
    }

    setSaving(true);
    try {
      if (medecin) {
        const { error } = await supabase
          .from('medecins')
          .update({
            first_name: formValues.first_name.trim(),
            name: formValues.name.trim(),
            email: formValues.email.trim() || null,
            phone_number: formValues.phone_number.trim() || null,
            specialite_id: formValues.specialite_id,
            besoin_secretaires: formValues.besoin_secretaires,
          })
          .eq('id', medecin.id);

        if (error) throw error;

        toast({
          title: "Succès",
          description: "Médecin modifié avec succès",
        });
      } else {
        const { error } = await supabase
          .from('medecins')
          .insert({
            first_name: formValues.first_name.trim(),
            name: formValues.name.trim(),
            email: formValues.email.trim() || null,
            phone_number: formValues.phone_number.trim() || null,
            specialite_id: formValues.specialite_id,
            besoin_secretaires: formValues.besoin_secretaires,
          });

        if (error) throw error;

        toast({
          title: "Succès",
          description: "Médecin créé avec succès",
        });
      }

      onSuccess();
    } catch (error) {
      console.error('Erreur:', error);
      toast({
        title: "Erreur",
        description: "Une erreur est survenue",
        variant: "destructive",
      });
    } finally {
      setSaving(false);
    }
  };

  const initials = `${formValues.first_name?.[0] || '?'}${formValues.name?.[0] || '?'}`;

  const FormField = ({
    field,
    label,
    icon: Icon,
    type = 'text',
    placeholder = '',
  }: {
    field: keyof typeof formValues;
    label: string;
    icon: any;
    type?: string;
    placeholder?: string;
  }) => {
    const value = formValues[field];
    const error = errors[field];

    return (
      <div className="flex items-start gap-3 py-3 px-1 rounded-lg">
        <Icon className="h-4 w-4 text-muted-foreground shrink-0 mt-2.5" />

        <div className="flex-1 min-w-0">
          <p className="text-[11px] font-medium text-muted-foreground uppercase tracking-wide">{label}</p>
          <Input
            type={type}
            value={value as string | number}
            onChange={(e) => {
              setFormValues(prev => ({
                ...prev,
                [field]: type === 'number' ? parseFloat(e.target.value) || 0 : e.target.value
              }));
              if (errors[field]) {
                setErrors(prev => ({ ...prev, [field]: '' }));
              }
            }}
            placeholder={placeholder}
            className={`h-9 text-sm mt-1 ${error ? 'border-destructive' : ''}`}
          />
          {error && <p className="text-xs text-destructive mt-1">{error}</p>}
        </div>
      </div>
    );
  };

  return (
    <div className="backdrop-blur-xl bg-card/95 rounded-2xl border border-border/50 shadow-xl overflow-hidden animate-fade-in">
      {/* Header */}
      <div className="px-6 pt-6 pb-4 border-b border-border/50">
        <div className="flex items-start gap-4">
          <Button
            variant="ghost"
            size="icon"
            onClick={onBack}
            className="h-9 w-9 rounded-xl hover:bg-teal-500/10 shrink-0"
          >
            <ArrowLeft className="h-4 w-4" />
          </Button>

          <div className="w-14 h-14 rounded-xl bg-gradient-to-br from-teal-500 to-emerald-600 flex items-center justify-center shadow-lg shadow-teal-500/20">
            <span className="text-lg font-bold text-white">
              {initials}
            </span>
          </div>

          <div className="flex-1 min-w-0">
            <h2 className="text-xl font-semibold text-foreground">
              {medecin ? 'Modifier le médecin' : 'Nouveau médecin'}
            </h2>
            <p className="text-sm text-muted-foreground mt-0.5">
              {medecin ? 'Modifiez les informations du médecin' : 'Remplissez les informations du nouveau médecin'}
            </p>
          </div>
        </div>
      </div>

      {/* Content */}
      <div className="px-6 py-5">
        <div className="grid gap-0 lg:grid-cols-2">
          {/* Left Column - Basic Info */}
          <div className="lg:pr-6 lg:border-r lg:border-border/50">
            <h3 className="text-xs font-semibold text-muted-foreground uppercase tracking-wider mb-3 px-1">
              Informations personnelles
            </h3>

            <div className="space-y-1">
              <FormField
                field="first_name"
                label="Prénom"
                icon={User}
                placeholder="Prénom du médecin"
              />

              <FormField
                field="name"
                label="Nom"
                icon={UserCircle}
                placeholder="Nom du médecin"
              />

              <FormField
                field="email"
                label="Email"
                icon={Mail}
                type="email"
                placeholder="email@example.com"
              />

              <FormField
                field="phone_number"
                label="Téléphone"
                icon={Phone}
                type="tel"
                placeholder="+33 1 23 45 67 89"
              />
            </div>
          </div>

          {/* Right Column - Professional Info */}
          <div className="lg:pl-6 mt-6 lg:mt-0">
            <h3 className="text-xs font-semibold text-muted-foreground uppercase tracking-wider mb-3 px-1">
              Informations professionnelles
            </h3>

            <div className="space-y-1">
              {/* Spécialité */}
              <div className="flex items-start gap-3 py-3 px-1 rounded-lg">
                <Stethoscope className="h-4 w-4 text-muted-foreground shrink-0 mt-2.5" />

                <div className="flex-1 min-w-0">
                  <p className="text-[11px] font-medium text-muted-foreground uppercase tracking-wide">Spécialité</p>
                  <Select
                    value={formValues.specialite_id}
                    onValueChange={(val) => {
                      setFormValues(prev => ({ ...prev, specialite_id: val }));
                      if (errors.specialite_id) {
                        setErrors(prev => ({ ...prev, specialite_id: '' }));
                      }
                    }}
                  >
                    <SelectTrigger className={`h-9 text-sm mt-1 ${errors.specialite_id ? 'border-destructive' : ''}`}>
                      <SelectValue placeholder="Sélectionner une spécialité" />
                    </SelectTrigger>
                    <SelectContent>
                      {specialites.map((s) => (
                        <SelectItem key={s.id} value={s.id}>{s.nom}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                  {errors.specialite_id && <p className="text-xs text-destructive mt-1">{errors.specialite_id}</p>}
                </div>
              </div>

              <FormField
                field="besoin_secretaires"
                label="Besoin en assistants médicaux"
                icon={Users}
                type="number"
                placeholder="1"
              />
            </div>

            {/* Info box */}
            <div className="mt-6 p-4 rounded-xl bg-muted/30 border border-border/30">
              <p className="text-xs text-muted-foreground">
                Vous pourrez configurer les horaires de travail après avoir créé le médecin en cliquant sur sa fiche.
              </p>
            </div>
          </div>
        </div>
      </div>

      {/* Footer */}
      <div className="px-6 py-4 border-t border-border/50 bg-muted/20 flex justify-end gap-3">
        <Button
          variant="outline"
          onClick={onBack}
          disabled={saving}
        >
          Annuler
        </Button>
        <Button
          onClick={handleSave}
          disabled={saving}
          className="bg-gradient-to-r from-teal-500 to-emerald-500 hover:from-teal-600 hover:to-emerald-600 text-white"
        >
          {saving && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
          {saving ? 'Enregistrement...' : (
            <>
              <Check className="h-4 w-4 mr-2" />
              Enregistrer
            </>
          )}
        </Button>
      </div>
    </div>
  );
}
