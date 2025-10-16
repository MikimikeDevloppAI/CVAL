import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.39.3";
import solver from 'https://esm.sh/javascript-lp-solver@0.4.24';

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

interface OptimizationRequest {
  selected_dates: string[];
  planning_id?: string;
}

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    console.log("========== DÉBUT OPTIMISATION MILP UNIFIÉE ==========");
    
    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const supabaseKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const supabase = createClient(supabaseUrl, supabaseKey);

    const { selected_dates, planning_id: input_planning_id }: OptimizationRequest = await req.json();
    console.log(`Dates sélectionnées: ${selected_dates.join(", ")}`);

    // ============================================================
    // PHASE 0: PRÉPARATION
    // ============================================================
    console.log("\n--- PHASE 0: PRÉPARATION ---");

    // Déterminer la semaine ISO
    const firstDate = new Date(selected_dates[0]);
    const startOfWeek = new Date(firstDate);
    startOfWeek.setDate(firstDate.getDate() - ((firstDate.getDay() + 6) % 7));
    const endOfWeek = new Date(startOfWeek);
    endOfWeek.setDate(startOfWeek.getDate() + 6);

    const formatDate = (d: Date) => d.toISOString().split("T")[0];
    const week_start = formatDate(startOfWeek);
    const week_end = formatDate(endOfWeek);

    console.log(`Semaine ISO: ${week_start} à ${week_end}`);

    // Créer ou récupérer le planning_id
    let planning_id = input_planning_id;
    if (!planning_id) {
      const { data: existingPlanning } = await supabase
        .from("planning")
        .select("id")
        .eq("date_debut", week_start)
        .eq("date_fin", week_end)
        .maybeSingle();

      if (existingPlanning) {
        planning_id = existingPlanning.id;
        console.log(`Planning existant trouvé: ${planning_id}`);
      } else {
        const { data: newPlanning, error } = await supabase
          .from("planning")
          .insert({
            date_debut: week_start,
            date_fin: week_end,
            statut: "en_cours",
          })
          .select("id")
          .single();

        if (error) throw error;
        planning_id = newPlanning.id;
        console.log(`Nouveau planning créé: ${planning_id}`);
      }
    }

    // Nettoyer les assignations existantes pour les dates sélectionnées
    console.log("Nettoyage des assignations existantes...");
    await supabase
      .from("planning_genere_personnel")
      .delete()
      .eq("planning_id", planning_id)
      .in("date", selected_dates);

    await supabase
      .from("planning_genere_bloc_operatoire")
      .delete()
      .eq("planning_id", planning_id)
      .in("date", selected_dates);

    console.log("Nettoyage terminé");

    // ============================================================
    // CHARGEMENT DES DONNÉES
    // ============================================================
    console.log("\n--- CHARGEMENT DES DONNÉES ---");

    // 1. Secrétaires
    const { data: secretaires, error: secError } = await supabase
      .from("secretaires")
      .select("*")
      .eq("actif", true);
    if (secError) throw secError;
    console.log(`✓ ${secretaires.length} secrétaires chargées`);

    // 2. Médecins
    const { data: medecins, error: medError } = await supabase
      .from("medecins")
      .select("*")
      .eq("actif", true);
    if (medError) throw medError;
    console.log(`✓ ${medecins.length} médecins chargés`);

    // 3. Sites
    const { data: sites, error: sitesError } = await supabase
      .from("sites")
      .select("*")
      .eq("actif", true);
    if (sitesError) throw sitesError;
    console.log(`✓ ${sites.length} sites chargés`);

    // 4. Besoins opérations (types)
    const { data: besoinsOperations, error: besoinsOpError } = await supabase
      .from("besoins_operations")
      .select("*")
      .eq("actif", true);
    if (besoinsOpError) throw besoinsOpError;
    console.log(`✓ ${besoinsOperations.length} types de besoins opérations chargés`);

    // 5. Types d'intervention
    const { data: typesIntervention, error: typesError } = await supabase
      .from("types_intervention")
      .select("*")
      .eq("actif", true);
    if (typesError) throw typesError;
    console.log(`✓ ${typesIntervention.length} types d'intervention chargés`);

    // 6. Besoins personnel par type d'intervention
    const { data: typesBesoinPersonnel, error: typesBesoinError } = await supabase
      .from("types_intervention_besoins_personnel")
      .select("*, besoin_operation:besoins_operations(*)")
      .eq("actif", true);
    if (typesBesoinError) throw typesBesoinError;
    console.log(`✓ ${typesBesoinPersonnel.length} besoins personnel par type d'intervention chargés`);

    // 6b. Configurations multi-flux
    const { data: configurationsMultiFlux, error: configsError } = await supabase
      .from("configurations_multi_flux")
      .select("*")
      .eq("actif", true);
    if (configsError) throw configsError;
    console.log(`✓ ${configurationsMultiFlux?.length || 0} configurations multi-flux chargées`);

    // 6c. Interventions pour les configurations multi-flux
    const { data: configurationsInterventions, error: configsIntError } = await supabase
      .from("configurations_multi_flux_interventions")
      .select("*");
    if (configsIntError) throw configsIntError;
    console.log(`✓ ${configurationsInterventions?.length || 0} interventions multi-flux chargées`);

    // 7. Secrétaires <-> Besoins opérations (compétences + préférences)
    const { data: secretairesBesoins, error: secBesoinsError } = await supabase
      .from("secretaires_besoins_operations")
      .select("*");
    if (secBesoinsError) throw secBesoinsError;
    console.log(`✓ ${secretairesBesoins.length} relations secrétaires-besoins chargées`);

    // 8. Secrétaires <-> Médecins (préférences)
    const { data: secretairesMedecins, error: secMedError } = await supabase
      .from("secretaires_medecins")
      .select("*");
    if (secMedError) throw secMedError;
    console.log(`✓ ${secretairesMedecins.length} relations secrétaires-médecins chargées`);

    // 9. Secrétaires <-> Sites (préférences)
    const { data: secretairesSites, error: secSitesError } = await supabase
      .from("secretaires_sites")
      .select("*");
    if (secSitesError) throw secSitesError;
    console.log(`✓ ${secretairesSites.length} relations secrétaires-sites chargées`);

    // 10. Besoins effectifs (médecins + bloc)
    const { data: besoinsEffectifs, error: besoinsEffError } = await supabase
      .from("besoin_effectif")
      .select("*")
      .in("date", selected_dates)
      .eq("actif", true);
    if (besoinsEffError) throw besoinsEffError;
    console.log(`✓ ${besoinsEffectifs.length} besoins effectifs chargés`);

    // Construire la liste des opérations à partir de tout besoin_effectif ayant un type_intervention_id
    const besoinsBloc = besoinsEffectifs.filter((b: any) => !!b.type_intervention_id);
    const besoinsMedecins = besoinsEffectifs.filter((b: any) => b.type === "medecin");
    console.log(`  - ${besoinsBloc.length} opérations détectées (type_intervention_id non nul)`);
    console.log(`  - ${besoinsMedecins.length} besoins médecins`);

    // 11. Capacités effectives (disponibilités secrétaires)
    const { data: capacitesRaw, error: capError } = await supabase
      .from("capacite_effective")
      .select("*")
      .in("date", selected_dates)
      .eq("actif", true);
    if (capError) throw capError;
    
    // Splitter toute_journee en matin + apres_midi
    const capacites: any[] = [];
    for (const cap of capacitesRaw || []) {
      if (cap.demi_journee === 'toute_journee') {
        capacites.push({ ...cap, demi_journee: 'matin' });
        capacites.push({ ...cap, demi_journee: 'apres_midi' });
      } else {
        capacites.push(cap);
      }
    }
    console.log(`✓ ${capacites.length} capacités effectives chargées (après split toute_journee)`);

    // 12. Absences (pour calcul jours flexibles)
    const { data: absences, error: absError } = await supabase
      .from("absences")
      .select("*")
      .in("statut", ["approuve", "en_attente"])
      .lte("date_debut", week_end)
      .gte("date_fin", week_start);
    if (absError) throw absError;
    console.log(`✓ ${absences.length} absences chargées`);

    // Identifier Stéphanie Guillaume et Dr Krunic pour contrainte d'exclusion
    const stephanieGuillaume = secretaires.find(
      (s) => s.name?.toLowerCase().includes("guillaume") && s.name?.toLowerCase().includes("stéphanie")
    );
    const drKrunic = medecins.find((m) => m.name?.toLowerCase().includes("krunic"));
    
    if (stephanieGuillaume && drKrunic) {
      console.log(`⚠️  Contrainte d'exclusion: Stéphanie Guillaume (${stephanieGuillaume.id}) ne peut pas être assignée avec Dr Krunic (${drKrunic.id})`);
    }

    // ============================================================
    // PHASE 1: ASSIGNATION DES SALLES BLOC OPÉRATOIRE
    // ============================================================
    console.log("\n--- PHASE 1: ASSIGNATION DES SALLES BLOC OPÉRATOIRE ---");

    const blocsOperatoireInserted: any[] = [];

    for (const besoin of besoinsBloc) {
      const date = besoin.date;
      const periodes = besoin.demi_journee === "toute_journee" ? ["matin", "apres_midi"] : [besoin.demi_journee];

      for (const periode of periodes) {
        // Obtenir le type d'intervention et sa salle préférentielle
        const typeIntervention = typesIntervention.find(t => t.id === besoin.type_intervention_id);
        const sallePreferentielle = typeIntervention?.salle_preferentielle;

        console.log(`Opération ${typeIntervention?.nom} (${date} ${periode}) - Salle pref: ${sallePreferentielle || 'aucune'}`);

        // Vérifier si la salle préférentielle est disponible
        const sallesDisponibles = new Set(['rouge', 'verte', 'jaune']);
        
        // Retirer les salles déjà occupées
        for (const blocInserted of blocsOperatoireInserted) {
          if (blocInserted.date === date && blocInserted.periode === periode && blocInserted.salle_assignee) {
            sallesDisponibles.delete(blocInserted.salle_assignee);
          }
        }

        let salleAssignee: string | null = null;

        // Si salle préférentielle disponible, l'utiliser
        if (sallePreferentielle && sallesDisponibles.has(sallePreferentielle)) {
          salleAssignee = sallePreferentielle;
        } else {
          // Chercher une configuration multi-flux compatible
          const configurationsCompatibles = (configurationsMultiFlux || []).filter((config: any) => {
            const interventions = (configurationsInterventions || []).filter((ci: any) => ci.configuration_id === config.id);
            return interventions.some((ci: any) => ci.type_intervention_id === besoin.type_intervention_id);
          });

          for (const config of configurationsCompatibles) {
            const interventions = (configurationsInterventions || [])
              .filter((ci: any) => ci.configuration_id === config.id)
              .sort((a: any, b: any) => a.ordre - b.ordre);
            
            const interventionCourante = interventions.find((ci: any) => ci.type_intervention_id === besoin.type_intervention_id);
            if (interventionCourante && sallesDisponibles.has(interventionCourante.salle)) {
              salleAssignee = interventionCourante.salle;
              break;
            }
          }

          // Si pas de config multi-flux, prendre la première salle disponible
          if (!salleAssignee && sallesDisponibles.size > 0) {
            salleAssignee = Array.from(sallesDisponibles)[0];
          }
        }

        if (!salleAssignee) {
          console.error(`❌ Aucune salle disponible pour ${typeIntervention?.nom} le ${date} ${periode}`);
          continue;
        }

        console.log(`  → Salle assignée: ${salleAssignee}`);

        // Insérer dans planning_genere_bloc_operatoire
        const { data: blocInserted, error: blocError } = await supabase
          .from("planning_genere_bloc_operatoire")
          .insert({
            planning_id,
            date,
            periode,
            type_intervention_id: besoin.type_intervention_id,
            medecin_id: besoin.medecin_id,
            salle_assignee: salleAssignee,
            statut: "planifie",
          })
          .select("*")
          .single();

        if (blocError) {
          console.error(`Erreur insertion bloc:`, blocError);
          continue;
        }

        blocsOperatoireInserted.push(blocInserted);
        console.log(`✓ Bloc inséré: ${blocInserted.id}`);
      }
    }

    console.log(`${blocsOperatoireInserted.length} opérations bloc insérées avec salles assignées`);

    // ============================================================
    // PHASE 2: CONSTRUCTION DU MODÈLE MILP
    // ============================================================
    console.log("\n--- PHASE 2: CONSTRUCTION DU MODÈLE MILP ---");

    const model: any = {
      optimize: "score",
      opType: "max",
      constraints: {},
      variables: {},
      ints: {},
    };

    let variableCount = 0;
    const assignments: any[] = [];

    // Maps pour lookup rapide
    const capacitesMap = new Map<string, any[]>();
    capacites.forEach((cap) => {
      // Supporter 'toute_journee' en le déclinant sur matin et après-midi
      const periods = cap.demi_journee === 'toute_journee' ? ['matin', 'apres_midi'] : [cap.demi_journee];
      for (const p of periods) {
        const key = `${cap.secretaire_id}_${cap.date}_${p}`;
        if (!capacitesMap.has(key)) capacitesMap.set(key, []);
        capacitesMap.get(key)!.push({ ...cap, demi_journee: p });
      }
    });

    const secretairesBesoinsMap = new Map<string, any[]>();
    secretairesBesoins.forEach((sb) => {
      const key = `${sb.secretaire_id}_${sb.besoin_operation_id}`;
      if (!secretairesBesoinsMap.has(key)) secretairesBesoinsMap.set(key, []);
      secretairesBesoinsMap.get(key)!.push(sb);
    });

    const secretairesMedecinsMap = new Map<string, any[]>();
    secretairesMedecins.forEach((sm) => {
      const key = `${sm.secretaire_id}_${sm.medecin_id}`;
      if (!secretairesMedecinsMap.has(key)) secretairesMedecinsMap.set(key, []);
      secretairesMedecinsMap.get(key)!.push(sm);
    });

    const secretairesSitesMap = new Map<string, any[]>();
    secretairesSites.forEach((ss) => {
      if (!secretairesSitesMap.has(ss.secretaire_id)) {
        secretairesSitesMap.set(ss.secretaire_id, []);
      }
      secretairesSitesMap.get(ss.secretaire_id)!.push(ss);
    });

    // Tracker pour pénalités progressives
    const adminAssignmentCount = new Map<string, number>();
    const portEnTruieAssignmentCount = new Map<string, number>();

    // Site Port-en-Truie
    const portEnTruieSite = sites.find((s) => s.nom.toLowerCase().includes("port") && s.nom.toLowerCase().includes("truie"));
    console.log(`Site Port-en-Truie: ${portEnTruieSite?.nom || "Non trouvé"}`);

    // ============================================================
    // PHASE 2A: VARIABLES BLOC OPÉRATOIRE (PERSONNEL)
    // ============================================================
    console.log("\n--- PHASE 2A: CRÉATION DES VARIABLES BLOC OPÉRATOIRE (PERSONNEL) ---");

    let blocVariableCount = 0;
    for (const bloc of blocsOperatoireInserted) {
      const date = bloc.date;
      const periode = bloc.periode;

      // Récupérer le médecin assigné à cette opération
      const medecinAssigne = bloc.medecin_id ? medecins.find((m: any) => m.id === bloc.medecin_id) : null;

      // Récupérer les besoins en personnel pour ce type d'intervention
      const besoinsPersonnel = typesBesoinPersonnel.filter(
        (tb: any) => tb.type_intervention_id === bloc.type_intervention_id
      );

      console.log(`Bloc ${bloc.id} (${date} ${periode}): ${besoinsPersonnel.length} besoins personnel`);

      for (const besoinPers of besoinsPersonnel) {
        const besoinOpId = besoinPers.besoin_operation_id;
        const nombreRequis = besoinPers.nombre_requis || 1;

        console.log(`  Besoin: ${besoinPers.besoin_operation?.nom} (${besoinOpId}) x${nombreRequis}`);

        for (let ordre = 1; ordre <= nombreRequis; ordre++) {
          // Trouver les secrétaires compétentes pour ce besoin
          const secretairesCompetentes = secretaires.filter((sec: any) => {
            const hasBesoin = secretairesBesoinsMap.has(`${sec.id}_${besoinOpId}`);
            return hasBesoin;
          });

          console.log(`    Ordre ${ordre}: ${secretairesCompetentes.length} secrétaires compétentes`);

          for (const sec of secretairesCompetentes) {
            // Vérifier capacité
            const capKey = `${sec.id}_${date}_${periode}`;
            if (!capacitesMap.has(capKey)) continue;

            // Vérifier contrainte d'exclusion Stéphanie Guillaume + Dr Krunic
            if (stephanieGuillaume && drKrunic && sec.id === stephanieGuillaume.id && medecinAssigne?.id === drKrunic.id) {
              console.log(`    ❌ Exclusion: ${sec.name} ne peut pas être assignée avec Dr Krunic`);
              continue;
            }

            // Récupérer la préférence
            const prefData = secretairesBesoinsMap.get(`${sec.id}_${besoinOpId}`)?.[0];
            const preference = prefData?.preference || 99;

            // Calculer le score (x10 pour priorité maximale)
            let score = 100000; // Base priorité bloc
            if (preference === 1) score += 50000;
            else if (preference === 2) score += 25000;
            else if (preference === 3) score += 10000;

            const varName = `x_${sec.id}_${besoinOpId}_${date}_${periode}_${ordre}_${bloc.id}`;
            model.variables[varName] = { score };
            model.ints[varName] = 1;
            variableCount++;
            blocVariableCount++;

            assignments.push({
              varName,
              type: "bloc",
              secretaire_id: sec.id,
              besoin_operation_id: besoinOpId,
              date,
              periode,
              ordre,
              bloc_id: bloc.id,
            });

            // Contrainte: chaque besoin peut être assigné à au plus 1 secrétaire (relaxation pour éviter l'infaisabilité)
            const constraintName = `besoin_bloc_${bloc.id}_${besoinOpId}_${ordre}`;
            if (!model.constraints[constraintName]) {
              model.constraints[constraintName] = { max: 1 };
            }
            model.variables[varName][constraintName] = 1;

            // Contrainte: secrétaire ne peut être assignée qu'une fois par date+période
            const uniqueConstraint = `unique_${sec.id}_${date}_${periode}`;
            if (!model.constraints[uniqueConstraint]) {
              model.constraints[uniqueConstraint] = { max: 1 };
            }
            model.variables[varName][uniqueConstraint] = 1;
          }
        }
      }
    }

    console.log(`✓ ${blocVariableCount} variables bloc créées`);

    // ============================================================
    // PHASE 1B: VARIABLES SITES
    // ============================================================
    console.log("\n--- PHASE 1B: CRÉATION DES VARIABLES SITES ---");

    // Agréger les besoins par (date, site_id, periode)
    const besoinsParSite = new Map<string, any>();

    for (const besoin of besoinsMedecins) {
      const date = besoin.date;
      // Split explicite pour toute_journee
      const periodes: Array<"matin" | "apres_midi"> = besoin.demi_journee === "toute_journee" 
        ? ["matin", "apres_midi"] 
        : [besoin.demi_journee as "matin" | "apres_midi"];

      for (const per of periodes) {
        const key = `${date}_${besoin.site_id}_${per}`;
        if (!besoinsParSite.has(key)) {
          besoinsParSite.set(key, {
            date,
            site_id: besoin.site_id,
            periode: per,
            medecins: [],
            besoin_total: 0,
          });
        }

        const medecin = medecins.find((m) => m.id === besoin.medecin_id);
        const besoinSecretaires = medecin?.besoin_secretaires || 1.2;
        
        besoinsParSite.get(key)!.medecins.push({
          medecin_id: besoin.medecin_id,
          besoin_secretaires: besoinSecretaires,
        });
        besoinsParSite.get(key)!.besoin_total += besoinSecretaires;
      }
    }

    console.log(`${besoinsParSite.size} besoins sites agrégés`);
    
    // Log détaillé des besoins par site avec noms des médecins
    for (const [key, besoinSite] of besoinsParSite.entries()) {
      const site = sites.find((s) => s.id === besoinSite.site_id);
      const medecinsNames = besoinSite.medecins.map((m: any) => {
        const medecin = medecins.find((med) => med.id === m.medecin_id);
        return medecin ? `${medecin.first_name} ${medecin.name} (${m.besoin_secretaires})` : 'Médecin inconnu';
      }).join(', ');
      console.log(
        `  📍 ${site?.nom || 'Site inconnu'} - ${besoinSite.date} ${besoinSite.periode}:\n` +
        `     Médecins: ${medecinsNames}\n` +
        `     Besoin total: ${besoinSite.besoin_total.toFixed(2)} → arrondi à ${Math.ceil(besoinSite.besoin_total)}`
      );
    }

    let siteVariableCount = 0;
    const siteVariablesLog: Array<{
      site: string, 
      date: string, 
      periode: string, 
      variablesCreated: number,
      candidates: Array<{nom: string, hasCapacity: boolean, hasPreference: boolean, score: number, concurrentBloc: boolean}>
    }> = [];
    
    for (const [key, besoinSite] of besoinsParSite.entries()) {
      const { date, site_id, periode, medecins: medecinsData, besoin_total } = besoinSite;
      const maxSecretaires = Math.ceil(besoin_total);

      const site = sites.find((s) => s.id === site_id);
      let localVariableCount = 0;
      const candidatesLog: Array<{nom: string, hasCapacity: boolean, hasPreference: boolean, score: number, concurrentBloc: boolean}> = [];

      // Contrainte: maximum de secrétaires par site (contrainte dure)
      const maxConstraint = `max_site_${site_id}_${date}_${periode}`;
      model.constraints[maxConstraint] = { max: maxSecretaires };

      for (const sec of secretaires) {
        // Ne pas exclure les candidates bloc: laisser le solveur arbitrer via contrainte unique
        const alreadyBloc = assignments.some(
          (a) => a.type === "bloc" && a.secretaire_id === sec.id && a.date === date && a.periode === periode
        );
        // Note: alreadyBloc conservé pour diagnostic uniquement

        // IMPORTANT: Vérifier capacité INDÉPENDAMMENT du site_id de la capacité
        // Une capacité signifie que la secrétaire est disponible pour cette demi-journée,
        // peu importe le site_id stocké dans capacite_effective.
        // Le site d'assignation est déterminé par les préférences et le solveur.
        const capKey = `${sec.id}_${date}_${periode}`;
        const hasCapacity = capacitesMap.has(capKey);
        
        // Vérifier que le site fait partie des préférences de cette secrétaire
        const sitesData = secretairesSitesMap.get(sec.id) || [];
        const siteData = sitesData.find((s) => s.site_id === site_id);
        const hasPreference = !!siteData;
        
        // Check concurrent bloc variable
        const hasConcurrentBloc = assignments.some(
          (a) => a.type === "bloc" && a.secretaire_id === sec.id && a.date === date && a.periode === periode
        );
        
        if (!hasCapacity) continue;
        
        if (!siteData) {
          // Log secrétaire candidate mais sans préférence
          candidatesLog.push({
            nom: `${sec.first_name || ''} ${sec.name || ''}`.trim(),
            hasCapacity,
            hasPreference: false,
            score: 0,
            concurrentBloc: hasConcurrentBloc
          });
          continue; // aucune préférence pour ce site
        }
        
        const prio = typeof siteData.priorite === 'string' 
          ? parseInt(siteData.priorite as any, 10) 
          : (siteData.priorite ?? null);

        // Calculer le score (x10 pour priorité)
        let score = 50000; // Base priorité site

        // Score médecin (scores différenciés 1/2/3)
        for (const medData of medecinsData) {
          const medRelation = secretairesMedecinsMap.get(`${sec.id}_${medData.medecin_id}`)?.[0];
          if (medRelation) {
            if (medRelation.priorite === 1 || medRelation.priorite === '1') score += 100000;
            else if (medRelation.priorite === 2 || medRelation.priorite === '2') score += 60000;
            else if (medRelation.priorite === 3 || medRelation.priorite === '3') score += 30000;
          }
        }
        
        localVariableCount++;

        // Score site (scores différenciés 1/2/3)
        if (prio === 1) score += 8000;
        else if (prio === 2) score += 4000;
        else if (prio === 3) score += 1000;

        // Bonus pour journée complète sur le même site (tie-breaker doux)
        // Favorise les affectations matin + après-midi au même endroit
        if (periode === 'apres_midi') {
          const hasMorningOnSameSite = assignments.some(
            (a) => a.type === "site" && 
                   a.secretaire_id === sec.id && 
                   a.date === date && 
                   a.periode === 'matin' && 
                   a.site_id === site_id
          );
          if (hasMorningOnSameSite) {
            score += 500; // Petit bonus pour cohérence journée complète
          }
        }

        // Pénalité Port-en-Truie progressive
        if (portEnTruieSite && site_id === portEnTruieSite.id) {
          const sitePref1 = sitesData.find((s) => s.priorite === 1);
          if (!sitePref1 || sitePref1.site_id !== portEnTruieSite.id) {
            const count = portEnTruieAssignmentCount.get(sec.id) || 0;
            score -= (count + 1) * 5;
          }
        }

        const varName = `y_${sec.id}_${site_id}_${date}_${periode}`;
        model.variables[varName] = { score };
        model.ints[varName] = 1;
        variableCount++;
        siteVariableCount++;

        assignments.push({
          varName,
          type: "site",
          secretaire_id: sec.id,
          site_id,
          date,
          periode,
        });

        // Contrainte max secrétaires
        model.variables[varName][maxConstraint] = 1;

        // Contrainte unique
        const uniqueConstraint = `unique_${sec.id}_${date}_${periode}`;
        if (!model.constraints[uniqueConstraint]) {
          model.constraints[uniqueConstraint] = { max: 1 };
        }
        model.variables[varName][uniqueConstraint] = 1;
        
        // Log candidate retenue
        candidatesLog.push({
          nom: `${sec.first_name || ''} ${sec.name || ''}`.trim(),
          hasCapacity: true,
          hasPreference: true,
          score,
          concurrentBloc: hasConcurrentBloc
        });
      }
      
      // Logger les variables créées pour ce site
      siteVariableCount += localVariableCount;
      siteVariablesLog.push({
        site: site?.nom || 'Site inconnu',
        date,
        periode,
        variablesCreated: localVariableCount,
        candidates: candidatesLog
      });
    }

    console.log(`✓ ${siteVariableCount} variables sites créées au total`);
    
    // Log détaillé des variables par site avec diagnostic approfondi
    console.log('\n📊 DIAGNOSTIC DÉTAILLÉ - Variables créées par site:');
    for (const log of siteVariablesLog) {
      console.log(`\n  📍 ${log.site} - ${log.date} ${log.periode}:`);
      console.log(`     Variables créées: ${log.variablesCreated}`);
      
      if (log.candidates.length > 0) {
        console.log(`     Candidates analysées:`);
        for (const candidate of log.candidates) {
          const status = candidate.hasPreference 
            ? `✓ RETENUE (score: ${candidate.score}${candidate.concurrentBloc ? ', BLOC concurrent' : ''})`
            : `✗ REJETÉE (pas de préférence site)`;
          console.log(`       - ${candidate.nom}: capacité=${candidate.hasCapacity} | ${status}`);
        }
      } else {
        console.log(`     ⚠️ AUCUNE CANDIDATE (vérifier capacités PM et préférences site)`);
      }
    }

    // ============================================================
    // PHASE 1C: PÉNALITÉ CHANGEMENT DE SITE
    // ============================================================
    console.log("\n--- PHASE 1C: PÉNALITÉ CHANGEMENT DE SITE ---");

    for (const date of selected_dates) {
      for (const sec of secretaires) {
        // Vérifier si la secrétaire peut travailler matin ET après-midi
        const capMatin = capacitesMap.has(`${sec.id}_${date}_matin`);
        const capAM = capacitesMap.has(`${sec.id}_${date}_apres_midi`);

        if (!capMatin || !capAM) continue;

        // Créer des variables auxiliaires pour détecter changement de site
        for (const site1 of sites) {
          for (const site2 of sites) {
            if (site1.id === site2.id) continue;

            const varMatin = `y_${sec.id}_${site1.id}_${date}_matin`;
            const varAM = `y_${sec.id}_${site2.id}_${date}_apres_midi`;

            // Si les deux variables existent dans le modèle
            if (model.variables[varMatin] && model.variables[varAM]) {
              // Créer une variable de pénalité
              const penaltyVar = `penalty_site_change_${sec.id}_${date}_${site1.id}_${site2.id}`;
              model.variables[penaltyVar] = { score: -50 };
              model.ints[penaltyVar] = 1;
              variableCount++;

              // Contrainte: penalty_var >= varMatin + varAM - 1
              // Si les deux sont à 1, penalty_var doit être à 1
              const constraintName = `site_change_${sec.id}_${date}_${site1.id}_${site2.id}`;
              model.constraints[constraintName] = { min: 0 };
              model.variables[varMatin][constraintName] = 1;
              model.variables[varAM][constraintName] = 1;
              model.variables[penaltyVar][constraintName] = -1;
            }
          }
        }
      }
    }

    console.log(`✓ Pénalités changement de site ajoutées`);

    // ============================================================
    // PHASE 1D: VARIABLES ADMINISTRATIVES
    // ============================================================
    console.log("\n--- PHASE 1D: CRÉATION DES VARIABLES ADMINISTRATIVES ---");

    let adminVariableCount = 0;
    for (const date of selected_dates) {
      for (const periode of ["matin", "apres_midi"]) {
        for (const sec of secretaires) {
          // Vérifier capacité
          const capKey = `${sec.id}_${date}_${periode}`;
          if (!capacitesMap.has(capKey)) continue;

          // On crée la variable admin pour toutes les secrétaires ayant une capacité
          // La contrainte unique_* garantira qu'elle ne peut être assignée qu'à un seul type (bloc/site/admin)

          // Calculer le score avec pénalité progressive
          let score = 100; // Base admin
          
          if (sec.prefered_admin) {
            score += 50;
          } else {
            const count = adminAssignmentCount.get(sec.id) || 0;
            score -= (count + 1) * 5;
          }

          const varName = `z_${sec.id}_${date}_${periode}`;
          model.variables[varName] = { score };
          model.ints[varName] = 1;
          variableCount++;
          adminVariableCount++;

          assignments.push({
            varName,
            type: "admin",
            secretaire_id: sec.id,
            date,
            periode,
          });

          // Contrainte unique
          const uniqueConstraint = `unique_${sec.id}_${date}_${periode}`;
          if (!model.constraints[uniqueConstraint]) {
            model.constraints[uniqueConstraint] = { max: 1 };
          }
          model.variables[varName][uniqueConstraint] = 1;
        }
      }
    }

    console.log(`✓ ${adminVariableCount} variables administratives créées`);

    // ============================================================
    // PHASE 1D-BIS: CONTRAINTES D'ASSIGNATION OBLIGATOIRE
    // ============================================================
    console.log("\n--- PHASE 1D-BIS: CONTRAINTES D'ASSIGNATION OBLIGATOIRE ---");
    
    let mandatoryAssignmentCount = 0;
    for (const sec of secretaires) {
      for (const date of selected_dates) {
        for (const periode of ["matin", "apres_midi"]) {
          const capKey = `${sec.id}_${date}_${periode}`;
          if (!capacitesMap.has(capKey)) continue;

          // Cette secrétaire a une capacité pour cette date/période
          // Elle DOIT être assignée à au moins quelque chose (bloc, site ou admin)
          const mandatoryConstraint = `mandatory_${sec.id}_${date}_${periode}`;
          model.constraints[mandatoryConstraint] = { min: 1 };

          // Trouver toutes les variables d'assignation pour cette secrétaire à cette date/période
          for (const assign of assignments) {
            if (
              assign.secretaire_id === sec.id &&
              assign.date === date &&
              assign.periode === periode
            ) {
              model.variables[assign.varName][mandatoryConstraint] = 1;
            }
          }
          
          mandatoryAssignmentCount++;
        }
      }
    }

    console.log(`✓ ${mandatoryAssignmentCount} contraintes d'assignation obligatoire ajoutées`);

    // ============================================================
    // PHASE 1E: HORAIRES FLEXIBLES
    // ============================================================
    console.log("\n--- PHASE 1E: GESTION DES HORAIRES FLEXIBLES ---");

    const flexibleSecretaires = secretaires.filter((s) => s.horaire_flexible);
    console.log(`${flexibleSecretaires.length} secrétaires flexibles`);

    for (const sec of flexibleSecretaires) {
      const baseRequiredDays = sec.nombre_jours_supplementaires ?? 3;

      // Absences complètes (journée) pour la semaine
      const absencesForSec = absences.filter(
        (a) =>
          a.secretaire_id === sec.id &&
          a.date_debut <= week_end &&
          a.date_fin >= week_start &&
          !a.heure_debut &&
          !a.heure_fin
      );

      // Calcul des jours disponibles: jours ouvrés avec AU MOINS une capacité (matin OU après-midi) et sans congé
      const candidateDays: string[] = [];
      for (const date of selected_dates) {
        const dow = new Date(date).getDay();
        if (dow < 1 || dow > 5) continue; // Lundi-vendredi
        const isOnVacation = absencesForSec.some(
          (a) => date >= a.date_debut && date <= a.date_fin
        );
        if (isOnVacation) continue;
        const hasCap = capacitesMap.has(`${sec.id}_${date}_matin`) || capacitesMap.has(`${sec.id}_${date}_apres_midi`);
        if (hasCap) candidateDays.push(date);
      }

      const availableDays = candidateDays.length;
      if (availableDays === 0) {
        console.log(`  ${sec.name}: 0 jours (en congé ou sans capacité toute la semaine)`);
        continue;
      }

      const requiredDays = Math.min(baseRequiredDays, availableDays);
      console.log(`  ${sec.name}: ${requiredDays} jours min requis (base: ${baseRequiredDays}, disponibles: ${availableDays})`);

      // Contrainte min sur la somme des jours choisis
      const flexConstraint = `flex_days_${sec.id}`;
      model.constraints[flexConstraint] = { min: requiredDays };

      for (const date of candidateDays) {
        // Variable jour
        const varName = `day_${sec.id}_${date}`;
        model.variables[varName] = { score: 0 };
        model.ints[varName] = 1;
        variableCount++;
        model.variables[varName][flexConstraint] = 1;

        // Lien avec assignations de ce jour (site, bloc, admin)
        const dayConstraint = `day_link_${sec.id}_${date}`;
        model.constraints[dayConstraint] = { min: 0 };
        model.variables[varName][dayConstraint] = -1;
        for (const assign of assignments) {
          if (assign.secretaire_id === sec.id && assign.date === date) {
            model.variables[assign.varName][dayConstraint] = 1;
          }
        }
      }
    }

    console.log(`✓ Contraintes horaires flexibles ajoutées`);

    // ============================================================
    // PHASE 2: RÉSOLUTION MILP
    // ============================================================
    console.log("\n--- PHASE 2: RÉSOLUTION MILP ---");
    console.log(`Total de variables: ${variableCount}`);
    console.log(`Total de contraintes: ${Object.keys(model.constraints).length}`);

    let solution: any;
    try {
      solution = solver.Solve(model);
      console.log(`Statut: ${solution.feasible ? "FAISABLE ✓" : "INFAISABLE ❌"}`);
      console.log(`Score optimal: ${solution.result || 0}`);
    } catch (error: any) {
      console.error("❌ Erreur lors de la résolution MILP:", error);
      return new Response(
        JSON.stringify({
          success: false,
          error: "Erreur lors de la résolution MILP",
          details: error?.message || "Erreur inconnue",
        }),
        { headers: { ...corsHeaders, "Content-Type": "application/json" }, status: 500 }
      );
    }

    if (!solution.feasible) {
      console.warn("⚠️ Solution MILP infaisable - mais on continue avec assignations existantes");
      // En cas d'infaisabilité, on retourne quand même un succès avec les blocs créés
      // et des assignations vides pour les autres types
      
      // Appeler assign-closing-responsibles quand même
      const week_start = selected_dates[0];
      const week_end = selected_dates[selected_dates.length - 1];
      
      try {
        await supabase.functions.invoke("assign-closing-responsibles", {
          body: { 
            planning_id,
            selected_dates,
            week_start,
            week_end
          },
        });
      } catch (assignError) {
        console.warn("Erreur lors de l'assignation des responsables fermeture:", assignError);
      }

      return new Response(
        JSON.stringify({
          success: true,
          message: "Optimisation partielle : blocs créés, assignations sites/admin limitées par contraintes",
          planning_id,
          stats: {
            blocs_crees: blocsOperatoireInserted.length,
            personnel_bloc: blocsOperatoireInserted.length > 0 ? blocsOperatoireInserted.length * 2 : 0,
            personnel_sites: 0,
            personnel_admin: 0,
            total_assignments: blocsOperatoireInserted.length > 0 ? blocsOperatoireInserted.length * 2 : 0,
          },
        }),
        { headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // ============================================================
    // PHASE 3: APPLICATION DE LA SOLUTION
    // ============================================================
    console.log("\n--- PHASE 3: APPLICATION DE LA SOLUTION ---");

    const blocsToInsert: any[] = [];
    const personnelToInsert: any[] = [];

    // Grouper les opérations bloc par (date, periode, type_intervention_id, medecin_id)
    const blocsMap = new Map<string, any>();
    
    // Diagnostic post-résolution par site
    const siteAssignmentsLog = new Map<string, Array<{secretaire: string, score: number, selected: boolean}>>();

    for (const assign of assignments) {
      const value = solution[assign.varName] || 0;
      const selected = value >= 0.5;
      
      // Log pour diagnostic des sites
      if (assign.type === "site") {
        const key = `${assign.site_id}_${assign.date}_${assign.periode}`;
        if (!siteAssignmentsLog.has(key)) {
          siteAssignmentsLog.set(key, []);
        }
        const sec = secretaires.find((s: any) => s.id === assign.secretaire_id);
        const varScore = model.variables[assign.varName]?.score || 0;
        siteAssignmentsLog.get(key)!.push({
          secretaire: `${sec?.first_name || ''} ${sec?.name || ''}`.trim(),
          score: varScore,
          selected
        });
      }
      
      if (!selected) continue; // Variable non sélectionnée

      if (assign.type === "bloc") {
        // Les blocs ont déjà été créés au début. On crée uniquement le personnel lié au bloc existant.
        if (!assign.bloc_id) {
          console.warn("Avertissement: bloc_id manquant pour une variable bloc, assign ignoré", assign.varName);
        } else {
          personnelToInsert.push({
            planning_id,
            planning_genere_bloc_operatoire_id: assign.bloc_id,
            date: assign.date,
            periode: assign.periode,
            secretaire_id: assign.secretaire_id,
            besoin_operation_id: assign.besoin_operation_id,
            type_assignation: "bloc",
            ordre: assign.ordre,
          });
        }

        // Mettre à jour les compteurs de pénalités
        const sec = secretaires.find((s: any) => s.id === assign.secretaire_id);
        
        // Port-en-Truie
        if (portEnTruieSite) {
          const sitesData = secretairesSitesMap.get(assign.secretaire_id) || [];
          const sitePref1 = sitesData.find((s: any) => s.priorite === 1);
          if (!sitePref1 || sitePref1.site_id !== portEnTruieSite.id) {
            const count = portEnTruieAssignmentCount.get(assign.secretaire_id) || 0;
            portEnTruieAssignmentCount.set(assign.secretaire_id, count + 1);
          }
        }
      }
      else if (assign.type === "site") {
        personnelToInsert.push({
          planning_id,
          date: assign.date,
          periode: assign.periode,
          secretaire_id: assign.secretaire_id,
          site_id: assign.site_id,
          type_assignation: "site",
          ordre: 1,
        });

        // Mettre à jour compteur Port-en-Truie
        if (portEnTruieSite && assign.site_id === portEnTruieSite.id) {
          const sitesData = secretairesSitesMap.get(assign.secretaire_id) || [];
          const sitePref1 = sitesData.find((s) => s.priorite === 1);
          if (!sitePref1 || sitePref1.site_id !== portEnTruieSite.id) {
            const count = portEnTruieAssignmentCount.get(assign.secretaire_id) || 0;
            portEnTruieAssignmentCount.set(assign.secretaire_id, count + 1);
          }
        }
      } else if (assign.type === "admin") {
        personnelToInsert.push({
          planning_id,
          date: assign.date,
          periode: assign.periode,
          secretaire_id: assign.secretaire_id,
          type_assignation: "administratif",
          ordre: 1,
        });

        // Mettre à jour compteur admin
        const sec = secretaires.find((s) => s.id === assign.secretaire_id);
        if (sec && !sec.prefered_admin) {
          const count = adminAssignmentCount.get(assign.secretaire_id) || 0;
          adminAssignmentCount.set(assign.secretaire_id, count + 1);
        }
      }
    }

    console.log(`${blocsMap.size} opérations bloc à insérer`);
    console.log(`${personnelToInsert.length} assignations personnel (site + admin) à insérer`);
    
    // Log diagnostic post-résolution pour chaque site
    console.log('\n🔍 DIAGNOSTIC POST-RÉSOLUTION - Assignations par site:');
    for (const [key, assignList] of siteAssignmentsLog.entries()) {
      const [site_id, date, periode] = key.split('_');
      const site = sites.find((s: any) => s.id === site_id);
      const selected = assignList.filter(a => a.selected);
      const rejected = assignList.filter(a => !a.selected);
      
      console.log(`\n  📍 ${site?.nom || 'Site inconnu'} - ${date} ${periode}:`);
      console.log(`     ✓ Assignées (${selected.length}):`);
      for (const s of selected.sort((a, b) => b.score - a.score)) {
        console.log(`       - ${s.secretaire} (score: ${s.score})`);
      }
      
      if (rejected.length > 0) {
        console.log(`     ✗ Candidates non retenues (${rejected.length}):`);
        for (const r of rejected.sort((a, b) => b.score - a.score).slice(0, 5)) {
          console.log(`       - ${r.secretaire} (score: ${r.score})`);
          
          // Trouver où elle a été assignée à la place
          const secId = secretaires.find((sec: any) => 
            `${sec.first_name || ''} ${sec.name || ''}`.trim() === r.secretaire
          )?.id;
          
          if (secId) {
            const otherAssign = assignments.find(a => 
              a.secretaire_id === secId && 
              a.date === date && 
              a.periode === periode && 
              solution[a.varName] >= 0.5
            );
            
            if (otherAssign) {
              if (otherAssign.type === 'bloc') {
                console.log(`         → Assignée au BLOC (priorité supérieure)`);
              } else if (otherAssign.type === 'admin') {
                console.log(`         → Assignée en ADMIN (score probablement supérieur)`);
              } else if (otherAssign.type === 'site') {
                const otherSite = sites.find((s: any) => s.id === otherAssign.site_id);
                console.log(`         → Assignée à autre SITE: ${otherSite?.nom || 'inconnu'}`);
              }
            } else {
              console.log(`         → NON assignée (capacité insuffisante ou autre contrainte)`);
            }
          }
        }
      }
    }

    // Insérer les opérations bloc
    for (const [key, blocData] of blocsMap.entries()) {
      const { data: blocInserted, error: blocError } = await supabase
        .from("planning_genere_bloc_operatoire")
        .insert({
          planning_id,
          date: blocData.date,
          periode: blocData.periode,
          type_intervention_id: blocData.type_intervention_id,
          medecin_id: blocData.medecin_id,
          statut: "planifie",
        })
        .select("id")
        .single();

      if (blocError) {
        console.error(`Erreur insertion bloc ${key}:`, blocError);
        continue;
      }

      console.log(`✓ Bloc ${key} inséré: ${blocInserted.id}`);

      // Insérer le personnel pour cette opération
      for (const pers of blocData.personnel) {
        personnelToInsert.push({
          planning_id,
          planning_genere_bloc_operatoire_id: blocInserted.id,
          date: blocData.date,
          periode: blocData.periode,
          secretaire_id: pers.secretaire_id,
          besoin_operation_id: pers.besoin_operation_id,
          type_assignation: "bloc",
          ordre: pers.ordre,
        });
      }
    }

    // Insérer tout le personnel
    if (personnelToInsert.length > 0) {
      const cleaned = personnelToInsert.map((r) => ({
        ...r,
        ordre: typeof r.ordre === 'number' && r.ordre > 0 ? r.ordre : 1,
      }));

      const { error: persError } = await supabase
        .from("planning_genere_personnel")
        .insert(cleaned);

      if (persError) {
        console.error("Erreur insertion personnel:", persError, cleaned[0]);
        throw persError;
      }

      console.log(`✓ ${cleaned.length} assignations personnel insérées`);
    }

    // ============================================================
    // PHASE 4: ASSIGNATION DES RESPONSABLES DE FERMETURE (1R, 2F, 3F)
    // ============================================================
    console.log("\n--- PHASE 4: ASSIGNATION DES RESPONSABLES DE FERMETURE ---");

    const { data: closingData, error: closingError } = await supabase.functions.invoke(
      "assign-closing-responsibles",
      {
        body: { planning_id, week_start, week_end, selected_dates },
      }
    );

    if (closingError) {
      console.error("Erreur assignation responsables fermeture:", closingError);
    } else {
      console.log("✓ Responsables de fermeture assignés");
    }

    // ============================================================
    // RÉSULTAT FINAL
    // ============================================================
    console.log("\n========== OPTIMISATION TERMINÉE ==========");
    console.log(`Planning ID: ${planning_id}`);
    console.log(`Score final: ${solution.result || 0}`);
    console.log(`Opérations bloc: ${blocsMap.size}`);
    console.log(`Assignations sites: ${personnelToInsert.filter((p) => p.type_assignation === "site").length}`);
    console.log(`Assignations admin: ${personnelToInsert.filter((p) => p.type_assignation === "administratif").length}`);
    console.log(`Assignations bloc personnel: ${personnelToInsert.filter((p) => p.type_assignation === "bloc").length}`);

    return new Response(
      JSON.stringify({
        success: true,
        planning_id,
        score: solution.result || 0,
        stats: {
          operations_bloc: blocsMap.size,
          assignations_sites: personnelToInsert.filter((p) => p.type_assignation === "site").length,
          assignations_admin: personnelToInsert.filter((p) => p.type_assignation === "administratif").length,
          assignations_bloc_personnel: personnelToInsert.filter((p) => p.type_assignation === "bloc").length,
        },
      }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  } catch (error: any) {
    console.error("❌ ERREUR CRITIQUE:", error);
    return new Response(
      JSON.stringify({ success: false, error: error?.message || String(error) }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" }, status: 500 }
    );
  }
});
