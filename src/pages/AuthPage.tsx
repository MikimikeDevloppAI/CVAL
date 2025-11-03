import { useState } from 'react';
import { useNavigate, Link } from 'react-router-dom';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from '@/hooks/useAuth';
import { useEffect } from 'react';
import cliniqueLogoImg from '@/assets/clinique-logo.png';
import { Loader2 } from 'lucide-react';

const AuthPage = () => {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const { user } = useAuth();
  const navigate = useNavigate();

  useEffect(() => {
    if (user) {
      navigate('/');
    }
  }, [user, navigate]);

  const handleSignIn = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    setError('');

    try {
      const { error } = await supabase.auth.signInWithPassword({
        email,
        password,
      });

      if (error) {
        if (error.message.includes('Invalid login credentials')) {
          setError('Email ou mot de passe incorrect');
        } else {
          setError(error.message);
        }
      }
    } catch (error) {
      setError('Une erreur est survenue lors de la connexion');
    }

    setLoading(false);
  };

  return (
    <div className="min-h-screen flex items-center justify-center bg-gradient-to-br from-background via-accent/20 to-primary/5 px-4">
      <div className="w-full max-w-md">
        <div className="flex flex-col items-center mb-8 space-y-4">
          <div className="p-4 bg-card rounded-2xl shadow-lg border">
            <img 
              src={cliniqueLogoImg} 
              alt="Clinique La Vallée" 
              className="h-14 w-auto"
            />
          </div>
        </div>

        <Card className="shadow-xl border-border/50">
          <CardHeader className="text-center space-y-1 pb-4">
            <CardTitle className="text-2xl font-bold">Connexion</CardTitle>
            <CardDescription>
              Entrez vos identifiants pour accéder à votre espace
            </CardDescription>
          </CardHeader>
          <CardContent className="pt-2">
            <form onSubmit={handleSignIn} className="space-y-4">
              <div className="space-y-2">
                <Label htmlFor="email" className="text-sm font-semibold">Email</Label>
                <Input
                  id="email"
                  type="email"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  required
                  placeholder="votre.email@example.com"
                  className="bg-background h-11"
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="password" className="text-sm font-semibold">Mot de passe</Label>
                <Input
                  id="password"
                  type="password"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  required
                  placeholder="••••••••"
                  className="bg-background h-11"
                />
              </div>
              
              <Button 
                type="submit" 
                className="w-full h-11 shadow-sm font-semibold" 
                disabled={loading}
              >
                {loading ? (
                  <>
                    <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                    Connexion en cours...
                  </>
                ) : (
                  'Se connecter'
                )}
              </Button>
              
              <div className="text-center pt-2">
                <Link 
                  to="/reset-password" 
                  className="text-sm text-primary hover:underline font-medium transition-colors"
                >
                  Mot de passe oublié ?
                </Link>
              </div>
            </form>

            {error && (
              <Alert className="mt-4 border-destructive/50 bg-destructive/5">
                <AlertDescription className="text-destructive text-sm">
                  {error}
                </AlertDescription>
              </Alert>
            )}
          </CardContent>
        </Card>

        <p className="text-center text-xs text-muted-foreground mt-6">
          © 2025 Clinique La Vallée - Tous droits réservés
        </p>
      </div>
    </div>
  );
};

export default AuthPage;