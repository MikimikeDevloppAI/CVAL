import { useEffect, useState } from 'react';
import { cn } from '@/lib/utils';

interface StatsCardProps {
  icon: React.ReactNode;
  value: number;
  label: string;
  gradient: string;
}

export const StatsCard = ({ icon, value, label, gradient }: StatsCardProps) => {
  const [displayValue, setDisplayValue] = useState(0);

  // Counter animation
  useEffect(() => {
    let start = 0;
    const duration = 1000;
    const increment = value / (duration / 16);
    
    const timer = setInterval(() => {
      start += increment;
      if (start >= value) {
        setDisplayValue(value);
        clearInterval(timer);
      } else {
        setDisplayValue(Math.floor(start));
      }
    }, 16);

    return () => clearInterval(timer);
  }, [value]);

  return (
    <div
      className={cn(
        "relative overflow-hidden rounded-xl p-6",
        "bg-card/50 backdrop-blur-xl border border-border/50",
        "shadow-lg hover:shadow-xl",
        "transition-all duration-300 ease-out",
        "hover:-translate-y-1"
      )}
    >
      {/* Gradient Glow */}
      <div
        className={cn(
          "absolute -top-10 -right-10 w-32 h-32 rounded-full blur-3xl opacity-20",
          `bg-gradient-to-br ${gradient}`
        )}
      />

      <div className="relative flex items-center justify-between">
        <div>
          <p className="text-sm font-medium text-muted-foreground mb-2">
            {label}
          </p>
          <p
            className={cn(
              "text-4xl font-bold bg-gradient-to-r bg-clip-text text-transparent",
              gradient
            )}
          >
            {displayValue}
          </p>
        </div>

        {/* Icon */}
        <div
          className={cn(
            "p-3 rounded-lg bg-gradient-to-br shadow-lg",
            gradient
          )}
        >
          <div className="text-white">
            {icon}
          </div>
        </div>
      </div>
    </div>
  );
};
