import { useState, useRef, useEffect } from 'react';
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Card } from '@/components/ui/card';
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Send, Loader2, BotMessageSquare, User, Trash2, HelpCircle, Database } from 'lucide-react';
import { supabase } from '@/integrations/supabase/client';
import { useToast } from '@/hooks/use-toast';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import { ConfirmActionDialog } from './ConfirmActionDialog';

interface Message {
  role: 'user' | 'assistant';
  content: string;
  timestamp: Date;
}

interface AIAssistantDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

export function AIAssistantDialog({ open, onOpenChange }: AIAssistantDialogProps) {
  const [mode, setMode] = useState<'planning' | 'usage'>('planning');
  const [planningMessages, setPlanningMessages] = useState<Message[]>([]);
  const [usageMessages, setUsageMessages] = useState<Message[]>([]);
  const [input, setInput] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const [pendingAction, setPendingAction] = useState<any>(null);
  const [isConfirmDialogOpen, setIsConfirmDialogOpen] = useState(false);
  const [isCreating, setIsCreating] = useState(false);
  const scrollRef = useRef<HTMLDivElement>(null);
  const { toast } = useToast();

  const messages = mode === 'planning' ? planningMessages : usageMessages;
  const setMessages = mode === 'planning' ? setPlanningMessages : setUsageMessages;

  // Auto-scroll vers le bas quand de nouveaux messages arrivent
  useEffect(() => {
    if (scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }
  }, [messages]);

  const handleSend = async () => {
    if (!input.trim() || isLoading) return;

    const userMessage: Message = {
      role: 'user',
      content: input.trim(),
      timestamp: new Date()
    };

    setMessages(prev => [...prev, userMessage]);
    setInput('');
    setIsLoading(true);

    try {
      const functionName = mode === 'planning' ? 'ai-assistant-chat' : 'ai-assistant-usage';
      
      // Pour le mode planning, envoyer les 3 derniers messages
      // Pour le mode usage, envoyer tous les messages (contexte complet nécessaire)
      const conversationMessages = mode === 'planning' 
        ? [...messages, userMessage].slice(-3).map(m => ({ role: m.role, content: m.content }))
        : [...messages, userMessage].map(m => ({ role: m.role, content: m.content }));

      // Appeler l'edge function appropriée
      const { data, error } = await supabase.functions.invoke(functionName, {
        body: { messages: conversationMessages }
      });

      if (error) {
        throw error;
      }

      // Créer le message assistant avec la réponse
      const assistantMessage: Message = {
        role: 'assistant',
        content: data.message || data.content || "Désolé, je n'ai pas pu générer de réponse.",
        timestamp: new Date()
      };
      
      setMessages(prev => [...prev, assistantMessage]);

      // Vérifier s'il y a une action en attente
      if (data.pendingAction) {
        console.log('Action en attente détectée:', data.pendingAction);
        setPendingAction(data.pendingAction);
        setIsConfirmDialogOpen(true);
      }

    } catch (error: any) {
      console.error('Erreur:', error);
      toast({
        title: "Erreur",
        description: error.message || "Impossible de communiquer avec l'assistant",
        variant: "destructive"
      });

      // Message d'erreur pour l'utilisateur
      const errorMessage: Message = {
        role: 'assistant',
        content: "Désolé, une erreur s'est produite. Veuillez réessayer.",
        timestamp: new Date()
      };
      setMessages(prev => [...prev, errorMessage]);
    } finally {
      setIsLoading(false);
    }
  };

  const handleKeyPress = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      handleSend();
    }
  };

  const handleClearConversation = () => {
    if (mode === 'planning') {
      setPlanningMessages([]);
    } else {
      setUsageMessages([]);
    }
    toast({
      title: "Conversation effacée",
      description: "L'historique de la conversation a été supprimé"
    });
  };

  const handleConfirmAction = async () => {
    if (!pendingAction) return;

    setIsCreating(true);
    try {
      if (pendingAction.type === 'absence') {
        const { error } = await supabase
          .from('absences')
          .insert({
            [`${pendingAction.data.person_type}_id`]: pendingAction.data.person_id,
            type_personne: pendingAction.data.person_type,
            type: pendingAction.data.type,
            date_debut: pendingAction.data.date_debut,
            date_fin: pendingAction.data.date_fin,
            demi_journee: pendingAction.data.demi_journee,
            motif: pendingAction.data.motif,
            statut: 'en_attente'
          });

        if (error) throw error;

        toast({
          title: "Absence créée",
          description: `L'absence pour ${pendingAction.data.person_name} a été créée avec succès.`
        });

        // Ajouter un message de confirmation dans le chat
        const confirmMessage: Message = {
          role: 'assistant',
          content: `✅ L'absence a été créée avec succès pour ${pendingAction.data.person_name}.`,
          timestamp: new Date()
        };
        setMessages(prev => [...prev, confirmMessage]);

      } else if (pendingAction.type === 'absence_batch') {
        // Créer une ligne par date
        const rows = pendingAction.data.dates.map((date: string) => ({
          [`${pendingAction.data.person_type}_id`]: pendingAction.data.person_id,
          type_personne: pendingAction.data.person_type,
          type: pendingAction.data.type,
          date_debut: date,
          date_fin: date,
          demi_journee: pendingAction.data.demi_journee,
          motif: pendingAction.data.motif,
          statut: 'en_attente'
        }));

        const { error } = await supabase
          .from('absences')
          .insert(rows);

        if (error) throw error;

        const firstDate = new Date(pendingAction.data.dates[0]).toLocaleDateString('fr-FR');
        const lastDate = new Date(pendingAction.data.dates[pendingAction.data.dates.length - 1]).toLocaleDateString('fr-FR');

        toast({
          title: "Absences créées",
          description: `${pendingAction.data.dates.length} absences créées du ${firstDate} au ${lastDate} pour ${pendingAction.data.person_name}.`
        });

        // Ajouter un message de confirmation dans le chat
        const confirmMessage: Message = {
          role: 'assistant',
          content: `✅ ${pendingAction.data.dates.length} absences ont été créées du ${firstDate} au ${lastDate} pour ${pendingAction.data.person_name}.`,
          timestamp: new Date()
        };
        setMessages(prev => [...prev, confirmMessage]);

      } else if (pendingAction.type === 'creneau_medecin') {
        // Créer un besoin effectif pour un médecin sur un site
        const { error } = await supabase
          .from('besoin_effectif')
          .insert({
            medecin_id: pendingAction.data.medecin_id,
            site_id: pendingAction.data.site_id,
            date: pendingAction.data.date,
            demi_journee: pendingAction.data.demi_journee,
            type: 'medecin',
            type_intervention_id: pendingAction.data.type_intervention_id,
            actif: true
          });

        if (error) throw error;

        const dateFormatted = new Date(pendingAction.data.date).toLocaleDateString('fr-FR');
        
        toast({
          title: "Créneau créé",
          description: `Créneau créé pour ${pendingAction.data.medecin_name} au ${pendingAction.data.site_name} le ${dateFormatted}.`
        });

        const confirmMessage: Message = {
          role: 'assistant',
          content: `✅ Le créneau a été créé pour ${pendingAction.data.medecin_name} au ${pendingAction.data.site_name} le ${dateFormatted}.`,
          timestamp: new Date()
        };
        setMessages(prev => [...prev, confirmMessage]);

      } else if (pendingAction.type === 'operation') {
        // Créer un besoin effectif pour une opération au bloc opératoire
        
        // 1. Vérifier s'il existe déjà un besoin effectif pour ce médecin/date/période
        const { data: existingBesoin, error: checkError } = await supabase
          .from('besoin_effectif')
          .select('id')
          .eq('medecin_id', pendingAction.data.medecin_id)
          .eq('date', pendingAction.data.date)
          .eq('demi_journee', pendingAction.data.periode)
          .maybeSingle();

        if (checkError) throw checkError;

        // 2. Si existe, le supprimer d'abord
        if (existingBesoin) {
          const { error: deleteError } = await supabase
            .from('besoin_effectif')
            .delete()
            .eq('id', existingBesoin.id);

          if (deleteError) throw deleteError;
        }

        // 3. Créer le nouveau besoin effectif (site_id vient du backend)
        const { error: insertError } = await supabase
          .from('besoin_effectif')
          .insert({
            medecin_id: pendingAction.data.medecin_id,
            type_intervention_id: pendingAction.data.type_intervention_id,
            date: pendingAction.data.date,
            demi_journee: pendingAction.data.periode,
            site_id: pendingAction.data.site_id,
            type: 'medecin',
            actif: true
          });

        if (insertError) throw insertError;

        const dateFormatted = new Date(pendingAction.data.date).toLocaleDateString('fr-FR');
        
        toast({
          title: "Opération créée",
          description: `Opération ${pendingAction.data.type_intervention_name} créée pour ${pendingAction.data.medecin_name} le ${dateFormatted}.`
        });

        const confirmMessage: Message = {
          role: 'assistant',
          content: `✅ L'opération ${pendingAction.data.type_intervention_name} a été créée pour ${pendingAction.data.medecin_name} le ${dateFormatted}.`,
          timestamp: new Date()
        };
        setMessages(prev => [...prev, confirmMessage]);

      } else if (pendingAction.type === 'jour_ferie') {
        const { error } = await supabase
          .from('jours_feries')
          .insert({
            date: pendingAction.data.date,
            nom: pendingAction.data.nom,
            actif: true
          });

        if (error) throw error;

        toast({
          title: "Jour férié créé",
          description: `Le jour férié "${pendingAction.data.nom}" a été créé avec succès.`
        });

        // Ajouter un message de confirmation dans le chat
        const confirmMessage: Message = {
          role: 'assistant',
          content: `✅ Le jour férié "${pendingAction.data.nom}" a été créé avec succès.`,
          timestamp: new Date()
        };
        setMessages(prev => [...prev, confirmMessage]);
      }

      setIsConfirmDialogOpen(false);
      setPendingAction(null);

    } catch (error: any) {
      console.error('Erreur lors de la création:', error);
      toast({
        title: "Erreur",
        description: error.message || "Impossible de créer l'élément",
        variant: "destructive"
      });
    } finally {
      setIsCreating(false);
    }
  };

  const handleCancelAction = () => {
    setIsConfirmDialogOpen(false);
    setPendingAction(null);

    // Ajouter un message d'annulation dans le chat
    const cancelMessage: Message = {
      role: 'assistant',
      content: "Action annulée. N'hésitez pas si vous avez besoin d'autre chose.",
      timestamp: new Date()
    };
    setMessages(prev => [...prev, cancelMessage]);
  };

  const getExampleQuestions = () => {
    if (mode === 'usage') {
      return [
        "Comment créer un horaire de base pour un médecin ?",
        "Comment fonctionne l'algorithme d'optimisation ?",
        "Que se passe-t-il quand je déclare une absence ?",
        "Comment générer un PDF du planning ?"
      ];
    } else {
      return [
        "Qui est en congé cette semaine ?",
        "Où travaille Marie Dupont demain ?",
        "Quels sont les jours fériés en octobre ?",
        "Combien d'assistants médicaux travaillent au Centre Esplanade vendredi ?"
      ];
    }
  };

  return (
    <>
      <Dialog open={open} onOpenChange={onOpenChange}>
        <DialogContent className="max-w-5xl h-[85vh] flex flex-col p-0 gap-0 bg-gradient-to-br from-background via-background to-primary/5">
        <DialogHeader className="px-6 pt-6 pb-0 border-b-0">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-3">
              <div className="p-2.5 rounded-xl bg-primary/10 backdrop-blur-sm border border-primary/20">
                <BotMessageSquare className="h-5 w-5 text-primary" />
              </div>
              <div>
                <DialogTitle className="text-xl font-semibold">ValléeBot</DialogTitle>
                <DialogDescription className="text-sm">
                  Votre assistant intelligent pour la Clinique La Vallée
                </DialogDescription>
              </div>
            </div>
            {messages.length > 0 && (
              <Button
                variant="ghost"
                size="sm"
                onClick={handleClearConversation}
                className="hover:bg-destructive/10 hover:text-destructive transition-colors"
                title="Effacer la conversation"
              >
                <Trash2 className="h-4 w-4 mr-2" />
                Effacer
              </Button>
            )}
          </div>
        </DialogHeader>

        <div className="px-6 pt-4 pb-3 space-y-3">
          <Tabs value={mode} onValueChange={(v) => setMode(v as 'planning' | 'usage')} className="w-full">
            <TabsList className="grid w-full grid-cols-2 h-11 bg-muted/50 p-1 rounded-xl">
              <TabsTrigger 
                value="planning" 
                className="flex items-center gap-2 rounded-lg data-[state=active]:bg-background data-[state=active]:shadow-sm transition-all"
              >
                <Database className="h-4 w-4" />
                <span className="font-medium">Questions sur le planning</span>
              </TabsTrigger>
              <TabsTrigger 
                value="usage" 
                className="flex items-center gap-2 rounded-lg data-[state=active]:bg-background data-[state=active]:shadow-sm transition-all"
              >
                <HelpCircle className="h-4 w-4" />
                <span className="font-medium">Aide à l'utilisation</span>
              </TabsTrigger>
            </TabsList>
          </Tabs>

          <div className="text-xs text-muted-foreground px-4 py-2.5 bg-muted/30 backdrop-blur-sm rounded-lg border border-border/50">
            {mode === 'usage' ? (
              <span>Posez vos questions sur comment utiliser l'application, l'algorithme, etc.</span>
            ) : (
              <span>Interrogez les données de votre planning (assistants médicaux, médecins, opérations, etc.)</span>
            )}
          </div>
        </div>

        <ScrollArea className="flex-1 px-6 bg-background/50" ref={scrollRef}>
          <div className="space-y-4 py-6">
            {messages.length === 0 && (
              <Card className="p-8 bg-gradient-to-br from-muted/30 to-muted/50 border-dashed border-2 shadow-sm">
                <div className="text-center space-y-4">
                  <div className="inline-flex p-4 rounded-2xl bg-primary/10">
                    <BotMessageSquare className="h-8 w-8 text-primary" />
                  </div>
                  <p className="text-base font-medium text-foreground">
                    Commencez la conversation en posant une question
                  </p>
                  <div className="mt-6 space-y-3 text-sm text-muted-foreground">
                    <p className="font-semibold text-foreground">Exemples de questions :</p>
                    <div className="grid gap-2">
                      {getExampleQuestions().map((question, i) => (
                        <div key={i} className="flex items-start gap-2 text-left p-3 rounded-lg bg-background/50 border border-border/50">
                          <span className="text-primary mt-0.5">•</span>
                          <span>{question}</span>
                        </div>
                      ))}
                    </div>
                  </div>
                </div>
              </Card>
            )}

            {messages.map((message, index) => (
              <MessageBubble key={index} message={message} />
            ))}

            {isLoading && (
              <div className="flex items-center gap-3 text-muted-foreground p-4 bg-muted/30 rounded-xl border border-border/50">
                <Loader2 className="h-5 w-5 animate-spin text-primary" />
                <span className="text-sm font-medium">L'assistant réfléchit...</span>
              </div>
            )}
          </div>
        </ScrollArea>

        <div className="px-6 py-4 border-t bg-background/80 backdrop-blur-sm">
          <div className="flex gap-3">
            <Input
              value={input}
              onChange={(e) => setInput(e.target.value)}
              onKeyPress={handleKeyPress}
              placeholder="Posez votre question..."
              disabled={isLoading}
              className="flex-1 h-11 bg-background border-border/50 focus-visible:ring-primary/20"
            />
            <Button
              onClick={handleSend}
              disabled={isLoading || !input.trim()}
              size="lg"
              className="px-5 h-11 shadow-sm"
            >
              {isLoading ? (
                <Loader2 className="h-4 w-4 animate-spin" />
              ) : (
                <>
                  <Send className="h-4 w-4 mr-2" />
                  <span className="hidden sm:inline">Envoyer</span>
                </>
              )}
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>

    <ConfirmActionDialog
      open={isConfirmDialogOpen}
      onOpenChange={setIsConfirmDialogOpen}
      action={pendingAction}
      onConfirm={handleConfirmAction}
      isLoading={isCreating}
    />
    </>
  );
}

