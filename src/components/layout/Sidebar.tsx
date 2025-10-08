import { 
  Calendar, 
  Users, 
  Building2, 
  UserPlus,
  Settings,
  LogOut,
  Menu,
  Stethoscope,
  User,
  UserCog,
  CalendarX,
  ClipboardPlus,
  BarChart3,
  ChevronDown
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

const planningItems = [
  { name: 'Planning', href: '/planning', icon: Calendar },
  { name: 'Statistiques', href: '/statistiques', icon: BarChart3 },
  { name: 'Absences', href: '/absences', icon: CalendarX },
  { name: 'Médecins', href: '/medecins', icon: Stethoscope },
  { name: 'Secrétaires', href: '/secretaires', icon: User },
  { name: 'Backup', href: '/backup', icon: UserCog },
  { name: 'Bloc Opératoire', href: '/bloc-operatoire', icon: ClipboardPlus },
  { name: 'Sites', href: '/sites', icon: Building2 },
];

const settingsItem = { name: 'Paramètres', href: '/settings', icon: Settings };

export const Sidebar = () => {
  const location = useLocation();
  const { signOut, user } = useAuth();
  const [open, setOpen] = useState(false);
  const [profile, setProfile] = useState<any>(null);
  const [planningExpanded, setPlanningExpanded] = useState(true);
  const { canManage } = useCanManagePlanning();
  const { isAdmin } = useIsAdmin();

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
  }, [user]);

  // Filter items based on planning access
  const visibleItems = canManage 
    ? planningItems 
    : planningItems.filter(item => item.href === '/planning');

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

        {/* Admin section */}
        {isAdmin && (
          <div className="mt-6 pt-6 border-t border-sidebar-border border-opacity-30">
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
          </div>
        )}

        <div className="flex-1" />

        {/* Settings section */}
        <div className="mt-4">
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
        </div>

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
    <>
      {/* Mobile Header with Burger Menu */}
      <div className="lg:hidden fixed top-0 left-0 right-0 z-50 h-16 bg-sidebar border-b border-sidebar-border flex items-center px-4">
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
      </div>

      {/* Desktop Sidebar */}
      <div className="hidden lg:flex h-full w-64 flex-col bg-sidebar border-r border-sidebar-border">
        <SidebarContent />
      </div>
    </>
  );
};
