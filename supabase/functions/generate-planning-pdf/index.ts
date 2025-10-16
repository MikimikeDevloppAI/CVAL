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
        { Name: 'MarginTop', Value: '0' },
        { Name: 'MarginBottom', Value: '0' },
        { Name: 'MarginLeft', Value: '0' },
        { Name: 'MarginRight', Value: '0' },
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

function generatePlanningHTML(secretaries: Secretary[], weekStart: string, weekEnd: string): string {
  // Fonction pour obtenir le nom du jour en français
  const getDayName = (dateStr: string): string => {
    const [day, month, year] = dateStr.split('/');
    const date = new Date(parseInt(year), parseInt(month) - 1, parseInt(day));
    const days = ['Dimanche', 'Lundi', 'Mardi', 'Mercredi', 'Jeudi', 'Vendredi', 'Samedi'];
    return days[date.getDay()];
  };
  
  // Regrouper par secrétaire et par jour
  const groupedBySecretary = secretaries.map(sec => {
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
  
  // Split into 2 columns
  const mid = Math.ceil(groupedBySecretary.length / 2);
  const col1 = groupedBySecretary.slice(0, mid);
  const col2 = groupedBySecretary.slice(mid);
  
  return `<!DOCTYPE html>
<html><head><meta charset="utf-8"><title>Planning des Secrétaires</title>
<style>
* { margin: 0; padding: 0; box-sizing: border-box; }
body { font-family: Arial, sans-serif; padding: 0; background: #f9fafb; }

@page {
  margin: 0;
}

.content-wrapper { padding: 40px 20px; }
.header { 
  text-align: center; 
  margin-bottom: 30px; 
  background: white; 
  padding: 25px; 
  border-radius: 12px; 
  box-shadow: 0 2px 4px rgba(0,0,0,0.1); 
}
.logo { max-width: 200px; height: auto; margin-bottom: 15px; }
.header h1 { font-size: 28px; color: #1f2937; margin-bottom: 8px; font-weight: 700; }
.period { font-size: 18px; color: #6b7280; font-weight: 500; }
.grid { display: grid; grid-template-columns: 1fr 1fr; gap: 25px; column-gap: 30px; }
.card { 
  background: white; 
  border-radius: 12px; 
  padding: 20px; 
  box-shadow: 0 2px 8px rgba(0,0,0,0.1); 
  page-break-inside: avoid; 
  margin-bottom: 20px; 
}
.secretary-name { 
  font-size: 20px; 
  font-weight: bold; 
  color: #1f2937; 
  padding-bottom: 12px; 
  margin-bottom: 16px; 
  border-bottom: 1px solid #e5e7eb;
}
.day-block { 
  border: 1px solid #e5e7eb; 
  border-radius: 8px; 
  padding: 14px; 
  margin-bottom: 12px; 
  background: #f9fafb; 
}
.day-title { 
  font-size: 16px; 
  font-weight: 600; 
  color: #1f2937; 
  margin-bottom: 10px; 
}
.time-row { 
  display: flex; 
  gap: 12px; 
  align-items: flex-start; 
  margin-bottom: 8px; 
}
.time-row:last-child { margin-bottom: 0; }
.time { 
  font-size: 14px; 
  color: #6b7280; 
  width: 90px; 
  flex-shrink: 0; 
  font-weight: 500; 
}
.content { flex: 1; min-width: 0; }
.site { 
  font-size: 15px; 
  font-weight: 600; 
  color: #374151; 
  margin-bottom: 6px; 
}
.badges { display: flex; gap: 6px; flex-wrap: wrap; }
.badge { 
  font-size: 13px; 
  padding: 4px 10px; 
  border-radius: 6px; 
  font-weight: 600; 
  display: inline-block;
}
.badge-1 { background: #e5e7eb; color: #374151; }
.badge-1r { background: #dbeafe; color: #1e40af; }
.badge-2f { background: #fef3c7; color: #92400e; }
.badge-3f { background: #d1fae5; color: #065f46; }
.badge-admin { background: #e5e7eb; color: #374151; }
.badge-bloc { background: #e9d5ff; color: #6b21a8; }
</style></head><body>
<div class="content-wrapper">
<div class="header">
<h1>Planning des Secrétaires</h1>
<p class="period">Semaine du ${weekStart} au ${weekEnd}</p>
</div>
<div class="grid">
<div>${col1.map(sec => renderCard(sec, getDayName)).join('')}</div>
<div>${col2.map(sec => renderCard(sec, getDayName)).join('')}</div>
</div>
</div></body></html>`;
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
<div class="time">07:30-17:00</div>
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
<div class="time">07:30-12:00</div>
<div class="content">
${renderAssignmentContent(day.matin, day.matin.is1R, day.matin.is2F, day.matin.is3F)}
</div>
</div>` : ''}
${day.apresMidi ? `<div class="time-row">
<div class="time">13:00-17:00</div>
<div class="content">
${renderAssignmentContent(day.apresMidi, day.apresMidi.is1R, day.apresMidi.is2F, day.apresMidi.is3F)}
</div>
</div>` : ''}
</div>`;
}).join('')}
</div>`;
}

function renderAssignmentContent(assignment: Assignment, is1R: boolean, is2F: boolean, is3F: boolean): string {
  let siteName = '';
  let badges = '';
  
  if (assignment.type === 'administratif') {
    siteName = 'Administratif';
    badges = '<span class="badge badge-admin">Administratif</span>';
  } else if (assignment.type === 'bloc') {
    siteName = 'Bloc opératoire';
    const blocBadges = [];
    if (assignment.salle) {
      blocBadges.push(`<span class="badge badge-bloc">${assignment.salle}</span>`);
    }
    if (assignment.typeBesoinBloc) {
      const labels: Record<string, string> = {
        'instrumentaliste': 'Instrumentaliste',
        'aide_de_salle': 'Aide de salle',
        'bloc_dermato_accueil': 'Accueil Dermato',
        'bloc_ophtalmo_accueil': 'Accueil Ophtalmo',
        'anesthesiste': 'Anesthésiste'
      };
      const label = labels[assignment.typeBesoinBloc] || assignment.typeBesoinBloc;
      blocBadges.push(`<span class="badge badge-bloc">${label}</span>`);
    }
    badges = blocBadges.join('');
  } else {
    // type === 'site'
    siteName = assignment.site;
    const siteBadges = [];
    
    if (is1R) {
      siteBadges.push('<span class="badge badge-1r">1R</span>');
    }
    if (is2F) {
      siteBadges.push('<span class="badge badge-2f">2F</span>');
    }
    if (is3F) {
      siteBadges.push('<span class="badge badge-3f">3F</span>');
    }
    
    // If no responsibility badge, add "1" badge
    if (!is1R && !is2F && !is3F) {
      siteBadges.push('<span class="badge badge-1">1</span>');
    }
    
    badges = siteBadges.join('');
  }
  
  return `<div class="site">${siteName}</div>
<div class="badges">${badges}</div>`;
}