import {
  Settings,
  LogOut,
  Menu,
  Stethoscope,
  Users,
  CalendarX,
  LayoutDashboard,
  HelpCircle,
  ClipboardList,
  Building,
} from 'lucide-react';
import { Link, useLocation } from 'react-router-dom';
import { cn } from '@/lib/utils';
import { useAuth } from '@/hooks/useAuth';
import { Button } from '@/components/ui/button';
import { Sheet, SheetContent, SheetTrigger } from '@/components/ui/sheet';
import { Accordion, AccordionContent, AccordionItem, AccordionTrigger } from '@/components/ui/accordion';
import cliniqueLogoImg from '@/assets/clinique-logo.png';
import { useState, useEffect } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { useCanManagePlanning } from '@/hooks/useCanManagePlanning';
import { useIsAdmin } from '@/hooks/useIsAdmin';
import { AIAssistantDialog } from '@/components/assistant/AIAssistantDialog';
import { UserHelpSheet } from '@/components/assistant/UserHelpSheet';
import { UnfilledNeedsBadge } from '@/components/dashboard/UnfilledNeedsBadge';
import { UnfilledNeedsSummaryDialog } from '@/components/dashboard/UnfilledNeedsSummaryDialog';
import { Badge } from '@/components/ui/badge';
import { format, startOfWeek, endOfWeek, addWeeks } from 'date-fns';
import { fr } from 'date-fns/locale';

