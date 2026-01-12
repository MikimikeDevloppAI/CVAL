import { SitesPopup } from '@/components/dashboard/sites/SitesPopup';

const SitesPage = () => {
  return (
    <div className="w-full h-full p-4 lg:p-6">
      <SitesPopup open={true} onOpenChange={() => {}} embedded />
    </div>
  );
};

export default SitesPage;
