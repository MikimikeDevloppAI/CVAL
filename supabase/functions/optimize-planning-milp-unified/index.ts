import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.39.3";
import solver from 'https://esm.sh/javascript-lp-solver@0.4.24';

// Utilitaires pour semaine ISO (lundi-dimanche)
function getISOWeek(date: Date): number {
  const d = new Date(date);
  d.setHours(0, 0, 0, 0);
  d.setDate(d.getDate() + 3 - (d.getDay() + 6) % 7);
  const week1 = new Date(d.getFullYear(), 0, 4);
  return 1 + Math.round(((d.getTime() - week1.getTime()) / 86400000 - 3 + (week1.getDay() + 6) % 7) / 7);
}

function getISOWeekYear(date: Date): number {
  const d = new Date(date);
  d.setDate(d.getDate() + 3 - (d.getDay() + 6) % 7);
  return d.getFullYear();
}

function getDateFromISOWeek(year: number, week: number, dayOfWeek: number): string {
  const jan4 = new Date(year, 0, 4);
  const mondayOfWeek1 = new Date(jan4);
  mondayOfWeek1.setDate(jan4.getDate() - (jan4.getDay() + 6) % 7);
  const targetDate = new Date(mondayOfWeek1);
  targetDate.setDate(mondayOfWeek1.getDate() + (week - 1) * 7 + (dayOfWeek - 1));
  return targetDate.toISOString().split('T')[0];
}

