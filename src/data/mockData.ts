import { Doctor, Secretary, Site, Speciality, Appointment } from '@/types/medical';

export const specialities: Speciality[] = [
  { id: '1', name: 'Cardiologie', code: 'CARDIO', color: 'blue' },
  { id: '2', name: 'Neurologie', code: 'NEURO', color: 'purple' },
  { id: '3', name: 'Orthopédie', code: 'ORTHO', color: 'green' },
  { id: '4', name: 'Dermatologie', code: 'DERMA', color: 'orange' },
  { id: '5', name: 'Pédiatrie', code: 'PEDIA', color: 'teal' },
];

export const sites: Site[] = [
  { id: '1', name: 'Clinique du Centre', address: '123 Rue de la Paix, Paris', maxDoctors: 15 },
  { id: '2', name: 'Hôpital Nord', address: '456 Avenue des Lilas, Lyon', maxDoctors: 25 },
  { id: '3', name: 'Centre Médical Sud', address: '789 Boulevard du Soleil, Marseille', maxDoctors: 20 },
];

export const doctors: Doctor[] = [
  {
    id: '1',
    firstName: 'Marie',
    lastName: 'Dubois',
    email: 'marie.dubois@clinic.com',
    speciality: specialities[0],
    avatar: 'https://images.unsplash.com/photo-1559839734-2b71ea197ec2?w=100&h=100&fit=crop&crop=face',
    preferredSite: sites[0],
  },
  {
    id: '2',
    firstName: 'Pierre',
    lastName: 'Martin',
    email: 'pierre.martin@clinic.com',
    speciality: specialities[1],
    avatar: 'https://images.unsplash.com/photo-1612349317150-e413f6a5b16d?w=100&h=100&fit=crop&crop=face',
    preferredSite: sites[0],
  },
  {
    id: '3',
    firstName: 'Sophie',
    lastName: 'Laurent',
    email: 'sophie.laurent@clinic.com',
    speciality: specialities[2],
    avatar: 'https://images.unsplash.com/photo-1594824804732-ca8db7531fdc?w=100&h=100&fit=crop&crop=face',
    preferredSite: sites[1],
  },
];

export const secretaries: Secretary[] = [
  {
    id: '1',
    firstName: 'Julie',
    lastName: 'Moreau',
    email: 'julie.moreau@clinic.com',
    specialities: [specialities[0], specialities[1]],
    avatar: 'https://images.unsplash.com/photo-1438761681033-6461ffad8d80?w=100&h=100&fit=crop&crop=face',
    preferredSite: sites[0],
  },
  {
    id: '2',
    firstName: 'Thomas',
    lastName: 'Bernard',
    email: 'thomas.bernard@clinic.com',
    specialities: [specialities[2], specialities[3]],
    avatar: 'https://images.unsplash.com/photo-1507003211169-0a1dd7228f2d?w=100&h=100&fit=crop&crop=face',
    preferredSite: sites[1],
  },
];

export const appointments: Appointment[] = [
  {
    id: '1',
    title: 'Consultation Cardiaque',
    startTime: '09:00',
    endTime: '10:00',
    date: '2024-09-24',
    doctor: doctors[0],
    secretary: secretaries[0],
    site: sites[0],
    speciality: specialities[0],
    status: 'confirmed',
    type: 'consultation',
  },
  {
    id: '2',
    title: 'Réunion équipe',
    startTime: '10:30',
    endTime: '11:30',
    date: '2024-09-24',
    doctor: doctors[1],
    site: sites[0],
    speciality: specialities[1],
    status: 'scheduled',
    type: 'meeting',
  },
  {
    id: '3',
    title: 'Consultation Orthopédie',
    startTime: '14:00',
    endTime: '15:00',
    date: '2024-09-25',
    doctor: doctors[2],
    secretary: secretaries[1],
    site: sites[1],
    speciality: specialities[2],
    status: 'confirmed',
    type: 'consultation',
  },
  {
    id: '4',
    title: 'Formation continue',
    startTime: '16:00',
    endTime: '18:00',
    date: '2024-09-25',
    doctor: doctors[0],
    site: sites[0],
    speciality: specialities[0],
    status: 'scheduled',
    type: 'admin',
  },
];

export const getCurrentWeekDays = () => {
  const today = new Date();
  const monday = new Date(today);
  monday.setDate(today.getDate() - today.getDay() + 1);
  
  const days = [];
  for (let i = 0; i < 5; i++) { // Lundi à Vendredi
    const day = new Date(monday);
    day.setDate(monday.getDate() + i);
    days.push({
      date: day.toISOString().split('T')[0],
      dayName: day.toLocaleDateString('fr-FR', { weekday: 'short' }).toUpperCase(),
      dayNumber: day.getDate(),
    });
  }
  return days;
};