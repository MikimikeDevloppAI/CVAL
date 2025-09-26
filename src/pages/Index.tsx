import { Sidebar } from '@/components/layout/Sidebar';
import { Header } from '@/components/layout/Header';
import { PlanningGrid } from '@/components/planning/PlanningGrid';

const Index = () => {
  return (
    <div className="flex h-screen w-full bg-background">
      {/* Sidebar */}
      <Sidebar />
      
      {/* Main content */}
      <div className="flex flex-1 flex-col overflow-hidden">
        <Header />
        <PlanningGrid />
      </div>
    </div>
  );
};

export default Index;
