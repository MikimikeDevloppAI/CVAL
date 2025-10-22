import { useState, useEffect } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { toast } from 'sonner';

export interface PdfHistoryItem {
  id: string;
  date_debut: string;
  date_fin: string;
  pdf_url: string;
  file_name: string;
  created_at: string;
  nombre_secretaires: number | null;
  nombre_semaines: number | null;
}

export function usePdfHistory() {
  const [pdfs, setPdfs] = useState<PdfHistoryItem[]>([]);
  const [loading, setLoading] = useState(false);
  const [generating, setGenerating] = useState(false);

  const fetchPdfs = async () => {
    setLoading(true);
    try {
      const { data, error } = await supabase
        .from('planning_pdfs')
        .select('*')
        .order('created_at', { ascending: false })
        .limit(50);
      
      if (error) throw error;
      if (data) setPdfs(data);
    } catch (error) {
      console.error('Error fetching PDFs:', error);
      toast.error('Erreur lors du chargement de l\'historique');
    } finally {
      setLoading(false);
    }
  };

  const generatePdf = async (selectedWeeks: string[]) => {
    if (selectedWeeks.length === 0) {
      toast.error('Veuillez sélectionner au moins une semaine');
      return null;
    }

    setGenerating(true);
    try {
      const { data, error } = await supabase.functions.invoke('generate-planning-pdf', {
        body: { selectedWeeks }
      });

      if (error) throw error;
      
      if (data.success) {
        toast.success('PDF généré avec succès');
        await fetchPdfs(); // Refresh the list
        return data;
      } else {
        throw new Error(data.error || 'Erreur inconnue');
      }
    } catch (error: any) {
      console.error('Error generating PDF:', error);
      toast.error(error.message || 'Erreur lors de la génération du PDF');
      return null;
    } finally {
      setGenerating(false);
    }
  };

  useEffect(() => {
    fetchPdfs();
  }, []);

  return { pdfs, loading, generating, fetchPdfs, generatePdf };
}
