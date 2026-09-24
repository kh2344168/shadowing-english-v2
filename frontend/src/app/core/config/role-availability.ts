export type AppRole = 'Admin' | 'Student' | 'Teacher' | 'Supervisor';
// Navigation state only. Backend remains the source of authorization.
export const ROLE_AVAILABILITY: Readonly<Record<AppRole, boolean>> = {
  Admin: true, Student: true, Teacher: false, Supervisor: false,
};
