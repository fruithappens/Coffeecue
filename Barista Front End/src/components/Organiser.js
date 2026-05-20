// components/Organiser.js
import React from 'react';
import OrganiserInterface from './OrganiserInterface';

// Previously imported EnhancedOrganizerInterface but never rendered
// it — that older interface has been archived to
// _archive_legacy/components_dup_2026_05/. Also dropped a localStorage
// preference toggle ('use_enhanced_organizer') that was just being
// cleared on every mount.
const Organiser = () => {
  return <OrganiserInterface />;
};

export default Organiser;