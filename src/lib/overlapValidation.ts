import { supabase } from '@/integrations/supabase/client';

export interface OverlapResult {
  hasOverlap: boolean;
  conflictingPeriode?: 'matin' | 'apres_midi';
  conflictingDate?: string;
}

export async function checkMedecinOverlap(
  medecinId: string,
  date: string,
  periodes: ('matin' | 'apres_midi')[]
): Promise<OverlapResult> {
  const { data: existing, error } = await supabase
    .from('besoin_effectif')
    .select('demi_journee')
    .eq('medecin_id', medecinId)
    .eq('date', date);

  if (error || !existing || existing.length === 0) {
    return { hasOverlap: false };
  }

  const existingPeriodes = existing.map((e) => e.demi_journee);

  for (const periode of periodes) {
    if (existingPeriodes.includes(periode)) {
      return {
        hasOverlap: true,
        conflictingPeriode: periode,
        conflictingDate: date,
      };
    }
  }

  return { hasOverlap: false };
}

export async function checkSecretaireOverlap(
  secretaireId: string,
  date: string,
  periodes: ('matin' | 'apres_midi')[]
): Promise<OverlapResult> {
  const { data: existing, error } = await supabase
    .from('capacite_effective')
    .select('demi_journee')
    .eq('secretaire_id', secretaireId)
    .eq('date', date);

  if (error || !existing || existing.length === 0) {
    return { hasOverlap: false };
  }

  const existingPeriodes = existing.map((e) => e.demi_journee);

  for (const periode of periodes) {
    if (existingPeriodes.includes(periode)) {
      return {
        hasOverlap: true,
        conflictingPeriode: periode,
        conflictingDate: date,
      };
    }
  }

  return { hasOverlap: false };
}

export function getOverlapErrorMessage(
  result: OverlapResult,
  personType: 'medecin' | 'secretaire'
): string {
  if (!result.hasOverlap || !result.conflictingPeriode || !result.conflictingDate) {
    return '';
  }

  const personLabel = personType === 'medecin' ? 'Ce médecin' : 'Cette secrétaire';
  const periodeLabel = result.conflictingPeriode === 'matin' ? 'le matin' : "l'après-midi";

  return `${personLabel} travaille déjà ${periodeLabel} le ${new Date(result.conflictingDate).toLocaleDateString('fr-FR')}`;
}
