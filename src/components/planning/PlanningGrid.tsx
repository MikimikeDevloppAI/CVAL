import { getCurrentWeekDays, appointments } from '@/data/mockData';
import { AppointmentCard } from './AppointmentCard';
import { Button } from '@/components/ui/button';
import { ChevronLeft, ChevronRight, Plus, RefreshCw } from 'lucide-react';
import { cn } from '@/lib/utils';

const tabs = [
  { id: 'planning', name: 'Planning', current: true },
  { id: 'event-types', name: 'Types d\'événements', current: false },
  { id: 'statistics', name: 'Statistiques', current: false },
];

const timeSlots = [
  '08:00', '09:00', '10:00', '11:00', '12:00', 
  '13:00', '14:00', '15:00', '16:00', '17:00', '18:00'
];

export const PlanningGrid = () => {
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
      <div className="border-b border-border bg-white px-6">
        <div className="flex items-center justify-between">
          <nav className="flex space-x-8">
            {tabs.map((tab) => (
              <button
                key={tab.id}
                className={cn(
                  'relative py-4 px-1 text-sm font-medium transition-colors',
                  tab.current
                    ? 'text-primary'
                    : 'text-muted-foreground hover:text-foreground'
                )}
              >
                {tab.name}
                {tab.current && (
                  <div className="absolute bottom-0 left-0 right-0 h-0.5 bg-primary rounded-full" />
                )}
              </button>
            ))}
          </nav>
          
          <div className="flex items-center space-x-3">
            <Button variant="outline" size="sm" className="gap-2">
              <RefreshCw className="h-4 w-4" />
              Recalculer
            </Button>
            <Button size="sm" className="gap-2">
              <Plus className="h-4 w-4" />
              Nouveau rendez-vous
            </Button>
          </div>
        </div>
      </div>

      {/* Week navigation */}
      <div className="flex items-center justify-between border-b border-border bg-white px-6 py-4">
        <div className="flex items-center space-x-4">
          <Button variant="outline" size="sm">
            <ChevronLeft className="h-4 w-4" />
          </Button>
          <h2 className="text-lg font-semibold text-foreground">
            23 - 27 Septembre 2024
          </h2>
          <Button variant="outline" size="sm">
            <ChevronRight className="h-4 w-4" />
          </Button>
        </div>
        
        <Button variant="outline" size="sm">
          Aujourd'hui
        </Button>
      </div>

      {/* Planning grid */}
      <div className="flex-1 overflow-auto">
        <div className="grid grid-cols-6 gap-0 min-h-full">
          {/* Time column */}
          <div className="border-r border-border bg-muted/30">
            <div className="h-16 border-b border-border flex items-center justify-center bg-white">
              <span className="text-sm font-medium text-muted-foreground">Heure</span>
            </div>
            {timeSlots.map((time) => (
              <div key={time} className="h-20 border-b border-border flex items-center justify-center">
                <span className="text-sm text-muted-foreground">{time}</span>
              </div>
            ))}
          </div>

          {/* Day columns */}
          {weekDays.map((day, dayIndex) => (
            <div key={day.date} className="border-r border-border last:border-r-0">
              {/* Day header */}
              <div className="h-16 border-b border-border bg-white px-4 flex flex-col justify-center">
                <div className="text-xs font-medium text-muted-foreground">
                  {day.dayName}
                </div>
                <div className="text-lg font-semibold text-foreground">
                  {day.dayNumber}
                </div>
              </div>

              {/* Time slots */}
              {timeSlots.map((time, timeIndex) => (
                <div 
                  key={`${day.date}-${time}`}
                  className="h-20 border-b border-border bg-white hover:bg-accent/50 transition-colors relative group"
                >
                  {/* Show appointments for this day and time */}
                  <div className="p-2 space-y-1">
                    {appointmentsByDate[day.date]?.map((appointment) => (
                      <AppointmentCard key={appointment.id} appointment={appointment} />
                    ))}
                  </div>
                  
                  {/* Add button on hover */}
                  <button className="absolute inset-0 flex items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity bg-primary/5 text-primary hover:bg-primary/10">
                    <Plus className="h-5 w-5" />
                  </button>
                </div>
              ))}
            </div>
          ))}
        </div>
      </div>
    </div>
  );
};