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

    // Get planning dates
    const { data: planning, error: planningError } = await supabaseServiceRole
      .from('planning')
      .select('date_debut, date_fin')
      .eq('id', planning_id)
      .single();

    if (planningError || !planning) {
      throw new Error('Planning not found');
    }

    console.log('📅 Fetching secretary assignments for PDF generation');

    // Fetch all assignments with related data
    const { data: assignments, error: assignmentsError } = await supabaseServiceRole
      .from('planning_genere_personnel')
      .select(`
        id,
        date,
        periode,
        type_assignation,
        site_id,
        secretaire_id,
        is_1r,
        is_2f,
        is_3f,
        type_besoin_bloc,
        planning_genere_bloc_operatoire_id,
        secretaire:secretaires!inner(first_name, name),
        site:sites(nom),
        bloc:planning_genere_bloc_operatoire(salle_assignee)
      `)
      .eq('planning_id', planning_id)
      .not('secretaire_id', 'is', null)
      .order('date')
      .order('periode');

    if (assignmentsError) {
      console.error('❌ Error fetching assignments:', assignmentsError);
      throw assignmentsError;
    }

    console.log(`✓ Fetched ${assignments?.length || 0} assignments`);

    // Group by secretary
    const secretaryMap = new Map();
    
    assignments?.forEach((a: any) => {
      const secId = a.secretaire_id;
      const secName = `${a.secretaire.first_name} ${a.secretaire.name}`;
      
      if (!secretaryMap.has(secId)) {
        secretaryMap.set(secId, { 
          id: secId, 
          name: secName, 
          assignments: [] 
        });
      }
      
      // Format date as dd/MM/yyyy
      const dateObj = new Date(a.date);
      const formattedDate = `${String(dateObj.getDate()).padStart(2, '0')}/${String(dateObj.getMonth() + 1).padStart(2, '0')}/${dateObj.getFullYear()}`;
      
      secretaryMap.get(secId).assignments.push({
        date: formattedDate,
        periode: a.periode === 'matin' ? 'Matin' : 'Après-midi',
        site: a.site?.nom || '',
        is1R: a.is_1r || false,
        is2F: a.is_2f || false,
        is3F: a.is_3f || false,
        type: a.type_assignation || 'site',
        typeBesoinBloc: a.type_besoin_bloc,
        salle: a.bloc?.salle_assignee
      });
    });

    const secretaries = Array.from(secretaryMap.values()).sort((a, b) => 
      a.name.localeCompare(b.name, 'fr')
    );

    console.log(`✓ Grouped into ${secretaries.length} secretaries`);

    // Format dates for PDF
    const formatDate = (dateStr: string): string => {
      const date = new Date(dateStr);
      return `${String(date.getDate()).padStart(2, '0')}/${String(date.getMonth() + 1).padStart(2, '0')}/${date.getFullYear()}`;
    };

    // Generate PDF
    console.log('📄 Calling generate-planning-pdf function');
    const { data: pdfData, error: pdfError } = await supabaseServiceRole.functions.invoke('generate-planning-pdf', {
      body: {
        weekStart: formatDate(planning.date_debut),
        weekEnd: formatDate(planning.date_fin),
        secretaries
      }
    });

    if (pdfError) {
      console.error('❌ PDF generation error:', pdfError);
      // Continue with validation even if PDF fails
    }

    const finalPdfUrl = pdfData?.pdfUrl || pdf_url || null;

    // Update planning to validated status
    const { error: planningUpdateError } = await supabaseServiceRole
      .from('planning')
      .update({
        statut: 'valide',
        validated_at: new Date().toISOString(),
        validated_by: user.id,
        pdf_url: finalPdfUrl,
        updated_at: new Date().toISOString()
      })
      .eq('id', planning_id);

    if (planningUpdateError) {
      console.error('❌ Error updating planning:', planningUpdateError);
      throw planningUpdateError;
    }

    console.log(`✓ Planning ${planning_id} marked as validated`);

    return new Response(JSON.stringify({
      success: true,
      message: 'Planning validated successfully',
      pdf_url: finalPdfUrl
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