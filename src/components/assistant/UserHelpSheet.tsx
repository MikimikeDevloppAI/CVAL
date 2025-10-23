import { useState, useRef, useEffect } from 'react';
import { Sheet, SheetContent, SheetHeader, SheetTitle, SheetDescription } from '@/components/ui/sheet';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Card } from '@/components/ui/card';
import { Send, Loader2, HelpCircle, User, Trash2 } from 'lucide-react';
import { supabase } from '@/integrations/supabase/client';
import { useToast } from '@/hooks/use-toast';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';

interface Message {
  role: 'user' | 'assistant';
  content: string;
  timestamp: Date;
}

interface UserHelpSheetProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

export function UserHelpSheet({ open, onOpenChange }: UserHelpSheetProps) {
  const [messages, setMessages] = useState<Message[]>([]);
  const [input, setInput] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const scrollRef = useRef<HTMLDivElement>(null);
  const { toast } = useToast();

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
      // Envoyer tous les messages pour le contexte complet
      const conversationMessages = [...messages, userMessage].map(m => ({ role: m.role, content: m.content }));

      const { data, error } = await supabase.functions.invoke('ai-assistant-usage', {
        body: { messages: conversationMessages }
      });

      if (error) {
        throw error;
      }

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
    setMessages([]);
    toast({
      title: "Conversation effacée",
      description: "L'historique de la conversation a été supprimé"
    });
  };

  const getExampleQuestions = () => {
    return [
      "Comment créer un horaire de base pour un médecin ?",
      "Comment fonctionne l'algorithme d'optimisation ?",
      "Que se passe-t-il quand je déclare une absence ?",
      "Comment générer un PDF du planning ?"
    ];
  };

  const MessageBubble = ({ message }: { message: Message }) => {
    const isUser = message.role === 'user';
    
    return (
      <div className={`flex gap-3 ${isUser ? 'flex-row-reverse' : 'flex-row'}`}>
        <div className={`flex-shrink-0 h-8 w-8 rounded-full flex items-center justify-center ${
          isUser 
            ? 'bg-primary' 
            : 'bg-gradient-to-br from-emerald-500 to-teal-600'
        }`}>
          {isUser ? (
            <User className="h-4 w-4 text-primary-foreground" />
          ) : (
            <HelpCircle className="h-4 w-4 text-white" />
          )}
        </div>
        
        <div className={`flex-1 space-y-2 ${isUser ? 'items-end' : 'items-start'} flex flex-col`}>
          <div className={`rounded-2xl px-4 py-3 max-w-[85%] ${
            isUser 
              ? 'bg-primary text-primary-foreground ml-auto' 
              : 'bg-muted'
          }`}>
            {isUser ? (
              <p className="text-sm whitespace-pre-wrap">{message.content}</p>
            ) : (
              <div className="text-sm prose prose-sm max-w-none dark:prose-invert">
                <ReactMarkdown remarkPlugins={[remarkGfm]}>
                  {message.content}
                </ReactMarkdown>
              </div>
            )}
          </div>
          <span className="text-xs text-muted-foreground px-2">
            {message.timestamp.toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' })}
          </span>
        </div>
      </div>
    );
  };

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent 
        side="right" 
        className="w-full sm:w-[500px] p-0 flex flex-col bg-gradient-to-br from-background via-background to-emerald-500/5"
        onPointerDownOutside={(e) => e.preventDefault()}
        onInteractOutside={(e) => e.preventDefault()}
      >
        <SheetHeader className="px-6 pt-6 pb-4 border-b">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-3">
              <div className="p-2.5 rounded-xl bg-emerald-500/10 backdrop-blur-sm border border-emerald-500/20">
                <HelpCircle className="h-5 w-5 text-emerald-600" />
              </div>
              <div>
                <SheetTitle className="text-xl font-semibold">Aide utilisateur</SheetTitle>
                <SheetDescription className="text-sm">
                  Obtenez de l'aide sur l'utilisation de l'application
                </SheetDescription>
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
                <Trash2 className="h-4 w-4" />
              </Button>
            )}
          </div>
        </SheetHeader>

        <div className="px-6 pt-4 pb-3">
          <div className="text-xs text-muted-foreground px-4 py-2.5 bg-muted/30 backdrop-blur-sm rounded-lg border border-border/50">
            <span>Posez vos questions sur comment utiliser l'application, l'algorithme, etc.</span>
          </div>
        </div>

        <ScrollArea className="flex-1 px-6 bg-background/50" ref={scrollRef}>
          <div className="space-y-4 py-6">
            {messages.length === 0 && (
              <Card className="p-8 bg-gradient-to-br from-muted/30 to-muted/50 border-dashed border-2 shadow-sm">
                <div className="text-center space-y-4">
                  <div className="inline-flex p-4 rounded-2xl bg-emerald-500/10">
                    <HelpCircle className="h-8 w-8 text-emerald-600" />
                  </div>
                  <p className="text-base font-medium text-foreground">
                    Commencez la conversation en posant une question
                  </p>
                  <div className="mt-6 space-y-3 text-sm text-muted-foreground">
                    <p className="font-semibold text-foreground">Exemples de questions :</p>
                    <div className="grid gap-2">
                      {getExampleQuestions().map((question, i) => (
                        <div key={i} className="flex items-start gap-2 text-left p-3 rounded-lg bg-background/50 border border-border/50">
                          <span className="text-emerald-600 mt-0.5">•</span>
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
                <Loader2 className="h-5 w-5 animate-spin text-emerald-600" />
                <span className="text-sm font-medium">L'assistant réfléchit...</span>
              </div>
            )}
          </div>
        </ScrollArea>

        <div className="border-t bg-background/80 backdrop-blur-sm p-6">
          <div className="flex gap-2">
            <Input
              value={input}
              onChange={(e) => setInput(e.target.value)}
              onKeyPress={handleKeyPress}
              placeholder="Posez votre question..."
              disabled={isLoading}
              className="flex-1 bg-background"
            />
            <Button
              onClick={handleSend}
              disabled={!input.trim() || isLoading}
              size="icon"
              className="shrink-0 bg-gradient-to-r from-emerald-500 to-teal-600 hover:from-emerald-600 hover:to-teal-700 text-white"
            >
              {isLoading ? (
                <Loader2 className="h-4 w-4 animate-spin" />
              ) : (
                <Send className="h-4 w-4" />
              )}
            </Button>
          </div>
        </div>
      </SheetContent>
    </Sheet>
  );
}