function isWeekday(dateStr: string): boolean {
  const dow = new Date(dateStr).getDay();
  return dow >= 1 && dow <= 5; // Lundi=1 à Vendredi=5
}

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

    // Helper: tracker des salles occupées par date/période
    interface RoomSchedule {
      [room: string]: {
        [date: string]: {
          [periode: string]: boolean; // true = occupée
        };
      };
    }

    const roomSchedules: RoomSchedule = {
      rouge: {},
      verte: {},
      jaune: {},
    };

    // Initialize room schedules
    for (const room of ['rouge', 'verte', 'jaune']) {
      roomSchedules[room] = {};
    }

    const isRoomAvailable = (room: string, date: string, periode: string): boolean => {
      if (!roomSchedules[room][date]) {
        roomSchedules[room][date] = {};
      }
      return !roomSchedules[room][date][periode];
    };

    const markRoomOccupied = (room: string, date: string, periode: string) => {
      if (!roomSchedules[room][date]) {
        roomSchedules[room][date] = {};
      }
      roomSchedules[room][date][periode] = true;
    };

    // PHASE 1A: Grouper les besoins par date + période + type_intervention_id
    interface GroupedOperation {
      besoin: any;
      date: string;
      periode: string;
    }

    const groupedOps = new Map<string, GroupedOperation[]>();

    for (const besoin of besoinsBloc) {
      const date = besoin.date;
      const periodes = besoin.demi_journee === "toute_journee" ? ["matin", "apres_midi"] : [besoin.demi_journee];

      for (const periode of periodes) {
        const key = `${date}|${periode}|${besoin.type_intervention_id}`;
        if (!groupedOps.has(key)) {
          groupedOps.set(key, []);
        }
        groupedOps.get(key)!.push({ besoin, date, periode });
      }
    }

    console.log(`📦 Grouped into ${groupedOps.size} groups for multi-flux detection`);

    // PHASE 1B: Traiter chaque groupe et détecter les configs multi-flux
    const processedOps = new Set<string>(); // Set de "besoin.id|periode"

    for (const [groupKey, groupOps] of groupedOps.entries()) {
      const [date, periode, type_intervention_id] = groupKey.split('|');
      const count = groupOps.length;

      console.log(`\n📦 Group ${groupKey}: ${count} operation(s)`);

      if (count >= 2) {
        // Chercher une configuration multi-flux
        const targetType = count === 2 ? 'double_flux' : count === 3 ? 'triple_flux' : null;

        if (targetType) {
          const config = configurationsMultiFlux.find(c =>
            c.type_flux === targetType &&
            configurationsInterventions.some((ci: any) =>
              ci.configuration_id === c.id && ci.type_intervention_id === type_intervention_id
            )
          );

          if (config) {
            console.log(`  ✓ Found ${targetType} config: ${config.nom}`);

            // Récupérer les interventions avec leurs salles triées par ordre
            const interventions = configurationsInterventions
              .filter((ci: any) => ci.configuration_id === config.id && ci.type_intervention_id === type_intervention_id)
              .sort((a: any, b: any) => a.ordre - b.ordre);

            if (interventions.length === count) {
              // Vérifier que toutes les salles sont disponibles
              let allRoomsAvailable = true;
              const roomsToAssign: string[] = [];

              for (const intervention of interventions) {
                const room = intervention.salle;
                if (!isRoomAvailable(room, date, periode)) {
                  allRoomsAvailable = false;
                  console.warn(`  ⚠️ Room ${room} not available for ${config.nom}`);
                  break;
                }
                roomsToAssign.push(room);
              }

              if (allRoomsAvailable) {
                // Assigner les opérations aux salles selon l'ordre de la config
                console.log(`  → Assigning using config order: ${roomsToAssign.join(', ')}`);

                for (let i = 0; i < groupOps.length; i++) {
                  const { besoin } = groupOps[i];
                  const assignedRoom = roomsToAssign[i];

                  // Insérer dans planning_genere_bloc_operatoire
                  const { data: blocInserted, error: blocError } = await supabase
                    .from("planning_genere_bloc_operatoire")
                    .insert({
                      planning_id,
                      date,
                      periode,
                      type_intervention_id: besoin.type_intervention_id,
                      medecin_id: besoin.medecin_id,
                      salle_assignee: assignedRoom,
                      statut: "planifie",
                    })
                    .select("*")
                    .single();

                  if (blocError) {
                    console.error(`  ❌ Error inserting bloc:`, blocError);
                    continue;
                  }

                  blocsOperatoireInserted.push(blocInserted);
                  markRoomOccupied(assignedRoom, date, periode);
                  processedOps.add(`${besoin.id}|${periode}`);
                  console.log(`  ✓ Assigned to ${assignedRoom}: ${blocInserted.id}`);
                }

                continue; // Ce groupe est complètement traité
              }
            }
          }
        }
      }

      // PHASE 1C: Fallback pour opérations non traitées (pas de config multi-flux ou non applicable)
      const remainingOps = groupOps.filter(({ besoin }) => !processedOps.has(`${besoin.id}|${periode}`));

      if (remainingOps.length > 0) {
        console.log(`  ℹ️ ${remainingOps.length} operation(s) without multi-flux config, using fallback`);

        // Grouper par salle préférentielle
        const byPreference = new Map<string, GroupedOperation[]>();
        const noPreference: GroupedOperation[] = [];

        for (const op of remainingOps) {
          const typeIntervention = typesIntervention.find(t => t.id === op.besoin.type_intervention_id);
          const pref = typeIntervention?.salle_preferentielle;

          if (pref) {
            if (!byPreference.has(pref)) byPreference.set(pref, []);
            byPreference.get(pref)!.push(op);
          } else {
            noPreference.push(op);
          }
        }

        // Traiter les opérations avec préférence
        for (const [preferredRoom, ops] of byPreference.entries()) {
          if (isRoomAvailable(preferredRoom, date, periode) && ops.length === 1) {
            // Une seule opération veut cette salle et elle est disponible
            const { besoin } = ops[0];

            const { data: blocInserted, error: blocError } = await supabase
              .from("planning_genere_bloc_operatoire")
              .insert({
                planning_id,
                date,
                periode,
                type_intervention_id: besoin.type_intervention_id,
                medecin_id: besoin.medecin_id,
                salle_assignee: preferredRoom,
                statut: "planifie",
              })
              .select("*")
              .single();

            if (blocError) {
              console.error(`  ❌ Error inserting bloc:`, blocError);
              continue;
            }

            blocsOperatoireInserted.push(blocInserted);
            markRoomOccupied(preferredRoom, date, periode);
            processedOps.add(`${besoin.id}|${periode}`);
            console.log(`  ✓ Assigned to preferred ${preferredRoom}: ${blocInserted.id}`);
          } else {
            // Plusieurs ops veulent la même salle OU salle non disponible: distribuer aléatoirement
            const shuffled = [...ops].sort(() => Math.random() - 0.5);

            for (const { besoin } of shuffled) {
              const opKey = `${besoin.id}|${periode}`;
              if (processedOps.has(opKey)) continue;

              let assignedRoom: string | null = null;

              // Essayer la salle préférée d'abord
              if (isRoomAvailable(preferredRoom, date, periode)) {
                assignedRoom = preferredRoom;
              } else {
                // Fallback: première salle disponible
                for (const room of ['rouge', 'verte', 'jaune']) {
                  if (isRoomAvailable(room, date, periode)) {
                    assignedRoom = room;
                    break;
                  }
                }
              }

              if (!assignedRoom) {
                console.warn(`  ⚠️ No room available for operation ${besoin.id}`);
                continue;
              }

              const { data: blocInserted, error: blocError } = await supabase
                .from("planning_genere_bloc_operatoire")
                .insert({
                  planning_id,
                  date,
                  periode,
                  type_intervention_id: besoin.type_intervention_id,
                  medecin_id: besoin.medecin_id,
                  salle_assignee: assignedRoom,
                  statut: "planifie",
                })
                .select("*")
                .single();

              if (blocError) {
                console.error(`  ❌ Error inserting bloc:`, blocError);
                continue;
              }

              blocsOperatoireInserted.push(blocInserted);
              markRoomOccupied(assignedRoom, date, periode);
              processedOps.add(opKey);
              console.log(`  ✓ Assigned to ${assignedRoom}: ${blocInserted.id}`);
            }
          }
        }

        // Traiter les opérations sans préférence
        for (const { besoin } of noPreference) {
          const opKey = `${besoin.id}|${periode}`;
          if (processedOps.has(opKey)) continue;

          let assignedRoom: string | null = null;

          // Première salle disponible
          for (const room of ['rouge', 'verte', 'jaune']) {
            if (isRoomAvailable(room, date, periode)) {
              assignedRoom = room;
              break;
            }
          }

          if (!assignedRoom) {
            console.warn(`  ⚠️ No room available for operation ${besoin.id}`);
            continue;
          }

          const { data: blocInserted, error: blocError } = await supabase
            .from("planning_genere_bloc_operatoire")
            .insert({
              planning_id,
              date,
              periode,
              type_intervention_id: besoin.type_intervention_id,
              medecin_id: besoin.medecin_id,
              salle_assignee: assignedRoom,
              statut: "planifie",
            })
            .select("*")
            .single();

          if (blocError) {
            console.error(`  ❌ Error inserting bloc:`, blocError);
            continue;
          }

          blocsOperatoireInserted.push(blocInserted);
          markRoomOccupied(assignedRoom, date, periode);
          processedOps.add(opKey);
          console.log(`  ✓ Assigned to ${assignedRoom}: ${blocInserted.id}`);
        }
      }
    }

    console.log(`\n✓ ${blocsOperatoireInserted.length} bloc operations inserted with rooms assigned`);

    // ============================================================
    // PHASE 1.5: CRÉER LES LIGNES DE PERSONNEL POUR TOUS LES BLOCS
    // ============================================================
    console.log("\n--- PHASE 1.5: CRÉATION DES LIGNES PERSONNEL POUR BLOCS ---");

    const personnelRowsCreated: any[] = [];
    for (const bloc of blocsOperatoireInserted) {
      // Récupérer les besoins en personnel pour ce type d'intervention
      const besoinsPersonnel = typesBesoinPersonnel.filter(
        (tb: any) => tb.type_intervention_id === bloc.type_intervention_id
      );

      for (const besoinPers of besoinsPersonnel) {
        const besoinOpId = besoinPers.besoin_operation_id;
        const nombreRequis = besoinPers.nombre_requis || 1;

        for (let ordre = 1; ordre <= nombreRequis; ordre++) {
          // Créer la ligne avec secretaire_id = NULL (sera mise à jour par le MILP)
          const { data: personnelRow, error: personnelError } = await supabase
            .from("planning_genere_personnel")
            .insert({
              planning_id,
              planning_genere_bloc_operatoire_id: bloc.id,
              date: bloc.date,
              periode: bloc.periode,
              besoin_operation_id: besoinOpId,
              type_assignation: "bloc",
              ordre,
              secretaire_id: null, // Sera assigné par le MILP
            })
            .select("*")
            .single();

          if (personnelError) {
            console.error(`Erreur création ligne personnel:`, personnelError);
            continue;
          }

          personnelRowsCreated.push(personnelRow);
        }
      }
    }

    console.log(`✓ ${personnelRowsCreated.length} lignes personnel créées pour les blocs`);

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

    // ============================================================
    // GÉNÉRATION DES CAPACITÉS POUR SECRÉTAIRES FLEXIBLES
    // ============================================================
    console.log("\n--- GÉNÉRATION CAPACITÉS FLEXIBLES ---");
    
    const flexibleSecretaires = secretaires.filter((s) => s.horaire_flexible && s.actif);
    console.log(`${flexibleSecretaires.length} secrétaires flexibles trouvées`);
    
    // Déterminer la semaine ISO de la première date sélectionnée
    const firstDateFlex = new Date(selected_dates[0]);
    const isoWeek = getISOWeek(firstDateFlex);
    const isoYear = getISOWeekYear(firstDateFlex);

    // Calculer le lundi et vendredi de cette semaine ISO
    const mondayOfWeek = getDateFromISOWeek(isoYear, isoWeek, 1); // Lundi (jour 1)
    const fridayOfWeek = getDateFromISOWeek(isoYear, isoWeek, 5); // Vendredi (jour 5)

    console.log(`📅 Semaine ISO ${isoWeek}/${isoYear}: ${mondayOfWeek} → ${fridayOfWeek}`);

    // Récupérer les assignations existantes pour les flexibles dans cette semaine
    const flexibleIds = flexibleSecretaires.map(s => s.id);
    const { data: existingAssignments, error: existingError } = await supabase
      .from('planning_genere_personnel')
      .select('secretaire_id, date, periode')
      .in('secretaire_id', flexibleIds)
      .gte('date', mondayOfWeek)
      .lte('date', fridayOfWeek);

    if (existingError) {
      console.error("Erreur récupération assignations existantes:", existingError);
      throw existingError;
    }

    // Compter les jours OUVRABLES déjà travaillés par secrétaire
    const joursDejaTravailes = new Map<string, Set<string>>();
    for (const assign of existingAssignments || []) {
      // FILTRER : ne compter que les jours ouvrables (lundi-vendredi)
      if (!isWeekday(assign.date)) {
        continue; // Ignorer samedi/dimanche
      }
      
      if (!joursDejaTravailes.has(assign.secretaire_id)) {
        joursDejaTravailes.set(assign.secretaire_id, new Set());
      }
      // Un jour complet = matin + après-midi, on compte uniquement les dates uniques
      joursDejaTravailes.get(assign.secretaire_id)!.add(assign.date);
    }

    console.log("Jours ouvrables déjà travaillés cette semaine:", 
      Array.from(joursDejaTravailes.entries()).map(([id, dates]) => {
        const sec = flexibleSecretaires.find(s => s.id === id);
        return `  ${sec?.name}: ${dates.size} jours (${Array.from(dates).join(', ')})`;
      }).join('\n')
    );
    
    for (const sec of flexibleSecretaires) {
      const pourcentage = sec.pourcentage_temps ?? 60; // Default 60%
      const joursCompletsTotal = Math.round((pourcentage / 100) * 5); // Quota hebdo total
      
      // Compter les jours ouvrables déjà travaillés HORS dates sélectionnées
      const joursDejaSet = joursDejaTravailes.get(sec.id) || new Set<string>();
      const joursDejaHorsPeriode = Array.from(joursDejaSet).filter(
        d => !selected_dates.includes(d)
      ).length;
      
      const quotaRestant = Math.max(0, joursCompletsTotal - joursDejaHorsPeriode);
      
      console.log(`  ${sec.name} (${pourcentage}%):`);
      console.log(`    • Quota total: ${joursCompletsTotal} jours/semaine`);
      console.log(`    • Déjà travaillé: ${joursDejaHorsPeriode} jours cette semaine (hors période opt.)`);
      console.log(`    • Quota restant: ${quotaRestant} jours`);
      
      // Si quota déjà atteint, ne pas générer de capacités
      if (quotaRestant === 0) {
        console.log(`    ⚠️ Quota atteint, pas de nouvelles assignations possibles`);
        (sec as any).quotaJoursComplets = 0;
        continue;
      }
      
      // Générer capacités virtuelles pour les dates sélectionnées
      let capsGenerated = 0;
      for (const date of selected_dates) {
        const dow = new Date(date).getDay();
        // Lundi-vendredi uniquement
        if (dow < 1 || dow > 5) continue;
        
        // Vérifier si absence complète ce jour
        const hasFullDayAbsence = absences.some(
          (a) =>
            a.secretaire_id === sec.id &&
            date >= a.date_debut &&
            date <= a.date_fin &&
            !a.heure_debut &&
            !a.heure_fin
        );
        if (hasFullDayAbsence) continue;
        
        // Générer DEUX capacités: matin ET après-midi
        for (const periode of ['matin', 'apres_midi']) {
          const key = `${sec.id}_${date}_${periode}`;
          if (!capacitesMap.has(key)) capacitesMap.set(key, []);
          capacitesMap.get(key)!.push({
            secretaire_id: sec.id,
            date: date,
            demi_journee: periode,
            site_id: null, // Flexible: pas de site fixe
            is_flexible: true
          });
          capsGenerated++;
        }
      }
      
      console.log(`    • Capacités générées: ${capsGenerated} demi-journées (${capsGenerated/2} jours max)`);
      
      // Stocker le quota RESTANT (pas le total)
      (sec as any).quotaJoursComplets = quotaRestant;
    }
    
    console.log(`✓ Capacités flexibles générées`);

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
            if (preference === 1) score += 3000;
            else if (preference === 2) score += 2500;
            else if (preference === 3) score += 2000;

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
            if (medRelation.priorite === 1 || medRelation.priorite === '1') score += 1500;
            else if (medRelation.priorite === 2 || medRelation.priorite === '2') score += 1200;
          }
        }
        
        localVariableCount++;

        // Score site (scores différenciés 1/2/3)
        if (prio === 1) score += 1200;
        else if (prio === 2) score += 1100;
        else if (prio === 3) score += 1000;

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
    // PHASE 1B-BIS: CONTRAINTES D'EXCLUSION SITES EXTÉRIEURS POUR OPÉRATIONS
    // ============================================================
    console.log("\n--- PHASE 1B-BIS: CONTRAINTES D'EXCLUSION SITES EXTÉRIEURS ---");
    
    // Sites extérieurs exclus si opération le même jour
    const sitesExterieursExclus = sites.filter((s) => 
      s.nom.toLowerCase().includes("centre esplanade") ||
      s.nom.toLowerCase().includes("vieille ville delémont")
    );
    
    console.log(`Sites extérieurs exclus pour les journées avec opération: ${sitesExterieursExclus.map(s => s.nom).join(', ')}`);
    
    let exclusionConstraintCount = 0;
    for (const date of selected_dates) {
      for (const sec of secretaires) {
        // Trouver toutes les variables bloc pour cette secrétaire ce jour-là (matin ET après-midi)
        const varsBlocJour = assignments.filter(
          (a) => a.type === "bloc" && a.secretaire_id === sec.id && a.date === date
        );
        
        if (varsBlocJour.length === 0) continue;
        
        // Pour chaque variable bloc, ajouter une contrainte d'exclusion avec les sites extérieurs
        for (const siteExclu of sitesExterieursExclus) {
          // Exclure TOUTE la journée (matin ET après-midi) sur les sites extérieurs
          for (const periode of ["matin", "apres_midi"]) {
            const varSiteExclu = `y_${sec.id}_${siteExclu.id}_${date}_${periode}`;
            
            // Si cette variable site existe
            if (model.variables[varSiteExclu]) {
              // Pour chaque variable bloc de la journée, ajouter une contrainte
              for (const assignBloc of varsBlocJour) {
                const varBloc = assignBloc.varName;
                
                // Contrainte: var_bloc + var_site_exclu <= 1
                // Si la secrétaire a un bloc ce jour-là, elle ne peut pas être sur un site extérieur
                const constraintName = `exclusion_${varBloc}_${varSiteExclu}`;
                model.constraints[constraintName] = { max: 1 };
                model.variables[varBloc][constraintName] = 1;
                model.variables[varSiteExclu][constraintName] = 1;
                exclusionConstraintCount++;
              }
            }
          }
        }
      }
    }
    
    console.log(`✓ ${exclusionConstraintCount} contraintes d'exclusion sites extérieurs ajoutées`);

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

          // Bonus de +100 pour encourager les assignations administratives
          let score = 100;

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
    // PHASE 1E: CONTRAINTES JOURS COMPLETS POUR FLEXIBLES
    // ============================================================
    console.log("\n--- PHASE 1E: CONTRAINTES JOURS COMPLETS FLEXIBLES ---");

    const flexibleSecretairesWithCapacities = flexibleSecretaires.filter(
      sec => (sec as any).quotaJoursComplets > 0
    );
    console.log(`${flexibleSecretairesWithCapacities.length} secrétaires flexibles avec quotas`);

    for (const sec of flexibleSecretairesWithCapacities) {
      const quotaJoursComplets = (sec as any).quotaJoursComplets;
      console.log(`  ${sec.name}: quota = ${quotaJoursComplets} jours complets`);
      
      // Pour chaque date, contraindre: matin = après-midi
      for (const date of selected_dates) {
        const matinKey = `${sec.id}_${date}_matin`;
        const amKey = `${sec.id}_${date}_apres_midi`;
        
        // Vérifier si capacités existent pour ce jour
        if (!capacitesMap.has(matinKey) || !capacitesMap.has(amKey)) continue;
        
        // Trouver toutes les variables d'assignation pour ce jour
        const varsMatin: string[] = [];
        const varsAM: string[] = [];
        
        for (const assign of assignments) {
          if (assign.secretaire_id === sec.id && assign.date === date) {
            if (assign.periode === 'matin') varsMatin.push(assign.varName);
            if (assign.periode === 'apres_midi') varsAM.push(assign.varName);
          }
        }
        
        // Créer contrainte: sum(matin) - sum(après-midi) = 0
        if (varsMatin.length > 0 || varsAM.length > 0) {
          const fullDayConstraint = `full_day_${sec.id}_${date}`;
          model.constraints[fullDayConstraint] = { equal: 0 };
          
          for (const varMatin of varsMatin) {
            model.variables[varMatin][fullDayConstraint] = 1;
          }
          for (const varAM of varsAM) {
            model.variables[varAM][fullDayConstraint] = -1;
          }
        }
      }
      
      // Contrainte de quota total: nombre max de JOURS (pas demi-journées)
      // On compte les matins uniquement (puisque matin = après-midi)
      const quotaConstraint = `max_days_${sec.id}`;
      model.constraints[quotaConstraint] = { max: quotaJoursComplets };
      
      for (const assign of assignments) {
        if (assign.secretaire_id === sec.id && assign.periode === 'matin') {
          // Ne compter que les jours ouvrables (lundi-vendredi) dans le quota
          if (isWeekday(assign.date)) {
            model.variables[assign.varName][quotaConstraint] = 1;
          }
        }
      }
      
      console.log(`    → ${Object.keys(model.constraints).filter(k => k.startsWith(`full_day_${sec.id}`)).length} contraintes jour complet`);
    }

    console.log(`✓ Contraintes jours complets flexibles ajoutées`);

    // ============================================================
    // PHASE 2: RÉSOLUTION MILP
    // ============================================================
    console.log("\n========== AVANT RÉSOLUTION MILP ==========");
    console.log(`Variables: ${variableCount}, Contraintes: ${Object.keys(model.constraints).length}`);

    let solution: any;
    try {
      solution = solver.Solve(model);
      console.log("\n========== APRÈS RÉSOLUTION MILP ==========");
      console.log(`Statut: ${solution.feasible ? "FAISABLE ✓" : "INFAISABLE ❌"}`);
      console.log(`Score optimal: ${solution.result || 0}`);
    } catch (error: any) {
      console.error("❌ Erreur lors de la résolution MILP:", error);
      // Ne pas retourner, continuer avec solution infaisable
      solution = { feasible: false, result: 0 };
      console.log("⚠️ Continuation avec solution vide pour tester Phase 2 séquentielle");
    }

    if (!solution.feasible) {
      console.warn("⚠️ Solution MILP infaisable - on continue quand même pour tester la Phase 2");
      // Ne PAS retourner ici, on va continuer jusqu'à la Phase 2 séquentielle
    }

    // ============================================================
    // PHASE 3: APPLICATION DE LA SOLUTION
    // ============================================================
    console.log("\n========== DÉBUT PHASE 3: APPLICATION SOLUTION ==========");
    console.log(`Solution faisable: ${solution.feasible}`);
    console.log("\n--- PHASE 3: APPLICATION DE LA SOLUTION ---");

    const blocsToInsert: any[] = [];
    const personnelToInsert: any[] = [];
    const personnelBlocToUpdate: Array<{row_id: string, secretaire_id: string}> = [];

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
        // Les lignes personnel ont déjà été créées en Phase 1.5 avec secretaire_id = NULL
        // On trouve la ligne correspondante et on la met à jour
        if (!assign.bloc_id) {
          console.warn("Avertissement: bloc_id manquant pour une variable bloc, assign ignoré", assign.varName);
        } else {
          const existingRow = personnelRowsCreated.find(
            (row: any) =>
              row.planning_genere_bloc_operatoire_id === assign.bloc_id &&
              row.besoin_operation_id === assign.besoin_operation_id &&
              row.ordre === assign.ordre
          );

          if (existingRow) {
            personnelBlocToUpdate.push({
              row_id: existingRow.id,
              secretaire_id: assign.secretaire_id,
            });
          } else {
            console.warn(`⚠️ Ligne personnel non trouvée pour bloc ${assign.bloc_id}, besoin ${assign.besoin_operation_id}, ordre ${assign.ordre}`);
          }
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
    console.log(`${personnelBlocToUpdate.length} assignations bloc à mettre à jour`);
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

    // Mettre à jour les assignations bloc (lignes déjà créées en Phase 1.5)
    if (personnelBlocToUpdate.length > 0) {
      console.log(`\n🔄 Mise à jour de ${personnelBlocToUpdate.length} assignations bloc...`);
      for (const update of personnelBlocToUpdate) {
        const { error: updateError } = await supabase
          .from("planning_genere_personnel")
          .update({ secretaire_id: update.secretaire_id })
          .eq("id", update.row_id);

        if (updateError) {
          console.error(`Erreur MAJ personnel row ${update.row_id}:`, updateError);
        }
      }
      console.log(`✓ Assignations bloc mises à jour`);
    }

    // Insérer tout le personnel (sites + admin uniquement, les blocs sont déjà créés)
    console.log(`\n========== AVANT INSERTION PERSONNEL ==========`);
    console.log(`personnelToInsert.length: ${personnelToInsert.length}`);
    
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
    } else {
      console.log("⚠️ Aucune assignation personnel à insérer (normal si MILP infaisable)");
    }

    // ============================================================
    // PHASE 2: OPTIMISATION SÉQUENTIELLE (HILL CLIMBING)
    // ============================================================
    console.log("\n========== PHASE 2 : OPTIMISATION SÉQUENTIELLE (HILL CLIMBING) ==========");
    console.log(`FORCE EXECUTION: ${selected_dates.length} dates à optimiser`);
    
    // Identifier les sites cibles (Clinique La Vallée + Centre Esplanade Ophtalmologie)
    const cliniqueValleeSite = sites.find((s) => 
      s.nom.toLowerCase().includes("clinique") && 
      s.nom.toLowerCase().includes("vallée") && 
      s.nom.toLowerCase().includes("ophtalmologie")
    );
    const esplanadeSite = sites.find((s) => 
      s.nom.toLowerCase().includes("centre esplanade") && 
      s.nom.toLowerCase().includes("ophtalmologie")
    );
    
    console.log(`Sites trouvés: Clinique=${!!cliniqueValleeSite}, Esplanade=${!!esplanadeSite}`);
    
    if (!cliniqueValleeSite || !esplanadeSite) {
      console.log("⚠️ Sites ophtalmo non trouvés, Phase 2 FORCÉE quand même pour diagnostic");
    }
    
    // TOUJOURS exécuter la Phase 2 (retirer le else)
    console.log(`Sites ciblés: ${cliniqueValleeSite?.nom || 'N/A'}, ${esplanadeSite?.nom || 'N/A'}`);
    {
      console.log(`Sites ciblés: ${cliniqueValleeSite.nom}, ${esplanadeSite.nom}`);
      
      // Filtrer les secrétaires éligibles (celles avec préférences sur ces sites)
      const eligibleSecretaires = secretaires.filter((sec) => {
        const sitesData = secretairesSitesMap.get(sec.id) || [];
        return sitesData.some((s) => 
          s.site_id === cliniqueValleeSite.id || s.site_id === esplanadeSite.id
        );
      });
      
      console.log(`${eligibleSecretaires.length} secrétaires éligibles pour optimisation`);
      
      const MAX_ITERATIONS = 30;
      let totalSwaps = 0;
      let totalGain = 0;
      
      for (let iteration = 1; iteration <= MAX_ITERATIONS; iteration++) {
        console.log(`\n[Itération ${iteration}]`);
        
        // 1. Charger l'état actuel depuis la DB
        const { data: currentAssignments, error: loadError } = await supabase
          .from("planning_genere_personnel")
          .select(`
            *,
            secretaires!secretaire_id(id, name, first_name, prefered_admin),
            sites!site_id(id, nom)
          `)
          .eq("planning_id", planning_id)
          .in("date", selected_dates);
        
        if (loadError || !currentAssignments) {
          console.error("Erreur chargement assignations:", loadError);
          break;
        }
        
        // 2. Calculer métriques par secrétaire
        const secretaryMetrics = new Map<string, {
          adminCount: number,
          siteChanges: number,
          esplanadeCount: number,
          assignments: typeof currentAssignments
        }>();
        
        for (const sec of eligibleSecretaires) {
          const secAssignments = currentAssignments.filter(a => a.secretaire_id === sec.id);
          
          // Compter admin
          const adminCount = secAssignments.filter(a => a.type_assignation === 'administratif').length;
          
          // Compter demi-journées au Centre Esplanade
          const ESPLANADE_ID = '043899a1-a232-4c4b-9d7d-0eb44dad00ad';
          const esplanadeCount = secAssignments.filter(a => 
            a.type_assignation === 'site' && 
            a.site_id === ESPLANADE_ID
          ).length;
          
          // Détecter changements de site (journée)
          const byDate = new Map<string, typeof secAssignments>();
          for (const a of secAssignments) {
            if (!byDate.has(a.date)) byDate.set(a.date, []);
            byDate.get(a.date)!.push(a);
          }
          
          let siteChanges = 0;
          for (const [date, dateAssignments] of byDate.entries()) {
            const matin = dateAssignments.find(a => a.periode === 'matin' && a.type_assignation === 'site');
            const aprem = dateAssignments.find(a => a.periode === 'apres_midi' && a.type_assignation === 'site');
            
            if (matin && aprem && matin.site_id !== aprem.site_id) {
              // Vérifier que c'est bien sur les sites ciblés
              const involvesClinique = [matin.site_id, aprem.site_id].includes(cliniqueValleeSite.id);
              const involvesEsplanade = [matin.site_id, aprem.site_id].includes(esplanadeSite.id);
              if (involvesClinique || involvesEsplanade) siteChanges++;
            }
          }
          
          secretaryMetrics.set(sec.id, { adminCount, siteChanges, esplanadeCount, assignments: secAssignments });
        }
        
        // 3. Détecter problèmes
        const problemsDetected = {
          siteChanges: Array.from(secretaryMetrics.entries()).filter(([_, m]) => m.siteChanges > 0).length,
          adminOverload: Array.from(secretaryMetrics.entries()).filter(([_, m]) => m.adminCount >= 2).length
        };
        
        console.log(`Problèmes détectés: ${problemsDetected.siteChanges} changements site, ${problemsDetected.adminOverload} surcharges admin`);
        
        // Log des secrétaires en surcharge admin
        const overloadedSecretaries = Array.from(secretaryMetrics.entries())
          .filter(([_, m]) => m.adminCount >= 2)
          .sort((a, b) => b[1].adminCount - a[1].adminCount);
        
        if (overloadedSecretaries.length > 0) {
          console.log(`\n📊 Secrétaires avec adminCount >= 2 :`);
          for (const [secId, metrics] of overloadedSecretaries) {
            const sec = secretaires.find(s => s.id === secId);
            console.log(`  - ${sec?.first_name} ${sec?.name}: ${metrics.adminCount} admin, ${metrics.siteChanges} changements site, ${metrics.esplanadeCount} demi-j. Esplanade`);
          }
        }
        
        // Log pénalités "Port-en-Truie" (Centre Esplanade P2/P3 > 1 demi-j.)
        const ESPLANADE_ID = '043899a1-a232-4c4b-9d7d-0eb44dad00ad';
        const esplanadeOverload = Array.from(secretaryMetrics.entries())
          .filter(([secId, m]) => {
            const sitesData = secretairesSitesMap.get(secId) || [];
            const esplanadePref = sitesData.find(s => s.site_id === ESPLANADE_ID);
            if (!esplanadePref) return false;
            const prio = typeof esplanadePref.priorite === 'string' ? parseInt(esplanadePref.priorite, 10) : esplanadePref.priorite;
            return (prio === 2 || prio === 3) && m.esplanadeCount > 1;
          })
          .sort((a, b) => b[1].esplanadeCount - a[1].esplanadeCount);
        
        if (esplanadeOverload.length > 0) {
          console.log(`\n⚠️ Pénalités "Port-en-Truie" (Centre Esplanade P2/P3 > 1 demi-j.) :`);
          for (const [secId, metrics] of esplanadeOverload) {
            const sec = secretaires.find(s => s.id === secId);
            const penalty = (metrics.esplanadeCount - 1) * 150;
            console.log(`  - ${sec?.first_name} ${sec?.name}: ${metrics.esplanadeCount} demi-j. → -${penalty} pts`);
          }
        }
        
        if (problemsDetected.siteChanges === 0 && problemsDetected.adminOverload === 0) {
          console.log("✓ Convergence atteinte");
          break;
        }
        
        // 4. Générer candidats d'échange
        interface SwapCandidate {
          id_1: string;
          id_2: string;
          type: 'half_day' | 'full_day';
          gain: number;
          secretaire_1: string;
          secretaire_2: string;
          date: string;
        }
        
        const highPriorityCandidates: SwapCandidate[] = [];
        const regularCandidates: SwapCandidate[] = [];
        
        // Helper: calculer pénalités progressives d'une secrétaire
        const calculatePenalties = (
          adminCount: number, 
          siteChanges: number,
          esplanadeCount: number,
          secretaireId: string
        ): number => {
          let penalty = 0;
          
          // Pénalités admin EXPONENTIELLES (plafonnées à 11+)
          if (adminCount === 2) penalty -= 50;
          else if (adminCount === 3) penalty -= 120;
          else if (adminCount === 4) penalty -= 200;
          else if (adminCount === 5) penalty -= 300;
          else if (adminCount === 6) penalty -= 420;
          else if (adminCount === 7) penalty -= 550;
          else if (adminCount === 8) penalty -= 700;
          else if (adminCount === 9) penalty -= 900;
          else if (adminCount === 10) penalty -= 1200;
          else if (adminCount >= 11) penalty -= 1500; // Plafonné
          
          // Pénalité changement de site (Site→Site uniquement)
          penalty -= siteChanges * 600;
          
          // Pénalité "Port-en-Truie" pour Centre Esplanade
          const ESPLANADE_ID = '043899a1-a232-4c4b-9d7d-0eb44dad00ad';
          const sitesData = secretairesSitesMap.get(secretaireId) || [];
          const esplanadePref = sitesData.find(s => s.site_id === ESPLANADE_ID);
          
          if (esplanadePref) {
            const prio = typeof esplanadePref.priorite === 'string' 
              ? parseInt(esplanadePref.priorite, 10) 
              : esplanadePref.priorite;
            
            // Si priorité 2 ou 3, pénaliser dès la 2e demi-journée (= 1+ journée entière)
            if ((prio === 2 || prio === 3) && esplanadeCount > 1) {
              const extraHalfDays = esplanadeCount - 1; // Au-delà de 1 demi-journée
              penalty -= extraHalfDays * 150; // Pénalité progressive -150 par demi-journée supplémentaire
            }
          }
          
          return penalty;
        };
        
        // Helper: calculer score d'une assignation
        const calculateScore = (assignment: typeof currentAssignments[0], secId: string): number => {
          let score = 0;
          
          if (assignment.type_assignation === 'administratif') {
            score += 100;
            const sec = secretaires.find(s => s.id === secId);
            if (sec?.prefered_admin) {
              const currentMetrics = secretaryMetrics.get(secId);
              if (currentMetrics && currentMetrics.adminCount === 0) {
                score += 500; // Bonus première admin
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
            
            // BONUS CONTINUITÉ: même site matin + après-midi
            const otherPeriod = assignment.periode === 'matin' ? 'apres_midi' : 'matin';
            const otherAssignment = currentAssignments.find(a =>
              a.secretaire_id === secId &&
              a.date === assignment.date &&
              a.periode === otherPeriod &&
              a.type_assignation === 'site' &&
              a.site_id === assignment.site_id
            );
            
            if (otherAssignment) {
              score += 300; // Bonus continuité
            }
            
            // Score médecins présents sur le site
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
                  if (medRelation.priorite === 1 || medRelation.priorite === '1') score += 300;
                  else if (medRelation.priorite === 2 || medRelation.priorite === '2') score += 200;
                  else if (medRelation.priorite === 3 || medRelation.priorite === '3') score += 100;
                }
              }
            }
          }
          
          return score;
        };
        
        // Helper: vérifier si échange est éligible
        const isEligible = (a1: typeof currentAssignments[0], a2: typeof currentAssignments[0]): boolean => {
          // Même date, même période
          if (a1.date !== a2.date || a1.periode !== a2.periode) return false;
          
          // Pas d'échange admin ↔ admin
          if (a1.type_assignation === 'administratif' && a2.type_assignation === 'administratif') return false;
          
          // Pas toucher au bloc
          if (a1.type_assignation === 'bloc' || a2.type_assignation === 'bloc') return false;
          
          // Vérifier compétences site
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
        
        // Évaluer échanges demi-journée
        for (let i = 0; i < currentAssignments.length; i++) {
          const a1 = currentAssignments[i];
          if (!eligibleSecretaires.some(s => s.id === a1.secretaire_id)) continue;
          
          for (let j = i + 1; j < currentAssignments.length; j++) {
            const a2 = currentAssignments[j];
            if (!eligibleSecretaires.some(s => s.id === a2.secretaire_id)) continue;
            if (a1.secretaire_id === a2.secretaire_id) continue;
            
            if (!isEligible(a1, a2)) continue;
            
            // ÉTAT AVANT l'échange
            const m1 = secretaryMetrics.get(a1.secretaire_id)!;
            const m2 = secretaryMetrics.get(a2.secretaire_id)!;
            
            const scoreBefore = 
              calculateScore(a1, a1.secretaire_id) + 
              calculateScore(a2, a2.secretaire_id) +
              calculatePenalties(m1.adminCount, m1.siteChanges, m1.esplanadeCount, a1.secretaire_id) +
              calculatePenalties(m2.adminCount, m2.siteChanges, m2.esplanadeCount, a2.secretaire_id);
            
            // SIMULER l'échange pour calculer APRÈS
            let newAdminCount1 = m1.adminCount;
            let newAdminCount2 = m2.adminCount;
            let newSiteChanges1 = m1.siteChanges;
            let newSiteChanges2 = m2.siteChanges;
            let newEsplanadeCount1 = m1.esplanadeCount;
            let newEsplanadeCount2 = m2.esplanadeCount;
            
            // Mise à jour admin count après échange
            if (a1.type_assignation === 'administratif' && a2.type_assignation !== 'administratif') {
              newAdminCount1 -= 1; // sec1 perd un admin
              newAdminCount2 += 1; // sec2 gagne un admin
            } else if (a1.type_assignation !== 'administratif' && a2.type_assignation === 'administratif') {
              newAdminCount1 += 1;
              newAdminCount2 -= 1;
            }
            
            // Recalculer changements de site après échange
            // Pour sec1 : elle prend l'assignation de sec2
            const otherPeriod = a1.periode === 'matin' ? 'apres_midi' : 'matin';
            const sec1OtherAssignment = m1.assignments.find(a => 
              a.periode === otherPeriod && a.date === a1.date
            );
            const sec2OtherAssignment = m2.assignments.find(a => 
              a.periode === otherPeriod && a.date === a2.date
            );
            
            // Sec1 aura l'assignation de a2 + son autre période existante
            if (sec1OtherAssignment) {
              const hadChange = sec1OtherAssignment.type_assignation === 'site' && 
                                a1.type_assignation === 'site' &&
                                sec1OtherAssignment.site_id !== a1.site_id;
              const willHaveChange = sec1OtherAssignment.type_assignation === 'site' && 
                                     a2.type_assignation === 'site' &&
                                     sec1OtherAssignment.site_id !== a2.site_id;
              
              if (hadChange && !willHaveChange) newSiteChanges1 -= 1;
              else if (!hadChange && willHaveChange) newSiteChanges1 += 1;
            }
            
            // Sec2 aura l'assignation de a1 + son autre période existante
            if (sec2OtherAssignment) {
              const hadChange = sec2OtherAssignment.type_assignation === 'site' && 
                                a2.type_assignation === 'site' &&
                                sec2OtherAssignment.site_id !== a2.site_id;
              const willHaveChange = sec2OtherAssignment.type_assignation === 'site' && 
                                     a1.type_assignation === 'site' &&
                                     sec2OtherAssignment.site_id !== a1.site_id;
              
              if (hadChange && !willHaveChange) newSiteChanges2 -= 1;
              else if (!hadChange && willHaveChange) newSiteChanges2 += 1;
            }
            
            // Simuler changement Centre Esplanade
            const ESPLANADE_ID = '043899a1-a232-4c4b-9d7d-0eb44dad00ad';
            if (a1.site_id === ESPLANADE_ID && a2.site_id !== ESPLANADE_ID) {
              newEsplanadeCount1--;
              newEsplanadeCount2++;
            } else if (a2.site_id === ESPLANADE_ID && a1.site_id !== ESPLANADE_ID) {
              newEsplanadeCount2--;
              newEsplanadeCount1++;
            }
            
            // ÉTAT APRÈS l'échange
            const scoreAfter = 
              calculateScore(a1, a2.secretaire_id) + 
              calculateScore(a2, a1.secretaire_id) +
              calculatePenalties(newAdminCount1, newSiteChanges1, newEsplanadeCount1, a1.secretaire_id) +
              calculatePenalties(newAdminCount2, newSiteChanges2, newEsplanadeCount2, a2.secretaire_id);
            
            const gain = scoreAfter - scoreBefore;
            
            if (gain > 0) {
              regularCandidates.push({
                id_1: a1.id,
                id_2: a2.id,
                type: 'half_day',
                gain,
                secretaire_1: a1.secretaire_id,
                secretaire_2: a2.secretaire_id,
                date: a1.date
              });
            }
          }
        }
        
        // Évaluer échanges journée complète (PRIORISER les surcharges admin >= 4)
        const overloadedSecs = eligibleSecretaires.filter(s => {
          const metrics = secretaryMetrics.get(s.id);
          return metrics && metrics.adminCount >= 4;
        });
        const normalSecs = eligibleSecretaires.filter(s => {
          const metrics = secretaryMetrics.get(s.id);
          return !metrics || metrics.adminCount < 4;
        });
        
        // Générer d'abord les échanges pour secrétaires surchargées
        for (const sec1 of overloadedSecs) {
          for (const sec2 of normalSecs) {
            if (sec1.id === sec2.id) continue;
            
            for (const date of selected_dates) {
              const s1Assignments = currentAssignments.filter(a => 
                a.secretaire_id === sec1.id && a.date === date
              );
              const s2Assignments = currentAssignments.filter(a => 
                a.secretaire_id === sec2.id && a.date === date
              );
              
              const s1Matin = s1Assignments.find(a => a.periode === 'matin');
              const s1Aprem = s1Assignments.find(a => a.periode === 'apres_midi');
              const s2Matin = s2Assignments.find(a => a.periode === 'matin');
              const s2Aprem = s2Assignments.find(a => a.periode === 'apres_midi');
              
              if (!s1Matin || !s1Aprem || !s2Matin || !s2Aprem) continue;
              
              if (!isEligible(s1Matin, s2Matin) || !isEligible(s1Aprem, s2Aprem)) continue;
              
              // ÉTAT AVANT l'échange
              const m1 = secretaryMetrics.get(sec1.id)!;
              const m2 = secretaryMetrics.get(sec2.id)!;
              
              const scoreBefore = 
                calculateScore(s1Matin, sec1.id) + calculateScore(s1Aprem, sec1.id) +
                calculateScore(s2Matin, sec2.id) + calculateScore(s2Aprem, sec2.id) +
                calculatePenalties(m1.adminCount, m1.siteChanges, m1.esplanadeCount, sec1.id) +
                calculatePenalties(m2.adminCount, m2.siteChanges, m2.esplanadeCount, sec2.id);
              
              // SIMULER échange journée complète
              let newAdminCount1 = m1.adminCount;
              let newAdminCount2 = m2.adminCount;
              let newEsplanadeCount1 = m1.esplanadeCount;
              let newEsplanadeCount2 = m2.esplanadeCount;
              
              // Changement admin matin
              if (s1Matin.type_assignation === 'administratif' && s2Matin.type_assignation !== 'administratif') {
                newAdminCount1 -= 1;
                newAdminCount2 += 1;
              } else if (s1Matin.type_assignation !== 'administratif' && s2Matin.type_assignation === 'administratif') {
                newAdminCount1 += 1;
                newAdminCount2 -= 1;
              }
              
              // Changement admin après-midi
              if (s1Aprem.type_assignation === 'administratif' && s2Aprem.type_assignation !== 'administratif') {
                newAdminCount1 -= 1;
                newAdminCount2 += 1;
              } else if (s1Aprem.type_assignation !== 'administratif' && s2Aprem.type_assignation === 'administratif') {
                newAdminCount1 += 1;
                newAdminCount2 -= 1;
              }
              
              // Recalculer changements de site pour journée complète
              let newSiteChanges1 = m1.siteChanges;
              let newSiteChanges2 = m2.siteChanges;
              
              // Sec1 avant : s1Matin + s1Aprem
              const hadChange1 = s1Matin.type_assignation === 'site' && 
                                 s1Aprem.type_assignation === 'site' &&
                                 s1Matin.site_id !== s1Aprem.site_id;
              // Sec1 après : s2Matin + s2Aprem
              const willHaveChange1 = s2Matin.type_assignation === 'site' && 
                                      s2Aprem.type_assignation === 'site' &&
                                      s2Matin.site_id !== s2Aprem.site_id;
              
              if (hadChange1 && !willHaveChange1) newSiteChanges1 -= 1;
              else if (!hadChange1 && willHaveChange1) newSiteChanges1 += 1;
              
              // Sec2 avant : s2Matin + s2Aprem
              const hadChange2 = s2Matin.type_assignation === 'site' && 
                                 s2Aprem.type_assignation === 'site' &&
                                 s2Matin.site_id !== s2Aprem.site_id;
              // Sec2 après : s1Matin + s1Aprem
              const willHaveChange2 = s1Matin.type_assignation === 'site' && 
                                      s1Aprem.type_assignation === 'site' &&
                                      s1Matin.site_id !== s1Aprem.site_id;
              
              if (hadChange2 && !willHaveChange2) newSiteChanges2 -= 1;
              else if (!hadChange2 && willHaveChange2) newSiteChanges2 += 1;
              
              // Simuler changement Centre Esplanade pour journée complète
              const ESPLANADE_ID = '043899a1-a232-4c4b-9d7d-0eb44dad00ad';
              if (s1Matin.site_id === ESPLANADE_ID) newEsplanadeCount1--;
              if (s1Aprem.site_id === ESPLANADE_ID) newEsplanadeCount1--;
              if (s2Matin.site_id === ESPLANADE_ID) newEsplanadeCount2--;
              if (s2Aprem.site_id === ESPLANADE_ID) newEsplanadeCount2--;
              
              if (s2Matin.site_id === ESPLANADE_ID) newEsplanadeCount1++;
              if (s2Aprem.site_id === ESPLANADE_ID) newEsplanadeCount1++;
              if (s1Matin.site_id === ESPLANADE_ID) newEsplanadeCount2++;
              if (s1Aprem.site_id === ESPLANADE_ID) newEsplanadeCount2++;
              
              // ÉTAT APRÈS l'échange
              const scoreAfter = 
                calculateScore(s1Matin, sec2.id) + calculateScore(s1Aprem, sec2.id) +
                calculateScore(s2Matin, sec1.id) + calculateScore(s2Aprem, sec1.id) +
                calculatePenalties(newAdminCount1, newSiteChanges1, newEsplanadeCount1, sec1.id) +
                calculatePenalties(newAdminCount2, newSiteChanges2, newEsplanadeCount2, sec2.id);
              
              const gain = scoreAfter - scoreBefore;
              
              if (gain > 0) {
                highPriorityCandidates.push({
                  id_1: s1Matin.id,
                  id_2: s2Matin.id,
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
        
        // Puis échanges journée complète pour le reste
        for (const sec1 of normalSecs) {
          for (const sec2 of normalSecs) {
            if (sec1.id === sec2.id) continue;
            
            for (const date of selected_dates) {
              const s1Assignments = currentAssignments.filter(a => 
                a.secretaire_id === sec1.id && a.date === date
              );
              const s2Assignments = currentAssignments.filter(a => 
                a.secretaire_id === sec2.id && a.date === date
              );
              
              const s1Matin = s1Assignments.find(a => a.periode === 'matin');
              const s1Aprem = s1Assignments.find(a => a.periode === 'apres_midi');
              const s2Matin = s2Assignments.find(a => a.periode === 'matin');
              const s2Aprem = s2Assignments.find(a => a.periode === 'apres_midi');
              
              if (!s1Matin || !s1Aprem || !s2Matin || !s2Aprem) continue;
              
              if (!isEligible(s1Matin, s2Matin) || !isEligible(s1Aprem, s2Aprem)) continue;
              
              // ÉTAT AVANT l'échange
              const m1 = secretaryMetrics.get(sec1.id)!;
              const m2 = secretaryMetrics.get(sec2.id)!;
              
              const scoreBefore = 
                calculateScore(s1Matin, sec1.id) + calculateScore(s1Aprem, sec1.id) +
                calculateScore(s2Matin, sec2.id) + calculateScore(s2Aprem, sec2.id) +
                calculatePenalties(m1.adminCount, m1.siteChanges, m1.esplanadeCount, sec1.id) +
                calculatePenalties(m2.adminCount, m2.siteChanges, m2.esplanadeCount, sec2.id);
              
              // SIMULER échange journée complète
              let newAdminCount1 = m1.adminCount;
              let newAdminCount2 = m2.adminCount;
              let newEsplanadeCount1 = m1.esplanadeCount;
              let newEsplanadeCount2 = m2.esplanadeCount;
              
              // Changement admin matin
              if (s1Matin.type_assignation === 'administratif' && s2Matin.type_assignation !== 'administratif') {
                newAdminCount1 -= 1;
                newAdminCount2 += 1;
              } else if (s1Matin.type_assignation !== 'administratif' && s2Matin.type_assignation === 'administratif') {
                newAdminCount1 += 1;
                newAdminCount2 -= 1;
              }
              
              // Changement admin après-midi
              if (s1Aprem.type_assignation === 'administratif' && s2Aprem.type_assignation !== 'administratif') {
                newAdminCount1 -= 1;
                newAdminCount2 += 1;
              } else if (s1Aprem.type_assignation !== 'administratif' && s2Aprem.type_assignation === 'administratif') {
                newAdminCount1 += 1;
                newAdminCount2 -= 1;
              }
              
              // Recalculer changements de site pour journée complète
              let newSiteChanges1 = m1.siteChanges;
              let newSiteChanges2 = m2.siteChanges;
              
              // Sec1 avant : s1Matin + s1Aprem
              const hadChange1 = s1Matin.type_assignation === 'site' && 
                                 s1Aprem.type_assignation === 'site' &&
                                 s1Matin.site_id !== s1Aprem.site_id;
              // Sec1 après : s2Matin + s2Aprem
              const willHaveChange1 = s2Matin.type_assignation === 'site' && 
                                      s2Aprem.type_assignation === 'site' &&
                                      s2Matin.site_id !== s2Aprem.site_id;
              
              if (hadChange1 && !willHaveChange1) newSiteChanges1 -= 1;
              else if (!hadChange1 && willHaveChange1) newSiteChanges1 += 1;
              
              // Sec2 avant : s2Matin + s2Aprem
              const hadChange2 = s2Matin.type_assignation === 'site' && 
                                 s2Aprem.type_assignation === 'site' &&
                                 s2Matin.site_id !== s2Aprem.site_id;
              // Sec2 après : s1Matin + s1Aprem
              const willHaveChange2 = s1Matin.type_assignation === 'site' && 
                                      s1Aprem.type_assignation === 'site' &&
                                      s1Matin.site_id !== s1Aprem.site_id;
              
              if (hadChange2 && !willHaveChange2) newSiteChanges2 -= 1;
              else if (!hadChange2 && willHaveChange2) newSiteChanges2 += 1;
              
              // Simuler changement Centre Esplanade pour journée complète
              const ESPLANADE_ID = '043899a1-a232-4c4b-9d7d-0eb44dad00ad';
              if (s1Matin.site_id === ESPLANADE_ID) newEsplanadeCount1--;
              if (s1Aprem.site_id === ESPLANADE_ID) newEsplanadeCount1--;
              if (s2Matin.site_id === ESPLANADE_ID) newEsplanadeCount2--;
              if (s2Aprem.site_id === ESPLANADE_ID) newEsplanadeCount2--;
              
              if (s2Matin.site_id === ESPLANADE_ID) newEsplanadeCount1++;
              if (s2Aprem.site_id === ESPLANADE_ID) newEsplanadeCount1++;
              if (s1Matin.site_id === ESPLANADE_ID) newEsplanadeCount2++;
              if (s1Aprem.site_id === ESPLANADE_ID) newEsplanadeCount2++;
              
              // ÉTAT APRÈS l'échange
              const scoreAfter = 
                calculateScore(s1Matin, sec2.id) + calculateScore(s1Aprem, sec2.id) +
                calculateScore(s2Matin, sec1.id) + calculateScore(s2Aprem, sec1.id) +
                calculatePenalties(newAdminCount1, newSiteChanges1, newEsplanadeCount1, sec1.id) +
                calculatePenalties(newAdminCount2, newSiteChanges2, newEsplanadeCount2, sec2.id);
              
              const gain = scoreAfter - scoreBefore;
              
              if (gain > 0) {
                regularCandidates.push({
                  id_1: s1Matin.id,
                  id_2: s2Matin.id,
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
        
        // Combiner : d'abord highPriority, puis regular
        const candidates = [...highPriorityCandidates, ...regularCandidates];
        
        if (candidates.length === 0) {
          console.log("✓ Aucun échange améliorant trouvé");
          break;
        }
        
        // 5. Trier et prendre le meilleur
        candidates.sort((a, b) => b.gain - a.gain);
        
        console.log(`\n${candidates.length} candidats d'échange trouvés`);
        
        // Log Top 5 des échanges
        const top5 = candidates.slice(0, 5);
        console.log(`\n📋 Top 5 échanges (avant application) :`);
        for (const c of top5) {
          const s1 = secretaires.find(s => s.id === c.secretaire_1);
          const s2 = secretaires.find(s => s.id === c.secretaire_2);
          console.log(`  - ${s1?.first_name} ${s1?.name} ↔ ${s2?.first_name} ${s2?.name} : +${c.gain.toFixed(0)} pts (${c.type}, ${c.date})`);
        }
        
        const best = candidates[0];
        console.log(`\n💡 Meilleur échange retenu (${best.type}): gain +${best.gain.toFixed(0)}`);
        
        // 6. Appliquer l'échange
        const { error: swapError } = await supabase.rpc('swap_secretaries_personnel', {
          p_assignment_id_1: best.id_1,
          p_assignment_id_2: best.id_2
        });
        
        if (swapError) {
          console.error("❌ Erreur échange:", swapError.message);
          break;
        }
        
        console.log("✓ Échange appliqué");
        totalSwaps++;
        totalGain += best.gain;
      }
      
      console.log(`\n✅ Phase 2 terminée: ${totalSwaps} échanges appliqués, gain total: +${totalGain.toFixed(0)}`);
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

    // Diagnostics de répartition admin par secrétaire
    try {
      const adminCountMap = new Map<string, number>();
      for (const p of personnelToInsert) {
        if (p.type_assignation === 'administratif' && p.secretaire_id) {
          adminCountMap.set(p.secretaire_id, (adminCountMap.get(p.secretaire_id) || 0) + 1);
        }
      }
      const secCounts = secretaires.map((s: any) => ({
        id: s.id,
        name: `${s.first_name || ''} ${s.name || ''}`.trim(),
        count: adminCountMap.get(s.id) || 0,
      }));
      const top = [...secCounts].sort((a, b) => b.count - a.count).slice(0, 5);
      console.log('Top charges admin:', top.map(t => `${t.name || t.id}: ${t.count}`).join(', '));
      const christine = secCounts.find(x => (x.name || '').toLowerCase().includes('christine') && (x.name || '').toLowerCase().includes('ribeaud'));
      if (christine) {
        console.log(`Christine Ribeaud - demi-journées admin: ${christine.count}`);
      }
    } catch (e) {
      console.log('Diagnostics admin non disponibles:', e);
    }

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
