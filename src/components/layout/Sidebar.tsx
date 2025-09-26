import { 
  Calendar, 
  LayoutDashboard, 
  Users, 
  Building2, 
  Clock, 
  BarChart3,
  UserPlus,
  Settings
} from 'lucide-react';
import { cn } from '@/lib/utils';

const navigation = [
  { name: 'Vue d\'ensemble', href: '#', icon: LayoutDashboard, current: false },
  { name: 'Planning', href: '#', icon: Calendar, current: true },
  { name: 'Médecins', href: '#', icon: Users, current: false },
  { name: 'Secrétaires', href: '#', icon: UserPlus, current: false },
  { name: 'Sites', href: '#', icon: Building2, current: false },
  { name: 'Horaires', href: '#', icon: Clock, current: false },
  { name: 'Statistiques', href: '#', icon: BarChart3, current: false },
  { name: 'Paramètres', href: '#', icon: Settings, current: false },
];

export const Sidebar = () => {
  return (
    <div className="flex h-full w-64 flex-col bg-gradient-primary">
      {/* Logo */}
      <div className="flex h-16 shrink-0 items-center px-6">
        <div className="flex items-center space-x-3">
          <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-white/20 backdrop-blur-sm">
            <Calendar className="h-5 w-5 text-white" />
          </div>
          <span className="text-lg font-semibold text-white">MedPlan</span>
        </div>
      </div>

      {/* Navigation */}
      <nav className="flex flex-1 flex-col px-4 pb-4">
        <ul role="list" className="flex flex-1 flex-col gap-y-1">
          {navigation.map((item) => (
            <li key={item.name}>
              <a
                href={item.href}
                className={cn(
                  'group flex gap-x-3 rounded-xl p-3 text-sm font-medium transition-all duration-200',
                  item.current
                    ? 'bg-white/20 text-white shadow-soft backdrop-blur-sm'
                    : 'text-white/80 hover:bg-white/10 hover:text-white'
                )}
              >
                <item.icon
                  className={cn(
                    'h-5 w-5 shrink-0 transition-colors',
                    item.current ? 'text-white' : 'text-white/60 group-hover:text-white'
                  )}
                />
                {item.name}
              </a>
            </li>
          ))}
        </ul>

        {/* Upgrade section */}
        <div className="mt-6 rounded-xl bg-white/10 p-4 backdrop-blur-sm">
          <div className="text-center">
            <h3 className="text-sm font-medium text-white">Passer à Pro</h3>
            <p className="mt-1 text-xs text-white/80">
              Fonctionnalités avancées + support prioritaire
            </p>
            <button className="mt-3 w-full rounded-lg bg-white px-3 py-2 text-sm font-medium text-primary transition-colors hover:bg-white/90">
              Mettre à niveau
            </button>
          </div>
        </div>
      </nav>
    </div>
  );
};