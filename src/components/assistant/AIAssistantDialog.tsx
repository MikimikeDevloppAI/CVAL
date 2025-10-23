import { useState, useRef, useEffect } from 'react';
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Card } from '@/components/ui/card';
import { Send, Loader2, Bot, User, Trash2 } from 'lucide-react';
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
      // Appeler l'edge function avec les 3 derniers messages
      const conversationMessages = [...messages, userMessage].slice(-3).map(m => ({
        role: m.role,
        content: m.content
      }));

      // Appeler l'edge function
      const { data, error } = await supabase.functions.invoke('ai-assistant-chat', {
        body: { messages: conversationMessages }
      });

      if (error) {
        throw error;
      }

      // Créer le message assistant avec la réponse
      const assistantMessage: Message = {
        role: 'assistant',
        content: data.content || "Désolé, je n'ai pas pu générer de réponse.",
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
    setMessages([]);
    toast({
      title: "Conversation effacée",
      description: "L'historique de la conversation a été supprimé"
    });
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-4xl h-[80vh] flex flex-col p-0">
        <DialogHeader className="px-6 pt-6 pb-4 border-b">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <Bot className="h-6 w-6 text-primary" />
              <div>
                <DialogTitle>Assistant IA - Planning</DialogTitle>
                <DialogDescription>
                  Posez des questions sur les absences, les affectations et les horaires
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
        </DialogHeader>

        <ScrollArea className="flex-1 px-6" ref={scrollRef}>
          <div className="space-y-4 py-4">
            {messages.length === 0 && (
              <Card className="p-6 bg-muted/50 border-dashed">
                <p className="text-sm text-muted-foreground text-center">
                  💬 Commencez la conversation en posant une question
                </p>
                <div className="mt-4 space-y-2 text-xs text-muted-foreground">
                  <p className="font-medium">Exemples de questions :</p>
                  <ul className="list-disc list-inside space-y-1 ml-2">
                    <li>Qui est en congé cette semaine ?</li>
                    <li>Où travaille Marie Dupont demain ?</li>
                    <li>Quels sont les jours fériés en octobre ?</li>
                    <li>Combien de secrétaires travaillent au Centre Esplanade vendredi ?</li>
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
