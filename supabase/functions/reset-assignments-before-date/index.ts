import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.39.3';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const supabase = createClient(
      Deno.env.get('SUPABASE_URL') ?? '',
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? ''
    );

    const ADMIN_SITE_ID = '00000000-0000-0000-0000-000000000001';
    const TARGET_DATE = '2025-12-08';

    // Reset all assignments before December 8, 2025
    const { data, error } = await supabase
      .from('capacite_effective')
      .update({
        is_1r: false,
        is_2f: false,
        is_3f: false,
        planning_genere_bloc_operatoire_id: null,
        besoin_operation_id: null,
        site_id: ADMIN_SITE_ID
      })
      .lt('date', TARGET_DATE)
      .gte('date', new Date().toISOString().split('T')[0])
      .select('id');

    if (error) throw error;

    return new Response(
      JSON.stringify({
        success: true,
        message: `Reset ${data?.length || 0} assignments to admin mode before ${TARGET_DATE}`,
        count: data?.length || 0
      }),
      { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  } catch (error) {
    console.error('Error resetting assignments:', error);
    return new Response(
      JSON.stringify({ error: error instanceof Error ? error.message : 'Unknown error' }),
      { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  }
});
