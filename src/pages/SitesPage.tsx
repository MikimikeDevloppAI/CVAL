import { SitesPopup } from '@/components/dashboard/sites/SitesPopup';

const SitesPage = () => {
  return (
    <div className="w-full">
      <SitesPopup open={true} onOpenChange={() => {}} embedded />
    </div>
  );
};

export default SitesPage;
