const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const { dates, minimize_changes, flexible_overrides } = await req.json();
    
    console.log('📤 Calling Python API with:', { 
      dates, 
      minimize_changes, 
      flexible_overrides_count: Object.keys(flexible_overrides || {}).length 
    });
    
    const apiKey = Deno.env.get('PLANNING_API_KEY');
    
    if (!apiKey) {
      throw new Error('PLANNING_API_KEY not configured');
    }
    
    const response = await fetch('https://api-planning.vps.allia-solutions.ch/optimize-week', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-API-Key': apiKey,
      },
      body: JSON.stringify({ 
        dates, 
        minimize_changes, 
        flexible_overrides 
      }),
    });

    if (!response.ok) {
      const errorText = await response.text();
      console.error('❌ Python API error:', response.status, errorText);
      throw new Error(`API error: ${response.status} - ${errorText}`);
    }

    const result = await response.json();
    console.log('✅ Python API response received');
    
    return new Response(JSON.stringify({ success: true, ...result }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  } catch (error) {
    console.error('❌ Error in optimize-planning-python:', error);
    const errorMessage = error instanceof Error ? error.message : 'Unknown error';
    return new Response(JSON.stringify({ 
      success: false, 
      error: errorMessage
    }), {
      status: 500,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }
});
