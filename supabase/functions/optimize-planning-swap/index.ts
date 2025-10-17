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
      
      // Pénalités admin PROGRESSIVES (dès la 1ère demi-journée)
      if (adminCount === 1) penalty -= 50;
      else if (adminCount === 2) penalty -= 110;
      else if (adminCount === 3) penalty -= 180;
      else if (adminCount === 4) penalty -= 260;
      else if (adminCount === 5) penalty -= 350;
      else if (adminCount === 6) penalty -= 450;
      else if (adminCount === 7) penalty -= 670;
      else if (adminCount === 8) penalty -= 800;
      else if (adminCount === 9) penalty -= 1000;
      else if (adminCount === 10) penalty -= 1200;
      else if (adminCount >= 11) penalty -= 1500;
      
      // Pénalité changement de site (augmentée)
      penalty -= siteChanges * 1000;
      
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
    
    // Helper: pénalité si une secrétaire a 1 demi-journée en bloc + 1 demi-journée sur site restreint
    const getSecretaryBlocRestrictedDayPenalty = (secId: string, date: string): number => {
      const dayAssignments = currentAssignments.filter((a: any) => 
        a.secretaire_id === secId && a.date === date
      );
      
      if (dayAssignments.length !== 2) return 0;
      
      const matin = dayAssignments.find((a: any) => a.periode === 'matin');
      const aprem = dayAssignments.find((a: any) => a.periode === 'apres_midi');
      
      if (!matin || !aprem) return 0;
      
      const hasBlocAndRestrictedSite = 
        (matin.type_assignation === 'bloc' && aprem.type_assignation === 'site' && 
         BLOC_RESTRICTED_SITES.includes(aprem.site_id)) ||
        (aprem.type_assignation === 'bloc' && matin.type_assignation === 'site' && 
         BLOC_RESTRICTED_SITES.includes(matin.site_id));
      
      return hasBlocAndRestrictedSite ? -5000 : 0;
    };
    
    // Helper: obtenir les assignations d'une secrétaire pour une journée
    const getDayAssignments = (secId: string, date: string): { matin?: any; aprem?: any } => {
      const dayAssignments = currentAssignments.filter((a: any) => 
        a.secretaire_id === secId && a.date === date
      );
      
      return {
        matin: dayAssignments.find((a: any) => a.periode === 'matin'),
        aprem: dayAssignments.find((a: any) => a.periode === 'apres_midi')
      };
    };
    
    // Helper: vérifier si une paire matin/aprem crée un changement de site
    const hasSiteChangeForPair = (matin?: any, aprem?: any): boolean => {
      if (!matin || !aprem) return false;
      
      // Cas 1: site → site différent
      if (matin.type_assignation === 'site' && aprem.type_assignation === 'site') {
        return matin.site_id !== aprem.site_id;
      }
      
      // Cas 2: bloc ↔ site (n'importe quel site)
      if ((matin.type_assignation === 'bloc' && aprem.type_assignation === 'site') ||
          (matin.type_assignation === 'site' && aprem.type_assignation === 'bloc')) {
        return true;
      }
      
      return false;
    };
    
    // Helper: calculer la pénalité "bloc + site restreint" pour une paire matin/aprem
    const computeDayPenaltyForPair = (matin?: any, aprem?: any): number => {
      if (!matin || !aprem) return 0;
      
      const hasBlocAndRestrictedSite = 
        (matin.type_assignation === 'bloc' && aprem.type_assignation === 'site' && 
         BLOC_RESTRICTED_SITES.includes(aprem.site_id)) ||
        (aprem.type_assignation === 'bloc' && matin.type_assignation === 'site' && 
         BLOC_RESTRICTED_SITES.includes(matin.site_id));
      
      return hasBlocAndRestrictedSite ? -5000 : 0;
    };
    
    // Helper: vérifier si échange est éligible
    const isEligible = (a1: any, a2: any): boolean => {
      if (a1.date !== a2.date || a1.periode !== a2.periode) return false;
      if (a1.type_assignation === 'administratif' && a2.type_assignation === 'administratif') return false;
      
      // Autoriser les swaps si l'une des deux assignations est admin
      // (l'admin est neutre par rapport aux médecins assignés)
      if (a1.type_assignation === 'administratif' || a2.type_assignation === 'administratif') {
        return true;
      }
      
      // NOUVEAU: Bloquer si médecin assigné (priorité 1 ou 2)
      if (a1.type_assignation === 'site' && a1.site_id) {
        const medecinsOnSite = besoinsEffectifs.filter(b =>
          b.site_id === a1.site_id &&
          b.date === a1.date &&
          b.demi_journee === a1.periode &&
          b.type === 'medecin'
        );
        
        for (const besoin of medecinsOnSite) {
          if (besoin.medecin_id) {
            const medRelation = secretairesMedecinsMap.get(`${a1.secretaire_id}_${besoin.medecin_id}`)?.[0];
            if (medRelation && (medRelation.priorite === 1 || medRelation.priorite === '1' || 
                               medRelation.priorite === 2 || medRelation.priorite === '2')) {
              console.log(`🚫 Swap bloqué: ${a1.secretaire_id} est assignée à son médecin priorité ${medRelation.priorite}`);
              return false;
            }
          }
        }
        
        // Vérifier que a2 peut aller sur le site de a1
        const sitesData = secretairesSitesMap.get(a2.secretaire_id) || [];
        if (!sitesData.some(s => s.site_id === a1.site_id)) return false;
      }
      
      if (a2.type_assignation === 'site' && a2.site_id) {
        const medecinsOnSite = besoinsEffectifs.filter(b =>
          b.site_id === a2.site_id &&
          b.date === a2.date &&
          b.demi_journee === a2.periode &&
          b.type === 'medecin'
        );
        
        for (const besoin of medecinsOnSite) {
          if (besoin.medecin_id) {
            const medRelation = secretairesMedecinsMap.get(`${a2.secretaire_id}_${besoin.medecin_id}`)?.[0];
            if (medRelation && (medRelation.priorite === 1 || medRelation.priorite === '1' || 
                               medRelation.priorite === 2 || medRelation.priorite === '2')) {
              console.log(`🚫 Swap bloqué: ${a2.secretaire_id} est assignée à son médecin priorité ${medRelation.priorite}`);
              return false;
            }
          }
        }
        
        // Vérifier que a1 peut aller sur le site de a2
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
      
      // Logs de diagnostic ciblés
      const targetDiagnostics = [
        { name: 'Aurélie Nusbaumer', date: '2025-10-13' },
        { name: 'Christine Ribeaud', date: '2025-10-17' },
        { name: 'Sarah Bortolon', date: null } // On vérifie tous ses jeudis
      ];
      
      for (const sec of eligibleSecretaires) {
        const secAssignments = currentAssignments.filter((a: any) => a.secretaire_id === sec.id);
        
        const adminCount = secAssignments.filter((a: any) => a.type_assignation === 'administratif').length;
        
        let siteChanges = 0;
        const dateGroups = new Map<string, any[]>();
        for (const a of secAssignments) {
          if (!dateGroups.has(a.date)) dateGroups.set(a.date, []);
          dateGroups.get(a.date)!.push(a);
        }
        
        for (const [date, dayAssignments] of dateGroups) {
          const matin = dayAssignments.find(a => a.periode === 'matin');
          const aprem = dayAssignments.find(a => a.periode === 'apres_midi');
          
          // Utiliser hasSiteChangeForPair pour gérer correctement bloc↔site
          if (matin && aprem && hasSiteChangeForPair(matin, aprem)) {
            siteChanges++;
          }
          
          // Diagnostic: détecter bloc + site restreint
          const penalty = computeDayPenaltyForPair(matin, aprem);
          if (penalty < 0) {
            console.log(`⚠ BLOC+SITE RESTREINT détecté: ${sec.first_name} ${sec.name} le ${date}`);
            console.log(`   Matin: ${matin?.type_assignation}, Aprem: ${aprem?.type_assignation}, Pénalité: ${penalty}`);
          }
          
          // Diagnostic ciblé pour personnes spécifiques
          const fullName = `${sec.first_name} ${sec.name}`;
          const target = targetDiagnostics.find(t => fullName.includes(t.name) || t.name.includes(fullName));
          if (target && (!target.date || target.date === date)) {
            console.log(`🔍 DIAGNOSTIC ${fullName} le ${date}:`);
            console.log(`   Matin: ${matin?.type_assignation} ${matin?.site_id || ''}`);
            console.log(`   Aprem: ${aprem?.type_assignation} ${aprem?.site_id || ''}`);
            
            // Vérifier médecins prioritaires
            if (matin?.type_assignation === 'site') {
              const medecinsOnSite = besoinsEffectifs.filter(b =>
                b.site_id === matin.site_id &&
                b.date === date &&
                b.demi_journee === 'matin' &&
                b.type === 'medecin'
              );
              const prioMeds = medecinsOnSite.filter(m => {
                const rel = secretairesMedecinsMap.get(`${sec.id}_${m.medecin_id}`)?.[0];
                return rel && (rel.priorite === 1 || rel.priorite === '1' || rel.priorite === 2 || rel.priorite === '2');
              });
              if (prioMeds.length > 0) {
                console.log(`   → Médecins prio 1/2 présents matin: ${prioMeds.length}`);
              }
            }
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
          
          // Bonus global admin pour prefered_admin=true
          let adminBonusBefore = 0;
          const sec1 = secretaires.find(s => s.id === a1.secretaire_id);
          const sec2 = secretaires.find(s => s.id === a2.secretaire_id);
          if (sec1?.prefered_admin && m1.adminCount >= 1) adminBonusBefore += 2000;
          if (sec2?.prefered_admin && m2.adminCount >= 1) adminBonusBefore += 2000;
          
          const scoreBefore = 
            calculateScore(a1, a1.secretaire_id) + 
            calculateScore(a2, a2.secretaire_id) +
            calculatePenalties(m1.adminCount, m1.siteChanges, m1.esplanadeCount, a1.secretaire_id) +
            calculatePenalties(m2.adminCount, m2.siteChanges, m2.esplanadeCount, a2.secretaire_id) +
            getSecretaryBlocRestrictedDayPenalty(a1.secretaire_id, a1.date) +
            getSecretaryBlocRestrictedDayPenalty(a2.secretaire_id, a2.date) +
            adminBonusBefore;
          
          // Simuler échange - recalculer adminCount
          let newAdminCount1 = m1.adminCount;
          let newAdminCount2 = m2.adminCount;
          
          if (a1.type_assignation === 'administratif' && a2.type_assignation !== 'administratif') {
            newAdminCount1 -= 1;
            newAdminCount2 += 1;
          } else if (a1.type_assignation !== 'administratif' && a2.type_assignation === 'administratif') {
            newAdminCount1 += 1;
            newAdminCount2 -= 1;
          }
          
          // Recalculer siteChanges pour sec1
          const day1 = getDayAssignments(a1.secretaire_id, a1.date);
          const beforeHasChange1 = hasSiteChangeForPair(day1.matin, day1.aprem);
          
          // Simuler le swap pour sec1: remplacer la période de a1 par les attributs de a2
          const simulated1 = {
            matin: a1.periode === 'matin' ? { type_assignation: a2.type_assignation, site_id: a2.site_id } : day1.matin,
            aprem: a1.periode === 'apres_midi' ? { type_assignation: a2.type_assignation, site_id: a2.site_id } : day1.aprem
          };
          const afterHasChange1 = hasSiteChangeForPair(simulated1.matin, simulated1.aprem);
          const newSiteChanges1 = m1.siteChanges - (beforeHasChange1 ? 1 : 0) + (afterHasChange1 ? 1 : 0);
          
          // Recalculer siteChanges pour sec2
          const day2 = getDayAssignments(a2.secretaire_id, a2.date);
          const beforeHasChange2 = hasSiteChangeForPair(day2.matin, day2.aprem);
          
          const simulated2 = {
            matin: a2.periode === 'matin' ? { type_assignation: a1.type_assignation, site_id: a1.site_id } : day2.matin,
            aprem: a2.periode === 'apres_midi' ? { type_assignation: a1.type_assignation, site_id: a1.site_id } : day2.aprem
          };
          const afterHasChange2 = hasSiteChangeForPair(simulated2.matin, simulated2.aprem);
          const newSiteChanges2 = m2.siteChanges - (beforeHasChange2 ? 1 : 0) + (afterHasChange2 ? 1 : 0);
          
          // Recalculer esplanadeCount
          const ESPLANADE_ID = '043899a1-a232-4c4b-9d7d-0eb44dad00ad';
          const deltaEsplanade1 = 
            (a2.type_assignation === 'site' && a2.site_id === ESPLANADE_ID ? 1 : 0) -
            (a1.type_assignation === 'site' && a1.site_id === ESPLANADE_ID ? 1 : 0);
          const newEsplanadeCount1 = m1.esplanadeCount + deltaEsplanade1;
          
          const deltaEsplanade2 = 
            (a1.type_assignation === 'site' && a1.site_id === ESPLANADE_ID ? 1 : 0) -
            (a2.type_assignation === 'site' && a2.site_id === ESPLANADE_ID ? 1 : 0);
          const newEsplanadeCount2 = m2.esplanadeCount + deltaEsplanade2;
          
          // Recalculer dayPenalty après swap
          const dayPenaltyAfter1 = computeDayPenaltyForPair(simulated1.matin, simulated1.aprem);
          const dayPenaltyAfter2 = computeDayPenaltyForPair(simulated2.matin, simulated2.aprem);
          
          // Recalculer bonus admin après swap
          let adminBonusAfter = 0;
          if (sec1?.prefered_admin && newAdminCount1 >= 1) adminBonusAfter += 2000;
          if (sec2?.prefered_admin && newAdminCount2 >= 1) adminBonusAfter += 2000;
          
          const scoreAfter = 
            calculateScore(a1, a2.secretaire_id) + 
            calculateScore(a2, a1.secretaire_id) +
            calculatePenalties(newAdminCount1, newSiteChanges1, newEsplanadeCount1, a1.secretaire_id) +
            calculatePenalties(newAdminCount2, newSiteChanges2, newEsplanadeCount2, a2.secretaire_id) +
            dayPenaltyAfter1 + dayPenaltyAfter2 +
            adminBonusAfter;
          
          let gain = scoreAfter - scoreBefore;
          
          // Appliquer pénalité bloc ↔ site restreint
          gain += getBlocSitePenalty(a1, a2);
          
          // Log spécial pour Sarah Bortolon et swaps admin
          if ((sec1?.name === 'Bortolon' || sec2?.name === 'Bortolon') && 
              (a1.type_assignation === 'administratif' || a2.type_assignation === 'administratif')) {
            console.log(`\n🔍 SWAP ADMIN SARAH:`);
            console.log(`   Sec1: ${sec1?.first_name} ${sec1?.name}, admin=${m1.adminCount}→${newAdminCount1}, prefered=${sec1?.prefered_admin}`);
            console.log(`   Sec2: ${sec2?.first_name} ${sec2?.name}, admin=${m2.adminCount}→${newAdminCount2}, prefered=${sec2?.prefered_admin}`);
            console.log(`   Type swap: ${a1.type_assignation} ↔ ${a2.type_assignation}`);
            console.log(`   Score avant: ${scoreBefore.toFixed(0)}, après: ${scoreAfter.toFixed(0)}, gain: ${gain.toFixed(0)}`);
            console.log(`   adminBonusBefore: ${adminBonusBefore}, adminBonusAfter: ${adminBonusAfter}`);
          }

          // Log spécial pour Laura Spring et Léna Jurot le 18/11
          if (a1.date === '2025-11-18' && 
              ((sec1?.name === 'Spring' && sec2?.name === 'Jurot') || 
               (sec1?.name === 'Jurot' && sec2?.name === 'Spring'))) {
            console.log(`\n🔍 SWAP LAURA/LÉNA 18/11:`);
            console.log(`   Sec1: ${sec1?.first_name} ${sec1?.name}, type=${a1.type_assignation}, siteChanges=${m1.siteChanges}→${newSiteChanges1}, admin=${m1.adminCount}→${newAdminCount1}`);
            console.log(`   Sec2: ${sec2?.first_name} ${sec2?.name}, type=${a2.type_assignation}, siteChanges=${m2.siteChanges}→${newSiteChanges2}, admin=${m2.adminCount}→${newAdminCount2}`);
            console.log(`   Gain: ${gain.toFixed(0)}, scoreBefore: ${scoreBefore.toFixed(0)}, scoreAfter: ${scoreAfter.toFixed(0)}`);
          }
          
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
            
            // Bonus global admin pour prefered_admin=true
            let adminBonusBefore = 0;
            const fullDaySec1 = secretaires.find(s => s.id === sec1.id);
            const fullDaySec2 = secretaires.find(s => s.id === sec2.id);
            if (fullDaySec1?.prefered_admin && m1.adminCount >= 1) adminBonusBefore += 2000;
            if (fullDaySec2?.prefered_admin && m2.adminCount >= 1) adminBonusBefore += 2000;
            
            const scoreBefore = 
              calculateScore(s1Matin, sec1.id) + calculateScore(s1Aprem, sec1.id) +
              calculateScore(s2Matin, sec2.id) + calculateScore(s2Aprem, sec2.id) +
              calculatePenalties(m1.adminCount, m1.siteChanges, m1.esplanadeCount, sec1.id) +
              calculatePenalties(m2.adminCount, m2.siteChanges, m2.esplanadeCount, sec2.id) +
              getSecretaryBlocRestrictedDayPenalty(sec1.id, date) +
              getSecretaryBlocRestrictedDayPenalty(sec2.id, date) +
              adminBonusBefore;
            
            // Recalculer adminCount (généralement inchangé pour journée complète site↔site)
            let newAdminCount1 = m1.adminCount;
            let newAdminCount2 = m2.adminCount;
            
            // Recalculer siteChanges après swap
            const beforeHasChange1 = hasSiteChangeForPair(s1Matin, s1Aprem);
            const afterHasChange1 = hasSiteChangeForPair(s2Matin, s2Aprem); // sec1 reçoit le pair de sec2
            const newSiteChanges1 = m1.siteChanges - (beforeHasChange1 ? 1 : 0) + (afterHasChange1 ? 1 : 0);
            
            const beforeHasChange2 = hasSiteChangeForPair(s2Matin, s2Aprem);
            const afterHasChange2 = hasSiteChangeForPair(s1Matin, s1Aprem); // sec2 reçoit le pair de sec1
            const newSiteChanges2 = m2.siteChanges - (beforeHasChange2 ? 1 : 0) + (afterHasChange2 ? 1 : 0);
            
            // Recalculer esplanadeCount
            const ESPLANADE_ID = '043899a1-a232-4c4b-9d7d-0eb44dad00ad';
            const deltaEsplanade1 = 
              (s2Matin.type_assignation === 'site' && s2Matin.site_id === ESPLANADE_ID ? 1 : 0) +
              (s2Aprem.type_assignation === 'site' && s2Aprem.site_id === ESPLANADE_ID ? 1 : 0) -
              (s1Matin.type_assignation === 'site' && s1Matin.site_id === ESPLANADE_ID ? 1 : 0) -
              (s1Aprem.type_assignation === 'site' && s1Aprem.site_id === ESPLANADE_ID ? 1 : 0);
            const newEsplanadeCount1 = m1.esplanadeCount + deltaEsplanade1;
            
            const deltaEsplanade2 = 
              (s1Matin.type_assignation === 'site' && s1Matin.site_id === ESPLANADE_ID ? 1 : 0) +
              (s1Aprem.type_assignation === 'site' && s1Aprem.site_id === ESPLANADE_ID ? 1 : 0) -
              (s2Matin.type_assignation === 'site' && s2Matin.site_id === ESPLANADE_ID ? 1 : 0) -
              (s2Aprem.type_assignation === 'site' && s2Aprem.site_id === ESPLANADE_ID ? 1 : 0);
            const newEsplanadeCount2 = m2.esplanadeCount + deltaEsplanade2;
            
            // Recalculer dayPenalty après swap
            const dayPenaltyAfter1 = computeDayPenaltyForPair(s2Matin, s2Aprem); // sec1 reçoit s2
            const dayPenaltyAfter2 = computeDayPenaltyForPair(s1Matin, s1Aprem); // sec2 reçoit s1
            
            // Calculer bonus de continuité après swap
            let afterContinuityBonus = 0;
            if (s2Matin.type_assignation === 'site' && s2Aprem.type_assignation === 'site' && 
                s2Matin.site_id === s2Aprem.site_id) {
              afterContinuityBonus += 600; // 300*2 pour sec1
            }
            if (s1Matin.type_assignation === 'site' && s1Aprem.type_assignation === 'site' && 
                s1Matin.site_id === s1Aprem.site_id) {
              afterContinuityBonus += 600; // 300*2 pour sec2
            }
            
            // Recalculer bonus admin après swap
            let adminBonusAfter = 0;
            if (fullDaySec1?.prefered_admin && newAdminCount1 >= 1) adminBonusAfter += 2000;
            if (fullDaySec2?.prefered_admin && newAdminCount2 >= 1) adminBonusAfter += 2000;
            
            const scoreAfter = 
              calculateScore(s1Matin, sec2.id) + calculateScore(s1Aprem, sec2.id) +
              calculateScore(s2Matin, sec1.id) + calculateScore(s2Aprem, sec1.id) +
              calculatePenalties(newAdminCount1, newSiteChanges1, newEsplanadeCount1, sec1.id) +
              calculatePenalties(newAdminCount2, newSiteChanges2, newEsplanadeCount2, sec2.id) +
              dayPenaltyAfter1 + dayPenaltyAfter2 + afterContinuityBonus +
              adminBonusAfter;
            
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
      
      // Log des candidats impliquant Laura Spring ou Léna Jurot le 18/11
      const lauraLenaCandidates = candidates.filter(c => {
        const s1 = secretaires.find(s => s.id === c.secretaire_1);
        const s2 = secretaires.find(s => s.id === c.secretaire_2);
        return c.date === '2025-11-18' && 
               ((s1?.name === 'Spring' && s2?.name === 'Jurot') || 
                (s1?.name === 'Jurot' && s2?.name === 'Spring'));
      });
      
      if (lauraLenaCandidates.length > 0) {
        console.log(`\n📋 ${lauraLenaCandidates.length} candidats Laura/Léna 18/11:`);
        lauraLenaCandidates.forEach((c, idx) => {
          const a1 = currentAssignments.find((a: any) => 
            a.secretaire_id === c.secretaire_1 && a.date === c.date && 
            (c.type === 'half_day' ? true : a.periode === 'matin')
          );
          const a2 = currentAssignments.find((a: any) => 
            a.secretaire_id === c.secretaire_2 && a.date === c.date && 
            (c.type === 'half_day' ? true : a.periode === 'matin')
          );
          const s1 = secretaires.find(s => s.id === c.secretaire_1);
          const s2 = secretaires.find(s => s.id === c.secretaire_2);
          console.log(`   ${idx+1}. ${s1?.first_name} ${a1?.type_assignation} ↔ ${s2?.first_name} ${a2?.type_assignation}, type=${c.type}, gain=${c.gain.toFixed(0)}`);
        });
      }
      
      
      const best = candidates[0];
      console.log(`💡 Meilleur échange retenu (${best.type}): gain +${best.gain.toFixed(0)}`);
      console.log(`   Sec1: ${best.secretaire_1}, Sec2: ${best.secretaire_2}, Date: ${best.date}`);
      
      // Afficher les métriques avant/après pour diagnostic
      const m1 = secretaryMetrics.get(best.secretaire_1)!;
      const m2 = secretaryMetrics.get(best.secretaire_2)!;
      console.log(`   Avant - Sec1: admin=${m1.adminCount}, changes=${m1.siteChanges}, espl=${m1.esplanadeCount}`);
      console.log(`   Avant - Sec2: admin=${m2.adminCount}, changes=${m2.siteChanges}, espl=${m2.esplanadeCount}`);
      
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
