import { 
  Calendar, 
  Users, 
  UserPlus,
  Settings,
  LogOut,
  Menu,
  Stethoscope,
  User,
  UserCog,
  CalendarX,
  CalendarX2,
  BarChart3,
  ChevronDown,
  LayoutDashboard,
  BotMessageSquare,
  HelpCircle
} from 'lucide-react';
import { Link, useLocation } from 'react-router-dom';
import { cn } from '@/lib/utils';
import { useAuth } from '@/hooks/useAuth';
import { Button } from '@/components/ui/button';
import { Sheet, SheetContent, SheetTrigger } from '@/components/ui/sheet';
import cliniqueLogoImg from '@/assets/clinique-logo.png';
import { useState, useEffect } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { useCanManagePlanning } from '@/hooks/useCanManagePlanning';
import { useIsAdmin } from '@/hooks/useIsAdmin';
import { AIAssistantDialog } from '@/components/assistant/AIAssistantDialog';
import { UserHelpSheet } from '@/components/assistant/UserHelpSheet';
import { UnfilledNeedsBadge } from '@/components/dashboard/UnfilledNeedsBadge';
import { UnfilledNeedsSummaryDialog } from '@/components/dashboard/UnfilledNeedsSummaryDialog';
import { format, startOfWeek, endOfWeek, addWeeks } from 'date-fns';
import { fr } from 'date-fns/locale';

const planningItems = [
  { name: 'Dashboard', href: '/', icon: LayoutDashboard },
];

const settingsItem = { name: 'Paramètres', href: '/settings', icon: Settings };

