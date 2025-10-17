import { createClient } from 'npm:@supabase/supabase-js@2';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

interface Assignment {
  date: string;          // Format dd/MM/yyyy
  periode: string;       // "Matin" ou "Après-midi"
  site: string;
  is1R: boolean;
  is2F: boolean;
  is3F: boolean;
  type: string;          // 'site' | 'administratif' | 'bloc'
  typeBesoinBloc?: string;
  salle?: string;
}

interface Secretary {
  id: string;
  name: string;
  assignments: Assignment[];
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const body = await req.json().catch(() => ({}));
    const weekStart: string = String(body?.weekStart || '');
    const weekEnd: string = String(body?.weekEnd || '');
    const secretaries: Secretary[] = Array.isArray(body?.secretaries) ? body.secretaries : [];

    const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
    const supabaseKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
    const convertApiSecret = Deno.env.get('CONVERTAPI_SECRET')!;
    
    const supabase = createClient(supabaseUrl, supabaseKey);

    // Generate HTML content
    const html = generatePlanningHTML(secretaries, weekStart, weekEnd);
    console.log('PDF generation input:', { weekStart, weekEnd, secretariesCount: secretaries.length });

    const makeSafeFilename = (s: string) => s.replace(/[^a-zA-Z0-9._-]/g, '-').replace(/-+/g, '-');
    const safeBaseName = makeSafeFilename(`planning_${weekStart}_${weekEnd}`);

    // Encode HTML to Base64
    const encoder = new TextEncoder();
    const htmlBytes = encoder.encode(html);
    let binary = '';
    for (let i = 0; i < htmlBytes.length; i++) {
      binary += String.fromCharCode(htmlBytes[i]);
    }
    const base64Html = btoa(binary);

    // Convert HTML to PDF
    const convertUrl = `https://v2.convertapi.com/convert/html/to/pdf?Secret=${encodeURIComponent(convertApiSecret)}&StoreFile=true`;
    const payload = {
      Parameters: [
        { Name: 'File', FileValue: { Name: `${safeBaseName}.html`, Data: base64Html } },
        { Name: 'FileName', Value: `${safeBaseName}.pdf` },
        { Name: 'MarginTop', Value: '15' },
        { Name: 'MarginBottom', Value: '12' },
        { Name: 'MarginLeft', Value: '10' },
        { Name: 'MarginRight', Value: '10' },
        { Name: 'PageSize', Value: 'a4' },
      ],
    };

