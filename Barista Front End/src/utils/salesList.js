// Sums behind Runner > System > Sales.
export const money = (n) => `$${Math.round(n).toLocaleString('en-AU')}`;

const CLOSED = ['paid', 'lost'];

export const summary = (leads, stages) => {
  const of = (list) => ({ count: list.length, value: list.reduce((t, l) => t + (l.value || 0), 0) });
  const out = { all: of(leads), open: of(leads.filter((l) => !CLOSED.includes(l.stage))) };
  stages.forEach((s) => { out[s] = of(leads.filter((l) => l.stage === s)); });
  return out;
};

// The date here, not the UTC date.
export const localToday = (d = new Date()) =>
  `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;

export const isOverdue = (lead, today) =>
  Boolean(lead.next_date) && lead.next_date < today && !CLOSED.includes(lead.stage);