export const Sidebar = () => {
  const location = useLocation();
  const { signOut, user } = useAuth();
  const [open, setOpen] = useState(false);
  const [aiAssistantOpen, setAiAssistantOpen] = useState(false);
  const [helpSheetOpen, setHelpSheetOpen] = useState(false);
  const [profile, setProfile] = useState<any>(null);
  const [planningExpanded, setPlanningExpanded] = useState(true);
  const { canManage } = useCanManagePlanning();
  const { isAdmin } = useIsAdmin();
  const [unfilledNeedsCount, setUnfilledNeedsCount] = useState(0);
  const [unfilledNeedsSummaryOpen, setUnfilledNeedsSummaryOpen] = useState(false);
  const [unfilledNeedsLoading, setUnfilledNeedsLoading] = useState(false);

  const fetchUnfilledNeedsCount = async () => {
    setUnfilledNeedsLoading(true);
    try {
      const today = new Date();
      let total = 0;

      for (let i = 0; i < 4; i++) {
        const weekStart = startOfWeek(addWeeks(today, i), { locale: fr });
        const weekEnd = endOfWeek(addWeeks(today, i), { locale: fr });
        const weekStartStr = format(weekStart, 'yyyy-MM-dd');
        const weekEndStr = format(weekEnd, 'yyyy-MM-dd');

        const [sitesResult, blocResult, fermetureResult] = await Promise.all([
          supabase
            .from('besoins_sites_summary')
            .select('deficit')
            .gte('date', weekStartStr)
            .lte('date', weekEndStr)
            .gt('deficit', 0),
          supabase
            .from('besoins_bloc_operatoire_summary')
            .select('deficit')
            .gte('date', weekStartStr)
            .lte('date', weekEndStr)
            .gt('deficit', 0),
          supabase
            .from('besoins_fermeture_summary')
            .select('deficit')
            .gte('date', weekStartStr)
            .lte('date', weekEndStr)
            .gt('deficit', 0)
        ]);

        if (sitesResult.error) throw sitesResult.error;
        if (blocResult.error) throw blocResult.error;
        if (fermetureResult.error) throw fermetureResult.error;

        const sitesDeficit = sitesResult.data?.reduce((sum, row) => sum + (row.deficit || 0), 0) || 0;
        const blocDeficit = blocResult.data?.reduce((sum, row) => sum + (row.deficit || 0), 0) || 0;
        const fermetureDeficit = fermetureResult.data?.reduce((sum, row) => sum + (row.deficit || 0), 0) || 0;
        total += sitesDeficit + blocDeficit + fermetureDeficit;
      }

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

  // All items visible when user has planning access
  const visibleItems = canManage ? planningItems : [];

  const getInitials = () => {
    if (profile?.prenom && profile?.nom) {
      return `${profile.prenom[0]}${profile.nom[0]}`.toUpperCase();
    }
    return user?.email?.[0]?.toUpperCase() || 'U';
  };

  const SidebarContent = ({ onLinkClick }: { onLinkClick?: () => void }) => (
    <>
      {/* Logo */}
      <div className="flex h-16 shrink-0 items-center px-6 border-b border-sidebar-border border-opacity-30">
        <div className="flex items-center space-x-3">
          <img 
            src={cliniqueLogoImg} 
            alt="Clinique La Vallée" 
            className="h-10 w-auto"
          />
        </div>
      </div>

      {/* Navigation */}
      <nav className="flex flex-1 flex-col px-3 py-4">
        <div>
          <button
            onClick={() => setPlanningExpanded(!planningExpanded)}
            className="flex items-center justify-between w-full px-3 py-2 text-xs font-semibold text-sidebar-foreground/70 hover:text-sidebar-foreground transition-colors"
          >
            <span>Planning</span>
            <ChevronDown 
              className={cn(
                "h-4 w-4 transition-transform",
                !planningExpanded && "-rotate-90"
              )}
            />
          </button>
          
          {planningExpanded && (
            <ul className="mt-2 space-y-1">
              {visibleItems.map((item) => {
                const isActive = location.pathname === item.href;
                return (
                  <li key={item.name}>
                    <Link
                      to={item.href}
                      onClick={onLinkClick}
                      className={cn(
                        'group flex gap-x-3 rounded-lg px-3 py-2 text-sm font-medium transition-colors',
                        isActive
                          ? 'bg-sidebar-primary text-sidebar-primary-foreground'
                          : 'text-sidebar-foreground hover:text-sidebar-primary-foreground hover:bg-sidebar-accent'
                      )}
                    >
                      <item.icon
                        className={cn(
                          'h-4 w-4 shrink-0 transition-colors',
                          isActive ? 'text-sidebar-primary-foreground' : 'text-sidebar-foreground group-hover:text-sidebar-primary-foreground'
                        )}
                      />
                      {item.name}
                    </Link>
                  </li>
                );
              })}
            </ul>
          )}
        </div>

        {/* Settings section - visible to all users */}
        <div className="mt-6 pt-6 border-t border-sidebar-border border-opacity-30">
          <ul className="space-y-1">
            <li>
              <Link
                to={settingsItem.href}
                onClick={onLinkClick}
                className={cn(
                  'group flex gap-x-3 rounded-lg px-3 py-2 text-sm font-medium transition-colors',
                  location.pathname === settingsItem.href
                    ? 'bg-sidebar-primary text-sidebar-primary-foreground'
                    : 'text-sidebar-foreground hover:text-sidebar-primary-foreground hover:bg-sidebar-accent'
                )}
              >
                <settingsItem.icon
                  className={cn(
                    'h-4 w-4 shrink-0 transition-colors',
                    location.pathname === settingsItem.href ? 'text-sidebar-primary-foreground' : 'text-sidebar-foreground group-hover:text-sidebar-primary-foreground'
                  )}
                />
                {settingsItem.name}
              </Link>
            </li>
          </ul>
        </div>

        {/* Admin section */}
        {isAdmin && (
          <div className="mt-6 pt-6 border-t border-sidebar-border border-opacity-30">
            <ul className="space-y-1">
              <li>
                <Link
                  to="/users"
                  onClick={onLinkClick}
                  className={cn(
                    'group flex gap-x-3 rounded-lg px-3 py-2 text-sm font-medium transition-colors',
                    location.pathname === '/users'
                      ? 'bg-sidebar-primary text-sidebar-primary-foreground'
                      : 'text-sidebar-foreground hover:text-sidebar-primary-foreground hover:bg-sidebar-accent'
                  )}
                >
                  <Users
                    className={cn(
                      'h-4 w-4 shrink-0 transition-colors',
                      location.pathname === '/users' ? 'text-sidebar-primary-foreground' : 'text-sidebar-foreground group-hover:text-sidebar-primary-foreground'
                    )}
                  />
                  Utilisateurs
                </Link>
              </li>
            </ul>
          </div>
        )}

        <div className="flex-1" />

        {/* User Profile section */}
        <div className="mt-6 rounded-lg bg-sidebar-accent bg-opacity-30 p-4">
          <div className="flex items-center justify-between gap-2">
            <div className="flex h-8 w-8 items-center justify-center rounded-full bg-sidebar-primary shrink-0">
              <span className="text-sm font-medium text-sidebar-primary-foreground">
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
              className="h-8 w-8 p-0 hover:bg-sidebar-accent-foreground/10 shrink-0"
            >
              <LogOut className="h-4 w-4" />
            </Button>
          </div>
        </div>
      </nav>
    </>
  );

  return (
    <div className="fixed top-0 left-0 right-0 z-50 h-16 bg-sidebar border-b border-sidebar-border flex items-center px-4">
      <Sheet open={open} onOpenChange={setOpen}>
        <SheetTrigger asChild>
          <Button variant="ghost" size="sm" className="mr-2">
            <Menu className="h-5 w-5" />
          </Button>
        </SheetTrigger>
        <SheetContent side="left" className="w-64 p-0 bg-sidebar">
          <SidebarContent onLinkClick={() => setOpen(false)} />
        </SheetContent>
      </Sheet>
          <img 
            src={cliniqueLogoImg} 
            alt="Clinique La Vallée" 
            className="h-8 w-auto"
          />
          
          <UnfilledNeedsBadge
            count={unfilledNeedsCount}
            onClick={() => setUnfilledNeedsSummaryOpen(true)}
            isLoading={unfilledNeedsLoading}
          />
          
          <div className="flex-1" />
          
          <Button
            variant="ghost"
            size="icon"
            onClick={() => setHelpSheetOpen(true)}
            className="hover:bg-emerald-500/10 hover:text-emerald-600"
            title="Aide utilisateur"
          >
            <HelpCircle className="h-5 w-5" />
          </Button>
          
          <Button
            size="sm"
            onClick={() => setAiAssistantOpen(true)}
            className="ml-2 flex items-center gap-2 bg-gradient-to-r from-emerald-500 to-teal-600 text-white border-0 shadow-lg hover:shadow-xl hover:scale-105 transition-all duration-200 hover:from-emerald-600 hover:to-teal-700"
          >
            <BotMessageSquare className="h-4 w-4" />
            <span className="hidden sm:inline">ValléeBot</span>
          </Button>
      
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
    </div>
  );
};
