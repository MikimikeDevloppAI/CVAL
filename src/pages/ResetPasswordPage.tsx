import { useState } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Link } from 'react-router-dom';
import { ArrowLeft, Loader2 } from 'lucide-react';
import { Label } from '@/components/ui/label';

export default function ResetPasswordPage() {
  const [email, setEmail] = useState('');
  const [loading, setLoading] = useState(false);
  const [message, setMessage] = useState('');
  const [error, setError] = useState('');

  const handleResetPassword = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    setError('');
    setMessage('');

    try {
      const { error } = await supabase.auth.resetPasswordForEmail(email, {
        redirectTo: `${window.location.origin}/update-password`,
      });

      if (error) throw error;

      setMessage('Un email de réinitialisation a été envoyé à votre adresse. Vérifiez votre boîte de réception.');
      setEmail('');
    } catch (error: any) {
      setError(error.message || 'Une erreur est survenue lors de la réinitialisation du mot de passe');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="min-h-screen flex items-center justify-center bg-gradient-to-br from-background via-accent/20 to-primary/5 p-4">
      <Card className="w-full max-w-md shadow-xl border-border/50">
        <CardHeader className="space-y-1 pb-4">
          <div className="flex items-center gap-2 mb-4">
            <Link 
              to="/auth" 
              className="text-muted-foreground hover:text-foreground transition-colors p-2 -ml-2 rounded-md hover:bg-accent"
            >
              <ArrowLeft className="h-4 w-4" />
            </Link>
          </div>
          <CardTitle className="text-2xl font-bold">Mot de passe oublié</CardTitle>
          <CardDescription>
            Entrez votre adresse email pour recevoir un lien de réinitialisation
          </CardDescription>
        </CardHeader>
        <CardContent className="pt-2">
          <form onSubmit={handleResetPassword} className="space-y-4">
            {error && (
              <Alert className="border-destructive/50 bg-destructive/5">
                <AlertDescription className="text-destructive text-sm">{error}</AlertDescription>
              </Alert>
            )}
            
            {message && (
              <Alert className="border-primary/50 bg-primary/5">
                <AlertDescription className="text-primary text-sm">{message}</AlertDescription>
              </Alert>
            )}

            <div className="space-y-2">
              <Label htmlFor="email" className="text-sm font-semibold">Adresse email</Label>
              <Input
                id="email"
                type="email"
                placeholder="votre.email@example.com"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                required
                disabled={loading}
                className="bg-background h-11"
              />
            </div>

            <Button type="submit" className="w-full h-11 shadow-sm font-semibold" disabled={loading}>
              {loading ? (
                <>
                  <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                  Envoi en cours...
                </>
              ) : (
                'Envoyer le lien de réinitialisation'
              )}
            </Button>
          </form>
        </CardContent>
      </Card>
    </div>
  );
}
