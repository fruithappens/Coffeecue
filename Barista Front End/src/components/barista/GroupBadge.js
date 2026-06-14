// components/GroupBadge.js
import React from 'react';
import { Users } from 'lucide-react';

/**
 * Small purple tag shown on an order card when the order is part of a GROUP
 * (a multi-drink SMS or a FRIEND order). Tells the barista at a glance that
 * these coffees were ordered together and should be served together.
 *
 * `info` is one entry from buildGroupInfo(): { groupLabel, size, position }.
 */
const GroupBadge = ({ info }) => {
  if (!info || !info.size || info.size < 2) return null;
  const label =
    info.groupLabel && info.groupLabel !== 'Group' ? info.groupLabel : 'Group';
  return (
    <span
      className="inline-flex items-center gap-1 bg-purple-100 text-purple-800 text-xs font-semibold px-2 py-0.5 rounded uppercase tracking-wide whitespace-nowrap"
      title={`${label}: ${info.size} coffees ordered together — serve as one`}
    >
      <Users size={12} /> {info.position}/{info.size}
    </span>
  );
};

export default GroupBadge;
