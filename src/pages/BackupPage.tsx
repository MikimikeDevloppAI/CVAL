import { useState, useEffect } from 'react';
import { Plus, Edit, Search, Mail, Phone } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from '@/components/ui/dialog';
import { Badge } from '@/components/ui/badge';
import { Switch } from '@/components/ui/switch';
import { ModernCard, ModernCardHeader, ModernCardContent, ModernCardTitle, ContactInfo } from '@/components/ui/modern-card';
import { supabase } from '@/integrations/supabase/client';
import { BackupForm } from '@/components/backup/BackupForm';
import { useToast } from '@/hooks/use-toast';

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
  const [searchTerm, setSearchTerm] = useState('');
  const [showInactive, setShowInactive] = useState(false);
  const [selectedBackup, setSelectedBackup] = useState<Backup | null>(null);
  const [isDialogOpen, setIsDialogOpen] = useState(false);
  const [loading, setLoading] = useState(true);
  const { toast } = useToast();

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
      toast({
        title: "Erreur",
        description: "Erreur lors du chargement des backups",
        variant: "destructive",
      });
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchBackups();
  }, []);

  const filteredBackups = backups.filter(backup => {
    const matchesSearch = backup.first_name?.toLowerCase().includes(searchTerm.toLowerCase()) ||
           backup.name?.toLowerCase().includes(searchTerm.toLowerCase()) ||
           backup.email?.toLowerCase().includes(searchTerm.toLowerCase());
    
    const matchesStatus = showInactive ? backup.actif === false : backup.actif !== false;
    
    return matchesSearch && matchesStatus;
  });

  const handleFormSuccess = () => {
    setIsDialogOpen(false);
    setSelectedBackup(null);
    fetchBackups();
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center h-64">
        <div className="text-muted-foreground">Chargement...</div>
      </div>
    );
  }

  return (
    <div className="container mx-auto py-6 space-y-6">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-bold text-foreground">Personnel de Backup</h1>
        
        <Dialog open={isDialogOpen} onOpenChange={setIsDialogOpen}>
          <DialogTrigger asChild>
            <Button className="gap-2" onClick={() => setSelectedBackup(null)}>
              <Plus className="h-4 w-4" />
              Ajouter un backup
            </Button>
          </DialogTrigger>
          <DialogContent className="max-w-4xl w-full max-h-[90vh] overflow-y-auto">
            <DialogHeader>
              <DialogTitle>
                {selectedBackup ? 'Modifier le backup' : 'Ajouter un backup'}
              </DialogTitle>
            </DialogHeader>
            <BackupForm 
              backup={selectedBackup} 
              onSubmit={handleFormSuccess}
              onCancel={() => setIsDialogOpen(false)}
            />
          </DialogContent>
        </Dialog>
      </div>

      {/* Search and Filter */}
      <div className="flex flex-col md:flex-row items-stretch md:items-center gap-4">
        <div className="relative flex-1 max-w-full md:max-w-md">
          <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
          <Input
            placeholder="Rechercher un backup..."
            value={searchTerm}
            onChange={(e) => setSearchTerm(e.target.value)}
            className="pl-10"
          />
        </div>
        
        <div className="flex items-center space-x-2">
          <Switch
            checked={showInactive}
            onCheckedChange={setShowInactive}
            id="show-inactive-backup"
          />
          <label htmlFor="show-inactive-backup" className="text-sm font-medium cursor-pointer">
            Montrer backups inactifs
          </label>
        </div>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
        {filteredBackups.map((backup) => (
          <ModernCard key={backup.id} className={backup.actif === false ? 'opacity-60' : ''}>
            <ModernCardHeader>
              <div className="flex items-start justify-between">
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2">
                    <ModernCardTitle>
                      {backup.first_name} {backup.name}
                    </ModernCardTitle>
                    {backup.actif === false && (
                      <Badge variant="secondary" className="text-xs">
                        Inactif
                      </Badge>
                    )}
                  </div>
                  
                  <div className="space-y-3 mt-4">
                    {backup.email && (
                      <ContactInfo 
                        icon={<Mail />} 
                        text={backup.email} 
                      />
                    )}
                    
                    {backup.phone_number && (
                      <ContactInfo 
                        icon={<Phone />} 
                        text={backup.phone_number} 
                      />
                    )}
                  </div>
                </div>
                
                <div className="flex items-center space-x-3 ml-3">
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={() => {
                      setSelectedBackup(backup);
                      setIsDialogOpen(true);
                    }}
                    className="opacity-0 group-hover:opacity-100 transition-opacity"
                  >
                    <Edit className="h-4 w-4" />
                  </Button>
                </div>
              </div>
            </ModernCardHeader>
            
            <ModernCardContent>
              <div className="space-y-4">
                <div>
                  <p className="text-xs font-medium text-muted-foreground uppercase tracking-wide mb-1">
                    Statut
                  </p>
                  <p className="text-sm text-foreground">
                    {backup.actif ? 'Actif' : 'Inactif'}
                  </p>
                </div>
              </div>
            </ModernCardContent>
          </ModernCard>
        ))}
      </div>

      {filteredBackups.length === 0 && (
        <div className="text-center py-12">
          <p className="text-muted-foreground">
            {searchTerm ? 'Aucun backup trouvé pour cette recherche' : showInactive ? 'Aucun backup inactif' : 'Aucun personnel de backup enregistré'}
          </p>
        </div>
      )}
    </div>
  );
};

export default BackupPage;