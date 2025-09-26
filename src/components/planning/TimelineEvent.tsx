import { Clock, MapPin } from 'lucide-react';
import { cn } from '@/lib/utils';
import { Appointment } from '@/types/medical';

interface TimelineEventProps {
  appointment: Appointment;
}

const getEventColor = (color: string) => {
  const colorMap = {
    blue: 'border-l-planning-blue bg-planning-blue/5',
    green: 'border-l-planning-green bg-planning-green/5', 
    orange: 'border-l-planning-orange bg-planning-orange/5',
    purple: 'border-l-planning-purple bg-planning-purple/5',
    teal: 'border-l-planning-teal bg-planning-teal/5',
  };
  return colorMap[color as keyof typeof colorMap] || colorMap.blue;
};

export const TimelineEvent = ({ appointment }: TimelineEventProps) => {
  const eventColor = getEventColor(appointment.speciality.color);
  
  return (
    <div className={cn(
      'border-l-4 rounded-r-md p-3 transition-all hover:shadow-soft cursor-pointer',
      eventColor
    )}>
      {/* Event title */}
      <h3 className="font-medium text-sm text-foreground mb-2 leading-tight">
        {appointment.title}
      </h3>
      
      {/* Time range */}
      <div className="flex items-center text-xs text-muted-foreground mb-2">
        <Clock className="h-3 w-3 mr-1" />
        <span>{appointment.startTime} - {appointment.endTime}</span>
      </div>

      {/* Location */}
      <div className="flex items-center text-xs text-muted-foreground mb-3">
        <MapPin className="h-3 w-3 mr-1" />
        <span>{appointment.site.name}</span>
      </div>

      {/* Doctor and duration */}
      <div className="flex items-center justify-between">
        <div className="flex items-center space-x-2">
          {appointment.doctor && (
            <img
              src={appointment.doctor.avatar}
              alt={`Dr. ${appointment.doctor.firstName} ${appointment.doctor.lastName}`}
              className="h-5 w-5 rounded-full object-cover"
            />
          )}
          {appointment.secretary && (
            <img
              src={appointment.secretary.avatar}
              alt={`${appointment.secretary.firstName} ${appointment.secretary.lastName}`}
              className="h-5 w-5 rounded-full object-cover"
            />
          )}
        </div>
        
        <div className="flex items-center space-x-2">
          <span className="text-xs text-muted-foreground">
            {/* Calculate duration */}
            2 hours
          </span>
          <div className="flex space-x-0.5">
            <div className="h-1 w-1 bg-muted-foreground rounded-full"></div>
            <div className="h-1 w-1 bg-muted-foreground rounded-full"></div>
            <div className="h-1 w-1 bg-muted-foreground rounded-full"></div>
          </div>
        </div>
      </div>
    </div>
  );
};