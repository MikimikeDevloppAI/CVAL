import { AbsencesJoursFeriesPopup } from '@/components/dashboard/AbsencesJoursFeriesPopup';

const AbsencesPage = () => {
  return (
    <div className="w-full h-full p-4 lg:p-6">
      <AbsencesJoursFeriesPopup open={true} onOpenChange={() => {}} embedded />
    </div>
  );
};

export default AbsencesPage;
