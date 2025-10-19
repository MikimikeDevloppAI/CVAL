import { useState, useEffect } from 'react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Trash2, Check, X } from 'lucide-react';
import { supabase } from '@/integrations/supabase/client';
import { useToast } from '@/hooks/use-toast';

interface BesoinOperationnelLineEditProps {
  assignment: any;
  besoins: any[];
  onUpdate: () => void;
  onDelete: (assignmentId: string) => void;
  isNew?: boolean;
}

export function BesoinOperationnelLineEdit({ assignment, besoins, onUpdate, onDelete, isNew = false }: BesoinOperationnelLineEditProps) {
  const [isEditing, setIsEditing] = useState(isNew);
  const [loading, setLoading] = useState(false);
  const [formData, setFormData] = useState({
    besoin_operation_id: assignment.besoin_operation_id || '',
    preference: assignment.preference || 1,
  });
  const { toast } = useToast();

  useEffect(() => {
    setFormData({
      besoin_operation_id: assignment.besoin_operation_id || '',
      preference: assignment.preference || 1,
    });
  }, [assignment]);

  const handleSave = async () => {
    if (!formData.besoin_operation_id) {
      toast({
        title: "Erreur",
        description: "Veuillez sélectionner un besoin",
        variant: "destructive",
      });
      return;
    }

    setLoading(true);
    try {
      const saveData = {
        besoin_operation_id: formData.besoin_operation_id,
        preference: formData.preference,
      };

      if (isNew) {
        const { error } = await supabase
          .from('secretaires_besoins_operations')
          .insert([{ ...saveData, secretaire_id: assignment.secretaire_id }]);

        if (error) throw error;

        toast({
          title: "Succès",
          description: "Besoin ajouté",
        });
      } else {
        const { error } = await supabase
          .from('secretaires_besoins_operations')
          .update(saveData)
          .eq('id', assignment.id);

        if (error) throw error;

        toast({
          title: "Succès",
          description: "Besoin mis à jour",
        });
      }
      
      onUpdate();
      setIsEditing(false);
    } catch (error) {
      console.error('Erreur:', error);
      toast({
        title: "Erreur",
        description: isNew ? "Impossible d'ajouter le besoin" : "Impossible de mettre à jour le besoin",
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
        besoin_operation_id: assignment.besoin_operation_id || '',
        preference: assignment.preference || 1,
      });
      setIsEditing(false);
    }
  };

  if (isEditing) {
    return (
      <div className="p-2 bg-emerald-500/5 rounded-lg border border-emerald-200/30">
        <div className="flex items-center gap-2">
          <Select 
            value={formData.besoin_operation_id} 
            onValueChange={(value) => setFormData({ ...formData, besoin_operation_id: value })}
          >
            <SelectTrigger className="h-8 flex-1 text-xs border-emerald-200/50">
              <SelectValue placeholder="Sélectionner un besoin" />
            </SelectTrigger>
            <SelectContent>
              {besoins.map((besoin) => (
                <SelectItem key={besoin.id} value={besoin.id}>
                  {besoin.nom}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>

          <Select 
            value={formData.preference.toString()} 
            onValueChange={(value) => setFormData({ ...formData, preference: parseInt(value) })}
          >
            <SelectTrigger className="h-8 w-24 text-xs border-emerald-200/50">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="1">Pref 1</SelectItem>
              <SelectItem value="2">Pref 2</SelectItem>
              <SelectItem value="3">Pref 3</SelectItem>
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
      className="group/line p-2 rounded-lg hover:bg-emerald-500/5 transition-all duration-200 cursor-pointer"
      onClick={() => setIsEditing(true)}
    >
      <div className="flex items-center gap-2">
        {assignment.preference && (
          <Badge 
            variant="outline" 
            className="text-xs shrink-0 bg-emerald-500/10 text-emerald-700 dark:text-emerald-300 border-emerald-500/20"
          >
            Pref {assignment.preference}
          </Badge>
        )}

        <span className="text-sm text-muted-foreground truncate flex-1">
          {assignment.besoins_operations?.nom || assignment.nom}
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