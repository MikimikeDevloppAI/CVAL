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
  admin_demi_journees: number;
  changements_site: number;
}

// Custom label qui ne s'affiche que si la valeur > 0
const renderCustomLabel = (props: any) => {
  const { x, y, width, value } = props;
  if (!value || value === 0) return null;
  return (
    <text
      x={x + width / 2}
      y={y - 5}
      fill="hsl(var(--foreground))"
      textAnchor="middle"
      fontSize={12}
    >
      {value}
    </text>
  );
};

export const SecretaireStatsDialog = ({ secretaires }: SecretaireStatsDialogProps) => {
  // Calculer les statistiques pour chaque secrétaire
  const stats: SecretaireStats[] = secretaires.map(secretaire => {
    let count_1r = 0;
    let count_2f = 0;
    let count_3f = 0;
    const joursEsplanadeSet = new Set<string>();
    let admin_demi_journees = 0;
    let changements_site = 0;

    secretaire.days.forEach(day => {
      // Compter les rôles 1R/2F/3F et jours Esplanade
      [...day.matin, ...day.apres_midi].forEach(assignment => {
        if (assignment.is_1r) count_1r++;
        if (assignment.is_2f) count_2f++;
        if (assignment.is_3f) count_3f++;

        if (assignment.site_nom?.toLowerCase().includes('esplanade')) {
          joursEsplanadeSet.add(day.date);
        }
      });

      // Compter les demi-journées administratives
      const isMatinAdmin = day.matin.some(a => a.site_nom?.toLowerCase().includes('administratif'));
      const isAMAdmin = day.apres_midi.some(a => a.site_nom?.toLowerCase().includes('administratif'));
      if (isMatinAdmin) admin_demi_journees++;
      if (isAMAdmin) admin_demi_journees++;

      // Compter les changements de site (excluant admin et bloc)
      const siteMatin = day.matin.find(a => 
        !a.site_nom?.toLowerCase().includes('administratif') && 
        !a.site_nom?.toLowerCase().includes('bloc')
      )?.site_nom;
      
      const siteAM = day.apres_midi.find(a => 
        !a.site_nom?.toLowerCase().includes('administratif') && 
        !a.site_nom?.toLowerCase().includes('bloc')
      )?.site_nom;

      if (siteMatin && siteAM && siteMatin !== siteAM) {
        changements_site++;
      }
    });

    return {
      id: secretaire.id,
      nom_complet: secretaire.nom_complet,
      count_1r,
      count_2f,
      count_3f,
      jours_esplanade: joursEsplanadeSet.size,
      admin_demi_journees,
      changements_site
    };
  });

  // Filtrer seulement les secrétaires avec des données et trier par nom
  const sortedStats = stats
    .filter(stat => stat.count_1r > 0 || stat.count_2f > 0 || stat.count_3f > 0 || stat.jours_esplanade > 0 || stat.admin_demi_journees > 0 || stat.changements_site > 0)
    .sort((a, b) => a.nom_complet.localeCompare(b.nom_complet));

  // Données pour le graphique des responsabilités (diviser 1R et 2F par 2 pour compter en journées)
  const responsibilitiesData = sortedStats
    .filter(stat => stat.count_1r > 0 || stat.count_2f > 0 || stat.count_3f > 0)
    .map(stat => ({
      nom: stat.nom_complet.split(' ').map(n => n.charAt(0)).join(''), // Initiales
      fullName: stat.nom_complet,
      '1R': stat.count_1r / 2,
      '2F': stat.count_2f / 2,
      '3F': stat.count_3f / 2,
    }));

  // Données pour le graphique Esplanade
  const esplanadeData = sortedStats
    .filter(stat => stat.jours_esplanade > 0)
    .map(stat => ({
      nom: stat.nom_complet.split(' ').map(n => n.charAt(0)).join(''),
      fullName: stat.nom_complet,
      'Jours': stat.jours_esplanade,
    }));

  // Données pour le graphique Administratif
  const adminData = sortedStats
    .filter(stat => stat.admin_demi_journees > 0)
    .map(stat => ({
      nom: stat.nom_complet.split(' ').map(n => n.charAt(0)).join(''),
      fullName: stat.nom_complet,
      'Demi-journées': stat.admin_demi_journees,
    }));

  // Données pour le graphique Changements de site
  const changementsSiteData = sortedStats
    .filter(stat => stat.changements_site > 0)
    .map(stat => ({
      nom: stat.nom_complet.split(' ').map(n => n.charAt(0)).join(''),
      fullName: stat.nom_complet,
      'Changements': stat.changements_site,
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
            <div className="flex items-center justify-between">
              <h3 className="text-lg font-semibold bg-gradient-to-r from-primary to-primary/70 bg-clip-text text-transparent">
                Répartition des responsabilités de fermeture
              </h3>
            </div>
            <div className="h-[380px] w-full bg-gradient-to-br from-card/50 to-card/30 rounded-xl p-6 border border-border/50 shadow-lg flex items-center justify-center">
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={responsibilitiesData} margin={{ top: 30, right: 40, left: 20, bottom: 60 }}>
                  <defs>
                    <linearGradient id="gradient1R" x1="0" y1="0" x2="0" y2="1">
                      <stop offset="0%" stopColor="#3b82f6" stopOpacity={0.9}/>
                      <stop offset="100%" stopColor="#3b82f6" stopOpacity={0.6}/>
                    </linearGradient>
                    <linearGradient id="gradient2F" x1="0" y1="0" x2="0" y2="1">
                      <stop offset="0%" stopColor="#22c55e" stopOpacity={0.9}/>
                      <stop offset="100%" stopColor="#22c55e" stopOpacity={0.6}/>
                    </linearGradient>
                    <linearGradient id="gradient3F" x1="0" y1="0" x2="0" y2="1">
                      <stop offset="0%" stopColor="#a855f7" stopOpacity={0.9}/>
                      <stop offset="100%" stopColor="#a855f7" stopOpacity={0.6}/>
                    </linearGradient>
                  </defs>
                  <CartesianGrid strokeDasharray="3 3" className="stroke-muted/30" />
                  <XAxis 
                    dataKey="nom" 
                    angle={-45}
                    textAnchor="end"
                    height={60}
                    tick={{ fill: 'hsl(var(--foreground))', fontSize: 12 }}
                    stroke="hsl(var(--border))"
                  />
                  <Tooltip 
                    contentStyle={{ 
                      backgroundColor: 'hsl(var(--popover))',
                      border: '1px solid hsl(var(--border))',
                      borderRadius: '12px',
                      boxShadow: '0 4px 12px rgba(0,0,0,0.1)'
                    }}
                    labelFormatter={(value, payload) => {
                      const item = payload?.[0]?.payload;
                      return item?.fullName || value;
                    }}
                  />
                  <Bar dataKey="1R" fill="url(#gradient1R)" name="Responsable 1R" radius={[8, 8, 0, 0]} label={renderCustomLabel} />
                  <Bar dataKey="2F" fill="url(#gradient2F)" name="Responsable 2F" radius={[8, 8, 0, 0]} label={renderCustomLabel} />
                  <Bar dataKey="3F" fill="url(#gradient3F)" name="Responsable 3F" radius={[8, 8, 0, 0]} label={renderCustomLabel} />
                </BarChart>
              </ResponsiveContainer>
            </div>
          </div>

          {/* Graphique Centre Esplanade */}
          {esplanadeData.length > 0 && (
            <div className="space-y-4">
              <h3 className="text-lg font-semibold bg-gradient-to-r from-orange-600 to-orange-400 bg-clip-text text-transparent">
                Nombre de jours au Centre Esplanade
              </h3>
              <div className="h-[380px] w-full bg-gradient-to-br from-card/50 to-card/30 rounded-xl p-6 border border-border/50 shadow-lg flex items-center justify-center">
                <ResponsiveContainer width="100%" height="100%">
                  <BarChart data={esplanadeData} margin={{ top: 30, right: 40, left: 20, bottom: 60 }}>
                    <defs>
                      <linearGradient id="gradientEsplanade" x1="0" y1="0" x2="0" y2="1">
                        <stop offset="0%" stopColor="#f97316" stopOpacity={0.9}/>
                        <stop offset="100%" stopColor="#f97316" stopOpacity={0.6}/>
                      </linearGradient>
                    </defs>
                    <CartesianGrid strokeDasharray="3 3" className="stroke-muted/30" />
                    <XAxis 
                      dataKey="nom" 
                      angle={-45}
                      textAnchor="end"
                      height={60}
                      tick={{ fill: 'hsl(var(--foreground))', fontSize: 12 }}
                      stroke="hsl(var(--border))"
                    />
                    <Tooltip 
                      contentStyle={{ 
                        backgroundColor: 'hsl(var(--popover))',
                        border: '1px solid hsl(var(--border))',
                        borderRadius: '12px',
                        boxShadow: '0 4px 12px rgba(0,0,0,0.1)'
                      }}
                      labelFormatter={(value, payload) => {
                        const item = payload?.[0]?.payload;
                        return item?.fullName || value;
                      }}
                    />
                    <Bar dataKey="Jours" fill="url(#gradientEsplanade)" name="Jours au Centre Esplanade" radius={[8, 8, 0, 0]} label={{ position: 'top', fill: 'hsl(var(--foreground))', fontSize: 12 }} />
                  </BarChart>
                </ResponsiveContainer>
              </div>
            </div>
          )}

          {/* Graphique Administratif */}
          {adminData.length > 0 && (
            <div className="space-y-4">
              <h3 className="text-lg font-semibold bg-gradient-to-r from-cyan-600 to-cyan-400 bg-clip-text text-transparent">
                Nombre de demi-journées administratives
              </h3>
              <div className="h-[380px] w-full bg-gradient-to-br from-card/50 to-card/30 rounded-xl p-6 border border-border/50 shadow-lg flex items-center justify-center">
                <ResponsiveContainer width="100%" height="100%">
                  <BarChart data={adminData} margin={{ top: 30, right: 40, left: 20, bottom: 60 }}>
                    <defs>
                      <linearGradient id="gradientAdmin" x1="0" y1="0" x2="0" y2="1">
                        <stop offset="0%" stopColor="#06b6d4" stopOpacity={0.9}/>
                        <stop offset="100%" stopColor="#06b6d4" stopOpacity={0.6}/>
                      </linearGradient>
                    </defs>
                    <CartesianGrid strokeDasharray="3 3" className="stroke-muted/30" />
                    <XAxis 
                      dataKey="nom" 
                      angle={-45}
                      textAnchor="end"
                      height={60}
                      tick={{ fill: 'hsl(var(--foreground))', fontSize: 12 }}
                      stroke="hsl(var(--border))"
                    />
                    <Tooltip 
                      contentStyle={{ 
                        backgroundColor: 'hsl(var(--popover))',
                        border: '1px solid hsl(var(--border))',
                        borderRadius: '12px',
                        boxShadow: '0 4px 12px rgba(0,0,0,0.1)'
                      }}
                      labelFormatter={(value, payload) => {
                        const item = payload?.[0]?.payload;
                        return item?.fullName || value;
                      }}
                    />
                    <Bar dataKey="Demi-journées" fill="url(#gradientAdmin)" name="Demi-journées administratives" radius={[8, 8, 0, 0]} label={{ position: 'top', fill: 'hsl(var(--foreground))', fontSize: 12 }} />
                  </BarChart>
                </ResponsiveContainer>
              </div>
            </div>
          )}

          {/* Graphique Changements de site */}
          {changementsSiteData.length > 0 && (
            <div className="space-y-4">
              <h3 className="text-lg font-semibold bg-gradient-to-r from-rose-600 to-rose-400 bg-clip-text text-transparent">
                Nombre de changements de site (matin → après-midi)
              </h3>
              <div className="h-[380px] w-full bg-gradient-to-br from-card/50 to-card/30 rounded-xl p-6 border border-border/50 shadow-lg flex items-center justify-center">
                <ResponsiveContainer width="100%" height="100%">
                  <BarChart data={changementsSiteData} margin={{ top: 30, right: 40, left: 20, bottom: 60 }}>
                    <defs>
                      <linearGradient id="gradientChangements" x1="0" y1="0" x2="0" y2="1">
                        <stop offset="0%" stopColor="#f43f5e" stopOpacity={0.9}/>
                        <stop offset="100%" stopColor="#f43f5e" stopOpacity={0.6}/>
                      </linearGradient>
                    </defs>
                    <CartesianGrid strokeDasharray="3 3" className="stroke-muted/30" />
                    <XAxis 
                      dataKey="nom" 
                      angle={-45}
                      textAnchor="end"
                      height={60}
                      tick={{ fill: 'hsl(var(--foreground))', fontSize: 12 }}
                      stroke="hsl(var(--border))"
                    />
                    <Tooltip 
                      contentStyle={{ 
                        backgroundColor: 'hsl(var(--popover))',
                        border: '1px solid hsl(var(--border))',
                        borderRadius: '12px',
                        boxShadow: '0 4px 12px rgba(0,0,0,0.1)'
                      }}
                      labelFormatter={(value, payload) => {
                        const item = payload?.[0]?.payload;
                        return item?.fullName || value;
                      }}
                    />
                    <Bar dataKey="Changements" fill="url(#gradientChangements)" name="Changements de site" radius={[8, 8, 0, 0]} label={{ position: 'top', fill: 'hsl(var(--foreground))', fontSize: 12 }} />
                  </BarChart>
                </ResponsiveContainer>
              </div>
            </div>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
};
