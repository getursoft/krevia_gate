/** Official Krevia identity. Never alter spelling or punctuation. */
export const BRAND = {
  name: 'Krevia',
  tagline: 'Secured. Transparent. Trust.',
} as const;

/** Design tokens shared by web and mobile. Sampled from the approved brand artwork. */
export const colors = {
  forest: '#074331',
  forestDark: '#05301F',
  forestSoft: '#175943',
  leaf: '#49994E',
  leafSoft: '#DFF0E2',
  mint: '#EAF3EE',
  canvas: '#F6F9F7',
  surface: '#FFFFFF',
  border: '#DCE6E0',
  ink: '#10241B',
  inkMuted: '#4D6157',
  inkSubtle: '#6B7D74',
  danger: '#B42318',
  dangerSoft: '#FDECEA',
  warning: '#8A5A00',
  warningSoft: '#FFF4DB',
  info: '#1D4ED8',
  infoSoft: '#E6EEFF',
  success: '#166534',
  successSoft: '#DCF5E3',
} as const;

export const radii = { sm: 8, md: 12, lg: 16, xl: 24, pill: 999 } as const;
export const spacing = { xs: 4, sm: 8, md: 12, lg: 16, xl: 24, xxl: 32 } as const;

export const MEMBERSHIP_STATUS_LABEL = {
  PENDING: 'Pending verification',
  APPROVED: 'Approved',
  REJECTED: 'Rejected',
  CANCELLED: 'Cancelled',
  REVOKED: 'Membership revoked',
} as const;

export const OCCUPANCY_LABEL = { OWNER: 'Owner', TENANT: 'Tenant', HOUSEHOLD: 'Household member' } as const;

/** Modules shown on the resident dashboard. Only membership is live in Sprint 1. */
export const PLATFORM_MODULES = [
  { key: 'notices', title: 'Society Notices', description: 'Announcements from your managing committee', available: false },
  { key: 'complaints', title: 'Raise a Complaint', description: 'Report and track issues in your society', available: false },
  { key: 'maintenance', title: 'Maintenance Updates', description: 'Follow service and repair requests', available: false },
  { key: 'payments', title: 'Make Payment', description: 'Pay society dues and view receipts', available: false },
] as const;
