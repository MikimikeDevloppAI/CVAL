import { Clock, MapPin, User } from 'lucide-react';
import { cn } from '@/lib/utils';
import { Appointment } from '@/types/medical';

interface AppointmentCardProps {
  appointment: Appointment;
}

const getColorClasses = (color: string) => {
  const colorMap = {
    blue: 'bg-planning-blue/10 border-planning-blue text-planning-blue',
    green: 'bg-planning-green/10 border-planning-green text-planning-green',
    orange: 'bg-planning-orange/10 border-planning-orange text-planning-orange',
    purple: 'bg-planning-purple/10 border-planning-purple text-planning-purple',
    teal: 'bg-planning-teal/10 border-planning-teal text-planning-teal',
  };
  return colorMap[color as keyof typeof colorMap] || colorMap.blue;
};

export const AppointmentCard = ({ appointment }: AppointmentCardProps) => {
  const colorClasses = getColorClasses(appointment.speciality.color);
  
  return (
    <div className={cn(
      'group relative rounded-lg border-l-4 p-3 shadow-soft transition-all duration-200 hover:shadow-medium cursor-pointer',
      'bg-white border-r border-t border-b border-border/50',
      colorClasses.split(' ').filter(c => c.includes('border-')).join(' ')
    )}>
      {/* Status indicator */}
      <div className="absolute top-2 right-2">
        <div className={cn(
          'h-2 w-2 rounded-full',
          appointment.status === 'confirmed' ? 'bg-success' : 
          appointment.status === 'scheduled' ? 'bg-warning' : 'bg-destructive'
        )} />
      </div>

      {/* Title */}
      <h3 className="font-medium text-foreground group-hover:text-primary transition-colors pr-4">
        {appointment.title}
      </h3>

      {/* Time */}
      <div className="mt-2 flex items-center text-sm text-muted-foreground">
        <Clock className="mr-1 h-3 w-3" />
        <span>{appointment.startTime} - {appointment.endTime}</span>
      </div>

      {/* Doctor */}
      {appointment.doctor && (
        <div className="mt-1 flex items-center text-sm text-muted-foreground">
          <User className="mr-1 h-3 w-3" />
          <span>Dr. {appointment.doctor.firstName} {appointment.doctor.lastName}</span>
        </div>
      )}

      {/* Site */}
      <div className="mt-1 flex items-center text-sm text-muted-foreground">
        <MapPin className="mr-1 h-3 w-3" />
        <span>{appointment.site.name}</span>
      </div>

      {/* Speciality badge */}
      <div className="mt-2">
        <span className={cn(
          'inline-flex items-center rounded-md px-2 py-1 text-xs font-medium',
          colorClasses
        )}>
          {appointment.speciality.name}
        </span>
      </div>

      {/* Secretary info */}
      {appointment.secretary && (
        <div className="mt-2 flex items-center">
          <img
            src={appointment.secretary.avatar}
            alt={`${appointment.secretary.firstName} ${appointment.secretary.lastName}`}
            className="h-5 w-5 rounded-full border border-white shadow-sm"
          />
          <span className="ml-2 text-xs text-muted-foreground">
            {appointment.secretary.firstName} {appointment.secretary.lastName}
          </span>
        </div>
      )}
    </div>
  );
};