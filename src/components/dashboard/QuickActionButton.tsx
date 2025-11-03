import { useNavigate } from 'react-router-dom';
import { Badge } from '@/components/ui/badge';
import { cn } from '@/lib/utils';

interface QuickActionButtonProps {
  label: string;
  icon: React.ReactNode;
  href?: string;
  onClick?: () => void;
  gradient: string;
  count?: number;
  subtitle?: string;
  disabled?: boolean;
}

export const QuickActionButton = ({ label, icon, href, onClick, gradient, count, subtitle, disabled }: QuickActionButtonProps) => {
  const navigate = useNavigate();

  const handleClick = () => {
    if (disabled) return;
    if (onClick) {
      onClick();
    } else if (href) {
      navigate(href);
    }
  };

  return (
    <button
      onClick={handleClick}
      disabled={disabled}
      className={cn(
        "group relative overflow-hidden rounded-xl p-6",
        "bg-card/50 backdrop-blur-xl border border-border/50",
        "shadow-lg hover:shadow-xl",
        "transition-all duration-300 ease-out",
        "focus:outline-none focus:ring-2 focus:ring-primary/50",
        disabled && "opacity-60 cursor-not-allowed hover:shadow-lg"
      )}
    >
      {/* Gradient Background on Hover */}
      <div
        className={cn(
          "absolute inset-0 opacity-0 group-hover:opacity-10",
          "transition-opacity duration-300",
          `bg-gradient-to-br ${gradient}`,
          disabled && "group-hover:opacity-0"
        )}
      />

      <div className="relative flex items-center justify-between">
        <div className="flex items-center gap-4">
          {/* Icon with Gradient */}
          <div
            className={cn(
              "p-3 rounded-lg bg-gradient-to-br shadow-lg",
              "transition-transform duration-300 group-hover:scale-110",
              gradient,
              disabled && "group-hover:scale-100"
            )}
          >
            <div className="text-white">
              {icon}
            </div>
          </div>

          {/* Label */}
          <div className="text-left">
            <p className="text-sm font-medium text-foreground">
              {label}
            </p>
            {subtitle && (
              <p className="text-xs text-muted-foreground italic mt-1">
                {subtitle}
              </p>
            )}
          </div>
        </div>
      </div>
    </button>
  );
};
