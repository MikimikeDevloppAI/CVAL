import { useState, useEffect } from 'react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Trash2, Check, X } from 'lucide-react';
import { supabase } from '@/integrations/supabase/client';
import { useToast } from '@/hooks/use-toast';

interface MedecinAssigneLineEditProps {
  assignment: any;
  medecins: any[];
  onUpdate: () => void;
  onDelete: (assignmentId: string) => void;
  isNew?: boolean;
}

export function MedecinAssigneLineEdit({ assignment, medecins, onUpdate, onDelete, isNew = false }: MedecinAssigneLineEditProps) {
  const [isEditing, setIsEditing] = useState(isNew);
  const [loading, setLoading] = useState(false);
  const [formData, setFormData] = useState({
    medecin_id: assignment.medecin_id || '',
    priorite: assignment.priorite || '1',
  });
  const { toast } = useToast();

  useEffect(() => {
    setFormData({
      medecin_id: assignment.medecin_id || '',
      priorite: assignment.priorite || '1',
    });
  }, [assignment]);

  const prioriteColors = {
    '1': 'bg-cyan-500/10 text-cyan-700 dark:text-cyan-300 border-cyan-500/20',
    '2': 'bg-blue-500/10 text-blue-700 dark:text-blue-300 border-blue-500/20',
  };

  const handleSave = async () => {
    if (!formData.medecin_id) {
      toast({
        title: "Erreur",
        description: "Veuillez sélectionner un médecin",
        variant: "destructive",
      });
      return;
    }

    setLoading(true);
    try {
      const saveData = {
        medecin_id: formData.medecin_id,
        priorite: formData.priorite,
      };

      if (isNew) {
        const { error } = await supabase
          .from('secretaires_medecins')
          .insert([{ ...saveData, secretaire_id: assignment.secretaire_id }]);

        if (error) throw error;

        toast({
          title: "Succès",
          description: "Médecin ajouté",
        });
      } else {
        const { error } = await supabase
          .from('secretaires_medecins')
          .update(saveData)
          .eq('id', assignment.id);

        if (error) throw error;

        toast({
          title: "Succès",
          description: "Médecin mis à jour",
        });
      }
      
      setIsEditing(false);
      onUpdate();
    } catch (error) {
      console.error('Erreur:', error);
      toast({
        title: "Erreur",
        description: isNew ? "Impossible d'ajouter le médecin" : "Impossible de mettre à jour le médecin",
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
        medecin_id: assignment.medecin_id || '',
        priorite: assignment.priorite || '1',
      });
      setIsEditing(false);
    }
  };

  if (isEditing) {
    return (
      <div className="p-2 bg-cyan-500/5 rounded-lg border border-cyan-200/30" onKeyDown={(e) => { if (e.key === 'Enter') e.preventDefault(); }}>
        <div className="flex items-center gap-2">
          <Select 
            value={formData.medecin_id} 
            onValueChange={(value) => setFormData({ ...formData, medecin_id: value })}
          >
            <SelectTrigger className="h-8 flex-1 text-xs border-cyan-200/50" type="button">
              <SelectValue placeholder="Sélectionner un médecin" />
            </SelectTrigger>
            <SelectContent>
              {medecins.map((medecin) => (
                <SelectItem key={medecin.id} value={medecin.id}>
                  {medecin.first_name} {medecin.name}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>

          <Select 
            value={formData.priorite} 
            onValueChange={(value) => setFormData({ ...formData, priorite: value })}
          >
            <SelectTrigger className="h-8 w-24 text-xs border-cyan-200/50" type="button">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="1">P1</SelectItem>
              <SelectItem value="2">P2</SelectItem>
            </SelectContent>
          </Select>

          <div className="flex gap-1 ml-2">
            <Button
              type="button"
              variant="ghost"
              size="sm"
              onClick={handleSave}
              disabled={loading}
              className="h-7 w-7 p-0 hover:bg-green-500/10 hover:text-green-600"
            >
              <Check className="h-3 w-3" />
            </Button>
            <Button
              type="button"
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
      className="group/line p-2 rounded-lg hover:bg-cyan-500/5 transition-all duration-200 cursor-pointer"
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
          {assignment.first_name} {assignment.name}
        </span>

        <Button
          type="button"
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