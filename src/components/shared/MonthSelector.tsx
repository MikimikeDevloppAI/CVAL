import { useState, useEffect, useRef } from 'react';
import { Calendar, ChevronDown } from 'lucide-react';
import { format, startOfMonth, endOfMonth, addMonths, subMonths, isSameMonth } from 'date-fns';
import { fr } from 'date-fns/locale';
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from '@/components/ui/popover';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { ScrollArea } from '@/components/ui/scroll-area';

interface MonthSelectorProps {
  currentDate: Date;
  onMonthChange: (date: Date) => void;
}

export function MonthSelector({ currentDate, onMonthChange }: MonthSelectorProps) {
  const [open, setOpen] = useState(false);
  const [months, setMonths] = useState<Date[]>([]);
  const scrollAreaRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    // Generate 12 past months + current month + 12 future months
    const monthsList: Date[] = [];
    const today = new Date();
    
    for (let i = -12; i <= 12; i++) {
      monthsList.push(addMonths(today, i));
    }
    
    setMonths(monthsList);
  }, []);

  const handleMonthSelect = (monthDate: Date) => {
    onMonthChange(monthDate);
    setOpen(false);
  };

  // Auto-scroll to selected month when dropdown opens
  useEffect(() => {
    if (open && scrollAreaRef.current && months.length > 0) {
      const currentMonthIndex = months.findIndex(m => 
        isSameMonth(m, currentDate)
      );
      
      if (currentMonthIndex !== -1) {
        const itemHeight = 44;
        const scrollPosition = currentMonthIndex * itemHeight;
        
        setTimeout(() => {
          if (scrollAreaRef.current) {
            const viewport = scrollAreaRef.current.querySelector('[data-radix-scroll-area-viewport]');
            if (viewport) {
              viewport.scrollTop = Math.max(0, scrollPosition - 100);
            }
          }
        }, 0);
      }
    }
  }, [open, months, currentDate]);

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button
          variant="outline"
          className="min-w-[280px] justify-between backdrop-blur-xl bg-card/95 border-cyan-200/50 dark:border-cyan-800/50 hover:border-cyan-400/70 dark:hover:border-cyan-600/70 hover:shadow-lg hover:shadow-cyan-500/10 transition-all duration-300"
        >
          <div className="flex items-center gap-2">
            <Calendar className="h-4 w-4 text-cyan-600 dark:text-cyan-400" />
            <span className="font-medium">
              {format(currentDate, 'MMMM yyyy', { locale: fr })}
            </span>
          </div>
          <ChevronDown className="h-4 w-4 opacity-50" />
        </Button>
      </PopoverTrigger>
      <PopoverContent 
        className="w-[320px] p-0 backdrop-blur-xl bg-card/95 border-cyan-200/50 dark:border-cyan-800/50"
        align="center"
      >
        <ScrollArea className="h-[300px]" ref={scrollAreaRef}>
          <div className="p-2 space-y-1">
            {months.map((monthDate, index) => {
              const isCurrentMonth = isSameMonth(monthDate, currentDate);
              const isThisMonth = isSameMonth(monthDate, new Date());

              return (
                <button
                  key={index}
                  onClick={() => handleMonthSelect(monthDate)}
                  className={`w-full text-left px-3 py-2 rounded-lg transition-all duration-200 ${
                    isCurrentMonth
                      ? 'bg-cyan-500/20 text-cyan-700 dark:text-cyan-300 font-medium'
                      : 'hover:bg-accent/50'
                  }`}
                >
                  <div className="flex items-center justify-between">
                    <span className="text-sm">
                      {format(monthDate, 'MMMM yyyy', { locale: fr })}
                    </span>
                    {isThisMonth && (
                      <Badge variant="outline" className="ml-2 text-xs bg-primary/10 text-primary border-primary/20">
                        Actuel
                      </Badge>
                    )}
                  </div>
                </button>
              );
            })}
          </div>
        </ScrollArea>
      </PopoverContent>
    </Popover>
  );
}
