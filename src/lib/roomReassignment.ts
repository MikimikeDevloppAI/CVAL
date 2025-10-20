import { supabase } from "@/integrations/supabase/client";

export const triggerRoomReassignment = async (): Promise<void> => {
  console.log('Triggering room reassignment...');
  
  const { error } = await supabase.functions.invoke('reassign-all-rooms');
  
  if (error) {
    console.error('Erreur de réassignation des salles:', error);
    throw error;
  }
  
  console.log('Room reassignment completed');
};
