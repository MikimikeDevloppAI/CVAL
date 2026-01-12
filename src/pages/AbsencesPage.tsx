import { AbsencesJoursFeriesPopup } from '@/components/dashboard/AbsencesJoursFeriesPopup';

const AbsencesPage = () => {
  return (
    <div className="w-full">
      <AbsencesJoursFeriesPopup open={true} onOpenChange={() => {}} embedded />
    </div>
  );
};

export default AbsencesPage;
