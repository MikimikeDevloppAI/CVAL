import { MedecinsPopup } from '@/components/dashboard/medecins/MedecinsPopup';

const MedecinsPage = () => {
  return (
    <div className="w-full">
      <MedecinsPopup open={true} onOpenChange={() => {}} embedded />
    </div>
  );
};

export default MedecinsPage;
