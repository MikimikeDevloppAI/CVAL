import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type'
};

serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    console.log('🔒 Starting planning validation');
    
    const supabaseServiceRole = createClient(
      Deno.env.get('SUPABASE_URL') ?? '',
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? ''
    );

    const { planning_id, pdf_url } = await req.json();

    if (!planning_id) {
      throw new Error('planning_id is required');
    }

    console.log(`📋 Validating planning ${planning_id}`);

    // Get the authenticated user
    const authHeader = req.headers.get('Authorization');
    if (!authHeader) {
      throw new Error('No authorization header');
    }

    const token = authHeader.replace('Bearer ', '');
    const { data: { user }, error: authError } = await createClient(
      Deno.env.get('SUPABASE_URL') ?? '',
      Deno.env.get('SUPABASE_ANON_KEY') ?? ''
    ).auth.getUser(token);

    if (authError || !user) {
      throw new Error('Authentication failed');
    }

    // 1. Update planning to validated status
    const { error: planningUpdateError } = await supabaseServiceRole
      .from('planning')
      .update({
        statut: 'valide',
        validated_at: new Date().toISOString(),
        validated_by: user.id,
        pdf_url: pdf_url || null,
        updated_at: new Date().toISOString()
      })
      .eq('id', planning_id);

    if (planningUpdateError) {
      console.error('❌ Error updating planning:', planningUpdateError);
      throw planningUpdateError;
    }

    console.log(`✓ Planning ${planning_id} marked as validated`);

    // 2. Update all associated planning_genere to confirmed status
    const { error: creneauxUpdateError } = await supabaseServiceRole
      .from('planning_genere')
      .update({
        statut: 'confirme',
        updated_at: new Date().toISOString()
      })
      .eq('planning_id', planning_id);

    if (creneauxUpdateError) {
      console.error('❌ Error updating planning_genere:', creneauxUpdateError);
      throw creneauxUpdateError;
    }

    console.log(`✓ All planning_genere entries marked as confirmed`);

    return new Response(JSON.stringify({
      success: true,
      message: 'Planning validated successfully'
    }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' }
    });

  } catch (error) {
    console.error('❌ Error:', error);
    return new Response(JSON.stringify({
      error: error instanceof Error ? error.message : 'Unknown error'
    }), {
      status: 500,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' }
    });
  }
});
