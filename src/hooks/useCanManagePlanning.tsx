import { useState, useEffect } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from './useAuth';

export const useCanManagePlanning = () => {
  const { user } = useAuth();
  const [canManage, setCanManage] = useState(false);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const checkAccess = async () => {
      if (!user) {
        setCanManage(false);
        setLoading(false);
        return;
      }

      try {
        const { data, error } = await supabase
          .from('profiles')
          .select('planning')
          .eq('id', user.id)
          .single();

        if (error) throw error;
        setCanManage(data?.planning || false);
      } catch (error) {
        console.error('Error checking planning access:', error);
        setCanManage(false);
      } finally {
        setLoading(false);
      }
    };

    checkAccess();
  }, [user]);

  return { canManage, loading };
};