function MessageBubble({ message }: { message: Message }) {
  const isUser = message.role === 'user';

  return (
    <div className={`flex gap-3 ${isUser ? 'justify-end' : 'justify-start'} animate-in fade-in slide-in-from-bottom-2 duration-300`}>
      {!isUser && (
        <div className="flex-shrink-0 w-9 h-9 rounded-xl bg-gradient-to-br from-primary/10 to-primary/5 border border-primary/20 flex items-center justify-center shadow-sm">
          <BotMessageSquare className="h-4 w-4 text-primary" />
        </div>
      )}
      
      <div className={`flex flex-col gap-1.5 max-w-[75%] ${isUser ? 'items-end' : 'items-start'}`}>
        <Card className={`p-4 shadow-sm border transition-all ${
          isUser 
            ? 'bg-white text-foreground border-border/50' 
            : 'bg-white border-border/50'
        }`}>
          <div className={`text-sm prose prose-sm max-w-none leading-relaxed ${isUser ? 'prose-invert' : 'dark:prose-invert'}`}>
            <ReactMarkdown
              remarkPlugins={[remarkGfm]}
              components={{
                table: ({ node, ...props }) => (
                  <table className="w-full border-collapse border border-border my-2" {...props} />
                ),
                thead: ({ node, ...props }) => (
                  <thead className="bg-muted/50" {...props} />
                ),
                th: ({ node, ...props }) => (
                  <th className="border border-border px-3 py-2 text-left font-medium" {...props} />
                ),
                td: ({ node, ...props }) => (
                  <td className="border border-border px-3 py-2" {...props} />
                ),
                p: ({ node, ...props }) => (
                  <p className="mb-2 last:mb-0" {...props} />
                ),
                ul: ({ node, ...props }) => (
                  <ul className="list-disc list-inside my-2" {...props} />
                ),
                ol: ({ node, ...props }) => (
                  <ol className="list-decimal list-inside my-2" {...props} />
                ),
              }}
            >
              {message.content}
            </ReactMarkdown>
          </div>
        </Card>

        <span className="text-xs text-muted-foreground font-medium px-1">
          {message.timestamp.toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' })}
        </span>
      </div>

      {isUser && (
        <div className="flex-shrink-0 w-9 h-9 rounded-xl bg-gradient-to-br from-primary to-primary/80 flex items-center justify-center shadow-sm">
          <User className="h-4 w-4 text-primary-foreground" />
        </div>
      )}
    </div>
  );
}
