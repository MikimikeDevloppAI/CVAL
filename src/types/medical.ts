export interface Doctor {
  id: string;
  firstName: string;
  lastName: string;
  email: string;
  speciality: Speciality;
  avatar: string;
  preferredSite: Site;
}

export interface Secretary {
  id: string;
  firstName: string;
  lastName: string;
  email: string;
  specialities: Speciality[];
  avatar: string;
  preferredSite: Site;
}

export interface Site {
  id: string;
  name: string;
  address: string;
  maxDoctors: number;
}

export interface Speciality {
  id: string;
  name: string;
  code: string;
  color: 'blue' | 'green' | 'orange' | 'purple' | 'teal';
}

export interface Appointment {
  id: string;
  title: string;
  startTime: string;
  endTime: string;
  date: string;
  doctor?: Doctor;
  secretary?: Secretary;
  site: Site;
  speciality: Speciality;
  status: 'scheduled' | 'confirmed' | 'cancelled';
  type: 'consultation' | 'meeting' | 'admin';
}

export interface Absence {
  id: string;
  profileId: string;
  startDate: string;
  endDate: string;
  type: 'vacation' | 'sick' | 'training' | 'other';
  reason?: string;
  status: 'pending' | 'approved' | 'rejected';
}

export interface WorkingHours {
  id: string;
  profileId: string;
  dayOfWeek: number; // 1-7 (Monday-Sunday)
  startTime: string;
  endTime: string;
  siteId: string;
  isActive: boolean;
}