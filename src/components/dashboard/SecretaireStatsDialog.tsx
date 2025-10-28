import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { BarChart3 } from "lucide-react";
import { BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, Legend, ResponsiveContainer } from 'recharts';

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

interface SecretaireStatsDialogProps {
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

export const SecretaireStatsDialog = ({ secretaires }: SecretaireStatsDialogProps) => {
  // Calculer les statistiques pour chaque secrétaire
  const stats: SecretaireStats[] = secretaires.map(secretaire => {
    let count_1r = 0;
    let count_2f = 0;
    let count_3f = 0;
    const joursEsplanadeSet = new Set<string>();

    secretaire.days.forEach(day => {
      [...day.matin, ...day.apres_midi].forEach(assignment => {
        if (assignment.is_1r) count_1r++;
        if (assignment.is_2f) count_2f++;
        if (assignment.is_3f) count_3f++;

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

  // Trier par nom et préparer les données pour les graphiques
  const sortedStats = stats.sort((a, b) => a.nom_complet.localeCompare(b.nom_complet));

  // Données pour le graphique des responsabilités
  const responsibilitiesData = sortedStats.map(stat => ({
    nom: stat.nom_complet.split(' ').map(n => n.charAt(0)).join(''), // Initiales
    '1R': stat.count_1r,
    '2F': stat.count_2f,
    '3F': stat.count_3f,
  }));

  // Données pour le graphique Esplanade
  const esplanadeData = sortedStats.map(stat => ({
    nom: stat.nom_complet.split(' ').map(n => n.charAt(0)).join(''),
    'Jours': stat.jours_esplanade,
  }));

  return (
    <Dialog>
      <DialogTrigger asChild>
        <Button variant="outline" size="sm" className="gap-2">
          <BarChart3 className="h-4 w-4" />
          Statistiques
        </Button>
      </DialogTrigger>
      <DialogContent className="max-w-5xl max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="text-xl">Statistiques hebdomadaires - Assistants médicaux</DialogTitle>
        </DialogHeader>

        <div className="space-y-8 py-4">
          {/* Graphique des responsabilités (1R, 2F, 3F) */}
          <div className="space-y-4">
            <h3 className="text-lg font-semibold">Répartition des responsabilités de fermeture</h3>
            <div className="h-[400px] w-full">
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={responsibilitiesData} margin={{ top: 20, right: 30, left: 20, bottom: 80 }}>
                  <CartesianGrid strokeDasharray="3 3" className="stroke-muted" />
                  <XAxis 
                    dataKey="nom" 
                    angle={-45}
                    textAnchor="end"
                    height={80}
                    className="text-xs"
                  />
                  <YAxis />
                  <Tooltip 
                    contentStyle={{ 
                      backgroundColor: 'hsl(var(--card))',
                      border: '1px solid hsl(var(--border))',
                      borderRadius: '8px'
                    }}
                  />
                  <Legend />
                  <Bar dataKey="1R" fill="#3b82f6" name="Responsable 1R" />
                  <Bar dataKey="2F" fill="#22c55e" name="Responsable 2F" />
                  <Bar dataKey="3F" fill="#a855f7" name="Responsable 3F" />
                </BarChart>
              </ResponsiveContainer>
            </div>
          </div>

          {/* Graphique Centre Esplanade */}
          <div className="space-y-4">
            <h3 className="text-lg font-semibold">Nombre de jours au Centre Esplanade</h3>
            <div className="h-[400px] w-full">
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={esplanadeData} margin={{ top: 20, right: 30, left: 20, bottom: 80 }}>
                  <CartesianGrid strokeDasharray="3 3" className="stroke-muted" />
                  <XAxis 
                    dataKey="nom" 
                    angle={-45}
                    textAnchor="end"
                    height={80}
                    className="text-xs"
                  />
                  <YAxis />
                  <Tooltip 
                    contentStyle={{ 
                      backgroundColor: 'hsl(var(--card))',
                      border: '1px solid hsl(var(--border))',
                      borderRadius: '8px'
                    }}
                  />
                  <Legend />
                  <Bar dataKey="Jours" fill="#f97316" name="Jours au Centre Esplanade" />
                </BarChart>
              </ResponsiveContainer>
            </div>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
};
