import { useEffect, useState } from 'react';
import { Badge } from '@/components/ui/badge';
import { AlertCircle, CheckCircle2 } from 'lucide-react';
import { format } from 'date-fns';
import { fr } from 'date-fns/locale';
import { supabase } from '@/integrations/supabase/client';

interface SiteClosingIndicatorProps {
  siteId: string;
  siteName: string;
  weekDays: Date[];
}

interface DayStatus {
  date: string;
  has1R: boolean;
  has2F: boolean;
  multiple1R: boolean;
  multiple2F: boolean;
  multiple3F: boolean;
}

export function SiteClosingIndicator({
  siteId,
  siteName,
  weekDays,
}: SiteClosingIndicatorProps) {
  // TODO: Component needs refactoring to use new planning architecture
  // (needs to query planning_genere_site_besoin for responsable_*_id)
  return null;
}
