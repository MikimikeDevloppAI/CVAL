import { useState, useEffect } from 'react';
import { ArrowLeft, Mail, Phone, User, UserCircle, Check, Loader2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Switch } from '@/components/ui/switch';
import { supabase } from '@/integrations/supabase/client';
import { useToast } from '@/hooks/use-toast';
import type { Secretaire } from './useSecretaires';

interface SecretaireFormCardProps {
  secretaire?: Secretaire | null;
  onSuccess: () => void;
  onBack: () => void;
}

export function SecretaireFormCard({ secretaire, onSuccess, onBack }: SecretaireFormCardProps) {
  const { toast } = useToast();
  const [saving, setSaving] = useState(false);

  const [formValues, setFormValues] = useState({
    first_name: '',
    name: '',
    email: '',
    phone_number: '',
    horaire_flexible: false,
    pourcentage_temps: 100,
    prefered_admin: false,
    nombre_demi_journees_admin: 0,
  });

  const [errors, setErrors] = useState<Record<string, string>>({});

  useEffect(() => {
    if (secretaire) {
      setFormValues({
        first_name: secretaire.first_name || '',
        name: secretaire.name || '',
        email: secretaire.email || '',
        phone_number: secretaire.phone_number || '',
        horaire_flexible: secretaire.horaire_flexible || false,
        pourcentage_temps: secretaire.pourcentage_temps || 100,
        prefered_admin: secretaire.prefered_admin || false,
        nombre_demi_journees_admin: secretaire.nombre_demi_journees_admin || 0,
      });
    }
  }, [secretaire]);

  const validate = () => {
    const newErrors: Record<string, string> = {};

    if (!formValues.first_name.trim()) {
      newErrors.first_name = 'Le prénom est requis';
    }
    if (!formValues.name.trim()) {
      newErrors.name = 'Le nom est requis';
    }
    if (formValues.email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(formValues.email)) {
      newErrors.email = 'Email invalide';
    }
    if (formValues.horaire_flexible && (!formValues.pourcentage_temps || formValues.pourcentage_temps <= 0)) {
      newErrors.pourcentage_temps = 'Le pourcentage est requis pour un horaire flexible';
    }
    if (formValues.prefered_admin && (!formValues.nombre_demi_journees_admin || formValues.nombre_demi_journees_admin <= 0)) {
      newErrors.nombre_demi_journees_admin = 'Le nombre de demi-journées est requis';
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
      if (secretaire) {
        const { error } = await supabase
          .from('secretaires')
          .update({
            first_name: formValues.first_name.trim(),
            name: formValues.name.trim(),
            email: formValues.email.trim() || null,
            phone_number: formValues.phone_number.trim() || null,
            horaire_flexible: formValues.horaire_flexible,
            pourcentage_temps: formValues.horaire_flexible ? formValues.pourcentage_temps : null,
            prefered_admin: formValues.prefered_admin,
            nombre_demi_journees_admin: formValues.prefered_admin ? formValues.nombre_demi_journees_admin : null,
          })
          .eq('id', secretaire.id);

        if (error) throw error;

        toast({
          title: "Succès",
          description: "Assistant médical modifié avec succès",
        });
      } else {
        const { error } = await supabase
          .from('secretaires')
          .insert({
            first_name: formValues.first_name.trim(),
            name: formValues.name.trim(),
            email: formValues.email.trim() || null,
            phone_number: formValues.phone_number.trim() || null,
            horaire_flexible: formValues.horaire_flexible,
            pourcentage_temps: formValues.horaire_flexible ? formValues.pourcentage_temps : null,
            prefered_admin: formValues.prefered_admin,
            nombre_demi_journees_admin: formValues.prefered_admin ? formValues.nombre_demi_journees_admin : null,
          });

        if (error) throw error;

        toast({
          title: "Succès",
          description: "Assistant médical créé avec succès",
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
            className="h-9 w-9 rounded-xl hover:bg-cyan-500/10 shrink-0"
          >
            <ArrowLeft className="h-4 w-4" />
          </Button>

          <div className="w-14 h-14 rounded-xl bg-gradient-to-br from-cyan-500 to-blue-600 flex items-center justify-center shadow-lg shadow-cyan-500/20">
            <span className="text-lg font-bold text-white">
              {initials}
            </span>
          </div>

          <div className="flex-1 min-w-0">
            <h2 className="text-xl font-semibold text-foreground">
              {secretaire ? 'Modifier l\'assistant' : 'Nouvel assistant médical'}
            </h2>
            <p className="text-sm text-muted-foreground mt-0.5">
              {secretaire ? 'Modifiez les informations de l\'assistant' : 'Remplissez les informations du nouvel assistant'}
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
                placeholder="Prénom de l'assistant"
              />

              <FormField
                field="name"
                label="Nom"
                icon={UserCircle}
                placeholder="Nom de l'assistant"
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

          {/* Right Column - Configuration */}
          <div className="lg:pl-6 mt-6 lg:mt-0">
            <h3 className="text-xs font-semibold text-muted-foreground uppercase tracking-wider mb-3 px-1">
              Configuration horaire
            </h3>

            <div className="space-y-4">
              {/* Horaire Flexible */}
              <div className="p-4 rounded-xl bg-muted/30 border border-border/30 space-y-3">
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-2">
                    <Switch
                      checked={formValues.horaire_flexible}
                      onCheckedChange={(checked) => setFormValues(prev => ({
                        ...prev,
                        horaire_flexible: checked,
                        pourcentage_temps: checked ? (prev.pourcentage_temps || 100) : 100
                      }))}
                      className="scale-90"
                    />
                    <span className="text-sm font-medium">Horaire flexible</span>
                  </div>
                </div>

                {formValues.horaire_flexible && (
                  <div className="flex items-center gap-2 pl-8">
                    <Input
                      type="number"
                      value={formValues.pourcentage_temps}
                      onChange={(e) => {
                        setFormValues(prev => ({
                          ...prev,
                          pourcentage_temps: parseInt(e.target.value) || 100
                        }));
                        if (errors.pourcentage_temps) {
                          setErrors(prev => ({ ...prev, pourcentage_temps: '' }));
                        }
                      }}
                      className={`w-20 h-8 text-sm text-center ${errors.pourcentage_temps ? 'border-destructive' : ''}`}
                      min={1}
                      max={100}
                    />
                    <span className="text-xs text-muted-foreground">% du temps</span>
                  </div>
                )}
                {errors.pourcentage_temps && (
                  <p className="text-xs text-destructive pl-8">{errors.pourcentage_temps}</p>
                )}
              </div>

              {/* Préfère Admin */}
              <div className="p-4 rounded-xl bg-muted/30 border border-border/30 space-y-3">
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-2">
                    <Switch
                      checked={formValues.prefered_admin}
                      onCheckedChange={(checked) => setFormValues(prev => ({
                        ...prev,
                        prefered_admin: checked,
                        nombre_demi_journees_admin: checked ? (prev.nombre_demi_journees_admin || 1) : 0
                      }))}
                      className="scale-90"
                    />
                    <span className="text-sm font-medium">Préfère admin</span>
                  </div>
                </div>

                {formValues.prefered_admin && (
                  <div className="flex items-center gap-2 pl-8">
                    <Input
                      type="number"
                      value={formValues.nombre_demi_journees_admin}
                      onChange={(e) => {
                        setFormValues(prev => ({
                          ...prev,
                          nombre_demi_journees_admin: parseInt(e.target.value) || 0
                        }));
                        if (errors.nombre_demi_journees_admin) {
                          setErrors(prev => ({ ...prev, nombre_demi_journees_admin: '' }));
                        }
                      }}
                      className={`w-20 h-8 text-sm text-center ${errors.nombre_demi_journees_admin ? 'border-destructive' : ''}`}
                      min={1}
                      max={10}
                    />
                    <span className="text-xs text-muted-foreground">demi-journées/sem</span>
                  </div>
                )}
                {errors.nombre_demi_journees_admin && (
                  <p className="text-xs text-destructive pl-8">{errors.nombre_demi_journees_admin}</p>
                )}
              </div>

              {/* Info box */}
              <div className="p-4 rounded-xl bg-cyan-500/5 border border-cyan-500/20">
                <p className="text-xs text-muted-foreground">
                  Vous pourrez configurer les horaires de travail, les médecins assignés et les compétences après avoir créé l'assistant en cliquant sur sa fiche.
                </p>
              </div>
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
          className="bg-primary hover:bg-primary/90 text-primary-foreground shadow-md shadow-primary/20"
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
