import type { IconName } from './icons';
import type { AppRole, UserDto } from './types';

/**
 * Role-based navigation from the "Krevia Multi-Role Community App Showcase".
 * One definition drives the web sidebar, the mobile "More" menu, quick actions
 * and bottom tabs, so every platform shows the same structure.
 *
 * `screen` names a screen that exists in Sprint 1; items without it open the
 * shared "Coming soon" screen for that module (`key`).
 */
export type Screen = 'home' | 'membership' | 'profile' | 'settings' | 'requests' | 'household';

export interface NavItem {
  key: string;
  label: string;
  icon: IconName;
  description: string;
  screen?: Screen;
  /** Visual accent for quick-action tiles. */
  tone?: 'green' | 'blue' | 'orange' | 'purple' | 'red' | 'teal';
}

export interface RoleNavigation {
  role: AppRole;
  title: string;
  subtitle: string;
  /** Web sidebar. */
  sidebar: NavItem[];
  /** Mobile "More" menu. */
  more: NavItem[];
  quickActions: NavItem[];
  /** Mobile bottom tabs: [home, second, centre action, fourth, more]. */
  tabs: { second: NavItem; centre: NavItem; fourth: NavItem };
}

const m = (key: string, label: string, icon: IconName, description: string, extra: Partial<NavItem> = {}): NavItem => ({
  key,
  label,
  icon,
  description,
  ...extra,
});

/* Module catalogue (descriptions used on "Coming soon" screens). */
const MOD = {
  home: m('home', 'Home', 'home', 'Your society at a glance.', { screen: 'home' }),
  dashboard: m('dashboard', 'Dashboard', 'home', 'Society overview.', { screen: 'home' }),
  liveEntry: m('live-entry', 'Live Entry', 'qr', 'Gate entry console.', { screen: 'home' }),
  mySociety: m('my-society', 'My Society', 'building', 'Your society and membership.', { screen: 'membership' }),
  profile: m('profile', 'My Profile', 'user', 'Your personal details.', { screen: 'profile' }),
  settings: m('settings', 'Settings', 'settings', 'Account and app settings.', { screen: 'settings' }),
  family: m('family', 'My Family Members', 'users', 'The people who share your flat and their contact details.', { screen: 'household' }),
  visitors: m('visitors', 'Visitors', 'userPlus', 'Pre-approve guests and see who visited your flat.'),
  preApprove: m('pre-approve', 'Pre-Approve Visitor', 'userPlus', 'Share an entry pass with expected guests and deliveries.', { tone: 'green' }),
  payments: m('payments', 'Payments', 'card', 'Pay maintenance and society dues, and download receipts.', { tone: 'red' }),
  amenities: m('amenities', 'Amenities', 'pool', 'Book the clubhouse, courts and other shared facilities.', { tone: 'purple' }),
  complaints: m('complaints', 'Complaints', 'file', 'Raise issues with your society and track their resolution.', { tone: 'orange' }),
  notices: m('notices', 'Notices', 'megaphone', 'Announcements from your managing committee.', { tone: 'blue' }),
  events: m('events', 'Events', 'calendar', 'Community events and festivals in your society.', { tone: 'purple' }),
  directory: m('directory', 'Directory', 'book', 'Find residents and society contacts.', { tone: 'green' }),
  buySell: m('buy-sell', 'Buy & Sell', 'bag', 'A marketplace for residents of your society.', { tone: 'blue' }),
  documents: m('documents', 'Documents', 'folder', 'Society bye-laws, circulars and your flat documents.'),
  emergency: m('emergency', 'Emergency Contacts', 'phone', 'Security desk, ambulance, fire and society helplines.', { tone: 'red' }),
  societyInfo: m('society-info', 'Society Information', 'info', 'Committee members, rules and facilities.'),
  // Admin
  residents: m('residents', 'Residents', 'users', 'Approve membership requests and manage residents.', { screen: 'requests' }),
  staff: m('staff', 'Staff & Vendors', 'wrench', 'Housekeeping, security and vendor records.'),
  polls: m('polls', 'Polls & Voting', 'vote', 'Run AOA polls and elections.'),
  reports: m('reports', 'Reports', 'chart', 'Collections, complaints and visitor analytics.', { tone: 'green' }),
  security: m('security-gate', 'Security & Gate Management', 'shield', 'Guards, gates and entry rules.'),
  // Guard
  visitorLog: m('visitor-log', 'Visitor Log', 'list', 'Every entry and exit at your gate.'),
  preApproved: m('pre-approved', 'Pre-Approved', 'userCheck', 'Visitors residents have approved in advance.'),
  deliveries: m('deliveries', 'Deliveries', 'truck', 'Log and route deliveries to flats.'),
  staffEntry: m('staff-entry', 'Staff Entry', 'key', 'Daily staff check-in and check-out.'),
  vehicleEntry: m('vehicle-entry', 'Vehicle Entry', 'car', 'Vehicle entries and parking.'),
  incidents: m('incidents', 'Incident Reports', 'alert', 'Report and track security incidents.', { tone: 'red' }),
  shift: m('shift', 'Shift & Handover', 'clock', 'Your shift timings and handover notes.'),
  scanQr: m('scan-qr', 'Scan QR Code', 'qr', 'Scan a visitor pass to verify entry.'),
  manualEntry: m('manual-entry', 'Manual Entry', 'list', 'Record a walk-in visitor.'),
  callResident: m('call-resident', 'Call Resident', 'phone', 'Call a flat to confirm a visitor.', { tone: 'green' }),
  community: m('community', 'Community', 'users', 'Posts and discussions in your society.'),
  contacts: m('contacts', 'Contacts', 'phone', 'Resident and society contacts for the gate.'),
};

