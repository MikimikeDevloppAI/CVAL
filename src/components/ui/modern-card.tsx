import React from 'react';
import { cn } from '@/lib/utils';

interface ModernCardProps {
  children: React.ReactNode;
  className?: string;
  onClick?: () => void;
}

export function ModernCard({ children, className, onClick }: ModernCardProps) {
  return (
    <div
      className={cn(
        "bg-card text-card-foreground rounded-xl border border-border/50",
        "shadow-lg hover:shadow-xl transition-all duration-300 ease-out",
        "hover:scale-105 hover:-translate-y-1",
        "backdrop-blur-sm bg-card/95",
        "cursor-pointer group",
        className
      )}
      onClick={onClick}
    >
      {children}
    </div>
  );
}

interface ModernCardHeaderProps {
  children: React.ReactNode;
  className?: string;
}

export function ModernCardHeader({ children, className }: ModernCardHeaderProps) {
  return (
    <div className={cn("p-6 pb-3", className)}>
      {children}
    </div>
  );
}

interface ModernCardContentProps {
  children: React.ReactNode;
  className?: string;
}

export function ModernCardContent({ children, className }: ModernCardContentProps) {
  return (
    <div className={cn("px-6 pb-6", className)}>
      {children}
    </div>
  );
}

interface ModernCardTitleProps {
  children: React.ReactNode;
  className?: string;
}

export function ModernCardTitle({ children, className }: ModernCardTitleProps) {
  return (
    <h3 className={cn("text-lg font-semibold text-foreground group-hover:text-primary transition-colors", className)}>
      {children}
    </h3>
  );
}

interface ContactInfoProps {
  icon: React.ReactNode;
  text: string;
  className?: string;
}

export function ContactInfo({ icon, text, className }: ContactInfoProps) {
  return (
    <div className={cn("flex items-center space-x-2 text-sm text-muted-foreground group-hover:text-foreground transition-colors", className)}>
      <div className="flex-shrink-0 w-4 h-4 text-primary/70 group-hover:text-primary transition-colors">
        {icon}
      </div>
      <span className="truncate">{text}</span>
    </div>
  );
}