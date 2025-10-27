import { Sidebar } from './Sidebar';

interface LayoutProps {
  children: React.ReactNode;
}

export const Layout = ({ children }: LayoutProps) => {
  return (
    <div className="flex h-screen w-full bg-muted/30">
      <Sidebar />
      <div className="flex flex-1 flex-col overflow-hidden pt-16">
        <main className="flex-1 overflow-auto p-6 bg-muted/30 [transform:rotateX(180deg)]">
          <div className="[transform:rotateX(180deg)]">
            {children}
          </div>
        </main>
      </div>
    </div>
  );
};