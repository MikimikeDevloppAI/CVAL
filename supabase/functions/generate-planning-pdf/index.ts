import { createClient } from 'npm:@supabase/supabase-js@2';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

interface Secretary {
  id: string;
  name: string;
  assignments: Array<{
    date: string;
    periode: string;
    site: string;
    medecins: string[];
    is1R: boolean;
    is2F: boolean;
    type: string;
  }>;
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
    console.log('Generated HTML length:', html?.length || 0);

    // Sanitize filename - remove illegal characters like /
    const makeSafeFilename = (s: string) => s.replace(/[^a-zA-Z0-9._-]/g, '-').replace(/-+/g, '-');
    const safeBaseName = makeSafeFilename(`planning_${weekStart}_${weekEnd}`);
    console.log('Using safe filename:', safeBaseName);

    // Encode HTML to Base64 for ConvertAPI File parameter
    const encoder = new TextEncoder();
    const htmlBytes = encoder.encode(html);
    let binary = '';
    for (let i = 0; i < htmlBytes.length; i++) {
      binary += String.fromCharCode(htmlBytes[i]);
    }
    const base64Html = btoa(binary);
    console.log('Base64 HTML length:', base64Html.length);

    // Convert HTML to PDF using ConvertAPI (v2) with File/FileValue
    // See: https://www.convertapi.com/html-to-pdf
    const convertUrl = `https://v2.convertapi.com/convert/html/to/pdf?Secret=${encodeURIComponent(convertApiSecret)}&StoreFile=true`;
    const payload = {
      Parameters: [
        { 
          Name: 'File', 
          FileValue: { 
            Name: `${safeBaseName}.html`, 
            Data: base64Html 
          } 
        },
        { Name: 'FileName', Value: `${safeBaseName}.pdf` },
        { Name: 'MarginTop', Value: '10' },
        { Name: 'MarginBottom', Value: '10' },
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
      console.error('ConvertAPI unexpected response:', pdfData);
      throw new Error('ConvertAPI returned no file URL');
    }
    const pdfUrl = pdfData.Files[0].Url;

    // Download the PDF from ConvertAPI
    const pdfResponse = await fetch(pdfUrl);
    const pdfBuffer = await pdfResponse.arrayBuffer();

    // Upload to Supabase Storage with safe filename
    const fileName = `${safeBaseName}_${Date.now()}.pdf`;
    console.log('Storage fileName:', fileName);
    const { data: uploadData, error: uploadError } = await supabase.storage
      .from('planning-pdfs')
      .upload(fileName, pdfBuffer, {
        contentType: 'application/pdf',
        upsert: false,
      });

    if (uploadError) {
      console.error('Upload error:', uploadError);
      throw uploadError;
    }

    // Get public URL
    const { data: urlData } = supabase.storage
      .from('planning-pdfs')
      .getPublicUrl(fileName);

    return new Response(
      JSON.stringify({
        success: true,
        pdfUrl: urlData.publicUrl,
      }),
      {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      }
    );
  } catch (error) {
    console.error('Error generating PDF:', error);
    const errorMessage = error instanceof Error ? error.message : 'Unknown error';
    return new Response(
      JSON.stringify({ error: errorMessage }),
      {
        status: 500,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      }
    );
  }
});

function generatePlanningHTML(secretaries: Secretary[], weekStart: string, weekEnd: string): string {
  const logoBase64 = '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';
  
  return `
    <!DOCTYPE html>
    <html>
    <head>
      <meta charset="utf-8">
      <title>Planning Secrétaires - ${weekStart} au ${weekEnd}</title>
      <style>
        * {
          margin: 0;
          padding: 0;
          box-sizing: border-box;
        }
        body {
          font-family: Arial, sans-serif;
          padding: 20px;
          background: #f5f5f5;
        }
        .header {
          text-align: center;
          margin-bottom: 30px;
          background: white;
          padding: 20px;
          border-radius: 8px;
          box-shadow: 0 2px 4px rgba(0,0,0,0.1);
        }
        .logo {
          max-width: 200px;
          margin-bottom: 15px;
        }
        .header h1 {
          color: #2c3e50;
          font-size: 24px;
          margin-bottom: 10px;
        }
        .period {
          color: #7f8c8d;
          font-size: 16px;
        }
        .secretary-card {
          background: white;
          border-radius: 8px;
          padding: 20px;
          margin-bottom: 20px;
          box-shadow: 0 2px 4px rgba(0,0,0,0.1);
          page-break-inside: avoid;
        }
        .secretary-name {
          font-size: 20px;
          font-weight: bold;
          color: #2c3e50;
          margin-bottom: 15px;
          padding-bottom: 10px;
          border-bottom: 2px solid #e74c3c;
        }
        .assignment {
          padding: 12px;
          margin-bottom: 10px;
          border-left: 4px solid #3498db;
          background: #f8f9fa;
          border-radius: 4px;
        }
        .assignment-date {
          font-weight: bold;
          color: #2c3e50;
          margin-bottom: 5px;
        }
        .assignment-site {
          color: #34495e;
          margin-bottom: 5px;
        }
        .assignment-doctors {
          color: #7f8c8d;
          font-size: 14px;
        }
        .badges {
          display: flex;
          gap: 8px;
          margin-top: 8px;
        }
        .badge {
          display: inline-block;
          padding: 4px 12px;
          border-radius: 12px;
          font-size: 12px;
          font-weight: bold;
        }
        .badge-1r {
          background: #dbeafe;
          color: #1e40af;
        }
        .badge-2f {
          background: #fef3c7;
          color: #92400e;
        }
        .badge-admin {
          background: #e5e7eb;
          color: #374151;
        }
      </style>
    </head>
    <body>
      <div class="header">
        <img src="data:image/png;base64,${logoBase64}" alt="Clinique La Vallée" class="logo">
        <h1>Planning des Secrétaires</h1>
        <p class="period">Semaine du ${weekStart} au ${weekEnd}</p>
      </div>
      
      ${secretaries.map((secretary: Secretary) => `
        <div class="secretary-card">
          <div class="secretary-name">${secretary.name}</div>
          ${secretary.assignments.map((assignment) => `
            <div class="assignment">
              <div class="assignment-date">${assignment.date} - ${assignment.periode}</div>
              <div class="assignment-site">${assignment.site}</div>
              ${assignment.medecins.length > 0 ? `
                <div class="assignment-doctors">Médecins: ${assignment.medecins.join(', ')}</div>
              ` : ''}
              <div class="badges">
                ${assignment.is1R ? '<span class="badge badge-1r">1R</span>' : ''}
                ${assignment.is2F ? '<span class="badge badge-2f">2F</span>' : ''}
                ${assignment.type === 'administratif' ? '<span class="badge badge-admin">Admin</span>' : ''}
              </div>
            </div>
          `).join('')}
        </div>
      `).join('')}
    </body>
    </html>
  `;
}
