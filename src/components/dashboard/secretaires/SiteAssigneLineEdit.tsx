import { useState, useEffect } from 'react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Trash2, Check, X } from 'lucide-react';
import { supabase } from '@/integrations/supabase/client';
import { useToast } from '@/hooks/use-toast';

interface SiteAssigneLineEditProps {
  assignment: any;
  sites: any[];
  onUpdate: () => void;
  onDelete: (assignmentId: string) => void;
  isNew?: boolean;
}

export function SiteAssigneLineEdit({ assignment, sites, onUpdate, onDelete, isNew = false }: SiteAssigneLineEditProps) {
  const [isEditing, setIsEditing] = useState(isNew);
  const [loading, setLoading] = useState(false);
  const [formData, setFormData] = useState({
    site_id: assignment.site_id || '',
    priorite: assignment.priorite || '1',
  });
  const { toast } = useToast();

  useEffect(() => {
    setFormData({
      site_id: assignment.site_id || '',
      priorite: assignment.priorite || '1',
    });
  }, [assignment]);

  const prioriteColors = {
    '1': 'bg-teal-500/10 text-teal-700 dark:text-teal-300 border-teal-500/20',
    '2': 'bg-blue-500/10 text-blue-700 dark:text-blue-300 border-blue-500/20',
    '3': 'bg-gray-500/10 text-gray-700 dark:text-gray-300 border-gray-500/20'
  };

  const handleSave = async () => {
    if (!formData.site_id) {
      toast({
        title: "Erreur",
        description: "Veuillez sélectionner un site",
        variant: "destructive",
      });
      return;
    }

    setLoading(true);
    try {
      const saveData = {
        site_id: formData.site_id,
        priorite: formData.priorite,
      };

      if (isNew) {
        const { error } = await supabase
          .from('secretaires_sites')
          .insert([{ ...saveData, secretaire_id: assignment.secretaire_id }]);

        if (error) throw error;

        toast({
          title: "Succès",
          description: "Site ajouté",
        });
      } else {
        const { error } = await supabase
          .from('secretaires_sites')
          .update(saveData)
          .eq('id', assignment.id);

        if (error) throw error;

        toast({
          title: "Succès",
          description: "Site mis à jour",
        });
      }
      
      onUpdate();
      setIsEditing(false);
    } catch (error) {
      console.error('Erreur:', error);
      toast({
        title: "Erreur",
        description: isNew ? "Impossible d'ajouter le site" : "Impossible de mettre à jour le site",
        variant: "destructive",
      });
    } finally {
      setLoading(false);
    }
  };

  const handleCancel = () => {
    if (isNew) {
      onDelete(assignment.id);
    } else {
      setFormData({
        site_id: assignment.site_id || '',
        priorite: assignment.priorite || '1',
      });
      setIsEditing(false);
    }
  };

  if (isEditing) {
    return (
      <div className="p-2 bg-teal-500/5 rounded-lg border border-teal-200/30">
        <div className="flex items-center gap-2">
          <Select 
            value={formData.site_id} 
            onValueChange={(value) => setFormData({ ...formData, site_id: value })}
          >
            <SelectTrigger className="h-8 flex-1 text-xs border-teal-200/50">
              <SelectValue placeholder="Sélectionner un site" />
            </SelectTrigger>
            <SelectContent>
              {sites
                .filter((site) => !site.nom.toLowerCase().includes('admin'))
                .map((site) => (
                  <SelectItem key={site.id} value={site.id}>
                    {site.nom}
                  </SelectItem>
                ))}
            </SelectContent>
          </Select>

          <Select 
            value={formData.priorite} 
            onValueChange={(value) => setFormData({ ...formData, priorite: value })}
          >
            <SelectTrigger className="h-8 w-24 text-xs border-teal-200/50">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="1">P1</SelectItem>
              <SelectItem value="2">P2</SelectItem>
              <SelectItem value="3">P3</SelectItem>
            </SelectContent>
          </Select>

          <div className="flex gap-1 ml-2">
            <Button
              variant="ghost"
              size="sm"
              onClick={handleSave}
              disabled={loading}
              className="h-7 w-7 p-0 hover:bg-green-500/10 hover:text-green-600"
            >
              <Check className="h-3 w-3" />
            </Button>
            <Button
              variant="ghost"
              size="sm"
              onClick={handleCancel}
              disabled={loading}
              className="h-7 w-7 p-0 hover:bg-red-500/10 hover:text-red-600"
            >
              <X className="h-3 w-3" />
            </Button>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div 
      className="group/line p-2 rounded-lg hover:bg-teal-500/5 transition-all duration-200 cursor-pointer"
      onClick={() => setIsEditing(true)}
    >
      <div className="flex items-center gap-2">
        <Badge 
          variant="outline" 
          className={`text-xs shrink-0 ${prioriteColors[assignment.priorite]}`}
        >
          P{assignment.priorite}
        </Badge>

        <span className="text-sm text-muted-foreground truncate flex-1">
          {assignment.nom}
        </span>

        <Button
          variant="ghost"
          size="sm"
          onClick={(e) => {
            e.stopPropagation();
            onDelete(assignment.id);
          }}
          className="opacity-0 group-hover/line:opacity-100 transition-opacity h-6 w-6 p-0 hover:bg-destructive/10 hover:text-destructive shrink-0"
        >
          <Trash2 className="h-3 w-3" />
        </Button>
      </div>
    </div>
  );
}