import { useState, useEffect } from 'react';
import { format, addWeeks, startOfWeek } from 'date-fns';
import { fr } from 'date-fns/locale';
import { FileText, Download, Eye, CheckSquare, Square, Loader2 } from 'lucide-react';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Badge } from '@/components/ui/badge';
import { Separator } from '@/components/ui/separator';
import { usePdfHistory } from '@/hooks/usePdfHistory';
import { Checkbox } from '@/components/ui/checkbox';

interface GeneratePdfDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

export function GeneratePdfDialog({ open, onOpenChange }: GeneratePdfDialogProps) {
  const [selectedWeeks, setSelectedWeeks] = useState<string[]>([]);
  const [availableWeeks, setAvailableWeeks] = useState<{ date: Date; label: string; value: string }[]>([]);
  const { pdfs, loading, generating, generatePdf } = usePdfHistory();

  useEffect(() => {
    // Generate 52 future weeks
    const weeks: { date: Date; label: string; value: string }[] = [];
    const today = new Date();
    
    for (let i = 0; i < 52; i++) {
      const weekStart = startOfWeek(addWeeks(today, i), { locale: fr, weekStartsOn: 1 });
      const weekEnd = addWeeks(weekStart, 1);
      weekEnd.setDate(weekEnd.getDate() - 1); // Last day is Saturday
      
      const label = `Semaine du ${format(weekStart, 'd MMM', { locale: fr })} au ${format(weekEnd, 'd MMM yyyy', { locale: fr })}`;
      const value = format(weekStart, 'yyyy-MM-dd');
      
      weeks.push({ date: weekStart, label, value });
    }
    
    setAvailableWeeks(weeks);
  }, []);

  const toggleWeek = (value: string) => {
    setSelectedWeeks(prev => 
      prev.includes(value) 
        ? prev.filter(w => w !== value)
        : [...prev, value]
    );
  };

  const toggleAll = () => {
    if (selectedWeeks.length === availableWeeks.length) {
      setSelectedWeeks([]);
    } else {
      setSelectedWeeks(availableWeeks.map(w => w.value));
    }
  };

  const handleGenerate = async () => {
    if (selectedWeeks.length === 0) return;
    if (selectedWeeks.length > 12) {
      return;
    }

    const result = await generatePdf(selectedWeeks);
    if (result?.success) {
      setSelectedWeeks([]);
    }
  };

  const handleDownload = (pdfUrl: string, fileName: string) => {
    const link = document.createElement('a');
    link.href = pdfUrl;
    link.download = fileName;
    link.target = '_blank';
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
  };

  const handleView = (pdfUrl: string) => {
    window.open(pdfUrl, '_blank');
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-4xl max-h-[90vh] overflow-y-auto backdrop-blur-xl bg-card/95 border-2 border-teal-200/50 dark:border-teal-800/50">
        <DialogHeader>
          <DialogTitle className="text-2xl font-bold bg-gradient-to-r from-teal-600 to-cyan-600 bg-clip-text text-transparent">
            Générer un PDF Planning
          </DialogTitle>
          <DialogDescription className="sr-only">
            Générer et télécharger un PDF du planning des assistants médicaux
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-6">
          {/* Selection Section */}
          <div className="space-y-3">
            <div className="flex items-center justify-between">
              <h3 className="text-sm font-semibold text-foreground">Sélectionner les semaines</h3>
              <Button
                variant="outline"
                size="sm"
                onClick={toggleAll}
                className="text-xs backdrop-blur-xl bg-card/95 border-teal-200/50 dark:border-teal-800/50 hover:border-teal-400/70"
              >
                {selectedWeeks.length === availableWeeks.length ? (
                  <>
                    <Square className="h-3 w-3 mr-1" />
                    Tout désélectionner
                  </>
                ) : (
                  <>
                    <CheckSquare className="h-3 w-3 mr-1" />
                    Tout sélectionner
                  </>
                )}
              </Button>
            </div>

            <ScrollArea className="h-[200px] max-h-[30vh] rounded-lg border border-border/50 bg-muted/20 p-3">
              <div className="grid grid-cols-2 gap-2">
                {availableWeeks.map((week) => (
                  <div
                    key={week.value}
                    className={`flex items-center space-x-2 p-2 rounded-lg border transition-all cursor-pointer ${
                      selectedWeeks.includes(week.value)
                        ? 'bg-teal-500/10 border-teal-400/50'
                        : 'bg-card/50 border-border/50 hover:border-teal-300/30'
                    }`}
                    onClick={() => toggleWeek(week.value)}
                  >
                    <Checkbox
                      checked={selectedWeeks.includes(week.value)}
                      onCheckedChange={() => toggleWeek(week.value)}
                    />
                    <label className="text-xs cursor-pointer flex-1">
                      {week.label}
                    </label>
                  </div>
                ))}
              </div>
            </ScrollArea>

            <div className="flex items-center justify-between">
              <p className="text-xs text-muted-foreground">
                {selectedWeeks.length} semaine{selectedWeeks.length > 1 ? 's' : ''} sélectionnée{selectedWeeks.length > 1 ? 's' : ''}
                {selectedWeeks.length > 12 && (
                  <span className="text-destructive ml-2">(Maximum 12 semaines)</span>
                )}
              </p>
              <Button
                onClick={handleGenerate}
                disabled={selectedWeeks.length === 0 || selectedWeeks.length > 12 || generating}
                className="backdrop-blur-xl bg-gradient-to-r from-teal-600 to-cyan-600 hover:from-teal-700 hover:to-cyan-700 text-white border-0 shadow-lg hover:shadow-xl hover:shadow-teal-500/20 transition-all duration-300"
              >
                {generating ? (
                  <>
                    <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                    Génération...
                  </>
                ) : (
                  <>
                    <FileText className="h-4 w-4 mr-2" />
                    Générer le PDF
                  </>
                )}
              </Button>
            </div>
          </div>

          <Separator className="bg-border/50" />

          {/* History Section */}
          <div className="space-y-3">
            <h3 className="text-sm font-semibold text-foreground">Historique des PDFs générés</h3>
            
            <ScrollArea className="h-[300px] max-h-[45vh] rounded-lg border border-border/50 bg-muted/20 p-3">
              {loading ? (
                <div className="flex items-center justify-center h-full">
                  <Loader2 className="h-6 w-6 animate-spin text-teal-600" />
                </div>
              ) : pdfs.length === 0 ? (
                <div className="flex flex-col items-center justify-center h-full text-center text-muted-foreground">
                  <FileText className="h-12 w-12 mb-2 opacity-20" />
                  <p className="text-sm">Aucun PDF généré pour le moment</p>
                </div>
              ) : (
                <div className="space-y-2">
                  {pdfs.map((pdf) => (
                    <div
                      key={pdf.id}
                      className="p-3 rounded-lg border border-border/50 bg-card/50 backdrop-blur-sm hover:border-teal-300/50 transition-all overflow-hidden"
                    >
                      <div className="flex items-start gap-3">
                        <div className="flex-shrink-0 p-2 rounded-lg bg-teal-500/10">
                          <FileText className="h-5 w-5 text-teal-600 dark:text-teal-400" />
                        </div>
                        
                        <div className="flex-1 min-w-0">
                          <p className="text-sm font-medium text-foreground truncate">
                            Du {format(new Date(pdf.date_debut), 'd MMM', { locale: fr })} au {format(new Date(pdf.date_fin), 'd MMM yyyy', { locale: fr })}
                          </p>
                          <div className="flex flex-wrap gap-2 mt-1">
                            {pdf.nombre_semaines && (
                              <Badge variant="outline" className="text-xs bg-blue-500/10 border-blue-300/50">
                                {pdf.nombre_semaines} semaine{pdf.nombre_semaines > 1 ? 's' : ''}
                              </Badge>
                            )}
                            {pdf.nombre_secretaires && (
                              <Badge variant="outline" className="text-xs bg-purple-500/10 border-purple-300/50">
                                {pdf.nombre_secretaires} assistant{pdf.nombre_secretaires > 1 ? 's' : ''}
                              </Badge>
                            )}
                          </div>
                          <p className="text-xs text-muted-foreground mt-1">
                            Créé le {format(new Date(pdf.created_at), 'd MMM yyyy à HH:mm', { locale: fr })}
                          </p>
                        </div>

                        <div className="flex gap-1">
                          <Button
                            variant="ghost"
                            size="icon"
                            onClick={() => handleView(pdf.pdf_url)}
                            className="h-8 w-8 hover:bg-teal-500/10 hover:text-teal-600"
                          >
                            <Eye className="h-4 w-4" />
                          </Button>
                          <Button
                            variant="ghost"
                            size="icon"
                            onClick={() => handleDownload(pdf.pdf_url, pdf.file_name)}
                            className="h-8 w-8 hover:bg-teal-500/10 hover:text-teal-600"
                          >
                            <Download className="h-4 w-4" />
                          </Button>
                        </div>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </ScrollArea>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
