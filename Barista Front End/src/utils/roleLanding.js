// Where a signed-in person lands when nothing else said where to go.
//
// Steve: coming through the sign-in page should end on /welcome (the
// section chooser), not the customer order page -- and an account that
// only has one section (a barista, a display login) should go straight
// to it. Explicit destinations (a protected link they were bounced from,
// or ?redirect=) always win over this default.
export const roleLanding = (role) => {
  const r = String(role || '').trim().toLowerCase();
  if (r === 'barista') return '/barista';
  if (r === 'support') return '/support';
  if (r === 'display' || r === 'screen') return '/displays';
  // admin / staff / organiser / event_organizer / unknown: the chooser.
  return '/welcome';
};

export default roleLanding;
