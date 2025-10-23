import { useState, useEffect } from 'react';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Label } from '@/components/ui/label';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { RadioGroup, RadioGroupItem } from '@/components/ui/radio-group';
import { Badge } from '@/components/ui/badge';
import { Loader2, ArrowLeftRight } from 'lucide-react';
import { toast } from '@/hooks/use-toast';
import {
  fetchAvailableSecretairesForExchange,
  exchangeSecretaires,
  SecretaireForExchange,
} from '@/lib/secretaireExchange';

interface ExchangeSecretaireDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  secretaireId: string;
  secretaireNom: string;
  date: string;
  siteId: string;
  periode: 'matin' | 'apres_midi' | 'journee';
  besoinOperationId?: string | null;
  onSuccess: () => void;
}

export function ExchangeSecretaireDialog({
  open,
  onOpenChange,
  secretaireId,
  secretaireNom,
  date,
  siteId,
  periode,
  besoinOperationId,
  onSuccess,
}: ExchangeSecretaireDialogProps) {
  const [exchangeType, setExchangeType] = useState<'journee' | 'matin' | 'apres_midi'>(
    periode === 'journee' ? 'journee' : periode
  );
  const [availableSecretaires, setAvailableSecretaires] = useState<SecretaireForExchange[]>([]);
  const [selectedSecretaireId, setSelectedSecretaireId] = useState<string>('');
  const [loading, setLoading] = useState(false);
  const [exchanging, setExchanging] = useState(false);

  // Determine available exchange types based on current periode
  const canExchangeFullDay = periode === 'journee';
  const availableExchangeTypes = canExchangeFullDay
    ? ['journee', 'matin', 'apres_midi']
    : [periode];

  useEffect(() => {
    if (open) {
      fetchAvailableSecretaires();
    }
  }, [open, exchangeType]);

  const fetchAvailableSecretaires = async () => {
    setLoading(true);
    try {
      const secretaires = await fetchAvailableSecretairesForExchange(
        date,
        secretaireId,
        siteId,
        exchangeType,
        besoinOperationId
      );
      setAvailableSecretaires(secretaires);
    } catch (error) {
      console.error('Error fetching available secretaires:', error);
      toast({
        title: 'Erreur',
        description: 'Impossible de charger les assistants médicaux disponibles',
        variant: 'destructive',
      });
    } finally {
      setLoading(false);
    }
  };

  const handleExchange = async () => {
    if (!selectedSecretaireId) {
      toast({
        title: 'Erreur',
        description: 'Veuillez sélectionner un assistant médical',
        variant: 'destructive',
      });
      return;
    }

    setExchanging(true);
    try {
      const result = await exchangeSecretaires(
        secretaireId,
        selectedSecretaireId,
        date,
        exchangeType
      );

      if (result.success) {
        toast({
          title: 'Succès',
          description: `Échange effectué avec succès pour ${
            exchangeType === 'journee' ? 'la journée' : exchangeType === 'matin' ? 'le matin' : "l'après-midi"
          }`,
        });
        onSuccess();
        onOpenChange(false);
      } else {
        toast({
          title: 'Erreur',
          description: result.error || 'Impossible d\'effectuer l\'échange',
          variant: 'destructive',
        });
      }
    } catch (error) {
      console.error('Error exchanging:', error);
      toast({
        title: 'Erreur',
        description: 'Une erreur inattendue est survenue',
        variant: 'destructive',
      });
    } finally {
      setExchanging(false);
    }
  };

  const selectedSecretaire = availableSecretaires.find(
    s => s.secretaire_id === selectedSecretaireId
  );

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-2xl">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <ArrowLeftRight className="h-5 w-5 text-primary" />
            Échanger {secretaireNom}
          </DialogTitle>
        </DialogHeader>

        <div className="space-y-6 py-4">
          {/* Only show exchange type selection if full day */}
          {canExchangeFullDay && (
            <div className="space-y-3">
              <Label>Type d'échange</Label>
              <RadioGroup value={exchangeType} onValueChange={(v: any) => {
                setExchangeType(v);
                setSelectedSecretaireId('');
              }}>
                {availableExchangeTypes.includes('journee') && (
                  <div className="flex items-center space-x-2">
                    <RadioGroupItem value="journee" id="journee" />
                    <Label htmlFor="journee" className="cursor-pointer">
                      Journée complète
                      <span className="text-xs text-muted-foreground ml-2">
                        (échange site, opération et rôles 1R/2F/3F)
                      </span>
                    </Label>
                  </div>
                )}
                {availableExchangeTypes.includes('matin') && (
                  <div className="flex items-center space-x-2">
                    <RadioGroupItem value="matin" id="matin" />
                    <Label htmlFor="matin" className="cursor-pointer">
                      Matin uniquement
                      <span className="text-xs text-muted-foreground ml-2">
                        (échange site et opération)
                      </span>
                    </Label>
                  </div>
                )}
                {availableExchangeTypes.includes('apres_midi') && (
                  <div className="flex items-center space-x-2">
                    <RadioGroupItem value="apres_midi" id="apres_midi" />
                    <Label htmlFor="apres_midi" className="cursor-pointer">
                      Après-midi uniquement
                      <span className="text-xs text-muted-foreground ml-2">
                        (échange site et opération)
                      </span>
                    </Label>
                  </div>
                )}
              </RadioGroup>
            </div>
          )}

          {/* Show info about the selected period if not full day */}
          {!canExchangeFullDay && (
            <div className="p-3 rounded-lg bg-muted/50 border border-border/50">
              <p className="text-sm font-medium">
                Échange pour: <Badge variant="outline" className="ml-2">
                  {periode === 'matin' ? 'Matin' : 'Après-midi'}
                </Badge>
              </p>
              <p className="text-xs text-muted-foreground mt-1">
                Seule cette demi-journée sera échangée
              </p>
            </div>
          )}

          {/* Secretaire Selection */}
          <div className="space-y-3">
            <Label>Échanger avec</Label>
            {loading ? (
              <div className="flex items-center justify-center py-8">
                <Loader2 className="h-6 w-6 animate-spin text-primary" />
              </div>
            ) : availableSecretaires.length === 0 ? (
              <p className="text-sm text-muted-foreground py-4 text-center">
                Aucun assistant médical disponible pour cet échange
              </p>
            ) : (
              <Select value={selectedSecretaireId} onValueChange={setSelectedSecretaireId}>
                <SelectTrigger>
                  <SelectValue placeholder="Sélectionner un assistant médical" />
                </SelectTrigger>
                <SelectContent>
                  {availableSecretaires.map((sec) => {
                    // Display only the selected period
                    let displayInfo = '';
                    let besoinInfo = '';
                    let salleInfo = '';
                    
                    if (exchangeType === 'journee') {
                      if (sec.has_different_sites) {
                        displayInfo = `${sec.matin_site_nom} / ${sec.apres_midi_site_nom} - Journée`;
                      } else {
                        displayInfo = `${sec.site_nom} - Journée`;
                      }
                      // Show bloc info if exists
                      if (sec.matin_besoin_nom || sec.apres_midi_besoin_nom) {
                        besoinInfo = [sec.matin_besoin_nom, sec.apres_midi_besoin_nom].filter(Boolean).join(' / ');
                      }
                      if (sec.matin_salle_nom || sec.apres_midi_salle_nom) {
                        salleInfo = [sec.matin_salle_nom, sec.apres_midi_salle_nom].filter(Boolean).join(' / ');
                      }
                    } else if (exchangeType === 'matin') {
                      displayInfo = `${sec.matin_site_nom || sec.site_nom} - Matin`;
                      if (sec.matin_besoin_nom) besoinInfo = sec.matin_besoin_nom;
                      if (sec.matin_salle_nom) salleInfo = sec.matin_salle_nom;
                    } else {
                      displayInfo = `${sec.apres_midi_site_nom || sec.site_nom} - Après-midi`;
                      if (sec.apres_midi_besoin_nom) besoinInfo = sec.apres_midi_besoin_nom;
                      if (sec.apres_midi_salle_nom) salleInfo = sec.apres_midi_salle_nom;
                    }
                    
                    return (
                      <SelectItem key={sec.secretaire_id} value={sec.secretaire_id}>
                        <div className="flex flex-col gap-1">
                          <div className="flex items-center gap-2">
                            <span className="font-medium">{sec.nom}</span>
                            <span className="text-xs text-muted-foreground">
                              ({displayInfo})
                            </span>
                            {sec.is_1r && (
                              <Badge variant="outline" className="text-[10px]">1R</Badge>
                            )}
                            {sec.is_2f && (
                              <Badge variant="outline" className="text-[10px]">2F</Badge>
                            )}
                            {sec.is_3f && (
                              <Badge variant="outline" className="text-[10px]">3F</Badge>
                            )}
                          </div>
                          {(besoinInfo || salleInfo) && (
                            <div className="text-[10px] text-muted-foreground ml-0">
                              {besoinInfo && <span>Besoin: {besoinInfo}</span>}
                              {besoinInfo && salleInfo && <span> • </span>}
                              {salleInfo && <span>Salle: {salleInfo}</span>}
                            </div>
                          )}
                        </div>
                      </SelectItem>
                    );
                  })}
                </SelectContent>
              </Select>
            )}
          </div>

          {/* Preview of exchange */}
          {selectedSecretaire && (
            <div className="rounded-lg border border-border bg-muted/30 p-4 space-y-2">
              <p className="text-sm font-medium">Aperçu de l'échange :</p>
              <div className="flex items-center gap-3 text-sm">
                <span className="font-medium">{secretaireNom}</span>
                <ArrowLeftRight className="h-4 w-4 text-muted-foreground" />
                <span className="font-medium">{selectedSecretaire.nom}</span>
              </div>
              <div className="text-xs text-muted-foreground space-y-1">
                <p>• Sites échangés</p>
                <p>• Opérations échangées (si applicable)</p>
                {exchangeType === 'journee' && (
                  <p>• Rôles 1R/2F/3F échangés</p>
                )}
              </div>
            </div>
          )}
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={exchanging}>
            Annuler
          </Button>
          <Button
            onClick={handleExchange}
            disabled={!selectedSecretaireId || exchanging}
            className="bg-gradient-to-r from-cyan-500 to-teal-600"
          >
            {exchanging ? (
              <>
                <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                Échange en cours...
              </>
            ) : (
              <>
                <ArrowLeftRight className="h-4 w-4 mr-2" />
                Échanger
              </>
            )}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
