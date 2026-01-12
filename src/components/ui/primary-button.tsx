import * as React from 'react';
import { Button, ButtonProps } from '@/components/ui/button';
import { cn } from '@/lib/utils';

/**
 * PrimaryButton - Bouton principal avec couleur primary (cyan/sky)
 * Utilisé pour les actions principales (Ajouter, Créer, etc.)
 */
export const PrimaryButton = React.forwardRef<HTMLButtonElement, ButtonProps>(
  ({ className, children, ...props }, ref) => {
    return (
      <Button
        ref={ref}
        className={cn(
          'gap-2 h-11 rounded-xl',
          'bg-primary hover:bg-primary/90',
          'text-primary-foreground',
          'shadow-md shadow-primary/20',
          'hover:shadow-lg hover:shadow-primary/30',
          'transition-all',
          className
        )}
        {...props}
      >
        {children}
      </Button>
    );
  }
);

PrimaryButton.displayName = 'PrimaryButton';

/**
 * SecondaryButton - Bouton secondaire avec outline
 * Utilisé pour les actions secondaires
 */
export const SecondaryButton = React.forwardRef<HTMLButtonElement, ButtonProps>(
  ({ className, children, ...props }, ref) => {
    return (
      <Button
        ref={ref}
        variant="outline"
        className={cn(
          'gap-2 h-11 rounded-xl',
          'border-border/50',
          'hover:bg-primary/5 hover:border-primary/30',
          'transition-colors',
          className
        )}
        {...props}
      >
        {children}
      </Button>
    );
  }
);

SecondaryButton.displayName = 'SecondaryButton';

/**
 * TabButton - Bouton pour les onglets/tabs avec le même style
 */
interface TabButtonProps extends React.ButtonHTMLAttributes<HTMLButtonElement> {
  active?: boolean;
  icon?: React.ReactNode;
  children: React.ReactNode;
}

export const TabButton = React.forwardRef<HTMLButtonElement, TabButtonProps>(
  ({ className, active, icon, children, ...props }, ref) => {
    return (
      <button
        ref={ref}
        className={cn(
          'flex items-center gap-2 px-4 py-2.5 rounded-lg text-sm font-medium transition-all flex-1 md:flex-initial justify-center',
          active
            ? 'bg-primary text-primary-foreground shadow-md shadow-primary/20'
            : 'text-muted-foreground hover:text-foreground hover:bg-muted/50',
          className
        )}
        {...props}
      >
        {icon}
        <span className="hidden sm:inline">{children}</span>
      </button>
    );
  }
);

TabButton.displayName = 'TabButton';
