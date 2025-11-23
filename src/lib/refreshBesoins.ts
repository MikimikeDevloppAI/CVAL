import { supabase } from "@/integrations/supabase/client";

export const refreshBesoinsViews = async (): Promise<void> => {
  console.log('Refreshing besoins materialized views...');
  
  const { error } = await supabase.functions.invoke('refresh-besoins-view');
  
  if (error) {
    console.error('Erreur lors du rafraîchissement des vues:', error);
    throw error;
  }
  
  console.log('Besoins views refreshed successfully');
};
