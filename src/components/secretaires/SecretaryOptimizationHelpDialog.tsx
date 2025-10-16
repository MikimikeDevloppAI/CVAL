import { HelpCircle } from 'lucide-react';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Separator } from '@/components/ui/separator';

export function SecretaryOptimizationHelpDialog() {
  return (
    <Dialog>
      <DialogTrigger asChild>
        <Button variant="outline" size="sm" className="gap-2">
          <HelpCircle className="h-4 w-4" />
          Aide
        </Button>
      </DialogTrigger>
      <DialogContent className="max-w-3xl max-h-[90vh]">
        <DialogHeader>
          <DialogTitle>Guide d'optimisation des secrétaires</DialogTitle>
          <DialogDescription>
            Comprendre les options et leur impact sur l'algorithme d'optimisation
          </DialogDescription>
        </DialogHeader>
        <ScrollArea className="max-h-[calc(90vh-120px)] pr-4">
          <div className="space-y-6">
            {/* Sites assignés */}
            <div className="space-y-2">
              <h3 className="font-semibold text-base">Sites assignés avec priorités</h3>
              <div className="space-y-2 text-sm">
                <div>
                  <p className="font-medium text-primary">Priorité 1 (P1)</p>
                  <p className="text-muted-foreground">
                    Sites préférentiels où la secrétaire sera assignée en priorité lors de l'optimisation. 
                    L'algorithme privilégiera toujours ces sites pour cette secrétaire.
                  </p>
                </div>
                <div>
                  <p className="font-medium text-primary">Priorité 2 (P2)</p>
                  <p className="text-muted-foreground">
                    Sites secondaires où la secrétaire peut être assignée si nécessaire. 
                    L'algorithme utilisera ces sites en second choix après avoir satisfait les besoins des sites P1.
                  </p>
                </div>
                <div>
                  <p className="font-medium text-primary">Priorité 3 (P3 - par défaut)</p>
                  <p className="text-muted-foreground">
                    Si aucune priorité n'est définie, la secrétaire peut être assignée à n'importe quel site selon les besoins.
                    L'algorithme optimisera en fonction de la disponibilité globale.
                  </p>
                </div>
              </div>
            </div>

            <Separator />

            {/* Médecins assignés */}
            <div className="space-y-2">
              <h3 className="font-semibold text-base">Médecins assignés avec priorités</h3>
              <div className="space-y-2 text-sm">
                <div>
                  <p className="font-medium text-primary">Priorité 1</p>
                  <p className="text-muted-foreground">
                    Médecins principaux pour lesquels la secrétaire est affectée en priorité.
                    L'algorithme maximisera les assignments avec ces médecins.
                  </p>
                </div>
                <div>
                  <p className="font-medium text-primary">Priorité 2</p>
                  <p className="text-muted-foreground">
                    Médecins secondaires où la secrétaire peut être assignée selon les besoins.
                  </p>
                </div>
              </div>
            </div>

            <Separator />

            {/* Personnel bloc opératoire */}
            <div className="space-y-2">
              <h3 className="font-semibold text-base">Personnel bloc opératoire</h3>
              <p className="text-sm text-muted-foreground">
                <span className="font-medium text-primary">Rôle dans l'optimisation :</span> Les secrétaires marquées comme 
                personnel de bloc opératoire sont assignées en <strong>première phase</strong> lors de l'optimisation. 
                Elles seront prioritairement affectées aux interventions chirurgicales avant l'affectation aux sites administratifs.
              </p>
              <p className="text-sm text-muted-foreground">
                Les rôles disponibles incluent : instrumentiste, aide de salle, anesthésiste, 
                accueil dermatologie, et accueil ophtalmologie.
              </p>
            </div>

            <Separator />

            {/* Assignation administrative */}
            <div className="space-y-2">
              <h3 className="font-semibold text-base">Assignation administrative</h3>
              <p className="text-sm text-muted-foreground">
                <span className="font-medium text-primary">Impact :</span> Les secrétaires avec cette option peuvent être 
                assignées à des tâches administratives générales dans les sites. Elles seront considérées dans la 
                <strong> deuxième phase</strong> d'optimisation après l'affectation du personnel de bloc.
              </p>
            </div>

            <Separator />

            {/* Préfère Port-en-Truie */}
            <div className="space-y-2">
              <h3 className="font-semibold text-base">Préfère travailler à Port-en-Truie</h3>
              <p className="text-sm text-muted-foreground">
                <span className="font-medium text-primary">Optimisation :</span> L'algorithme donnera un poids plus élevé 
                aux affectations à ce site pour cette secrétaire. Cela augmente la probabilité d'être assignée à 
                Port-en-Truie lorsque plusieurs choix sont possibles.
              </p>
            </div>

            <Separator />

            {/* Horaire flexible */}
            <div className="space-y-2">
              <h3 className="font-semibold text-base">Horaire flexible avec pourcentage de temps</h3>
              <p className="text-sm text-muted-foreground">
                <span className="font-medium text-primary">Fonctionnement :</span> Le pourcentage de temps (ex: 80%) 
                indique la charge de travail de la secrétaire. L'algorithme d'optimisation calcule automatiquement 
                le nombre de demi-journées nécessaires et peut ajuster les affectations en conséquence.
              </p>
              <p className="text-sm text-muted-foreground">
                Par exemple, une secrétaire à 80% sur une semaine de 5 jours travaillera 4 jours complets ou l'équivalent en demi-journées.
              </p>
            </div>

            <Separator />

            {/* Jours supplémentaires flexibles */}
            <div className="space-y-2">
              <h3 className="font-semibold text-base">Jours supplémentaires flexibles</h3>
              <p className="text-sm text-muted-foreground">
                <span className="font-medium text-primary">Optimisation :</span> Lorsque activé, l'algorithme peut 
                ajouter jusqu'au nombre spécifié de jours supplémentaires pour cette secrétaire si cela améliore 
                significativement la couverture des besoins. Cela offre plus de flexibilité dans la planification.
              </p>
            </div>

            <Separator />

            {/* Résumé du processus d'optimisation */}
            <div className="space-y-2 bg-muted/50 p-4 rounded-lg">
              <h3 className="font-semibold text-base">Résumé du processus d'optimisation</h3>
              <ol className="list-decimal list-inside space-y-1 text-sm text-muted-foreground">
                <li>
                  <strong>Phase 1 :</strong> Affectation du personnel bloc opératoire aux interventions chirurgicales
                </li>
                <li>
                  <strong>Phase 2 :</strong> Affectation des secrétaires aux sites selon les priorités (P1 {'>'} P2 {'>'} P3)
                </li>
                <li>
                  <strong>Phase 3 :</strong> Optimisation fine en tenant compte des préférences (Port-en-Truie, médecins)
                </li>
                <li>
                  <strong>Phase 4 :</strong> Ajustement avec les horaires flexibles et jours supplémentaires si nécessaire
                </li>
              </ol>
            </div>
          </div>
        </ScrollArea>
      </DialogContent>
    </Dialog>
  );
}
