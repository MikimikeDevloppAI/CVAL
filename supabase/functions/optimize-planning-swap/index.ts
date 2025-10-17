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
    console.log("🔄 ========== DÉBUT OPTIMISATION SWAP (6 PHASES) ==========");
    
    const payload: SwapPayload = await req.json();
    const { 
      planning_id, 
      assignments, 
      sites, 
      secretaires,
      besoinsEffectifs,
      secretairesSitesMap: sitesMapArray,
      secretairesMedecinsMap: medecinsMapArray,
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
    
    console.log(`📦 ${assignments.length} assignations à optimiser`);
    
    // Sites constants
    const PORT_EN_TRUIE_ID = '043899a1-a232-4c4b-9d7d-0eb44dad00ad';
    const CENTRE_ESPLANADE_ID = '043899a1-a232-4c4b-9d7d-0eb44dad00ad'; // Same as Port-en-Truie
    const BLOC_RESTRICTED_SITES = [PORT_EN_TRUIE_ID, CENTRE_ESPLANADE_ID];
    
    // Créer une copie mutable des assignations
    let currentAssignments = JSON.parse(JSON.stringify(assignments));
    
    // ========== HELPERS ==========
    
    const getSecretaryName = (secId: string): string => {
      const sec = secretaires.find(s => s.id === secId);
      return sec ? `${sec.first_name || ''} ${sec.name || ''}`.trim() : secId.slice(0, 8);
    };
    
    const getSiteName = (siteId: string | null): string => {
      if (!siteId) return 'admin';
      const site = sites.find(s => s.id === siteId);
      return site?.nom || siteId.slice(0, 8);
    };
    
    const hasHighPriorityDoctor = (assignment: any): boolean => {
      if (assignment.type_assignation !== 'site' || !assignment.site_id) return false;
      
      const medecinsOnSite = besoinsEffectifs.filter(b =>
        b.site_id === assignment.site_id &&
        b.date === assignment.date &&
        b.demi_journee === assignment.periode &&
        b.type === 'medecin'
      );
      
      for (const besoin of medecinsOnSite) {
        if (besoin.medecin_id) {
          const medRelation = secretairesMedecinsMap.get(`${assignment.secretaire_id}_${besoin.medecin_id}`)?.[0];
          if (medRelation) {
            const prio = typeof medRelation.priorite === 'string' 
              ? parseInt(medRelation.priorite, 10) 
              : medRelation.priorite;
            if (prio === 1 || prio === 2) return true;
          }
        }
      }
      return false;
    };
    
    const canGoToSite = (secId: string, siteId: string): boolean => {
      const sitesData = secretairesSitesMap.get(secId) || [];
      return sitesData.some(s => s.site_id === siteId);
    };
    
    const hasSiteChangeForPair = (matin?: any, aprem?: any): boolean => {
      if (!matin || !aprem) return false;
      
      if (matin.type_assignation === 'site' && aprem.type_assignation === 'site') {
        return matin.site_id !== aprem.site_id;
      }
      
      if ((matin.type_assignation === 'bloc' && aprem.type_assignation === 'site') ||
          (matin.type_assignation === 'site' && aprem.type_assignation === 'bloc')) {
        return true;
      }
      
      return false;
    };
    
    const getDayAssignments = (secId: string, date: string): { matin?: any; aprem?: any } => {
      const dayAssignments = currentAssignments.filter((a: any) => 
        a.secretaire_id === secId && a.date === date
      );
      
      return {
        matin: dayAssignments.find((a: any) => a.periode === 'matin'),
        aprem: dayAssignments.find((a: any) => a.periode === 'apres_midi')
      };
    };
    
    // Helper: calculer score total (simplifié pour deltas)
    const calculateTotalScore = (): number => {
      let totalScore = 0;
      
      // Calculer métriques par secrétaire
      const secretaryMetrics = new Map<string, {
        adminCount: number;
        siteChanges: number;
        portEnTruieCount: number;
      }>();
      
      for (const sec of secretaires) {
        const secAssignments = currentAssignments.filter((a: any) => a.secretaire_id === sec.id);
        const adminCount = secAssignments.filter((a: any) => a.type_assignation === 'administratif').length;
        
        // Compter changements de site
        const dates = Array.from(new Set(secAssignments.map((a: any) => a.date))) as string[];
        let siteChanges = 0;
        for (const date of dates) {
          const { matin, aprem } = getDayAssignments(sec.id, date);
          if (hasSiteChangeForPair(matin, aprem)) siteChanges++;
        }
        
        // Compter Port-en-Truie
        const portEnTruieCount = secAssignments.filter((a: any) =>
          a.type_assignation === 'site' && a.site_id === PORT_EN_TRUIE_ID
        ).length;
        
        secretaryMetrics.set(sec.id, { adminCount, siteChanges, portEnTruieCount });
      }
      
      // Score des assignations
      for (const assignment of currentAssignments) {
        if (assignment.type_assignation === 'administratif') {
          totalScore += 100;
        } else if (assignment.type_assignation === 'site' && assignment.site_id) {
          const sitesData = secretairesSitesMap.get(assignment.secretaire_id) || [];
          const siteData = sitesData.find((s) => s.site_id === assignment.site_id);
          
          if (siteData) {
            const prio = typeof siteData.priorite === 'string' 
              ? parseInt(siteData.priorite, 10) 
              : siteData.priorite;
            
            if (prio === 1) totalScore += 1200;
            else if (prio === 2) totalScore += 1100;
            else if (prio === 3) totalScore += 1000;
          }
          
          // Bonus continuité
          const otherPeriod = assignment.periode === 'matin' ? 'apres_midi' : 'matin';
          const otherAssignment = currentAssignments.find((a: any) =>
            a.secretaire_id === assignment.secretaire_id &&
            a.date === assignment.date &&
            a.periode === otherPeriod &&
            a.type_assignation === 'site' &&
            a.site_id === assignment.site_id
          );
          
          if (otherAssignment) totalScore += 300;
          
          // Score médecins
          const medecinsOnSite = besoinsEffectifs.filter(b =>
            b.site_id === assignment.site_id &&
            b.date === assignment.date &&
            b.demi_journee === assignment.periode &&
            b.type === 'medecin'
          );
          
          for (const besoin of medecinsOnSite) {
            if (besoin.medecin_id) {
              const medRelation = secretairesMedecinsMap.get(`${assignment.secretaire_id}_${besoin.medecin_id}`)?.[0];
              if (medRelation) {
                const prio = typeof medRelation.priorite === 'string' 
                  ? parseInt(medRelation.priorite, 10) 
                  : medRelation.priorite;
                if (prio === 1) totalScore += 2000;
                else if (prio === 2) totalScore += 1500;
                else if (prio === 3) totalScore += 100;
              }
            }
          }
        }
      }
      
      // Pénalités
      for (const sec of secretaires) {
        const metrics = secretaryMetrics.get(sec.id)!;
        
        // Pénalités admin
        const adminCount = metrics.adminCount;
        if (adminCount === 3) totalScore -= 180;
        else if (adminCount === 4) totalScore -= 260;
        else if (adminCount === 5) totalScore -= 350;
        else if (adminCount === 6) totalScore -= 450;
        else if (adminCount === 7) totalScore -= 670;
        else if (adminCount === 8) totalScore -= 800;
        else if (adminCount >= 9) totalScore -= 1000 * (adminCount - 8);
        
        // Bonus/pénalité prefered_admin
        if (sec.prefered_admin) {
          if (adminCount === 1) totalScore += 3000;
          else if (adminCount === 2) totalScore += 3000;
        } else {
          if (adminCount === 1) totalScore -= 800;
          else if (adminCount === 2) totalScore -= 1200;
        }
        
        // Pénalité changement de site
        totalScore -= metrics.siteChanges * 1500;
        
        // Pénalité Port-en-Truie
        const sitesData = secretairesSitesMap.get(sec.id) || [];
        const portPref = sitesData.find(s => s.site_id === PORT_EN_TRUIE_ID);
        
        if (portPref) {
          const prio = typeof portPref.priorite === 'string' 
            ? parseInt(portPref.priorite, 10) 
            : portPref.priorite;
          
          if ((prio === 2 || prio === 3) && metrics.portEnTruieCount > 1) {
            const extra = metrics.portEnTruieCount - 1;
            totalScore -= extra * 150;
          }
        }
      }
      
      // Pénalité bloc + site restreint
      for (const sec of secretaires) {
        const dates = Array.from(new Set(currentAssignments.filter((a: any) => a.secretaire_id === sec.id).map((a: any) => a.date))) as string[];
        for (const date of dates) {
          const { matin, aprem } = getDayAssignments(sec.id, date);
          if (matin && aprem) {
            const hasBlocAndRestricted = 
              (matin.type_assignation === 'bloc' && aprem.type_assignation === 'site' && 
               BLOC_RESTRICTED_SITES.includes(aprem.site_id)) ||
              (aprem.type_assignation === 'bloc' && matin.type_assignation === 'site' && 
               BLOC_RESTRICTED_SITES.includes(matin.site_id));
            
            if (hasBlocAndRestricted) totalScore -= 5000;
          }
        }
      }
      
      return totalScore;
    };
    
    // ========== PHASE 1: Opérations Bloquées (OBLIGATOIRE) ==========
    
    const phase1_blockedOperations = (): { swaps: number; gain: number; resolved: boolean } => {
      console.log("\n🔴 PHASE 1 : Résolution opérations bloquées (OBLIGATOIRE)");
      
      const blockedAssignments = currentAssignments.filter((a: any) => {
        if (a.type_assignation !== 'bloc') return false;
        
        const otherPeriod = a.periode === 'matin' ? 'apres_midi' : 'matin';
        const otherAssignment = currentAssignments.find((other: any) =>
          other.secretaire_id === a.secretaire_id &&
          other.date === a.date &&
          other.periode === otherPeriod
        );
        
        return otherAssignment && 
               otherAssignment.type_assignation === 'site' &&
               BLOC_RESTRICTED_SITES.includes(otherAssignment.site_id);
      });
      
      console.log(`   📍 ${blockedAssignments.length} situation(s) bloquée(s) détectée(s)`);
      
      let totalSwaps = 0;
      let totalGain = 0;
      
      for (const blockedAssignment of blockedAssignments) {
        const otherPeriod = blockedAssignment.periode === 'matin' ? 'apres_midi' : 'matin';
        const restrictedSiteAssignment = currentAssignments.find((a: any) =>
          a.secretaire_id === blockedAssignment.secretaire_id &&
          a.date === blockedAssignment.date &&
          a.periode === otherPeriod
        )!;
        
        console.log(`\n   🚨 ${getSecretaryName(blockedAssignment.secretaire_id)} le ${blockedAssignment.date}:`);
        console.log(`      ${blockedAssignment.periode}: BLOC`);
        console.log(`      ${otherPeriod}: ${getSiteName(restrictedSiteAssignment.site_id)}`);
        
        // Trouver tous les candidats
        const candidates = currentAssignments.filter((candidate: any) =>
          candidate.secretaire_id !== blockedAssignment.secretaire_id &&
          candidate.date === restrictedSiteAssignment.date &&
          candidate.periode === restrictedSiteAssignment.periode &&
          candidate.type_assignation !== 'bloc' && // Ne pas créer un autre problème
          !hasHighPriorityDoctor(candidate)
        );
        
        console.log(`      → ${candidates.length} candidat(s) trouvé(s)`);
        
        // Trier par delta
        const scoredCandidates = candidates.map((candidate: any) => {
          const scoreBefore = calculateTotalScore();
          
          const tempSecId1 = restrictedSiteAssignment.secretaire_id;
          const tempSecId2 = candidate.secretaire_id;
          
          restrictedSiteAssignment.secretaire_id = tempSecId2;
          candidate.secretaire_id = tempSecId1;
          
          const scoreAfter = calculateTotalScore();
          
          restrictedSiteAssignment.secretaire_id = tempSecId1;
          candidate.secretaire_id = tempSecId2;
          
          return { candidate, delta: scoreAfter - scoreBefore };
        }).sort((a: any, b: any) => b.delta - a.delta);
        
        if (scoredCandidates.length > 0) {
          const best = scoredCandidates[0];
          
          // Appliquer le swap
          const tempSecId = restrictedSiteAssignment.secretaire_id;
          restrictedSiteAssignment.secretaire_id = best.candidate.secretaire_id;
          best.candidate.secretaire_id = tempSecId;
          
          console.log(`      ✅ SWAP: ${getSecretaryName(best.candidate.secretaire_id)} ↔ ${getSecretaryName(tempSecId)}`);
          console.log(`         Delta: ${best.delta >= 0 ? '+' : ''}${best.delta.toFixed(0)} points`);
          totalSwaps++;
          totalGain += best.delta;
        } else {
          console.log(`      ❌ Aucun candidat trouvé`);
        }
      }
      
      console.log(`\n   📊 Phase 1: ${totalSwaps} swap(s), gain total: ${totalGain >= 0 ? '+' : ''}${totalGain.toFixed(0)}`);
      return { swaps: totalSwaps, gain: totalGain, resolved: totalSwaps === blockedAssignments.length };
    };
    
    // ========== PHASE 2: Contrainte Fermeture (OBLIGATOIRE) ==========
    
    const phase2_closingConstraint = (): { swaps: number; gain: number; resolved: boolean } => {
      console.log("\n🔴 PHASE 2 : Résolution contraintes fermeture (OBLIGATOIRE)");
      
      const sitesWithClosure = sites.filter((s: any) => s.fermeture);
      const dates = Array.from(new Set(currentAssignments.map((a: any) => a.date))) as string[];
      
      let totalSwaps = 0;
      let totalGain = 0;
      let allResolved = true;
      
      for (const site of sitesWithClosure) {
        for (const date of dates) {
          // Vérifier besoin
          const medecinMatin = besoinsEffectifs.filter((b: any) =>
            b.site_id === site.id && b.date === date && 
            b.demi_journee === 'matin' && b.type === 'medecin'
          );
          const medecinAprem = besoinsEffectifs.filter((b: any) =>
            b.site_id === site.id && b.date === date && 
            b.demi_journee === 'apres_midi' && b.type === 'medecin'
          );
          
          if (medecinMatin.length === 0 || medecinAprem.length === 0) continue;
          
          // Compter journées complètes
          const dayAssignments = currentAssignments.filter((a: any) =>
            a.date === date && a.site_id === site.id && a.type_assignation === 'site'
          );
          
          const secretaryDays = new Map<string, Set<string>>();
          dayAssignments.forEach((a: any) => {
            if (!secretaryDays.has(a.secretaire_id)) {
              secretaryDays.set(a.secretaire_id, new Set());
            }
            secretaryDays.get(a.secretaire_id)!.add(a.periode);
          });
          
          const fullDayCount = Array.from(secretaryDays.values())
            .filter(periods => periods.has('matin') && periods.has('apres_midi'))
            .length;
          
          if (fullDayCount >= 2) continue;
          
          let needed = 2 - fullDayCount;
          console.log(`\n   🏥 ${site.nom} le ${date}: ${fullDayCount}/2 journées complètes (manque ${needed})`);
          
          // Identifier secrétaires avec 1 demi-journée
          const partialCandidates = Array.from(secretaryDays.entries())
            .filter(([_, periods]) => periods.size === 1)
            .map(([secId, _]) => secId);
          
          console.log(`      → ${partialCandidates.length} candidat(s) avec 1 demi-journée`);
          
          for (const candidateId of partialCandidates) {
            if (needed <= 0) break;
            
            const existingPeriod = Array.from(secretaryDays.get(candidateId)!)[0];
            const neededPeriod = existingPeriod === 'matin' ? 'apres_midi' : 'matin';
            
            const otherAssignment = currentAssignments.find((a: any) =>
              a.secretaire_id === candidateId &&
              a.date === date &&
              a.periode === neededPeriod
            );
            
            if (!otherAssignment) continue;
            
            const swapCandidates = currentAssignments.filter((candidate: any) =>
              candidate.secretaire_id !== candidateId &&
              candidate.date === date &&
              candidate.periode === neededPeriod &&
              (candidate.type_assignation === 'administratif' || !hasHighPriorityDoctor(candidate))
            );
            
            const scoredSwaps = swapCandidates.map((candidate: any) => {
              const scoreBefore = calculateTotalScore();
              
              const tempSecId1 = otherAssignment.secretaire_id;
              const tempSecId2 = candidate.secretaire_id;
              
              otherAssignment.secretaire_id = tempSecId2;
              candidate.secretaire_id = tempSecId1;
              
              const scoreAfter = calculateTotalScore();
              
              otherAssignment.secretaire_id = tempSecId1;
              candidate.secretaire_id = tempSecId2;
              
              return { candidate, delta: scoreAfter - scoreBefore };
            }).sort((a: any, b: any) => b.delta - a.delta);
            
            if (scoredSwaps.length > 0) {
              const best = scoredSwaps[0];
              
              const tempSecId = otherAssignment.secretaire_id;
              otherAssignment.secretaire_id = best.candidate.secretaire_id;
              best.candidate.secretaire_id = tempSecId;
              
              console.log(`      ✅ SWAP: ${getSecretaryName(candidateId)} obtient ${neededPeriod}`);
              console.log(`         ↔ ${getSecretaryName(best.candidate.secretaire_id)}`);
              console.log(`         Delta: ${best.delta >= 0 ? '+' : ''}${best.delta.toFixed(0)} points`);
              totalSwaps++;
              totalGain += best.delta;
              needed--;
            }
          }
          
          if (needed > 0) {
            console.log(`      ❌ Impossible de résoudre complètement (manque ${needed})`);
            allResolved = false;
          }
        }
      }
      
      console.log(`\n   📊 Phase 2: ${totalSwaps} swap(s), gain total: ${totalGain >= 0 ? '+' : ''}${totalGain.toFixed(0)}`);
      return { swaps: totalSwaps, gain: totalGain, resolved: allResolved };
    };
    
    // ========== PHASE 3: Admin pour prefered_admin ==========
    
    const phase3_adminForPreferred = (): { swaps: number; gain: number } => {
      console.log("\n🟡 PHASE 3 : Attribution admin pour prefered_admin");
      
      const preferredAdminSecs = secretaires.filter((s: any) => s.prefered_admin);
      
      let totalSwaps = 0;
      let totalGain = 0;
      
      for (const sec of preferredAdminSecs) {
        const secAssignments = currentAssignments.filter((a: any) => a.secretaire_id === sec.id);
        const adminCount = secAssignments.filter((a: any) => a.type_assignation === 'administratif').length;
        
        if (adminCount >= 2) {
          console.log(`   ${getSecretaryName(sec.id)}: ${adminCount} admin ✓`);
          continue;
        }
        
        let needed = 2 - adminCount;
        console.log(`\n   👤 ${getSecretaryName(sec.id)}: ${adminCount}/2 admin (besoin ${needed})`);
        
        const swappableSiteAssignments = secAssignments.filter((a: any) =>
          a.type_assignation === 'site' && !hasHighPriorityDoctor(a)
        );
        
        for (const siteAssignment of swappableSiteAssignments) {
          if (needed <= 0) break;
          
          const adminCandidates = currentAssignments.filter((candidate: any) =>
            candidate.secretaire_id !== sec.id &&
            candidate.date === siteAssignment.date &&
            candidate.periode === siteAssignment.periode &&
            candidate.type_assignation === 'administratif' &&
            canGoToSite(candidate.secretaire_id, siteAssignment.site_id)
          );
          
          const scoredSwaps = adminCandidates.map((candidate: any) => {
            const scoreBefore = calculateTotalScore();
            
            const tempSecId1 = siteAssignment.secretaire_id;
            const tempSecId2 = candidate.secretaire_id;
            
            siteAssignment.secretaire_id = tempSecId2;
            candidate.secretaire_id = tempSecId1;
            
            const scoreAfter = calculateTotalScore();
            
            siteAssignment.secretaire_id = tempSecId1;
            candidate.secretaire_id = tempSecId2;
            
            return { candidate, delta: scoreAfter - scoreBefore };
          }).filter((s: any) => s.delta >= 0).sort((a: any, b: any) => b.delta - a.delta);
          
          if (scoredSwaps.length > 0) {
            const best = scoredSwaps[0];
            
            const tempSecId = siteAssignment.secretaire_id;
            siteAssignment.secretaire_id = best.candidate.secretaire_id;
            best.candidate.secretaire_id = tempSecId;
            
            console.log(`      ✅ SWAP: obtient admin le ${siteAssignment.date} ${siteAssignment.periode}`);
            console.log(`         ↔ ${getSecretaryName(best.candidate.secretaire_id)}`);
            console.log(`         Delta: +${best.delta.toFixed(0)} points`);
            totalSwaps++;
            totalGain += best.delta;
            needed--;
          }
        }
      }
      
      console.log(`\n   📊 Phase 3: ${totalSwaps} swap(s), gain total: ${totalGain >= 0 ? '+' : ''}${totalGain.toFixed(0)}`);
      return { swaps: totalSwaps, gain: totalGain };
    };
    
    // ========== PHASE 4: Réduction Changements de Site ==========
    
    const phase4_reduceSiteChanges = (): { swaps: number; gain: number } => {
      console.log("\n🟡 PHASE 4 : Réduction changements de site");
      
      let totalSwaps = 0;
      let totalGain = 0;
      
      const dates = Array.from(new Set(currentAssignments.map((a: any) => a.date))) as string[];
      const siteChanges: Array<{secId: string, date: string, matin: any, aprem: any}> = [];
      
      for (const sec of secretaires) {
        for (const date of dates) {
          const { matin, aprem } = getDayAssignments(sec.id, date);
          if (matin && aprem && hasSiteChangeForPair(matin, aprem)) {
            siteChanges.push({ secId: sec.id, date, matin, aprem });
          }
        }
      }
      
      console.log(`   📍 ${siteChanges.length} changement(s) de site détecté(s)`);
      
      for (const change of siteChanges) {
        console.log(`\n   🔄 ${getSecretaryName(change.secId)} le ${change.date}:`);
        console.log(`      matin: ${change.matin.type_assignation === 'site' ? getSiteName(change.matin.site_id) : 'BLOC'}`);
        console.log(`      aprem: ${change.aprem.type_assignation === 'site' ? getSiteName(change.aprem.site_id) : 'BLOC'}`);
        
        const matinCandidates = currentAssignments.filter((candidate: any) =>
          candidate.secretaire_id !== change.secId &&
          candidate.date === change.date &&
          candidate.periode === 'matin' &&
          !hasHighPriorityDoctor(change.matin) &&
          !hasHighPriorityDoctor(candidate)
        );
        
        const apremCandidates = currentAssignments.filter((candidate: any) =>
          candidate.secretaire_id !== change.secId &&
          candidate.date === change.date &&
          candidate.periode === 'apres_midi' &&
          !hasHighPriorityDoctor(change.aprem) &&
          !hasHighPriorityDoctor(candidate)
        );
        
        let bestSwap: {period: 'matin' | 'apres_midi', candidate: any, delta: number} | null = null;
        
        for (const candidate of matinCandidates) {
          const scoreBefore = calculateTotalScore();
          
          const tempSecId1 = change.matin.secretaire_id;
          const tempSecId2 = candidate.secretaire_id;
          
          change.matin.secretaire_id = tempSecId2;
          candidate.secretaire_id = tempSecId1;
          
          const scoreAfter = calculateTotalScore();
          const delta = scoreAfter - scoreBefore;
          
          change.matin.secretaire_id = tempSecId1;
          candidate.secretaire_id = tempSecId2;
          
          if (delta > 0 && (!bestSwap || delta > bestSwap.delta)) {
            bestSwap = { period: 'matin', candidate, delta };
          }
        }
        
        for (const candidate of apremCandidates) {
          const scoreBefore = calculateTotalScore();
          
          const tempSecId1 = change.aprem.secretaire_id;
          const tempSecId2 = candidate.secretaire_id;
          
          change.aprem.secretaire_id = tempSecId2;
          candidate.secretaire_id = tempSecId1;
          
          const scoreAfter = calculateTotalScore();
          const delta = scoreAfter - scoreBefore;
          
          change.aprem.secretaire_id = tempSecId1;
          candidate.secretaire_id = tempSecId2;
          
          if (delta > 0 && (!bestSwap || delta > bestSwap.delta)) {
            bestSwap = { period: 'apres_midi', candidate, delta };
          }
        }
        
        if (bestSwap) {
          const assignment = bestSwap.period === 'matin' ? change.matin : change.aprem;
          const tempSecId = assignment.secretaire_id;
          assignment.secretaire_id = bestSwap.candidate.secretaire_id;
          bestSwap.candidate.secretaire_id = tempSecId;
          
          console.log(`      ✅ SWAP ${bestSwap.period}: ${getSecretaryName(bestSwap.candidate.secretaire_id)} ↔ ${getSecretaryName(tempSecId)}`);
          console.log(`         Delta: +${bestSwap.delta.toFixed(0)} points`);
          totalSwaps++;
          totalGain += bestSwap.delta;
        } else {
          console.log(`      ❌ Aucun swap bénéfique trouvé`);
        }
      }
      
      console.log(`\n   📊 Phase 4: ${totalSwaps} swap(s), gain total: ${totalGain >= 0 ? '+' : ''}${totalGain.toFixed(0)}`);
      return { swaps: totalSwaps, gain: totalGain };
    };
    
    // ========== PHASE 5: Équilibrage Admin (>2) ==========
    
    const phase5_balanceAdmin = (): { swaps: number; gain: number } => {
      console.log("\n🟡 PHASE 5 : Équilibrage admin (>2 demi-journées)");
      
      let totalSwaps = 0;
      let totalGain = 0;
      
      const overloadedAdminSecs: Array<{sec: any, adminCount: number}> = [];
      
      for (const sec of secretaires) {
        const sitesData = secretairesSitesMap.get(sec.id) || [];
        if (sitesData.length === 0) continue;
        
        const secAssignments = currentAssignments.filter((a: any) => a.secretaire_id === sec.id);
        const adminCount = secAssignments.filter((a: any) => a.type_assignation === 'administratif').length;
        
        if (adminCount > 2) {
          overloadedAdminSecs.push({ sec, adminCount });
        }
      }
      
      console.log(`   📍 ${overloadedAdminSecs.length} secrétaire(s) avec >2 admin`);
      
      for (const {sec, adminCount} of overloadedAdminSecs) {
        let currentAdminCount = adminCount;
        console.log(`\n   👤 ${getSecretaryName(sec.id)}: ${currentAdminCount} admin`);
        
        const adminAssignments = currentAssignments.filter((a: any) =>
          a.secretaire_id === sec.id && a.type_assignation === 'administratif'
        );
        
        for (const adminAssignment of adminAssignments) {
          if (currentAdminCount <= 2) break;
          
          const siteCandidates = currentAssignments.filter((candidate: any) =>
            candidate.secretaire_id !== sec.id &&
            candidate.date === adminAssignment.date &&
            candidate.periode === adminAssignment.periode &&
            candidate.type_assignation === 'site' &&
            !hasHighPriorityDoctor(candidate) &&
            canGoToSite(sec.id, candidate.site_id)
          );
          
          const scoredSwaps = siteCandidates.map((candidate: any) => {
            const scoreBefore = calculateTotalScore();
            
            const tempSecId1 = adminAssignment.secretaire_id;
            const tempSecId2 = candidate.secretaire_id;
            
            adminAssignment.secretaire_id = tempSecId2;
            candidate.secretaire_id = tempSecId1;
            
            const scoreAfter = calculateTotalScore();
            
            adminAssignment.secretaire_id = tempSecId1;
            candidate.secretaire_id = tempSecId2;
            
            return { candidate, delta: scoreAfter - scoreBefore };
          }).filter((s: any) => s.delta >= 0).sort((a: any, b: any) => b.delta - a.delta);
          
          if (scoredSwaps.length > 0) {
            const best = scoredSwaps[0];
            
            const tempSecId = adminAssignment.secretaire_id;
            adminAssignment.secretaire_id = best.candidate.secretaire_id;
            best.candidate.secretaire_id = tempSecId;
            
            console.log(`      ✅ SWAP: admin → site le ${adminAssignment.date} ${adminAssignment.periode}`);
            console.log(`         ↔ ${getSecretaryName(best.candidate.secretaire_id)}`);
            console.log(`         Delta: ${best.delta >= 0 ? '+' : ''}${best.delta.toFixed(0)} points`);
            totalSwaps++;
            totalGain += best.delta;
            currentAdminCount--;
          }
        }
      }
      
      console.log(`\n   📊 Phase 5: ${totalSwaps} swap(s), gain total: ${totalGain >= 0 ? '+' : ''}${totalGain.toFixed(0)}`);
      return { swaps: totalSwaps, gain: totalGain };
    };
    
    // ========== PHASE 6: Équilibrage Port-en-Truie (>2) ==========
    
    const phase6_balancePortEnTruie = (): { swaps: number; gain: number } => {
      console.log("\n🟡 PHASE 6 : Équilibrage Port-en-Truie (>2 demi-journées)");
      
      let totalSwaps = 0;
      let totalGain = 0;
      
      const overloadedPortSecs: Array<{sec: any, count: number}> = [];
      
      for (const sec of secretaires) {
        const sitesData = secretairesSitesMap.get(sec.id) || [];
        const portPref = sitesData.find((s: any) => s.site_id === PORT_EN_TRUIE_ID);
        
        if (!portPref) continue;
        
        const prio = typeof portPref.priorite === 'string' 
          ? parseInt(portPref.priorite, 10) 
          : portPref.priorite;
        
        if (prio !== 2 && prio !== 3) continue;
        
        const secAssignments = currentAssignments.filter((a: any) => a.secretaire_id === sec.id);
        const portCount = secAssignments.filter((a: any) =>
          a.type_assignation === 'site' && a.site_id === PORT_EN_TRUIE_ID
        ).length;
        
        if (portCount > 2) {
          overloadedPortSecs.push({ sec, count: portCount });
        }
      }
      
      console.log(`   📍 ${overloadedPortSecs.length} secrétaire(s) avec >2 Port-en-Truie (prio 2/3)`);
      
      for (const {sec, count} of overloadedPortSecs) {
        let currentCount = count;
        console.log(`\n   👤 ${getSecretaryName(sec.id)}: ${currentCount} Port-en-Truie`);
        
        const portAssignments = currentAssignments.filter((a: any) =>
          a.secretaire_id === sec.id &&
          a.type_assignation === 'site' &&
          a.site_id === PORT_EN_TRUIE_ID
        );
        
        for (const portAssignment of portAssignments) {
          if (currentCount <= 2) break;
          
          if (hasHighPriorityDoctor(portAssignment)) continue;
          
          const candidates = currentAssignments.filter((candidate: any) =>
            candidate.secretaire_id !== sec.id &&
            candidate.date === portAssignment.date &&
            candidate.periode === portAssignment.periode &&
            (candidate.type_assignation === 'administratif' || 
             (candidate.type_assignation === 'site' && candidate.site_id !== PORT_EN_TRUIE_ID)) &&
            !hasHighPriorityDoctor(candidate) &&
            canGoToSite(candidate.secretaire_id, PORT_EN_TRUIE_ID)
          );
          
          const scoredSwaps = candidates.map((candidate: any) => {
            const scoreBefore = calculateTotalScore();
            
            const tempSecId1 = portAssignment.secretaire_id;
            const tempSecId2 = candidate.secretaire_id;
            
            portAssignment.secretaire_id = tempSecId2;
            candidate.secretaire_id = tempSecId1;
            
            const scoreAfter = calculateTotalScore();
            
            portAssignment.secretaire_id = tempSecId1;
            candidate.secretaire_id = tempSecId2;
            
            return { candidate, delta: scoreAfter - scoreBefore };
          }).filter((s: any) => s.delta >= 0).sort((a: any, b: any) => b.delta - a.delta);
          
          if (scoredSwaps.length > 0) {
            const best = scoredSwaps[0];
            
            const tempSecId = portAssignment.secretaire_id;
            portAssignment.secretaire_id = best.candidate.secretaire_id;
            best.candidate.secretaire_id = tempSecId;
            
            console.log(`      ✅ SWAP: Port-en-Truie → autre le ${portAssignment.date} ${portAssignment.periode}`);
            console.log(`         ↔ ${getSecretaryName(best.candidate.secretaire_id)}`);
            console.log(`         Delta: ${best.delta >= 0 ? '+' : ''}${best.delta.toFixed(0)} points`);
            totalSwaps++;
            totalGain += best.delta;
            currentCount--;
          }
        }
      }
      
      console.log(`\n   📊 Phase 6: ${totalSwaps} swap(s), gain total: ${totalGain >= 0 ? '+' : ''}${totalGain.toFixed(0)}`);
      return { swaps: totalSwaps, gain: totalGain };
    };
    
    // ========== EXÉCUTION DES PHASES ==========
    
    const phase1Result = phase1_blockedOperations();
    const phase2Result = phase2_closingConstraint();
    const phase3Result = phase3_adminForPreferred();
    const phase4Result = phase4_reduceSiteChanges();
    const phase5Result = phase5_balanceAdmin();
    const phase6Result = phase6_balancePortEnTruie();
    
    const totalSwaps = phase1Result.swaps + phase2Result.swaps + phase3Result.swaps + 
                       phase4Result.swaps + phase5Result.swaps + phase6Result.swaps;
    const totalGain = phase1Result.gain + phase2Result.gain + phase3Result.gain + 
                      phase4Result.gain + phase5Result.gain + phase6Result.gain;
    
    console.log("\n========================================");
    console.log("✅ OPTIMISATION TERMINÉE");
    console.log(`📊 Total: ${totalSwaps} swaps, gain: ${totalGain >= 0 ? '+' : ''}${totalGain.toFixed(0)} points`);
    console.log("========================================");
    
    // Insertion finale
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
        phase1: phase1Result,
        phase2: phase2Result,
        phase3: phase3Result,
        phase4: phase4Result,
        phase5: phase5Result,
        phase6: phase6Result
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
