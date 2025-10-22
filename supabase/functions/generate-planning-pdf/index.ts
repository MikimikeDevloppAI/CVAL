import { serve } from 'https://deno.land/std@0.168.0/http/server.ts';
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.39.3';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

interface Assignment {
  date: string;
  periode: 'Matin' | 'Après-midi' | 'Journée entière';
  site: string;
  is1R: boolean;
  is2F: boolean;
  is3F: boolean;
  type: 'site' | 'administratif' | 'bloc';
  typeBesoinBloc?: string;
  salle?: string;
  typeIntervention?: string;
  medecin?: string;
}

interface SecretaryData {
  id: string;
  name: string;
  assignments: Assignment[];
}

serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
    const supabaseServiceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
    const convertApiSecret = Deno.env.get('CONVERTAPI_SECRET');

    if (!convertApiSecret) {
      throw new Error('CONVERTAPI_SECRET not configured');
    }

    const supabase = createClient(supabaseUrl, supabaseServiceKey);

    const { selectedWeeks } = await req.json();

    if (!selectedWeeks || selectedWeeks.length === 0) {
      throw new Error('No weeks selected');
    }

    // Sort weeks chronologically
    const sortedWeeks = [...selectedWeeks].sort();
    const dateDebut = sortedWeeks[0];
    const dateFin = new Date(sortedWeeks[sortedWeeks.length - 1]);
    dateFin.setDate(dateFin.getDate() + 6); // Add 6 days to get Saturday
    const dateFinStr = dateFin.toISOString().split('T')[0];

    console.log(`Generating PDF from ${dateDebut} to ${dateFinStr}`);

    // Fetch all capacite_effective for the period
    const { data: capacites, error: capacitesError } = await supabase
      .from('capacite_effective')
      .select(`
        id,
        date,
        demi_journee,
        site_id,
        is_1r,
        is_2f,
        is_3f,
        besoin_operation_id,
        planning_genere_bloc_operatoire_id,
        secretaire_id,
        sites!inner(nom),
        secretaires!inner(first_name, name)
      `)
      .gte('date', dateDebut)
      .lte('date', dateFinStr)
      .eq('actif', true)
      .order('secretaires(name)')
      .order('date')
      .order('demi_journee');

    if (capacitesError) {
      console.error('Error fetching capacites:', capacitesError);
      throw capacitesError;
    }

    console.log(`Found ${capacites?.length || 0} capacites`);

    // Fetch besoins operations
    const besoinIds = capacites
      ?.map(c => c.besoin_operation_id)
      .filter(Boolean) || [];

    let besoinsOpsMap = new Map();
    if (besoinIds.length > 0) {
      const { data: besoinsOps } = await supabase
        .from('besoins_operations')
        .select('id, nom')
        .in('id', besoinIds);
      
      if (besoinsOps) {
        besoinsOpsMap = new Map(besoinsOps.map(b => [b.id, b.nom]));
      }
    }

    // Fetch bloc operations
    const blocIds = capacites
      ?.map(c => c.planning_genere_bloc_operatoire_id)
      .filter(Boolean) || [];

    let blocsMap = new Map();
    if (blocIds.length > 0) {
      const { data: blocs } = await supabase
        .from('planning_genere_bloc_operatoire')
        .select(`
          id,
          salle_assignee,
          type_intervention_id,
          medecin_id,
          salles_operation(name),
          types_intervention(nom),
          medecins(first_name, name)
        `)
        .in('id', blocIds);
      
      if (blocs) {
        blocsMap = new Map(blocs.map(b => [b.id, b]));
      }
    }

    // Group by secretary
    const secretariesMap = new Map<string, SecretaryData>();

    capacites?.forEach((cap: any) => {
      const secretaireId = cap.secretaire_id;
      const secretaireName = `${cap.secretaires.first_name || ''} ${cap.secretaires.name || ''}`.trim();

      if (!secretariesMap.has(secretaireId)) {
        secretariesMap.set(secretaireId, {
          id: secretaireId,
          name: secretaireName,
          assignments: []
        });
      }

      const secretary = secretariesMap.get(secretaireId)!;
      const siteName = cap.sites?.nom || 'Site inconnu';
      
      // Determine type
      let type: 'site' | 'administratif' | 'bloc' = 'site';
      let typeBesoinBloc: string | undefined;
      let salle: string | undefined;
      let typeIntervention: string | undefined;
      let medecin: string | undefined;

      if (cap.planning_genere_bloc_operatoire_id) {
        type = 'bloc';
        const blocData = blocsMap.get(cap.planning_genere_bloc_operatoire_id);
        if (blocData) {
          salle = blocData.salles_operation?.name;
          typeIntervention = blocData.types_intervention?.nom;
          if (blocData.medecins) {
            medecin = `${blocData.medecins.first_name || ''} ${blocData.medecins.name || ''}`.trim();
          }
        }
      } else if (cap.besoin_operation_id) {
        type = 'bloc';
        typeBesoinBloc = besoinsOpsMap.get(cap.besoin_operation_id);
      } else if (siteName.toLowerCase().includes('administratif')) {
        type = 'administratif';
      }

      const assignment: Assignment = {
        date: cap.date,
        periode: cap.demi_journee === 'matin' ? 'Matin' : 'Après-midi',
        site: siteName,
        is1R: cap.is_1r || false,
        is2F: cap.is_2f || false,
        is3F: cap.is_3f || false,
        type,
        typeBesoinBloc,
        salle,
        typeIntervention,
        medecin
      };

      secretary.assignments.push(assignment);
    });

    // Convert map to array and sort alphabetically
    const secretaries = Array.from(secretariesMap.values())
      .sort((a, b) => a.name.localeCompare(b.name, 'fr'));

    console.log(`Processing ${secretaries.length} secretaries`);

    // Merge morning/afternoon into full day where applicable
    secretaries.forEach(sec => {
      const byDate = new Map<string, Assignment[]>();
      
      sec.assignments.forEach(a => {
        if (!byDate.has(a.date)) {
          byDate.set(a.date, []);
        }
        byDate.get(a.date)!.push(a);
      });

      const mergedAssignments: Assignment[] = [];
      
      byDate.forEach((assignments, date) => {
        const matin = assignments.find(a => a.periode === 'Matin');
        const am = assignments.find(a => a.periode === 'Après-midi');

        if (matin && am) {
          // Check if they can be merged
          const canMerge = 
            matin.site === am.site &&
            matin.type === am.type &&
            (matin.type !== 'bloc' || (
              matin.salle === am.salle &&
              matin.typeIntervention === am.typeIntervention
            ));

          if (canMerge) {
            mergedAssignments.push({
              ...matin,
              periode: 'Journée entière',
              is1R: matin.is1R || am.is1R,
              is2F: matin.is2F || am.is2F,
              is3F: matin.is3F || am.is3F,
            });
          } else {
            mergedAssignments.push(matin, am);
          }
        } else {
          assignments.forEach(a => mergedAssignments.push(a));
        }
      });

      sec.assignments = mergedAssignments.sort((a, b) => {
        if (a.date !== b.date) return a.date.localeCompare(b.date);
        const periodeOrder = { 'Matin': 0, 'Après-midi': 1, 'Journée entière': 2 };
        return (periodeOrder[a.periode] || 0) - (periodeOrder[b.periode] || 0);
      });
    });

    // Generate HTML
    const html = generatePlanningHTML(secretaries, dateDebut, dateFinStr);

    // Convert to PDF via ConvertAPI
    const convertResponse = await fetch(
      `https://v2.convertapi.com/convert/html/to/pdf?Secret=${convertApiSecret}`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          Parameters: [
            {
              Name: 'File',
              FileValue: {
                Name: 'planning.html',
                Data: btoa(unescape(encodeURIComponent(html)))
              }
            },
            { Name: 'PageSize', Value: 'a4' },
            { Name: 'MarginTop', Value: '10' },
            { Name: 'MarginBottom', Value: '10' },
            { Name: 'MarginLeft', Value: '10' },
            { Name: 'MarginRight', Value: '10' }
          ]
        })
      }
    );

    if (!convertResponse.ok) {
      const errorText = await convertResponse.text();
      console.error('ConvertAPI error:', errorText);
      throw new Error(`ConvertAPI failed: ${convertResponse.status}`);
    }

    const convertData = await convertResponse.json();
    
    // Validate ConvertAPI response
    if (!convertData.Files || !convertData.Files[0] || !convertData.Files[0].Url) {
      console.error('Invalid ConvertAPI response:', JSON.stringify(convertData));
      throw new Error('ConvertAPI response missing PDF URL');
    }
    
    const pdfUrl = convertData.Files[0].Url;
    console.log('PDF generated by ConvertAPI:', pdfUrl);

    // Download PDF
    const pdfResponse = await fetch(pdfUrl);
    const pdfBlob = await pdfResponse.blob();
    const pdfBuffer = await pdfBlob.arrayBuffer();

    // Upload to Supabase Storage
    const fileName = `planning_${dateDebut}_${dateFinStr}_${Date.now()}.pdf`;
    const { data: uploadData, error: uploadError } = await supabase.storage
      .from('planning-pdfs')
      .upload(fileName, pdfBuffer, {
        contentType: 'application/pdf',
        upsert: false
      });

    if (uploadError) {
      console.error('Upload error:', uploadError);
      throw uploadError;
    }

    // Get public URL
    const { data: urlData } = supabase.storage
      .from('planning-pdfs')
      .getPublicUrl(fileName);

    const publicUrl = urlData.publicUrl;

    // Insert into planning_pdfs table
    const { data: insertData, error: insertError } = await supabase
      .from('planning_pdfs')
      .insert({
        date_debut: dateDebut,
        date_fin: dateFinStr,
        pdf_url: publicUrl,
        file_name: fileName,
        nombre_secretaires: secretaries.length,
        nombre_semaines: selectedWeeks.length
      })
      .select()
      .single();

    if (insertError) {
      console.error('Insert error:', insertError);
      throw insertError;
    }

    console.log('PDF generated successfully:', publicUrl);

    return new Response(
      JSON.stringify({
        success: true,
        pdfUrl: publicUrl,
        pdfId: insertData.id,
        nombreSecretaires: secretaries.length,
        nombreSemaines: selectedWeeks.length
      }),
      {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        status: 200
      }
    );
  } catch (error: any) {
    console.error('Error:', error);
    return new Response(
      JSON.stringify({ success: false, error: error.message }),
      {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        status: 500
      }
    );
  }
});