    const convertApiResponse = await fetch(convertUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    });

    if (!convertApiResponse.ok) {
      const errorText = await convertApiResponse.text();
      console.error('ConvertAPI error:', convertApiResponse.status, errorText);
      throw new Error(`ConvertAPI failed (${convertApiResponse.status}): ${errorText}`);
    }

    const pdfData = await convertApiResponse.json();
    if (!pdfData?.Files?.[0]?.Url) {
      throw new Error('ConvertAPI returned no file URL');
    }
    const pdfUrl = pdfData.Files[0].Url;

    // Download and upload to Supabase
    const pdfResponse = await fetch(pdfUrl);
    const pdfBuffer = await pdfResponse.arrayBuffer();

    const fileName = `${safeBaseName}_${Date.now()}.pdf`;
    const { error: uploadError } = await supabase.storage
      .from('planning-pdfs')
      .upload(fileName, pdfBuffer, {
        contentType: 'application/pdf',
        upsert: false,
      });

    if (uploadError) throw uploadError;

    const { data: urlData } = supabase.storage
      .from('planning-pdfs')
      .getPublicUrl(fileName);

    return new Response(
      JSON.stringify({ success: true, pdfUrl: urlData.publicUrl }),
      { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  } catch (error) {
    console.error('Error generating PDF:', error);
    return new Response(
      JSON.stringify({ error: error instanceof Error ? error.message : 'Unknown error' }),
      { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  }
});

// Helper function to get room colors based on actual database values
function getSalleColors(salle?: string): { bg: string; text: string } {
  const defaultColors = { bg: 'linear-gradient(135deg, #e9d5ff 0%, #d8b4fe 100%)', text: '#6b21a8' };
  if (!salle) return defaultColors;
  
  const normalized = salle.trim().toLowerCase().replace(/^salle\s+/, '');
  
  switch (normalized) {
    case 'rouge':
      return { bg: 'linear-gradient(135deg, #fee2e2 0%, #fecaca 100%)', text: '#991b1b' };
    case 'verte':
      return { bg: 'linear-gradient(135deg, #d1fae5 0%, #a7f3d0 100%)', text: '#065f46' };
    case 'jaune':
      return { bg: 'linear-gradient(135deg, #fef3c7 0%, #fde68a 100%)', text: '#92400e' };
    case 'bleue':
      return { bg: 'linear-gradient(135deg, #dbeafe 0%, #bfdbfe 100%)', text: '#1e40af' };
    default:
      return defaultColors;
  }
}

function generatePlanningHTML(secretaries: Secretary[], weekStart: string, weekEnd: string): string {
  // Fonction pour obtenir le nom du jour en français
  const getDayName = (dateStr: string): string => {
    const [day, month, year] = dateStr.split('/');
    const date = new Date(parseInt(year), parseInt(month) - 1, parseInt(day));
    const days = ['Dimanche', 'Lundi', 'Mardi', 'Mercredi', 'Jeudi', 'Vendredi', 'Samedi'];
    return days[date.getDay()];
  };
  
  // Sort secretaries alphabetically
  const sortedSecretaries = [...secretaries].sort((a, b) => 
    a.name.localeCompare(b.name, 'fr')
  );
  
  // Regrouper par secrétaire et par jour
  const groupedBySecretary = sortedSecretaries.map(sec => {
    const byDay = new Map<string, { matin?: Assignment; apresMidi?: Assignment }>();
    
    sec.assignments.forEach(a => {
      if (!byDay.has(a.date)) {
        byDay.set(a.date, {});
      }
      const day = byDay.get(a.date)!;
      if (a.periode.includes('Matin')) {
        day.matin = a;
      } else {
        day.apresMidi = a;
      }
    });
    
    return { ...sec, byDay: Array.from(byDay.entries()).sort((a, b) => {
      const [dayA, monthA, yearA] = a[0].split('/').map(Number);
      const [dayB, monthB, yearB] = b[0].split('/').map(Number);
      const dateA = new Date(yearA, monthA - 1, dayA);
      const dateB = new Date(yearB, monthB - 1, dayB);
      return dateA.getTime() - dateB.getTime();
    }) };
  });
  
  // Split into 2 columns (zigzag pattern: 1st left, 2nd right, 3rd left, 4th right, etc.)
  const col1: typeof groupedBySecretary = [];
  const col2: typeof groupedBySecretary = [];
  
  groupedBySecretary.forEach((sec, index) => {
    if (index % 2 === 0) {
      col1.push(sec);
    } else {
      col2.push(sec);
    }
  });
  
  return `<!DOCTYPE html>
<html><head><meta charset="utf-8"><title>Planning - Assistant médical</title>
<style>
* { margin: 0; padding: 0; box-sizing: border-box; }
body { 
  font-family: 'Segoe UI', Tahoma, Geneva, Verdana, sans-serif; 
  background: white; 
  min-height: 100vh;
}

@page {
  margin: 40px 30px 30px 30px;
}

.page-header {
  text-align: center;
  padding: 40px 0 30px 0;
  margin-bottom: 20px;
}

.page-header h1 { 
  font-size: 32px; 
  font-weight: 800; 
  background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
  -webkit-background-clip: text;
  -webkit-text-fill-color: transparent;
  background-clip: text;
  margin-bottom: 8px;
  letter-spacing: -0.5px;
}

.page-header .period { 
  font-size: 18px; 
  color: #64748b;
  font-weight: 500; 
}

.content-wrapper { 
  padding-top: 20px; 
  padding-bottom: 40px;
  padding-left: 30px;
  padding-right: 30px;
}

.grid { 
  display: grid; 
  grid-template-columns: 1fr 1fr; 
  gap: 24px; 
  max-width: 1400px; 
  margin: 0 auto; 
}

.card { 
  background: linear-gradient(135deg, #ffffff 0%, #f8fafc 100%);
  border-radius: 20px;
  padding: 24px;
  box-shadow: 0 10px 30px rgba(0,0,0,0.15);
  page-break-inside: avoid;
  margin-top: 20px;
  margin-bottom: 20px;
  border: 1px solid rgba(255,255,255,0.9);
  transition: transform 0.2s;
}

.secretary-name { 
  font-size: 22px; 
  font-weight: 800; 
  background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
  -webkit-background-clip: text;
  -webkit-text-fill-color: transparent;
  background-clip: text;
  position: relative;
  margin-bottom: 18px; 
  padding-bottom: 10px;
  letter-spacing: -0.5px;
}

.secretary-name::after {
  content: "";
  position: absolute;
  left: 0;
  right: 0;
  bottom: 0;
  height: 3px;
  background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
  border-radius: 2px;
}

.day-block { 
  background: linear-gradient(135deg, #fefefe 0%, #f1f5f9 100%);
  border-radius: 14px;
  padding: 16px;
  margin-bottom: 14px;
  border: 1px solid #e2e8f0;
  box-shadow: 0 2px 10px rgba(0,0,0,0.05);
}

.day-title { 
  font-size: 16px; 
  font-weight: 700; 
  color: #334155; 
  margin-bottom: 12px; 
}

.time-row { 
  padding: 12px;
  border-left: 4px solid #667eea;
  background: white;
  border-radius: 8px;
  box-shadow: 0 1px 4px rgba(0,0,0,0.05);
  margin-bottom: 10px;
}

.time-row:last-child { margin-bottom: 0; }

.time { 
  font-size: 14px; 
  color: #64748b; 
  font-weight: 700; 
  margin-bottom: 10px;
}

.content { 
  display: flex; 
  align-items: center; 
  gap: 8px; 
  flex-wrap: wrap; 
}

.site { 
  font-size: 15px; 
  font-weight: 700; 
  color: #1e293b; 
  display: inline-block;
}

.admin-text {
  font-size: 15px;
  font-weight: 600;
  color: #64748b;
}

.badge { 
  font-size: 13px; 
  padding: 5px 12px; 
  border-radius: 8px; 
  font-weight: 700; 
  display: inline-block;
  box-shadow: 0 2px 4px rgba(0,0,0,0.1);
  border: 1px solid rgba(0,0,0,0.05);
}

.badge-1 { 
  background: linear-gradient(135deg, #f1f5f9 0%, #e2e8f0 100%); 
  color: #475569; 
}

.badge-1r { 
  background: linear-gradient(135deg, #dbeafe 0%, #bfdbfe 100%); 
  color: #1e40af; 
}

.badge-2f { 
  background: linear-gradient(135deg, #fef3c7 0%, #fde68a 100%); 
  color: #92400e; 
}

.badge-3f { 
  background: linear-gradient(135deg, #d1fae5 0%, #a7f3d0 100%); 
  color: #065f46; 
}

.badge-bloc { 
  background: linear-gradient(135deg, #e9d5ff 0%, #d8b4fe 100%); 
  color: #6b21a8; 
}

@media print {
  .page-header {
    page-break-after: avoid;
  }
}
</style></head><body>
<div class="page-header">
  <h1>Planning - Assistant médical</h1>
  <p class="period">Semaine du ${weekStart} au ${weekEnd}</p>
</div>
<div class="content-wrapper">
  <div class="grid">
    <div>${col1.map(sec => renderCard(sec, getDayName)).join('')}</div>
    <div>${col2.map(sec => renderCard(sec, getDayName)).join('')}</div>
  </div>
</div>
</body></html>`;
}

function renderCard(sec: any, getDayName: (date: string) => string): string {
  return `<div class="card">
<div class="secretary-name">${sec.name}</div>
${sec.byDay.map(([date, day]: [string, any]) => {
  const dayName = getDayName(date);
  
  // Check if we can merge morning and afternoon
  const canMerge = day.matin && day.apresMidi && 
                   day.matin.site === day.apresMidi.site && 
                   day.matin.type === day.apresMidi.type;
  
  if (canMerge) {
    // Merged view
    const assignment = day.matin;
    const is1R = day.matin.is1R || day.apresMidi.is1R;
    const is2F = day.matin.is2F || day.apresMidi.is2F;
    const is3F = day.matin.is3F || day.apresMidi.is3F;
    
    return `<div class="day-block">
<div class="day-title">${dayName} ${date}</div>
<div class="time-row">
<div class="time">Journée entière</div>
<div class="content">
${renderAssignmentContent(assignment, is1R, is2F, is3F)}
</div>
</div>
</div>`;
  }
  
  // Separate morning and afternoon
  return `<div class="day-block">
<div class="day-title">${dayName} ${date}</div>
${day.matin ? `<div class="time-row">
<div class="time">Matin</div>
<div class="content">
${renderAssignmentContent(day.matin, day.matin.is1R, day.matin.is2F, day.matin.is3F)}
</div>
</div>` : ''}
${day.apresMidi ? `<div class="time-row">
<div class="time">Après-midi</div>
<div class="content">
${renderAssignmentContent(day.apresMidi, day.apresMidi.is1R, day.apresMidi.is2F, day.apresMidi.is3F)}
</div>
</div>` : ''}
</div>`;
}).join('')}
</div>`;
}

function renderAssignmentContent(assignment: Assignment, is1R: boolean, is2F: boolean, is3F: boolean): string {
  if (assignment.type === 'administratif') {
    return '<span class="admin-text">Administratif</span>';
  } else if (assignment.type === 'bloc') {
    const parts = ['<span class="site">Bloc opératoire</span>'];
    
    // Get color for the room using the helper function
    const colors = getSalleColors(assignment.salle);
    
    // Badge pour la salle avec couleur spécifique
    if (assignment.salle) {
      parts.push(`<span class="badge" style="background: ${colors.bg} !important; color: ${colors.text} !important; border: 1px solid rgba(0,0,0,0.05) !important;">${assignment.salle}</span>`);
    }
    
    // Badge pour le type de besoin (nom récupéré depuis besoins_operations)
    if (assignment.typeBesoinBloc) {
      parts.push(`<span class="badge" style="background: ${colors.bg} !important; color: ${colors.text} !important; border: 1px solid rgba(0,0,0,0.05) !important;">${assignment.typeBesoinBloc}</span>`);
    }
    
    return parts.join('');
  } else {
    // type === 'site'
    const parts = [`<span class="site">${assignment.site}</span>`];
    
    if (is1R) {
      parts.push('<span class="badge badge-1r">1R</span>');
    }
    if (is2F) {
      parts.push('<span class="badge badge-2f">2F</span>');
    }
    if (is3F) {
      parts.push('<span class="badge badge-3f">3F</span>');
    }
    
    // If no responsibility badge, add "1" badge
    if (!is1R && !is2F && !is3F) {
      parts.push('<span class="badge badge-1">1</span>');
    }
    
    return parts.join('');
  }
}