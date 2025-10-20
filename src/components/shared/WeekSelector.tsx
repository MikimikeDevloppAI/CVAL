import { useState, useEffect } from 'react';
import { Calendar, ChevronDown } from 'lucide-react';
import { format, startOfWeek, endOfWeek, addWeeks, subWeeks, isSameWeek } from 'date-fns';
import { fr } from 'date-fns/locale';
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from '@/components/ui/popover';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { ScrollArea } from '@/components/ui/scroll-area';

interface WeekSelectorProps {
  currentDate: Date;
  onWeekChange: (date: Date) => void;
}

export function WeekSelector({ currentDate, onWeekChange }: WeekSelectorProps) {
  const [open, setOpen] = useState(false);
  const [weeks, setWeeks] = useState<Date[]>([]);

  useEffect(() => {
    // Generate 52 weeks starting from current week (1 year forward)
    const weeksList: Date[] = [];
    for (let i = 0; i <= 52; i++) {
      weeksList.push(addWeeks(new Date(), i));
    }
    setWeeks(weeksList);
  }, []);

  const currentWeekStart = startOfWeek(currentDate, { locale: fr, weekStartsOn: 1 });
  const currentWeekEnd = endOfWeek(currentDate, { locale: fr, weekStartsOn: 1 });

  const handleWeekSelect = (weekDate: Date) => {
    onWeekChange(weekDate);
    setOpen(false);
  };

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
              Semaine du {format(currentWeekStart, 'd', { locale: fr })} au{' '}
              {format(currentWeekEnd, 'd MMM yyyy', { locale: fr })}
            </span>
          </div>
          <ChevronDown className="h-4 w-4 opacity-50" />
        </Button>
      </PopoverTrigger>
      <PopoverContent 
        className="w-[320px] p-0 backdrop-blur-xl bg-card/95 border-cyan-200/50 dark:border-cyan-800/50"
        align="center"
      >
        <ScrollArea className="h-[300px]">
          <div className="p-2 space-y-1">
            {weeks.map((weekDate, index) => {
              const weekStart = startOfWeek(weekDate, { locale: fr, weekStartsOn: 1 });
              const weekEnd = endOfWeek(weekDate, { locale: fr, weekStartsOn: 1 });
              const isCurrentWeek = isSameWeek(weekDate, currentDate, { locale: fr, weekStartsOn: 1 });
              const isThisWeek = isSameWeek(weekDate, new Date(), { locale: fr, weekStartsOn: 1 });

              return (
                <button
                  key={index}
                  onClick={() => handleWeekSelect(weekDate)}
                  className={`w-full text-left px-3 py-2 rounded-lg transition-all duration-200 ${
                    isCurrentWeek
                      ? 'bg-cyan-500/20 text-cyan-700 dark:text-cyan-300 font-medium'
                      : 'hover:bg-accent/50'
                  }`}
                >
                  <div className="flex items-center justify-between">
                    <span className="text-sm">
                      Semaine du {format(weekStart, 'd', { locale: fr })} au{' '}
                      {format(weekEnd, 'd MMM yyyy', { locale: fr })}
                    </span>
                    {isThisWeek && (
                      <Badge variant="outline" className="ml-2 text-xs bg-primary/10 text-primary border-primary/20">
                        Actuelle
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
