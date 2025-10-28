import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";

const ESPLANADE_SITE_ID = '043899a1-a232-4c4b-9d7d-0eb44dad00ad';

interface SecretaireAssignment {
  site_nom?: string;
  medecin_nom?: string;
  besoin_operation_nom?: string;
  salle_nom?: string;
  is_1r?: boolean;
  is_2f?: boolean;
  is_3f?: boolean;
  validated?: boolean;
}

interface SecretaireDayData {
  date: string;
  matin: SecretaireAssignment[];
  apres_midi: SecretaireAssignment[];
}

interface DashboardSecretaire {
  id: string;
  nom_complet: string;
  actif: boolean;
  horaire_flexible: boolean;
  flexible_jours_supplementaires: boolean;
  nombre_jours_supplementaires?: number;
  days: SecretaireDayData[];
}

interface SecretaireWeekStatsProps {
  secretaires: DashboardSecretaire[];
}

interface SecretaireStats {
  id: string;
  nom_complet: string;
  count_1r: number;
  count_2f: number;
  count_3f: number;
  jours_esplanade: number;
}

export const SecretaireWeekStats = ({ secretaires }: SecretaireWeekStatsProps) => {
  // Calculer les statistiques pour chaque secrétaire
  const stats: SecretaireStats[] = secretaires.map(secretaire => {
    let count_1r = 0;
    let count_2f = 0;
    let count_3f = 0;
    const joursEsplanadeSet = new Set<string>();

    secretaire.days.forEach(day => {
      // Compter les 1R, 2F, 3F dans le matin et l'après-midi
      [...day.matin, ...day.apres_midi].forEach(assignment => {
        if (assignment.is_1r) count_1r++;
        if (assignment.is_2f) count_2f++;
        if (assignment.is_3f) count_3f++;

        // Vérifier si c'est au Centre Esplanade
        // On vérifie par le nom du site car on n'a pas l'ID dans les données
        if (assignment.site_nom?.toLowerCase().includes('esplanade')) {
          joursEsplanadeSet.add(day.date);
        }
      });
    });

    return {
      id: secretaire.id,
      nom_complet: secretaire.nom_complet,
      count_1r,
      count_2f,
      count_3f,
      jours_esplanade: joursEsplanadeSet.size
    };
  });

  // Trier par nom
  const sortedStats = stats.sort((a, b) => a.nom_complet.localeCompare(b.nom_complet));

  return (
    <div className="space-y-4">
      <div className="rounded-lg border border-border/50 overflow-hidden bg-card/50 backdrop-blur-sm">
        <Table>
          <TableHeader>
            <TableRow className="bg-muted/50">
              <TableHead className="font-semibold">Assistant médical</TableHead>
              <TableHead className="text-center font-semibold">
                <div className="flex items-center justify-center gap-1">
                  <Badge variant="secondary" className="bg-blue-100 text-blue-700 dark:bg-blue-900/30 dark:text-blue-300">
                    1R
                  </Badge>
                </div>
              </TableHead>
              <TableHead className="text-center font-semibold">
                <div className="flex items-center justify-center gap-1">
                  <Badge variant="secondary" className="bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-300">
                    2F
                  </Badge>
                </div>
              </TableHead>
              <TableHead className="text-center font-semibold">
                <div className="flex items-center justify-center gap-1">
                  <Badge variant="secondary" className="bg-purple-100 text-purple-700 dark:bg-purple-900/30 dark:text-purple-300">
                    3F
                  </Badge>
                </div>
              </TableHead>
              <TableHead className="text-center font-semibold">Jours Esplanade</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {sortedStats.map((stat) => (
              <TableRow key={stat.id} className="hover:bg-muted/30">
                <TableCell className="font-medium">{stat.nom_complet}</TableCell>
                <TableCell className="text-center">
                  <span className="inline-flex items-center justify-center w-8 h-8 rounded-full bg-blue-100 text-blue-700 dark:bg-blue-900/30 dark:text-blue-300 font-semibold">
                    {stat.count_1r}
                  </span>
                </TableCell>
                <TableCell className="text-center">
                  <span className="inline-flex items-center justify-center w-8 h-8 rounded-full bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-300 font-semibold">
                    {stat.count_2f}
                  </span>
                </TableCell>
                <TableCell className="text-center">
                  <span className="inline-flex items-center justify-center w-8 h-8 rounded-full bg-purple-100 text-purple-700 dark:bg-purple-900/30 dark:text-purple-300 font-semibold">
                    {stat.count_3f}
                  </span>
                </TableCell>
                <TableCell className="text-center">
                  <span className="inline-flex items-center justify-center w-8 h-8 rounded-full bg-orange-100 text-orange-700 dark:bg-orange-900/30 dark:text-orange-300 font-semibold">
                    {stat.jours_esplanade}
                  </span>
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </div>

      <div className="flex items-center gap-4 text-xs text-muted-foreground px-2">
        <div className="flex items-center gap-2">
          <Badge variant="secondary" className="bg-blue-100 text-blue-700 dark:bg-blue-900/30 dark:text-blue-300">1R</Badge>
          <span>Responsable 1er rang</span>
        </div>
        <div className="flex items-center gap-2">
          <Badge variant="secondary" className="bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-300">2F</Badge>
          <span>Responsable 2ème fermeture</span>
        </div>
        <div className="flex items-center gap-2">
          <Badge variant="secondary" className="bg-purple-100 text-purple-700 dark:bg-purple-900/30 dark:text-purple-300">3F</Badge>
          <span>Responsable 3ème fermeture</span>
        </div>
      </div>
    </div>
  );
};
