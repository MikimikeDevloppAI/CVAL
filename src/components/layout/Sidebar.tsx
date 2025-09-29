import { 
  Calendar, 
  LayoutDashboard, 
  Users, 
  Building2, 
  Clock, 
  BarChart3,
  UserPlus,
  Settings,
  LogOut
} from 'lucide-react';
import { Link, useLocation } from 'react-router-dom';
import { cn } from '@/lib/utils';
import { useAuth } from '@/hooks/useAuth';
import { Button } from '@/components/ui/button';
import cliniqueLogoImg from '@/assets/clinique-logo.png';

const navigation = [
  { name: 'Vue d\'ensemble', href: '/', icon: LayoutDashboard },
  { name: 'Planning', href: '/', icon: Calendar },
  { name: 'Médecins', href: '/medecins', icon: Users },
  { name: 'Secrétaires', href: '/secretaires', icon: UserPlus },
  { name: 'Sites', href: '#', icon: Building2 },
  { name: 'Horaires', href: '#', icon: Clock },
  { name: 'Statistiques', href: '#', icon: BarChart3 },
  { name: 'Paramètres', href: '#', icon: Settings },
];

export const Sidebar = () => {
  const location = useLocation();
  const { signOut, user } = useAuth();

  return (
    <div className="flex h-full w-64 flex-col bg-sidebar border-r border-sidebar-border">
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
        <ul role="list" className="flex flex-1 flex-col gap-y-1">
          {navigation.map((item) => {
            const isActive = location.pathname === item.href;
            return (
              <li key={item.name}>
                  <Link
                  to={item.href}
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

        {/* User Profile section */}
        <div className="mt-6 rounded-lg bg-sidebar-accent bg-opacity-30 p-4">
          <div className="flex items-center justify-between">
            <div className="flex items-center">
              <div className="flex h-8 w-8 items-center justify-center rounded-full bg-sidebar-primary">
                <span className="text-sm font-medium text-sidebar-primary-foreground">
                  {user?.email?.[0]?.toUpperCase() || 'U'}
                </span>
              </div>
              <div className="ml-3 flex flex-col">
                <span className="text-sm font-medium text-sidebar-foreground">
                  {user?.email}
                </span>
                <span className="text-xs text-sidebar-foreground text-opacity-70">Utilisateur</span>
              </div>
            </div>
            <Button
              variant="ghost"
              size="sm"
              onClick={signOut}
              className="h-8 w-8 p-0 hover:bg-sidebar-accent-foreground/10"
            >
              <LogOut className="h-4 w-4" />
            </Button>
          </div>
        </div>
      </nav>
    </div>
  );
};