function generatePlanningHTML(
  secretaries: SecretaryData[],
  dateDebut: string,
  dateFin: string
): string {
  const formatDate = (dateStr: string) => {
    const date = new Date(dateStr);
    return date.toLocaleDateString('fr-FR', { 
      day: 'numeric',
      month: 'long',
      year: 'numeric'
    });
  };

  const formatDayDate = (dateStr: string) => {
    const date = new Date(dateStr);
    const dayName = date.toLocaleDateString('fr-FR', { weekday: 'long' });
    const dayNum = date.toLocaleDateString('fr-FR', { day: 'numeric', month: 'long' });
    return `${dayName.charAt(0).toUpperCase() + dayName.slice(1)} ${dayNum}`;
  };

  const getSalleColor = (salle?: string) => {
    if (!salle) return { bg: '#f3f4f6', border: '#d1d5db', text: '#374151' };
    const lower = salle.toLowerCase();
    if (lower.includes('rouge')) return { bg: '#fef2f2', border: '#fecaca', text: '#b91c1c' };
    if (lower.includes('verte')) return { bg: '#f0fdf4', border: '#bbf7d0', text: '#15803d' };
    if (lower.includes('jaune')) return { bg: '#fefce8', border: '#fde047', text: '#a16207' };
    if (lower.includes('bleue')) return { bg: '#eff6ff', border: '#bfdbfe', text: '#1e40af' };
    return { bg: '#f3f4f6', border: '#d1d5db', text: '#374151' };
  };

  const renderAssignment = (assignment: Assignment) => {
    const badges: string[] = [];
    
    if (assignment.is1R) badges.push('<span class="badge badge-1r">1R</span>');
    if (assignment.is2F) badges.push('<span class="badge badge-2f">2F</span>');
    if (assignment.is3F) badges.push('<span class="badge badge-3f">3F</span>');

    if (assignment.type === 'bloc') {
      const parts: string[] = [];
      parts.push('<strong>Bloc opératoire</strong>');
      
      if (assignment.salle) {
        const color = getSalleColor(assignment.salle);
        parts.push(`<span class="badge-salle" style="background: ${color.bg}; border-color: ${color.border}; color: ${color.text};">${assignment.salle}</span>`);
      }
      
      if (assignment.typeIntervention) {
        parts.push(`<span class="badge-intervention">${assignment.typeIntervention}</span>`);
      }
      
      if (assignment.typeBesoinBloc) {
        parts.push(`<span class="badge-besoin">${assignment.typeBesoinBloc}</span>`);
      }
      
      if (assignment.medecin) {
        parts.push(`<span class="badge-medecin">Dr ${assignment.medecin}</span>`);
      }
      
      return parts.join(' ') + (badges.length > 0 ? ' ' + badges.join(' ') : '');
    } else if (assignment.type === 'administratif') {
      return '<span class="text-admin">Administratif</span>' + (badges.length > 0 ? ' ' + badges.join(' ') : '');
    } else {
      return `<strong>${assignment.site}</strong>` + (badges.length > 0 ? ' ' + badges.join(' ') : '');
    }
  };

  const renderCard = (sec: SecretaryData) => {
    const byDate = new Map<string, Assignment[]>();
    sec.assignments.forEach(a => {
      if (!byDate.has(a.date)) byDate.set(a.date, []);
      byDate.get(a.date)!.push(a);
    });

    const sortedDates = Array.from(byDate.keys()).sort();

    const daysHtml = sortedDates.map(date => {
      const assignments = byDate.get(date)!;
      const dayLabel = formatDayDate(date);

      const assignmentsHtml = assignments.map(assignment => {
        let periodeClass = 'period-full';
        let periodeLabel = 'Journée entière';
        
        if (assignment.periode === 'Matin') {
          periodeClass = 'period-morning';
          periodeLabel = 'Matin';
        } else if (assignment.periode === 'Après-midi') {
          periodeClass = 'period-afternoon';
          periodeLabel = 'Après-midi';
        }

        return `
          <div class="assignment-row ${periodeClass}">
            <div class="period-label">${periodeLabel}</div>
            <div class="assignment-content">
              ${renderAssignment(assignment)}
            </div>
          </div>
        `;
      }).join('');

      return `
        <div class="day-block">
          <div class="day-title">${dayLabel}</div>
          ${assignmentsHtml}
        </div>
      `;
    }).join('');

    return `
      <div class="secretary-card">
        <div class="secretary-name">${sec.name}</div>
        ${daysHtml}
      </div>
    `;
  };

  // Split secretaries into two columns (zigzag)
  const leftColumn: SecretaryData[] = [];
  const rightColumn: SecretaryData[] = [];
  
  secretaries.forEach((sec, idx) => {
    if (idx % 2 === 0) {
      leftColumn.push(sec);
    } else {
      rightColumn.push(sec);
    }
  });

  return `
<!DOCTYPE html>
<html lang="fr">
<head>
  <meta charset="UTF-8">
  <title>Planning - Assistants Médicaux</title>
  <style>
    * {
      margin: 0;
      padding: 0;
      box-sizing: border-box;
    }
    
    body {
      font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
      background: #f9fafb;
      color: #111827;
      padding: 20px;
    }
    
    .page-header {
      text-align: center;
      margin-bottom: 30px;
      padding-bottom: 20px;
      border-bottom: 3px solid #0d9488;
    }
    
    .page-header h1 {
      font-size: 32px;
      background: linear-gradient(135deg, #0d9488 0%, #0891b2 100%);
      -webkit-background-clip: text;
      -webkit-text-fill-color: transparent;
      margin-bottom: 10px;
    }
    
    .period {
      font-size: 16px;
      color: #6b7280;
    }
    
    .grid {
      display: grid;
      grid-template-columns: 1fr 1fr;
      gap: 20px;
    }
    
    .secretary-card {
      background: white;
      border: 2px solid #e5e7eb;
      border-radius: 12px;
      padding: 16px;
      margin-bottom: 16px;
      break-inside: avoid;
    }
    
    .secretary-name {
      font-size: 18px;
      font-weight: 700;
      color: #111827;
      padding-bottom: 12px;
      margin-bottom: 12px;
      border-bottom: 2px solid #0d9488;
    }
    
    .day-block {
      margin-bottom: 16px;
      padding: 12px;
      background: #f9fafb;
      border-radius: 8px;
      border: 1px solid #e5e7eb;
    }
    
    .day-title {
      font-size: 14px;
      font-weight: 600;
      color: #374151;
      margin-bottom: 8px;
      text-transform: capitalize;
    }
    
    .assignment-row {
      display: flex;
      align-items: center;
      gap: 12px;
      padding: 8px;
      margin-bottom: 6px;
      border-radius: 6px;
      font-size: 12px;
    }
    
    .period-morning {
      background: rgba(59, 130, 246, 0.1);
      border: 1px solid rgba(59, 130, 246, 0.3);
    }
    
    .period-afternoon {
      background: rgba(234, 179, 8, 0.1);
      border: 1px solid rgba(234, 179, 8, 0.3);
    }
    
    .period-full {
      background: rgba(34, 197, 94, 0.1);
      border: 1px solid rgba(34, 197, 94, 0.3);
    }
    
    .period-label {
      font-weight: 600;
      min-width: 100px;
      font-size: 11px;
    }
    
    .assignment-content {
      flex: 1;
      font-size: 11px;
    }
    
    .badge {
      display: inline-block;
      padding: 2px 8px;
      border-radius: 4px;
      font-size: 10px;
      font-weight: 600;
      margin-left: 4px;
      border: 1px solid;
    }
    
    .badge-1r {
      background: rgba(59, 130, 246, 0.1);
      border-color: rgba(59, 130, 246, 0.3);
      color: #1e40af;
    }
    
    .badge-2f {
      background: rgba(234, 179, 8, 0.1);
      border-color: rgba(234, 179, 8, 0.3);
      color: #a16207;
    }
    
    .badge-3f {
      background: rgba(34, 197, 94, 0.1);
      border-color: rgba(34, 197, 94, 0.3);
      color: #15803d;
    }
    
    .badge-salle,
    .badge-intervention,
    .badge-besoin,
    .badge-medecin {
      display: inline-block;
      padding: 2px 8px;
      border-radius: 4px;
      font-size: 10px;
      font-weight: 600;
      margin-left: 4px;
      background: #f3f4f6;
      border: 1px solid #d1d5db;
      color: #374151;
    }
    
    .text-admin {
      color: #6b7280;
      font-style: italic;
    }
    
    strong {
      font-weight: 600;
      color: #111827;
    }
  </style>
</head>
<body>
  <div class="page-header">
    <h1>Planning - Assistants Médicaux</h1>
    <p class="period">Du ${formatDate(dateDebut)} au ${formatDate(dateFin)}</p>
  </div>
  
  <div class="grid">
    <div>
      ${leftColumn.map(sec => renderCard(sec)).join('')}
    </div>
    <div>
      ${rightColumn.map(sec => renderCard(sec)).join('')}
    </div>
  </div>
</body>
</html>
  `;
}