export const Sidebar = () => {
  const location = useLocation();
  const { signOut, user } = useAuth();
  const [open, setOpen] = useState(false);
  const [aiAssistantOpen, setAiAssistantOpen] = useState(false);
  const [helpSheetOpen, setHelpSheetOpen] = useState(false);
  const [profile, setProfile] = useState<any>(null);
  const { canManage } = useCanManagePlanning();
  const { isAdmin } = useIsAdmin();
  const [unfilledNeedsCount, setUnfilledNeedsCount] = useState(0);
  const [unfilledNeedsSummaryOpen, setUnfilledNeedsSummaryOpen] = useState(false);
  const [unfilledNeedsLoading, setUnfilledNeedsLoading] = useState(false);

  const fetchUnfilledNeedsCount = async () => {
    setUnfilledNeedsLoading(true);
    try {
      const today = new Date();
      const weekStart = startOfWeek(today, { locale: fr });
      const fourWeeksEnd = endOfWeek(addWeeks(today, 3), { locale: fr });
      const weekStartStr = format(weekStart, 'yyyy-MM-dd');
      const weekEndStr = format(fourWeeksEnd, 'yyyy-MM-dd');

      const { data, error } = await supabase
        .from('besoins_unified_summary')
        .select('balance')
        .gte('date', weekStartStr)
        .lte('date', weekEndStr)
        .eq('statut', 'DEFICIT');

      if (error) throw error;

      const total = data?.reduce((sum, row) => sum + Math.abs(row.balance || 0), 0) || 0;
      setUnfilledNeedsCount(total);
    } catch (error) {
      console.error('Error fetching unfilled needs count:', error);
      setUnfilledNeedsCount(0);
    } finally {
      setUnfilledNeedsLoading(false);
    }
  };

  useEffect(() => {
    const fetchProfile = async () => {
      if (user) {
        const { data } = await supabase
          .from('profiles')
          .select('prenom, nom, planning')
          .eq('id', user.id)
          .single();

        if (data) {
          setProfile(data);
        }
      }
    };

    fetchProfile();
    fetchUnfilledNeedsCount();
  }, [user]);

  const getInitials = () => {
    if (profile?.prenom && profile?.nom) {
      return `${profile.prenom[0]}${profile.nom[0]}`.toUpperCase();
    }
    return user?.email?.[0]?.toUpperCase() || 'U';
  };

  const isActive = (path: string) => location.pathname === path;

  const NavLink = ({ to, icon: Icon, label, badge, onLinkClick }: {
    to: string;
    icon: React.ElementType;
    label: string;
    badge?: number;
    onLinkClick?: () => void;
  }) => (
    <Link
      to={to}
      onClick={onLinkClick}
      className={cn(
        'group flex items-center gap-3 rounded-lg px-3 py-2.5 text-sm font-medium transition-all duration-200',
        isActive(to)
          ? 'bg-primary/10 text-primary'
          : 'text-muted-foreground hover:bg-muted hover:text-foreground'
      )}
    >
      <Icon className="h-4 w-4 shrink-0 text-primary" />
      <span className="flex-1">{label}</span>
      {badge !== undefined && badge > 0 && (
        <Badge variant="destructive" className="h-5 min-w-5 px-1.5 text-xs">
          {badge}
        </Badge>
      )}
    </Link>
  );

  const SidebarContent = ({ onLinkClick }: { onLinkClick?: () => void }) => (
    <div className="flex flex-col h-full">
      {/* Logo */}
      <div className="flex h-16 shrink-0 items-center px-6 border-b border-border/50">
        <img
          src={cliniqueLogoImg}
          alt="Clinique La Vallée"
          className="h-10 w-auto"
        />
      </div>

      {/* Navigation with Accordions */}
      <nav className="flex-1 overflow-y-auto px-3 py-4">
        <Accordion type="multiple" defaultValue={['planning']} className="space-y-2">
          {/* Section Planning - contient tout sauf Paramètres et Utilisateurs */}
          <AccordionItem value="planning" className="border-none">
            <AccordionTrigger className="px-3 py-2 text-xs font-semibold text-muted-foreground uppercase tracking-wider hover:no-underline hover:text-foreground">
              Planning
            </AccordionTrigger>
            <AccordionContent className="pt-1 pb-2 space-y-1">
              {canManage && (
                <NavLink to="/" icon={LayoutDashboard} label="Dashboard" onLinkClick={onLinkClick} />
              )}
              <NavLink to="/medecins" icon={Stethoscope} label="Médecins" onLinkClick={onLinkClick} />
              <NavLink to="/assistants" icon={Users} label="Assistants médicaux" onLinkClick={onLinkClick} />
              <NavLink to="/sites" icon={Building} label="Sites" onLinkClick={onLinkClick} />
              <NavLink to="/operations" icon={ClipboardList} label="Opérations" onLinkClick={onLinkClick} />
              <NavLink to="/absences" icon={CalendarX} label="Absences" onLinkClick={onLinkClick} />
            </AccordionContent>
          </AccordionItem>
        </Accordion>

        {/* Fixed Navigation Links - hors section Planning */}
        <div className="mt-6 pt-6 border-t border-border/50 space-y-1">
          <NavLink to="/settings" icon={Settings} label="Paramètres" onLinkClick={onLinkClick} />
          {/* Admin section */}
          {isAdmin && (
            <NavLink to="/users" icon={Users} label="Utilisateurs" onLinkClick={onLinkClick} />
          )}
        </div>
      </nav>

      {/* Bottom section */}
      <div className="shrink-0 p-4 border-t border-border/50">
        {/* Quick actions */}
        <div className="flex items-center justify-center gap-2 mb-4">
          <UnfilledNeedsBadge
            count={unfilledNeedsCount}
            onClick={() => setUnfilledNeedsSummaryOpen(true)}
            isLoading={unfilledNeedsLoading}
          />

          <Button
            variant="ghost"
            size="icon"
            onClick={() => setHelpSheetOpen(true)}
            className="hover:bg-primary/10 hover:text-primary"
            title="Aide utilisateur"
          >
            <HelpCircle className="h-5 w-5" />
          </Button>

          {/* ValléeBot hidden for now
          <Button
            size="sm"
            onClick={() => setAiAssistantOpen(true)}
            className="flex items-center gap-2"
          >
            <BotMessageSquare className="h-4 w-4" />
            <span className="hidden sm:inline">ValléeBot</span>
          </Button>
          */}
        </div>

        {/* User Profile */}
        <div className="rounded-lg bg-muted/50 p-3">
          <div className="flex items-center justify-between gap-2">
            <div className="flex h-8 w-8 items-center justify-center rounded-full bg-primary shrink-0">
              <span className="text-sm font-medium text-primary-foreground">
                {getInitials()}
              </span>
            </div>
            {profile?.prenom && (
              <span className="text-sm font-medium text-foreground flex-1 text-center truncate">
                {profile.prenom} {profile.nom}
              </span>
            )}
            <Button
              variant="ghost"
              size="sm"
              onClick={signOut}
              className="h-8 w-8 p-0 hover:bg-destructive/10 hover:text-destructive shrink-0"
            >
              <LogOut className="h-4 w-4" />
            </Button>
          </div>
        </div>
      </div>
    </div>
  );

  return (
    <>
      {/* Desktop Sidebar - Fixed left */}
      <div className="hidden lg:flex lg:flex-col lg:fixed lg:inset-y-0 lg:left-0 lg:z-50 lg:w-64 lg:bg-card lg:border-r lg:border-border">
        <SidebarContent />
      </div>

      {/* Mobile Header */}
      <div className="lg:hidden fixed top-0 left-0 right-0 z-50 h-16 bg-card border-b border-border flex items-center px-4">
        <Sheet open={open} onOpenChange={setOpen}>
          <SheetTrigger asChild>
            <Button variant="ghost" size="sm" className="mr-2">
              <Menu className="h-5 w-5" />
            </Button>
          </SheetTrigger>
          <SheetContent side="left" className="w-64 p-0 bg-card">
            <SidebarContent onLinkClick={() => setOpen(false)} />
          </SheetContent>
        </Sheet>

        <img
          src={cliniqueLogoImg}
          alt="Clinique La Vallée"
          className="h-8 w-auto"
        />

        <div className="flex-1" />

        <UnfilledNeedsBadge
          count={unfilledNeedsCount}
          onClick={() => setUnfilledNeedsSummaryOpen(true)}
          isLoading={unfilledNeedsLoading}
        />

        <Button
          variant="ghost"
          size="icon"
          onClick={() => setHelpSheetOpen(true)}
          className="hover:bg-primary/10 hover:text-primary"
          title="Aide utilisateur"
        >
          <HelpCircle className="h-5 w-5" />
        </Button>
      </div>

      {/* Dialogs */}
      <AIAssistantDialog
        open={aiAssistantOpen}
        onOpenChange={setAiAssistantOpen}
      />
      <UserHelpSheet
        open={helpSheetOpen}
        onOpenChange={setHelpSheetOpen}
      />
      <UnfilledNeedsSummaryDialog
        open={unfilledNeedsSummaryOpen}
        onOpenChange={setUnfilledNeedsSummaryOpen}
        onRefresh={fetchUnfilledNeedsCount}
      />
    </>
  );
};
