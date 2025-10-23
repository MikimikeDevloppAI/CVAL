import { useState, useRef, useEffect } from 'react';
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Card } from '@/components/ui/card';
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Send, Loader2, Bot, User, Trash2, HelpCircle, Database } from 'lucide-react';
import { supabase } from '@/integrations/supabase/client';
import { useToast } from '@/hooks/use-toast';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';

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
  const [mode, setMode] = useState<'planning' | 'usage'>('usage');
  const [planningMessages, setPlanningMessages] = useState<Message[]>([]);
  const [usageMessages, setUsageMessages] = useState<Message[]>([]);
  const [input, setInput] = useState('');
  const [isLoading, setIsLoading] = useState(false);
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
        "Combien de secrétaires travaillent au Centre Esplanade vendredi ?"
      ];
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-4xl h-[80vh] flex flex-col p-0">
        <DialogHeader className="px-6 pt-6 pb-4 border-b">
          <div className="flex items-center justify-between mb-4">
            <div className="flex items-center gap-2">
              <Bot className="h-6 w-6 text-primary" />
              <div>
                <DialogTitle>Assistant IA - Planning</DialogTitle>
                <DialogDescription>
                  Posez vos questions sur l'utilisation ou les données
                </DialogDescription>
              </div>
            </div>
            {messages.length > 0 && (
              <Button
                variant="ghost"
                size="icon"
                onClick={handleClearConversation}
                title="Effacer la conversation"
              >
                <Trash2 className="h-4 w-4" />
              </Button>
            )}
          </div>

          <Tabs value={mode} onValueChange={(v) => setMode(v as 'planning' | 'usage')} className="w-full">
            <TabsList className="grid w-full grid-cols-2">
              <TabsTrigger value="usage" className="flex items-center gap-2">
                <HelpCircle className="h-4 w-4" />
                <span className="text-sm">❓ Aide à l'utilisation</span>
              </TabsTrigger>
              <TabsTrigger value="planning" className="flex items-center gap-2">
                <Database className="h-4 w-4" />
                <span className="text-sm">📊 Questions sur le planning</span>
              </TabsTrigger>
            </TabsList>
          </Tabs>

          <div className="text-xs text-muted-foreground px-3 py-2 bg-muted/30 rounded-md mt-3">
            {mode === 'usage' ? (
              <span>💡 Posez vos questions sur comment utiliser l'application, l'algorithme, etc.</span>
            ) : (
              <span>💡 Interrogez les données de votre planning (secrétaires, médecins, opérations, etc.)</span>
            )}
          </div>
        </DialogHeader>

        <ScrollArea className="flex-1 px-6" ref={scrollRef}>
          <div className="space-y-4 py-4">
            {messages.length === 0 && (
              <Card className="p-6 bg-muted/50 border-dashed">
                <p className="text-sm text-muted-foreground text-center mb-3">
                  💬 Commencez la conversation en posant une question
                </p>
                <div className="mt-4 space-y-2 text-xs text-muted-foreground">
                  <p className="font-medium">Exemples de questions :</p>
                  <ul className="list-disc list-inside space-y-1 ml-2">
                    {getExampleQuestions().map((question, i) => (
                      <li key={i}>{question}</li>
                    ))}
                  </ul>
                </div>
              </Card>
            )}

            {messages.map((message, index) => (
              <MessageBubble key={index} message={message} />
            ))}

            {isLoading && (
              <div className="flex items-center gap-2 text-muted-foreground">
                <Loader2 className="h-4 w-4 animate-spin" />
                <span className="text-sm">L'assistant réfléchit...</span>
              </div>
            )}
          </div>
        </ScrollArea>

        <div className="px-6 py-4 border-t bg-background">
          <div className="flex gap-2">
            <Input
              value={input}
              onChange={(e) => setInput(e.target.value)}
              onKeyPress={handleKeyPress}
              placeholder="Posez votre question..."
              disabled={isLoading}
              className="flex-1"
            />
            <Button
              onClick={handleSend}
              disabled={isLoading || !input.trim()}
              size="icon"
            >
              {isLoading ? (
                <Loader2 className="h-4 w-4 animate-spin" />
              ) : (
                <Send className="h-4 w-4" />
              )}
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}

function MessageBubble({ message }: { message: Message }) {
  const isUser = message.role === 'user';

  return (
    <div className={`flex gap-3 ${isUser ? 'justify-end' : 'justify-start'}`}>
      {!isUser && (
        <div className="flex-shrink-0 w-8 h-8 rounded-full bg-primary/10 flex items-center justify-center">
          <Bot className="h-4 w-4 text-primary" />
        </div>
      )}
      
      <div className={`flex flex-col gap-1 max-w-[80%] ${isUser ? 'items-end' : 'items-start'}`}>
        <Card className={`p-3 ${isUser ? 'bg-primary text-primary-foreground' : 'bg-muted'}`}>
          <div className={`text-sm prose prose-sm max-w-none ${isUser ? 'prose-invert' : 'dark:prose-invert'}`}>
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

        <span className="text-xs text-muted-foreground">
          {message.timestamp.toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' })}
        </span>
      </div>

      {isUser && (
        <div className="flex-shrink-0 w-8 h-8 rounded-full bg-primary flex items-center justify-center">
          <User className="h-4 w-4 text-primary-foreground" />
        </div>
      )}
    </div>
  );
}
