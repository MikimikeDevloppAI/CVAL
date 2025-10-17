import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

interface SwapPayload {
  planning_id: string;
  selected_dates: string[];
  week_start: string;
  week_end: string;
  assignments: any[];
  blocsMap: Array<{ key: string; value: any }>;
  sites: any[];
  secretaires: any[];
  besoinsEffectifs: any[];
  secretairesSitesMap: Array<{ key: string; value: any[] }>;
  secretairesMedecinsMap: Array<{ key: string; value: any[] }>;
  capacitesMap: Array<{ key: string; value: any[] }>;
}

serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    console.log("🔄 ========== DÉBUT OPTIMISATION SWAP ==========");
    
    const payload: SwapPayload = await req.json();
    const { 
      planning_id, 
      selected_dates, 
      assignments, 
      sites, 
      secretaires,
      besoinsEffectifs,
      secretairesSitesMap: sitesMapArray,
      secretairesMedecinsMap: medecinsMapArray,
      capacitesMap: capacitesMapArray
    } = payload;

    // Initialize Supabase client
    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const supabaseKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const supabase = createClient(supabaseUrl, supabaseKey);

    // Reconstruire les Maps
    const secretairesSitesMap = new Map<string, any[]>(
      sitesMapArray.map(x => [x.key, x.value])
    );
    const secretairesMedecinsMap = new Map<string, any[]>(
      medecinsMapArray.map(x => [x.key, x.value])
    );
    
    console.log(`📦 Payload reçu: ${assignments.length} assignations à optimiser`);
    
    // Identifier les sites ciblés
    const CLINIQUE_VALLEE_ID = '7c8abe96-0a6b-44eb-857f-ad69036ebc88';
    const CENTRE_ESPLANADE_ID = '043899a1-a232-4c4b-9d7d-0eb44dad00ad';
    
    const cliniqueValleeSite = sites.find((s) => s.id === CLINIQUE_VALLEE_ID);
    const esplanadeSite = sites.find((s) => s.id === CENTRE_ESPLANADE_ID);
    
    console.log(`\n🔍 DIAGNOSTIC SITES :`);
    console.log(`  - cliniqueValleeSite : ${cliniqueValleeSite ? '✓ trouvé' : '❌ null'}`);
    if (cliniqueValleeSite) console.log(`    → "${cliniqueValleeSite.nom}" (ID: ${cliniqueValleeSite.id})`);
    console.log(`  - esplanadeSite : ${esplanadeSite ? '✓ trouvé' : '❌ null'}`);
    if (esplanadeSite) console.log(`    → "${esplanadeSite.nom}" (ID: ${esplanadeSite.id})`);
    
    // Filtrer les secrétaires éligibles
    const eligibleSecretaires = secretaires.filter((sec) => {
      const sitesData = secretairesSitesMap.get(sec.id) || [];
      return sitesData.some((s) => 
        (cliniqueValleeSite && s.site_id === cliniqueValleeSite.id) || 
        (esplanadeSite && s.site_id === esplanadeSite.id)
      );
    });
    
    console.log(`${eligibleSecretaires.length} secrétaires éligibles pour optimisation`);
    
    // PHASE DE SWAP ITÉRATIVE (travail en mémoire)
    const MAX_ITERATIONS = 30;
    let totalSwaps = 0;
    let totalGain = 0;
    
    // Créer une copie mutable des assignations
    let currentAssignments = JSON.parse(JSON.stringify(assignments));
    
    // Helper: calculer pénalités
    const calculatePenalties = (adminCount: number, siteChanges: number, esplanadeCount: number, secretaireId: string): number => {
      let penalty = 0;
      
      // Pénalités admin EXPONENTIELLES
      if (adminCount === 2) penalty -= 50;
      else if (adminCount === 3) penalty -= 120;
      else if (adminCount === 4) penalty -= 200;
      else if (adminCount === 5) penalty -= 300;
      else if (adminCount === 6) penalty -= 420;
      else if (adminCount === 7) penalty -= 550;
      else if (adminCount === 8) penalty -= 700;
      else if (adminCount === 9) penalty -= 900;
      else if (adminCount === 10) penalty -= 1200;
      else if (adminCount >= 11) penalty -= 1500;
      
      // Pénalité changement de site
      penalty -= siteChanges * 600;
      
      // Pénalité "Port-en-Truie" pour Centre Esplanade
      const ESPLANADE_ID = '043899a1-a232-4c4b-9d7d-0eb44dad00ad';
      const sitesData = secretairesSitesMap.get(secretaireId) || [];
      const esplanadePref = sitesData.find(s => s.site_id === ESPLANADE_ID);
      
      if (esplanadePref) {
        const prio = typeof esplanadePref.priorite === 'string' 
          ? parseInt(esplanadePref.priorite, 10) 
          : esplanadePref.priorite;
        
        if ((prio === 2 || prio === 3) && esplanadeCount > 1) {
          const extraHalfDays = esplanadeCount - 1;
          penalty -= extraHalfDays * 150;
        }
      }
      
      return penalty;
    };
    
    // Helper: calculer score d'une assignation
    const calculateScore = (assignment: any, secId: string): number => {
      let score = 0;
      
      if (assignment.type_assignation === 'administratif') {
        score += 100;
        const sec = secretaires.find(s => s.id === secId);
        if (sec?.prefered_admin) {
          const secAssignments = currentAssignments.filter((a: any) => a.secretaire_id === secId);
          const adminCount = secAssignments.filter((a: any) => a.type_assignation === 'administratif').length;
          if (adminCount === 1) { // C'est le premier
            score += 500;
          }
        }
        return score;
      }
      
      if (assignment.type_assignation === 'site' && assignment.site_id) {
        const sitesData = secretairesSitesMap.get(secId) || [];
        const siteData = sitesData.find((s) => s.site_id === assignment.site_id);
        
        if (siteData) {
          const prio = typeof siteData.priorite === 'string' 
            ? parseInt(siteData.priorite, 10) 
            : siteData.priorite;
          
          if (prio === 1) score += 1200;
          else if (prio === 2) score += 1100;
          else if (prio === 3) score += 1000;
        }
        
        // BONUS CONTINUITÉ
        const otherPeriod = assignment.periode === 'matin' ? 'apres_midi' : 'matin';
        const otherAssignment = currentAssignments.find((a: any) =>
          a.secretaire_id === secId &&
          a.date === assignment.date &&
          a.periode === otherPeriod &&
          a.type_assignation === 'site' &&
          a.site_id === assignment.site_id
        );
        
        if (otherAssignment) {
          score += 300;
        }
        
        // Score médecins présents
        const medecinsOnSite = besoinsEffectifs.filter(b =>
          b.site_id === assignment.site_id &&
          b.date === assignment.date &&
          b.demi_journee === assignment.periode &&
          b.type === 'medecin'
        );
        
        for (const besoin of medecinsOnSite) {
          if (besoin.medecin_id) {
            const medRelation = secretairesMedecinsMap.get(`${secId}_${besoin.medecin_id}`)?.[0];
            if (medRelation) {
              if (medRelation.priorite === 1 || medRelation.priorite === '1') score += 2000;
              else if (medRelation.priorite === 2 || medRelation.priorite === '2') score += 1500;
              else if (medRelation.priorite === 3 || medRelation.priorite === '3') score += 100;
            }
          }
        }
      }
      
      return score;
    };
    
    // Sites sensibles pour le bloc opératoire
    const BLOC_RESTRICTED_SITES = [
      '7723c334-d06c-413d-96f0-be281d76520d',
      '043899a1-a232-4c4b-9d7d-0eb44dad00ad'
    ];
    
    // Helper: pénalité si swap bloc ↔ site restreint
    const getBlocSitePenalty = (a1: any, a2: any): number => {
      const isBlocToRestrictedSite = 
        (a1.type_assignation === 'bloc' && a2.type_assignation === 'site' && 
         BLOC_RESTRICTED_SITES.includes(a2.site_id)) ||
        (a2.type_assignation === 'bloc' && a1.type_assignation === 'site' && 
         BLOC_RESTRICTED_SITES.includes(a1.site_id));
      
      return isBlocToRestrictedSite ? -5000 : 0;
    };
    
    // Helper: vérifier si échange est éligible
    const isEligible = (a1: any, a2: any): boolean => {
      if (a1.date !== a2.date || a1.periode !== a2.periode) return false;
      if (a1.type_assignation === 'administratif' && a2.type_assignation === 'administratif') return false;
      
      // Permettre les swaps avec le bloc (la pénalité gérera les sites restreints)
      
      if (a1.type_assignation === 'site' && a1.site_id) {
        const sitesData = secretairesSitesMap.get(a2.secretaire_id) || [];
        if (!sitesData.some(s => s.site_id === a1.site_id)) return false;
      }
      
      if (a2.type_assignation === 'site' && a2.site_id) {
        const sitesData = secretairesSitesMap.get(a1.secretaire_id) || [];
        if (!sitesData.some(s => s.site_id === a2.site_id)) return false;
      }
      
      return true;
    };
    
    // BOUCLE D'OPTIMISATION
    for (let iteration = 1; iteration <= MAX_ITERATIONS; iteration++) {
      console.log(`\n[Itération ${iteration}]`);
      
      // 1. Calculer métriques par secrétaire
      const secretaryMetrics = new Map<string, {
        adminCount: number,
        siteChanges: number,
        esplanadeCount: number,
        assignments: any[]
      }>();
      
      for (const sec of eligibleSecretaires) {
        const secAssignments = currentAssignments.filter((a: any) => a.secretaire_id === sec.id);
        
        const adminCount = secAssignments.filter((a: any) => a.type_assignation === 'administratif').length;
        
        let siteChanges = 0;
        const dateGroups = new Map<string, any[]>();
        for (const a of secAssignments) {
          if (!dateGroups.has(a.date)) dateGroups.set(a.date, []);
          dateGroups.get(a.date)!.push(a);
        }
        
        for (const [_, dayAssignments] of dateGroups) {
          const matin = dayAssignments.find(a => a.periode === 'matin');
          const aprem = dayAssignments.find(a => a.periode === 'apres_midi');
          
          if (matin && aprem && 
              matin.type_assignation === 'site' && aprem.type_assignation === 'site' &&
              matin.site_id !== aprem.site_id) {
            siteChanges++;
          }
        }
        
        const ESPLANADE_ID = '043899a1-a232-4c4b-9d7d-0eb44dad00ad';
        const esplanadeCount = secAssignments.filter((a: any) =>
          a.type_assignation === 'site' && a.site_id === ESPLANADE_ID
        ).length;
        
        secretaryMetrics.set(sec.id, {
          adminCount,
          siteChanges,
          esplanadeCount,
          assignments: secAssignments
        });
      }
      
      // 2. Détecter problèmes
      const problematicSecs = Array.from(secretaryMetrics.entries())
        .filter(([_, m]) => m.adminCount >= 2 || m.siteChanges > 0)
        .map(([id, _]) => eligibleSecretaires.find(s => s.id === id)!);
      
      const normalSecs = eligibleSecretaires.filter(s => 
        !problematicSecs.some(p => p.id === s.id)
      );
      
      console.log(`Problèmes détectés: ${Array.from(secretaryMetrics.values()).reduce((sum, m) => sum + m.siteChanges, 0)} changements site, ${problematicSecs.length} surcharges admin`);
      
      // 3. Collecter candidats d'échange
      const highPriorityCandidates: any[] = [];
      const regularCandidates: any[] = [];
      
      // Échanges demi-journée
      for (let i = 0; i < currentAssignments.length; i++) {
        const a1 = currentAssignments[i];
        if (!eligibleSecretaires.some(s => s.id === a1.secretaire_id)) continue;
        
        for (let j = i + 1; j < currentAssignments.length; j++) {
          const a2 = currentAssignments[j];
          if (!eligibleSecretaires.some(s => s.id === a2.secretaire_id)) continue;
          if (a1.secretaire_id === a2.secretaire_id) continue;
          
          if (!isEligible(a1, a2)) continue;
          
          const m1 = secretaryMetrics.get(a1.secretaire_id)!;
          const m2 = secretaryMetrics.get(a2.secretaire_id)!;
          
          const scoreBefore = 
            calculateScore(a1, a1.secretaire_id) + 
            calculateScore(a2, a2.secretaire_id) +
            calculatePenalties(m1.adminCount, m1.siteChanges, m1.esplanadeCount, a1.secretaire_id) +
            calculatePenalties(m2.adminCount, m2.siteChanges, m2.esplanadeCount, a2.secretaire_id);
          
          // Simuler échange
          let newAdminCount1 = m1.adminCount;
          let newAdminCount2 = m2.adminCount;
          
          if (a1.type_assignation === 'administratif' && a2.type_assignation !== 'administratif') {
            newAdminCount1 -= 1;
            newAdminCount2 += 1;
          } else if (a1.type_assignation !== 'administratif' && a2.type_assignation === 'administratif') {
            newAdminCount1 += 1;
            newAdminCount2 -= 1;
          }
          
          const scoreAfter = 
            calculateScore(a1, a2.secretaire_id) + 
            calculateScore(a2, a1.secretaire_id) +
            calculatePenalties(newAdminCount1, m1.siteChanges, m1.esplanadeCount, a1.secretaire_id) +
            calculatePenalties(newAdminCount2, m2.siteChanges, m2.esplanadeCount, a2.secretaire_id);
          
          let gain = scoreAfter - scoreBefore;
          
          // Appliquer pénalité bloc ↔ site restreint
          gain += getBlocSitePenalty(a1, a2);
          
          if (gain > 0) {
            regularCandidates.push({
              idx_1: i,
              idx_2: j,
              type: 'half_day',
              gain,
              secretaire_1: a1.secretaire_id,
              secretaire_2: a2.secretaire_id,
              date: a1.date
            });
          }
        }
      }
      
      // Échanges journée complète haute priorité
      for (const sec1 of problematicSecs) {
        for (const sec2 of normalSecs) {
          if (sec1.id === sec2.id) continue;
          
          for (const date of selected_dates) {
            const s1Assignments = currentAssignments.filter((a: any) =>
              a.secretaire_id === sec1.id && a.date === date
            );
            const s2Assignments = currentAssignments.filter((a: any) =>
              a.secretaire_id === sec2.id && a.date === date
            );
            
            const s1Matin = s1Assignments.find((a: any) => a.periode === 'matin');
            const s1Aprem = s1Assignments.find((a: any) => a.periode === 'apres_midi');
            const s2Matin = s2Assignments.find((a: any) => a.periode === 'matin');
            const s2Aprem = s2Assignments.find((a: any) => a.periode === 'apres_midi');
            
            if (!s1Matin || !s1Aprem || !s2Matin || !s2Aprem) continue;
            if (!isEligible(s1Matin, s2Matin) || !isEligible(s1Aprem, s2Aprem)) continue;
            
            const m1 = secretaryMetrics.get(sec1.id)!;
            const m2 = secretaryMetrics.get(sec2.id)!;
            
            const scoreBefore = 
              calculateScore(s1Matin, sec1.id) + calculateScore(s1Aprem, sec1.id) +
              calculateScore(s2Matin, sec2.id) + calculateScore(s2Aprem, sec2.id) +
              calculatePenalties(m1.adminCount, m1.siteChanges, m1.esplanadeCount, sec1.id) +
              calculatePenalties(m2.adminCount, m2.siteChanges, m2.esplanadeCount, sec2.id);
            
            const scoreAfter = 
              calculateScore(s1Matin, sec2.id) + calculateScore(s1Aprem, sec2.id) +
              calculateScore(s2Matin, sec1.id) + calculateScore(s2Aprem, sec1.id) +
              calculatePenalties(m1.adminCount, m1.siteChanges, m1.esplanadeCount, sec1.id) +
              calculatePenalties(m2.adminCount, m2.siteChanges, m2.esplanadeCount, sec2.id);
            
            let gain = scoreAfter - scoreBefore;
            
            // Appliquer pénalités bloc ↔ site restreint pour les 2 demi-journées
            gain += getBlocSitePenalty(s1Matin, s2Matin);
            gain += getBlocSitePenalty(s1Aprem, s2Aprem);
            
            if (gain > 0) {
              const idx1 = currentAssignments.indexOf(s1Matin);
              const idx2 = currentAssignments.indexOf(s2Matin);
              
              highPriorityCandidates.push({
                idx_1: idx1,
                idx_2: idx2,
                type: 'full_day',
                gain,
                secretaire_1: sec1.id,
                secretaire_2: sec2.id,
                date
              });
            }
          }
        }
      }
      
      const candidates = [...highPriorityCandidates, ...regularCandidates];
      
      if (candidates.length === 0) {
        console.log("✓ Aucun échange améliorant trouvé");
        break;
      }
      
      candidates.sort((a, b) => b.gain - a.gain);
      console.log(`${candidates.length} candidats d'échange trouvés`);
      
      const best = candidates[0];
      console.log(`💡 Meilleur échange retenu (${best.type}): gain +${best.gain.toFixed(0)}`);
      
      // Appliquer l'échange EN MÉMOIRE
      if (best.type === 'half_day') {
        const tempSecId = currentAssignments[best.idx_1].secretaire_id;
        currentAssignments[best.idx_1].secretaire_id = currentAssignments[best.idx_2].secretaire_id;
        currentAssignments[best.idx_2].secretaire_id = tempSecId;
      } else {
        // Journée complète : échanger les 2 périodes
        const s1MatinIdx = best.idx_1;
        const s2MatinIdx = best.idx_2;
        
        const s1ApremIdx = currentAssignments.findIndex((a: any) =>
          a.secretaire_id === best.secretaire_1 &&
          a.date === best.date &&
          a.periode === 'apres_midi'
        );
        const s2ApremIdx = currentAssignments.findIndex((a: any) =>
          a.secretaire_id === best.secretaire_2 &&
          a.date === best.date &&
          a.periode === 'apres_midi'
        );
        
        currentAssignments[s1MatinIdx].secretaire_id = best.secretaire_2;
        currentAssignments[s2MatinIdx].secretaire_id = best.secretaire_1;
        currentAssignments[s1ApremIdx].secretaire_id = best.secretaire_2;
        currentAssignments[s2ApremIdx].secretaire_id = best.secretaire_1;
      }
      
      console.log("✓ Échange appliqué");
      totalSwaps++;
      totalGain += best.gain;
    }
    
    console.log(`\n✅ Phase swap terminée: ${totalSwaps} échanges appliqués, gain total: +${totalGain.toFixed(0)}`);
    
    // INSERTION FINALE dans la DB
    console.log("\n💾 Insertion des assignations optimisées...");
    
    const { error: insertError } = await supabase
      .from("planning_genere_personnel")
      .insert(currentAssignments);
    
    if (insertError) {
      console.error("❌ Erreur insertion:", insertError);
      throw insertError;
    }
    
    console.log(`✅ ${currentAssignments.length} assignations insérées`);
    
    return new Response(
      JSON.stringify({ 
        success: true, 
        totalSwaps, 
        totalGain,
        assignmentsCount: currentAssignments.length
      }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
    
  } catch (error) {
    console.error("❌ Erreur dans optimize-planning-swap:", error);
    return new Response(
      JSON.stringify({ error: error instanceof Error ? error.message : String(error) }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }
});
