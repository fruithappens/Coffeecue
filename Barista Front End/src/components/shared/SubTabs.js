import React from 'react';

// Sub-tab bar used by the grouped sections in both the Organiser and
// Support interfaces. Lives here rather than in either one so the two
// stay visually identical by construction — the previous drift between
// the interfaces came from each growing its own chrome separately.
//
// tabs: [{ id, label, Icon }]  active: id  onChange: (id) => void
const SubTabs = ({ tabs, active, onChange }) => (
  <div className="mb-6 bg-cq-milk p-2 rounded-cq-md shadow grid grid-cols-2 gap-2 sm:flex sm:gap-0">
    {tabs.map(({ id, label, Icon }) => (
      <button
        key={id}
        className={`flex-1 py-2 px-2 sm:px-4 text-sm sm:text-base rounded-md ${active === id ? 'bg-cq-caramel text-white' : 'bg-cq-wash text-cq-ink-2 hover:bg-cq-line'}`}
        onClick={() => onChange(id)}
      >
        <Icon size={16} className="inline-block mr-1" />
        {label}
      </button>
    ))}
  </div>
);

export default SubTabs;
