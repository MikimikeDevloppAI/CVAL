import { getCurrentWeekDays, appointments } from '@/data/mockData';
import { TimelineEvent } from './TimelineEvent';
import { Button } from '@/components/ui/button';
import { ChevronLeft, ChevronRight, Calendar, Filter } from 'lucide-react';
import { cn } from '@/lib/utils';

const tabs = [
  { id: 'planning', name: 'Planning', current: true },
  { id: 'event-types', name: 'Event types', current: false },
  { id: 'statistics', name: 'Statistics', current: false },
];

export const TimelineView = () => {
  const weekDays = getCurrentWeekDays();
  
  // Group appointments by date
  const appointmentsByDate = appointments.reduce((acc, appointment) => {
    if (!acc[appointment.date]) {
      acc[appointment.date] = [];
    }
    acc[appointment.date].push(appointment);
    return acc;
  }, {} as Record<string, typeof appointments>);

  return (
    <div className="flex flex-1 flex-col bg-background">
      {/* Tabs */}
      <div className="bg-white px-6 pt-4">
        <nav className="flex space-x-8">
          {tabs.map((tab) => (
            <button
              key={tab.id}
              className={cn(
                'pb-3 text-sm font-medium transition-colors border-b-2',
                tab.current
                  ? 'text-primary border-primary'
                  : 'text-muted-foreground border-transparent hover:text-foreground'
              )}
            >
              {tab.name}
            </button>
          ))}
        </nav>
      </div>

      {/* Date navigation */}
      <div className="flex items-center justify-between bg-white px-6 py-4 border-b border-border">
        <div className="flex items-center space-x-4">
          <div className="flex items-center space-x-1">
            <Button variant="ghost" size="sm" className="h-8 w-8 p-0">
              <ChevronLeft className="h-4 w-4" />
            </Button>
            <span className="text-sm text-muted-foreground px-2">22 - 28 July 2020</span>
            <Button variant="ghost" size="sm" className="h-8 w-8 p-0">
              <ChevronRight className="h-4 w-4" />
            </Button>
          </div>
          <Button variant="ghost" size="sm" className="h-8 w-8 p-0">
            <Calendar className="h-4 w-4" />
          </Button>
        </div>
        
        <Button variant="outline" size="sm" className="gap-2 text-xs">
          <Filter className="h-3 w-3" />
          Filter
        </Button>
      </div>

      {/* Timeline content */}
      <div className="flex-1 bg-white">
        <div className="grid grid-cols-4 gap-0">
          {weekDays.slice(0, 3).map((day) => (
            <div key={day.date} className="border-r border-border last:border-r-0">
              {/* Day header */}
              <div className="px-4 py-3 border-b border-border">
                <div className="text-xs font-medium text-muted-foreground uppercase">
                  {day.dayName}
                </div>
                <div className="text-2xl font-light text-foreground mt-1">
                  {day.dayNumber}
                </div>
              </div>

              {/* Events for this day */}
              <div className="p-4 space-y-3">
                {appointmentsByDate[day.date]?.map((appointment) => (
                  <TimelineEvent key={appointment.id} appointment={appointment} />
                ))}
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
};