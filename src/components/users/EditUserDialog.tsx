import { useState } from 'react';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import * as z from 'zod';
import { supabase } from '@/integrations/supabase/client';
import { useToast } from '@/hooks/use-toast';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import {
  Form,
  FormControl,
  FormField,
  FormItem,
  FormLabel,
  FormMessage,
} from '@/components/ui/form';
import { Button } from '@/components/ui/button';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { Checkbox } from '@/components/ui/checkbox';

const formSchema = z.object({
  role: z.enum(['admin', 'medecin', 'secretaire']),
  planning: z.boolean(),
});

interface EditUserDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onSuccess: () => void;
  user: {
    id: string;
    email: string;
    prenom: string;
    nom: string;
    role: string;
    planning: boolean;
  } | null;
}

export const EditUserDialog = ({ open, onOpenChange, onSuccess, user }: EditUserDialogProps) => {
  const [loading, setLoading] = useState(false);
  const { toast } = useToast();

  const form = useForm<z.infer<typeof formSchema>>({
    resolver: zodResolver(formSchema),
    values: user ? {
      role: user.role as 'admin' | 'medecin' | 'secretaire',
      planning: user.planning,
    } : undefined,
  });

  const onSubmit = async (values: z.infer<typeof formSchema>) => {
    if (!user) return;

    setLoading(true);
    try {
      // Update planning access
      const { error: profileError } = await supabase
        .from('profiles')
        .update({ planning: values.planning })
        .eq('id', user.id);

      if (profileError) throw profileError;

      // Update role (delete old, insert new)
      const { error: deleteError } = await supabase
        .from('user_roles')
        .delete()
        .eq('user_id', user.id);

      if (deleteError) throw deleteError;

      const { error: insertError } = await supabase
        .from('user_roles')
        .insert({ user_id: user.id, role: values.role });

      if (insertError) throw insertError;

      toast({
        title: 'Utilisateur modifié',
        description: 'Les modifications ont été enregistrées',
      });

      onOpenChange(false);
      onSuccess();
    } catch (error: any) {
      toast({
        title: 'Erreur',
        description: error.message || 'Erreur lors de la modification',
        variant: 'destructive',
      });
    } finally {
      setLoading(false);
    }
  };

  const handleResetPassword = async () => {
    if (!user) return;

    try {
      const { error } = await supabase.auth.resetPasswordForEmail(user.email, {
        redirectTo: `${window.location.origin}/auth`,
      });

      if (error) throw error;

      toast({
        title: 'Email envoyé',
        description: `Un email de réinitialisation a été envoyé à ${user.email}`,
      });
    } catch (error: any) {
      toast({
        title: 'Erreur',
        description: error.message || "Erreur lors de l'envoi de l'email",
        variant: 'destructive',
      });
    }
  };

  if (!user) return null;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-[500px]">
        <DialogHeader>
          <DialogTitle>Modifier l'utilisateur</DialogTitle>
          <DialogDescription>
            {user.prenom} {user.nom} - {user.email}
          </DialogDescription>
        </DialogHeader>

        <Form {...form}>
          <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-4">
            <FormField
              control={form.control}
              name="role"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Rôle</FormLabel>
                  <Select onValueChange={field.onChange} defaultValue={field.value}>
                    <FormControl>
                      <SelectTrigger>
                        <SelectValue />
                      </SelectTrigger>
                    </FormControl>
                    <SelectContent>
                      <SelectItem value="admin">Administrateur</SelectItem>
                      <SelectItem value="medecin">Médecin</SelectItem>
                      <SelectItem value="secretaire">Secrétaire</SelectItem>
                    </SelectContent>
                  </Select>
                  <FormMessage />
                </FormItem>
              )}
            />

            <FormField
              control={form.control}
              name="planning"
              render={({ field }) => (
                <FormItem className="flex flex-row items-start space-x-3 space-y-0 rounded-md border p-4">
                  <FormControl>
                    <Checkbox
                      checked={field.value}
                      onCheckedChange={field.onChange}
                    />
                  </FormControl>
                  <div className="space-y-1 leading-none">
                    <FormLabel>Accès planning</FormLabel>
                    <p className="text-sm text-muted-foreground">
                      Autoriser cet utilisateur à gérer le planning
                    </p>
                  </div>
                </FormItem>
              )}
            />

            <div className="pt-4 border-t">
              <Button
                type="button"
                variant="outline"
                onClick={handleResetPassword}
                className="w-full"
              >
                Réinitialiser le mot de passe
              </Button>
            </div>

            <div className="flex justify-end gap-3">
              <Button
                type="button"
                variant="outline"
                onClick={() => onOpenChange(false)}
                disabled={loading}
              >
                Annuler
              </Button>
              <Button type="submit" disabled={loading}>
                {loading ? 'Enregistrement...' : 'Enregistrer'}
              </Button>
            </div>
          </form>
        </Form>
      </DialogContent>
    </Dialog>
  );
};
