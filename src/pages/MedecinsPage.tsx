import { MedecinsPopup } from '@/components/dashboard/medecins/MedecinsPopup';

const MedecinsPage = () => {
  return (
    <div className="w-full h-full p-4 lg:p-6">
      <MedecinsPopup open={true} onOpenChange={() => {}} embedded />
    </div>
  );
};

export default MedecinsPage;
