import { useState, useEffect } from 'react';
import { Plus } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { supabase } from '@/integrations/supabase/client';
import { BackupForm } from '@/components/backup/BackupForm';
import { toast } from 'sonner';

interface Backup {
  id: string;
  first_name: string;
  name: string;
  email: string;
  phone_number: string;
  specialites: string[];
  actif: boolean;
  created_at: string;
}

const BackupPage = () => {
  const [backups, setBackups] = useState<Backup[]>([]);
  const [showForm, setShowForm] = useState(false);
  const [editingBackup, setEditingBackup] = useState<Backup | null>(null);
  const [loading, setLoading] = useState(true);

  const fetchBackups = async () => {
    try {
      const { data, error } = await supabase
        .from('backup')
        .select('*')
        .order('created_at', { ascending: false });

      if (error) throw error;
      setBackups(data || []);
    } catch (error) {
      console.error('Erreur lors du chargement des backups:', error);
      toast.error('Erreur lors du chargement des backups');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchBackups();
  }, []);

  const handleEdit = (backup: Backup) => {
    setEditingBackup(backup);
    setShowForm(true);
  };

  const handleFormSubmit = () => {
    setShowForm(false);
    setEditingBackup(null);
    fetchBackups();
  };

  const handleFormCancel = () => {
    setShowForm(false);
    setEditingBackup(null);
  };

  if (loading) {
    return (
      <div className="container mx-auto p-6">
        <div className="flex justify-center items-center h-64">
          <div className="text-lg">Chargement...</div>
        </div>
      </div>
    );
  }

  return (
    <div className="container mx-auto p-6 space-y-6">
      <div className="flex justify-between items-center">
        <h1 className="text-3xl font-bold">Personnel de Backup</h1>
        <Button onClick={() => setShowForm(true)} className="flex items-center gap-2">
          <Plus className="h-4 w-4" />
          Ajouter un backup
        </Button>
      </div>

      {showForm && (
        <Card>
          <CardHeader>
            <CardTitle>
              {editingBackup ? 'Modifier le backup' : 'Ajouter un nouveau backup'}
            </CardTitle>
          </CardHeader>
          <CardContent>
            <BackupForm
              backup={editingBackup}
              onSubmit={handleFormSubmit}
              onCancel={handleFormCancel}
            />
          </CardContent>
        </Card>
      )}

      <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
        {backups.map((backup) => (
          <Card key={backup.id} className="cursor-pointer hover:shadow-md transition-shadow">
            <CardHeader className="pb-2">
              <CardTitle className="text-lg">
                {backup.first_name} {backup.name}
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-2">
              <p className="text-sm text-muted-foreground">
                <strong>Email:</strong> {backup.email}
              </p>
              {backup.phone_number && (
                <p className="text-sm text-muted-foreground">
                  <strong>Téléphone:</strong> {backup.phone_number}
                </p>
              )}
              <p className="text-sm text-muted-foreground">
                <strong>Statut:</strong> {backup.actif ? 'Actif' : 'Inactif'}
              </p>
              <Button 
                variant="outline" 
                size="sm" 
                onClick={() => handleEdit(backup)}
                className="w-full mt-3"
              >
                Modifier
              </Button>
            </CardContent>
          </Card>
        ))}
      </div>

      {backups.length === 0 && (
        <Card>
          <CardContent className="text-center py-12">
            <p className="text-muted-foreground">Aucun personnel de backup enregistré</p>
            <Button 
              onClick={() => setShowForm(true)} 
              className="mt-4"
              variant="outline"
            >
              Ajouter le premier backup
            </Button>
          </CardContent>
        </Card>
      )}
    </div>
  );
};

export default BackupPage;