const withLabel = (item: NavItem, label: string, extra: Partial<NavItem> = {}): NavItem => ({ ...item, label, ...extra });

export const ROLE_NAVIGATION: Record<AppRole, RoleNavigation> = {
  RESIDENT: {
    role: 'RESIDENT',
    title: 'Resident',
    subtitle: 'Everything you need, in one place',
    sidebar: [
      MOD.home, MOD.mySociety, MOD.family, MOD.visitors, MOD.payments, MOD.amenities, MOD.complaints, MOD.notices,
      MOD.events, MOD.directory, MOD.buySell, MOD.documents, MOD.settings,
    ],
    more: [
      MOD.profile, MOD.family, withLabel(MOD.visitors, 'Visitors & Pre-Approval'), withLabel(MOD.payments, 'Payments & Bills'),
      withLabel(MOD.amenities, 'Amenities Booking'), withLabel(MOD.complaints, 'Complaints / Helpdesk'), MOD.notices, MOD.events,
      withLabel(MOD.directory, 'Resident Directory'), MOD.buySell, MOD.documents, MOD.emergency, MOD.societyInfo, MOD.settings,
    ],
    quickActions: [
      MOD.preApprove, MOD.payments, withLabel(MOD.complaints, 'Raise a Complaint'), withLabel(MOD.amenities, 'Book Amenities'),
      withLabel(MOD.notices, 'Society Notices'), MOD.events, MOD.directory, MOD.buySell,
    ],
    tabs: { second: MOD.community, centre: withLabel(MOD.mySociety, 'Join'), fourth: MOD.buySell },
  },
  ADMIN: {
    role: 'ADMIN',
    title: 'Society Admin / AOA',
    subtitle: 'Manage your society efficiently',
    sidebar: [
      MOD.dashboard, MOD.residents, MOD.visitors, MOD.payments, MOD.amenities, MOD.complaints, MOD.notices,
      MOD.events, MOD.staff, MOD.documents, MOD.polls, MOD.reports, MOD.settings,
    ],
    more: [
      withLabel(MOD.residents, 'Resident Management'), withLabel(MOD.visitors, 'Visitor Management'),
      withLabel(MOD.payments, 'Payments & Accounting'), withLabel(MOD.amenities, 'Amenities Management'),
      withLabel(MOD.complaints, 'Complaints Management'), withLabel(MOD.notices, 'Notice Board'),
      withLabel(MOD.events, 'Events & Community Programs'), withLabel(MOD.staff, 'Staff & Vendor Management'),
      withLabel(MOD.documents, 'Documents & Records'), MOD.security, withLabel(MOD.polls, 'Polls & Voting (AOA)'),
      withLabel(MOD.reports, 'Reports & Analytics'), withLabel(MOD.settings, 'Society Settings'), MOD.profile,
    ],
    quickActions: [
      withLabel(MOD.residents, 'Approve Residents', { tone: 'green' }), withLabel(MOD.visitors, 'Manage Visitors', { tone: 'blue' }),
      withLabel(MOD.notices, 'Raise Notice', { tone: 'orange' }), withLabel(MOD.payments, 'Collect Payments', { tone: 'blue' }),
      withLabel(MOD.amenities, 'Manage Amenities'), withLabel(MOD.events, 'Create Event', { tone: 'red' }),
      withLabel(MOD.staff, 'Manage Staff', { tone: 'orange' }), withLabel(MOD.reports, 'View Reports'),
    ],
    tabs: { second: withLabel(MOD.residents, 'Approvals'), centre: withLabel(MOD.residents, 'Approve'), fourth: MOD.reports },
  },
  GUARD: {
    role: 'GUARD',
    title: 'Security Guard',
    subtitle: 'Simple. Fast. Secure Entries.',
    sidebar: [
      MOD.liveEntry, MOD.visitorLog, MOD.preApproved, MOD.deliveries, MOD.staffEntry, MOD.vehicleEntry,
      withLabel(MOD.directory, 'Resident Directory'), MOD.incidents, MOD.notices, MOD.shift, MOD.settings,
    ],
    more: [
      MOD.visitorLog, withLabel(MOD.preApproved, 'Pre-Approved Visitors'), withLabel(MOD.deliveries, 'Delivery Management'),
      withLabel(MOD.staffEntry, 'Staff Entry / Exit'), withLabel(MOD.vehicleEntry, 'Vehicle Entry / Exit'),
      withLabel(MOD.directory, 'Resident Directory (View Only)'), MOD.emergency, MOD.incidents,
      withLabel(MOD.notices, 'Notices from Management'), withLabel(MOD.shift, 'My Shift & Handover'), MOD.settings,
    ],
    quickActions: [MOD.callResident, withLabel(MOD.emergency, 'Emergency'), withLabel(MOD.incidents, 'Report Incident')],
    tabs: { second: withLabel(MOD.visitorLog, 'Entries'), centre: MOD.scanQr, fourth: MOD.contacts },
  },
};

/** Every module key → definition, for the "Coming soon" screen. */
export const MODULES: Record<string, NavItem> = Object.fromEntries(
  Object.values(MOD).map((item) => [item.key, item]),
);

/** Roles available to a user, in default order (staff roles first). */
export function availableRoles(user: Pick<UserDto, 'adminSocietyIds' | 'guardSocietyIds' | 'platformRole'>): AppRole[] {
  const roles: AppRole[] = [];
  if ((user.adminSocietyIds?.length ?? 0) > 0 || user.platformRole === 'PLATFORM_ADMIN') roles.push('ADMIN');
  if ((user.guardSocietyIds?.length ?? 0) > 0) roles.push('GUARD');
  roles.push('RESIDENT');
  return roles;
}

export const ROLE_LABEL: Record<AppRole, string> = { RESIDENT: 'Resident', ADMIN: 'Society Admin', GUARD: 'Security Guard' };
