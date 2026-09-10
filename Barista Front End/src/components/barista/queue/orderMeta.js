// Small readers for the order object as the API ships it (camel and snake
// case both appear). Presentation only -- no state.
import { parseServerDate } from '../../../utils/orderUtils';

export const orderNumberOf = (o) => o.orderNumber || o.order_number || o.id;
export const drinkLine = (o) => [o.size, o.coffeeType || o.coffee_type || 'Coffee'].filter(Boolean).join(' ');
export const milkSugarLine = (o) => [o.milkType || o.milk_type || null, o.sugar || null, o.extraHot ? 'Extra hot' : null].filter(Boolean).join(' · ');
export const notesOf = (o) => o.notes || o.specialInstructions || o.special_instructions || '';
export const messageOf = (o) => o.customerMessage || o.customer_message || '';
export const groupIdOf = (o) => o.groupId || o.group_id || null;
export const isPriority = (o) => !!(o.vip || o.priority);
export const priceOf = (o) => o.priceFormatted || o.price_formatted || null;
// DECAF is a bean, not a note. A customer who asks for it is often asking
// for a reason -- it must be impossible to miss on the card, and it was
// missing entirely: the order carried beanType 'decaf' and nothing on the
// barista's screen said so.
export const isDecaf = (o) => /decaf/i.test(String(o.beanType || o.bean_type || ''));

export const hasPhone = (o) => {
  if (o.hasPhone !== undefined) return !!o.hasPhone;
  const p = String(o.phoneNumber || o.phone_number || o.phone || '').trim().toLowerCase();
  return !!p && p !== 'walk-in' && p !== 'na' && p !== 'n/a';
};

const ago = (ts) => {
  if (!ts) return null;
  const t = parseServerDate(ts).getTime();
  if (Number.isNaN(t)) return null;
  const m = Math.max(0, Math.round((Date.now() - t) / 60000));
  return m === 0 ? 'just now' : `${m} min ago`;
};
// The server's waitTime (minutes) first: it is computed on the server's own
// clock, so it is right whether the server stores UTC (Railway) or local
// time (a Mac). createdAt/startedAt only when waitTime is missing.
const mins = (v) => Math.max(0, Math.round(Number(v) || 0));
export const sinceQueued = (o) => (o.waitTime != null ? `Waiting ${mins(o.waitTime)} min` : (ago(o.createdAt || o.created_at) ? `Ordered ${ago(o.createdAt || o.created_at)}` : ''));
export const sinceStarted = (o) => (o.waitTime != null ? `${mins(o.waitTime)} min since ordered` : (ago(o.startedAt || o.started_at) ? `Started ${ago(o.startedAt || o.started_at)}` : ''));
export const sinceReady = (o) => { const a = ago(o.completedAt || o.completed_at); return a ? `Ready ${a}` : ''; };
