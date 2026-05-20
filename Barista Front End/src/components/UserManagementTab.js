// components/UserManagementTab.js
import React, { useState, useEffect } from 'react';
import {
  UserPlus, Edit2, Trash2, Save, X, Coffee, Star,
  Clock, Award, Calendar, Shield, Eye, EyeOff,
  ChevronDown, ChevronUp, Search, Filter, User
} from 'lucide-react';
import useStations from '../hooks/useStations';
import ApiServiceClass from '../services/ApiService';

// One ApiService instance per component import — request() handles
// JWT refresh and base URL automatically.
const apiService = new ApiServiceClass();

// localStorage key for the rich metadata (skills, availability, notes)
// that the backend's users table doesn't track yet. Identity-relevant
// fields (username, email, role, password) live in Postgres via
// /api/users and survive across devices. Enrichment is keyed by username
// so it follows the canonical row from the backend.
const ENRICHMENT_KEY = 'coffee_system_user_enrichment';

const _loadEnrichment = () => {
  try {
    return JSON.parse(localStorage.getItem(ENRICHMENT_KEY) || '{}');
  } catch (_) {
    return {};
  }
};

const _saveEnrichment = (enrichment) => {
  try {
    localStorage.setItem(ENRICHMENT_KEY, JSON.stringify(enrichment));
  } catch (e) {
    console.error('Could not save user enrichment to localStorage:', e);
  }
};

const UserManagementTab = () => {
  // Pull real stations from the backend so the preferred-station dropdown
  // isn't capped at the hardcoded ['1','2','3']. Falls back to an empty
  // list while loading, which is the same as "no preference".
  const { stations: availableStations = [] } = useStations() || {};
  const [users, setUsers] = useState([]);
  const [showAddUser, setShowAddUser] = useState(false);
  const [editingUser, setEditingUser] = useState(null);
  const [searchTerm, setSearchTerm] = useState('');
  const [filterRole, setFilterRole] = useState('all');
  const [expandedUser, setExpandedUser] = useState(null);
  const [showPassword, setShowPassword] = useState({});
  
  // Form state for new/edit user
  const [userForm, setUserForm] = useState({
    username: '',
    password: '',
    confirmPassword: '',
    email: '',
    fullName: '',
    role: 'barista',
    phone: '',
    experience: 'beginner',
    skills: {
      espresso: false,
      latte_art: false,
      customer_service: false,
      inventory_management: false,
      speed: false,
      training_others: false
    },
    availability: {
      monday: { available: false, start: '08:00', end: '17:00' },
      tuesday: { available: false, start: '08:00', end: '17:00' },
      wednesday: { available: false, start: '08:00', end: '17:00' },
      thursday: { available: false, start: '08:00', end: '17:00' },
      friday: { available: false, start: '08:00', end: '17:00' },
      saturday: { available: false, start: '08:00', end: '17:00' },
      sunday: { available: false, start: '08:00', end: '17:00' }
    },
    preferredStation: '',
    certifications: [],
    notes: '',
    active: true
  });

  // Loading / error state for the API roundtrips.
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);

  // Load users from the backend on mount, merging with the local
  // enrichment store for the fields the backend doesn't persist
  // (skills, availability, notes, fullName, etc.).
  useEffect(() => {
    loadUsers();
  }, []);

  const loadUsers = async () => {
    setLoading(true);
    setError(null);
    try {
      const resp = await apiService.get('/users');
      const dbUsers = resp?.data || resp?.users || [];
      const enrichment = _loadEnrichment();

      // Merge backend rows with local enrichment, keyed by username.
      const merged = dbUsers.map((u) => {
        const extras = enrichment[u.username] || {};
        return {
          ...extras,
          id: u.id,
          username: u.username,
          email: u.email || extras.email || '',
          role: u.role,
          active: u.is_active !== false,
          last_login: u.last_login,
          password: '***',  // never display — the backend stores a hash
        };
      });
      setUsers(merged);
    } catch (err) {
      console.error('Error loading users:', err);
      setError(
        `Could not load users from the backend: ${err.message || err}. ` +
        `Falling back to local cache (this device only).`
      );
      // Best-effort fallback so the panel still renders something.
      const enrichment = _loadEnrichment();
      setUsers(
        Object.entries(enrichment).map(([username, extras]) => ({
          ...extras,
          username,
          id: extras.id || `local_${username}`,
          password: '***',
        }))
      );
    } finally {
      setLoading(false);
    }
  };

  const handleAddUser = async () => {
    if (!userForm.username || !userForm.password || !userForm.fullName) {
      alert('Please fill in all required fields');
      return;
    }

    if (userForm.password !== userForm.confirmPassword) {
      alert('Passwords do not match');
      return;
    }

    // Check if username already exists locally (defensive — backend
    // also checks).
    if (users.some(u => u.username === userForm.username)) {
      alert('Username already exists');
      return;
    }

    setLoading(true);
    setError(null);
    try {
      // Backend takes the basic identity fields. The rich
      // skills/availability/notes go into local enrichment so they
      // appear next time we render this list (per-device cache).
      const resp = await apiService.post('/users', {
        username: userForm.username,
        email: userForm.email,
        role: userForm.role,
        password: userForm.password,
      });
      const created = resp?.data || resp;
      const enrichment = _loadEnrichment();
      enrichment[userForm.username] = {
        fullName: userForm.fullName,
        phone: userForm.phone,
        experience: userForm.experience,
        skills: userForm.skills,
        availability: userForm.availability,
        preferredStation: userForm.preferredStation,
        certifications: userForm.certifications,
        notes: userForm.notes,
        createdAt: new Date().toISOString(),
      };
      _saveEnrichment(enrichment);
      await loadUsers();
      resetForm();
      setShowAddUser(false);
    } catch (err) {
      console.error('Error adding user:', err);
      setError(`Could not add user: ${err.message || err}`);
    } finally {
      setLoading(false);
    }
  };

  const handleUpdateUser = async () => {
    if (!userForm.username || !userForm.fullName) {
      alert('Please fill in all required fields');
      return;
    }

    const existing = users.find(u => u.id === editingUser);
    if (!existing) return;

    setLoading(true);
    setError(null);
    try {
      // Send the identity fields the backend cares about.
      const updatePayload = {
        username: userForm.username,
        email: userForm.email,
        role: userForm.role,
      };
      if (userForm.password) {
        // Password change — backend re-hashes server-side.
        updatePayload.password = userForm.password;
      }
      if (typeof userForm.active === 'boolean') {
        updatePayload.is_active = userForm.active;
      }
      await apiService.put(`/users/${existing.id}`, updatePayload);

      // Update the enrichment row keyed by the (possibly new) username.
      const enrichment = _loadEnrichment();
      if (existing.username !== userForm.username) {
        delete enrichment[existing.username];
      }
      enrichment[userForm.username] = {
        fullName: userForm.fullName,
        phone: userForm.phone,
        experience: userForm.experience,
        skills: userForm.skills,
        availability: userForm.availability,
        preferredStation: userForm.preferredStation,
        certifications: userForm.certifications,
        notes: userForm.notes,
        updatedAt: new Date().toISOString(),
      };
      _saveEnrichment(enrichment);
      await loadUsers();
      resetForm();
      setEditingUser(null);
    } catch (err) {
      console.error('Error updating user:', err);
      setError(`Could not update user: ${err.message || err}`);
    } finally {
      setLoading(false);
    }
  };

  const handleDeleteUser = async (userId) => {
    if (!window.confirm('Are you sure you want to delete this user?')) return;
    const target = users.find(u => u.id === userId);
    setLoading(true);
    setError(null);
    try {
      await apiService.delete(`/users/${userId}`);
      // Tidy up local enrichment too.
      if (target?.username) {
        const enrichment = _loadEnrichment();
        delete enrichment[target.username];
        _saveEnrichment(enrichment);
      }
      await loadUsers();
    } catch (err) {
      console.error('Error deleting user:', err);
      setError(`Could not delete user: ${err.message || err}`);
    } finally {
      setLoading(false);
    }
  };

  const resetForm = () => {
    setUserForm({
      username: '',
      password: '',
      confirmPassword: '',
      email: '',
      fullName: '',
      role: 'barista',
      phone: '',
      experience: 'beginner',
      skills: {
        espresso: false,
        latte_art: false,
        customer_service: false,
        inventory_management: false,
        speed: false,
        training_others: false
      },
      availability: {
        monday: { available: false, start: '08:00', end: '17:00' },
        tuesday: { available: false, start: '08:00', end: '17:00' },
        wednesday: { available: false, start: '08:00', end: '17:00' },
        thursday: { available: false, start: '08:00', end: '17:00' },
        friday: { available: false, start: '08:00', end: '17:00' },
        saturday: { available: false, start: '08:00', end: '17:00' },
        sunday: { available: false, start: '08:00', end: '17:00' }
      },
      preferredStation: '',
      certifications: [],
      notes: '',
      active: true
    });
  };

  const startEdit = (user) => {
    setUserForm({
      ...user,
      password: '',
      confirmPassword: ''
    });
    setEditingUser(user.id);
    setShowAddUser(false);
  };

  const filteredUsers = users.filter(user => {
    const matchesSearch = user.fullName.toLowerCase().includes(searchTerm.toLowerCase()) ||
                         user.username.toLowerCase().includes(searchTerm.toLowerCase()) ||
                         user.email.toLowerCase().includes(searchTerm.toLowerCase());
    const matchesRole = filterRole === 'all' || user.role === filterRole;
    return matchesSearch && matchesRole;
  });

  const getExperienceColor = (experience) => {
    switch (experience) {
      case 'expert': return 'text-purple-600 bg-purple-100';
      case 'advanced': return 'text-blue-600 bg-blue-100';
      case 'intermediate': return 'text-green-600 bg-green-100';
      default: return 'text-gray-600 bg-gray-100';
    }
  };

  const getRoleBadgeColor = (role) => {
    switch (role) {
      case 'admin': return 'bg-red-100 text-red-700';
      case 'organizer': return 'bg-purple-100 text-purple-700';
      case 'barista': return 'bg-amber-100 text-amber-700';
      default: return 'bg-gray-100 text-gray-700';
    }
  };

  return (
    <div className="space-y-6">
      {/* Loading + error banners — surface backend round-trip status. */}
      {loading && (
        <div className="bg-blue-50 border border-blue-200 text-blue-800 px-3 py-2 rounded text-sm">
          Loading users from the server…
        </div>
      )}
      {error && (
        <div className="bg-red-50 border border-red-200 text-red-800 px-3 py-2 rounded text-sm flex items-center justify-between">
          <span>{error}</span>
          <button onClick={() => setError(null)} className="ml-2"><X size={16} /></button>
        </div>
      )}

      {/* Header and Actions */}
      <div className="flex justify-between items-center">
        <div>
          <h2 className="text-2xl font-bold">User Management</h2>
          <p className="text-gray-600">
            Manage barista profiles, skills, and schedules.
            <span className="text-xs text-gray-500 ml-2">
              Identity (username/email/role/password) is saved to the
              backend. Skills, availability and notes are cached locally
              per-device.
            </span>
          </p>
        </div>
        <button
          onClick={() => {
            resetForm();
            setShowAddUser(true);
            setEditingUser(null);
          }}
          className="bg-amber-600 text-white px-4 py-2 rounded-lg hover:bg-amber-700 flex items-center gap-2"
        >
          <UserPlus size={18} />
          Add New User
        </button>
      </div>

      {/* Filters */}
      <div className="bg-white rounded-lg shadow-sm p-4">
        <div className="flex gap-4 items-center">
          <div className="flex-1 flex items-center gap-2">
            <Search size={18} className="text-gray-500" />
            <input
              type="text"
              placeholder="Search users by name, username, or email..."
              value={searchTerm}
              onChange={(e) => setSearchTerm(e.target.value)}
              className="flex-1 border rounded px-3 py-1"
            />
          </div>
          
          <div className="flex items-center gap-2">
            <Filter size={18} className="text-gray-500" />
            <select
              value={filterRole}
              onChange={(e) => setFilterRole(e.target.value)}
              className="border rounded px-3 py-1"
            >
              <option value="all">All Roles</option>
              <option value="barista">Baristas</option>
              <option value="organizer">Organizers</option>
              <option value="admin">Admins</option>
            </select>
          </div>
        </div>
      </div>

      {/* Add/Edit User Form */}
      {(showAddUser || editingUser) && (
        <div className="bg-white rounded-lg shadow-sm p-6">
          <h3 className="text-lg font-bold mb-4">
            {editingUser ? 'Edit User' : 'Add New User'}
          </h3>
          
          <div className="grid grid-cols-2 gap-4">
            {/* Basic Info */}
            <div className="space-y-4">
              <div>
                <label className="block text-sm font-medium mb-1">Username *</label>
                <input
                  type="text"
                  value={userForm.username}
                  onChange={(e) => setUserForm({...userForm, username: e.target.value})}
                  className="w-full border rounded px-3 py-2"
                  disabled={editingUser}
                />
              </div>
              
              <div>
                <label className="block text-sm font-medium mb-1">Full Name *</label>
                <input
                  type="text"
                  value={userForm.fullName}
                  onChange={(e) => setUserForm({...userForm, fullName: e.target.value})}
                  className="w-full border rounded px-3 py-2"
                />
              </div>
              
              <div>
                <label className="block text-sm font-medium mb-1">Email</label>
                <input
                  type="email"
                  value={userForm.email}
                  onChange={(e) => setUserForm({...userForm, email: e.target.value})}
                  className="w-full border rounded px-3 py-2"
                />
              </div>
              
              <div>
                <label className="block text-sm font-medium mb-1">Phone</label>
                <input
                  type="tel"
                  value={userForm.phone}
                  onChange={(e) => setUserForm({...userForm, phone: e.target.value})}
                  className="w-full border rounded px-3 py-2"
                />
              </div>
              
              <div>
                <label className="block text-sm font-medium mb-1">Role *</label>
                <select
                  value={userForm.role}
                  onChange={(e) => setUserForm({...userForm, role: e.target.value})}
                  className="w-full border rounded px-3 py-2"
                >
                  <option value="barista">Barista</option>
                  <option value="organizer">Organizer</option>
                  <option value="admin">Admin</option>
                </select>
              </div>
              
              {!editingUser && (
                <>
                  <div>
                    <label className="block text-sm font-medium mb-1">Password *</label>
                    <div className="relative">
                      <input
                        type={showPassword.new ? "text" : "password"}
                        value={userForm.password}
                        onChange={(e) => setUserForm({...userForm, password: e.target.value})}
                        className="w-full border rounded px-3 py-2 pr-10"
                      />
                      <button
                        type="button"
                        onClick={() => setShowPassword({...showPassword, new: !showPassword.new})}
                        className="absolute right-2 top-1/2 -translate-y-1/2 text-gray-500"
                      >
                        {showPassword.new ? <EyeOff size={18} /> : <Eye size={18} />}
                      </button>
                    </div>
                  </div>
                  
                  <div>
                    <label className="block text-sm font-medium mb-1">Confirm Password *</label>
                    <input
                      type="password"
                      value={userForm.confirmPassword}
                      onChange={(e) => setUserForm({...userForm, confirmPassword: e.target.value})}
                      className="w-full border rounded px-3 py-2"
                    />
                  </div>
                </>
              )}
            </div>
            
            {/* Skills and Experience */}
            <div className="space-y-4">
              <div>
                <label className="block text-sm font-medium mb-1">Experience Level</label>
                <select
                  value={userForm.experience}
                  onChange={(e) => setUserForm({...userForm, experience: e.target.value})}
                  className="w-full border rounded px-3 py-2"
                >
                  <option value="beginner">Beginner (0-1 years)</option>
                  <option value="intermediate">Intermediate (1-3 years)</option>
                  <option value="advanced">Advanced (3-5 years)</option>
                  <option value="expert">Expert (5+ years)</option>
                </select>
              </div>
              
              <div>
                <label className="block text-sm font-medium mb-1">Preferred Station</label>
                <select
                  value={userForm.preferredStation}
                  onChange={(e) => setUserForm({...userForm, preferredStation: e.target.value})}
                  className="w-full border rounded px-3 py-2"
                >
                  <option value="">No preference</option>
                  {availableStations.map(station => (
                    <option key={station.id} value={station.id}>
                      {station.name || `Station ${station.id}`}
                    </option>
                  ))}
                </select>
              </div>
              
              <div>
                <label className="block text-sm font-medium mb-2">Skills</label>
                <div className="space-y-2">
                  {Object.entries({
                    espresso: 'Espresso Making',
                    latte_art: 'Latte Art',
                    customer_service: 'Customer Service',
                    inventory_management: 'Inventory Management',
                    speed: 'High-Speed Service',
                    training_others: 'Training Others'
                  }).map(([key, label]) => (
                    <label key={key} className="flex items-center gap-2">
                      <input
                        type="checkbox"
                        checked={userForm.skills[key]}
                        onChange={(e) => setUserForm({
                          ...userForm,
                          skills: {...userForm.skills, [key]: e.target.checked}
                        })}
                        className="rounded"
                      />
                      <span className="text-sm">{label}</span>
                    </label>
                  ))}
                </div>
              </div>
              
              <div>
                <label className="block text-sm font-medium mb-1">Notes</label>
                <textarea
                  value={userForm.notes}
                  onChange={(e) => setUserForm({...userForm, notes: e.target.value})}
                  className="w-full border rounded px-3 py-2"
                  rows="3"
                  placeholder="Additional notes about this user..."
                />
              </div>
              
              <div>
                <label className="flex items-center gap-2">
                  <input
                    type="checkbox"
                    checked={userForm.active}
                    onChange={(e) => setUserForm({...userForm, active: e.target.checked})}
                    className="rounded"
                  />
                  <span className="text-sm font-medium">Active User</span>
                </label>
              </div>
            </div>
          </div>
          
          {/* Action Buttons */}
          <div className="flex justify-end gap-2 mt-6 pt-4 border-t">
            <button
              onClick={() => {
                resetForm();
                setShowAddUser(false);
                setEditingUser(null);
              }}
              className="px-4 py-2 border rounded hover:bg-gray-50"
            >
              Cancel
            </button>
            <button
              onClick={editingUser ? handleUpdateUser : handleAddUser}
              className="px-4 py-2 bg-amber-600 text-white rounded hover:bg-amber-700 flex items-center gap-2"
            >
              <Save size={18} />
              {editingUser ? 'Update User' : 'Create User'}
            </button>
          </div>
        </div>
      )}

      {/* Users List */}
      <div className="bg-white rounded-lg shadow-sm">
        {filteredUsers.length > 0 ? (
          <div className="divide-y">
            {filteredUsers.map(user => (
              <div key={user.id} className="p-4">
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-4">
                    <div className="w-12 h-12 rounded-full bg-amber-100 flex items-center justify-center">
                      <User size={20} className="text-amber-700" />
                    </div>
                    <div>
                      <div className="flex items-center gap-2">
                        <h4 className="font-bold">{user.fullName}</h4>
                        <span className={`text-xs px-2 py-0.5 rounded ${getRoleBadgeColor(user.role)}`}>
                          {user.role}
                        </span>
                        {!user.active && (
                          <span className="text-xs px-2 py-0.5 rounded bg-gray-100 text-gray-600">
                            Inactive
                          </span>
                        )}
                      </div>
                      <div className="text-sm text-gray-600">
                        @{user.username} • {user.email}
                      </div>
                      <div className="flex items-center gap-4 mt-1">
                        <span className={`text-xs px-2 py-0.5 rounded ${getExperienceColor(user.experience)}`}>
                          {user.experience}
                        </span>
                        {user.preferredStation && (
                          <span className="text-xs text-gray-500">
                            Prefers Station {user.preferredStation}
                          </span>
                        )}
                        {user.stats && user.stats.totalOrders > 0 && (
                          <>
                            <span className="text-xs text-gray-500">
                              {user.stats.totalOrders} orders
                            </span>
                            <span className="text-xs text-gray-500">
                              Avg {user.stats.avgPrepTime}min
                            </span>
                            {user.stats.rating > 0 && (
                              <span className="text-xs text-gray-500 flex items-center gap-1">
                                <Star size={12} className="text-yellow-500" />
                                {user.stats.rating}
                              </span>
                            )}
                          </>
                        )}
                      </div>
                    </div>
                  </div>
                  
                  <div className="flex items-center gap-2">
                    <button
                      onClick={() => setExpandedUser(expandedUser === user.id ? null : user.id)}
                      className="p-2 hover:bg-gray-100 rounded"
                    >
                      {expandedUser === user.id ? <ChevronUp size={18} /> : <ChevronDown size={18} />}
                    </button>
                    <button
                      onClick={() => startEdit(user)}
                      className="p-2 hover:bg-gray-100 rounded text-blue-600"
                    >
                      <Edit2 size={18} />
                    </button>
                    <button
                      onClick={() => handleDeleteUser(user.id)}
                      className="p-2 hover:bg-gray-100 rounded text-red-600"
                    >
                      <Trash2 size={18} />
                    </button>
                  </div>
                </div>
                
                {/* Expanded Details */}
                {expandedUser === user.id && (
                  <div className="mt-4 pt-4 border-t">
                    <div className="grid grid-cols-2 gap-4">
                      <div>
                        <h5 className="font-medium mb-2">Skills</h5>
                        <div className="flex flex-wrap gap-2">
                          {Object.entries(user.skills || {}).filter(([_, value]) => value).map(([skill]) => (
                            <span key={skill} className="text-xs bg-green-100 text-green-700 px-2 py-1 rounded">
                              {skill.replace(/_/g, ' ')}
                            </span>
                          ))}
                        </div>
                      </div>
                      
                      {user.availability && (
                        <div>
                          <h5 className="font-medium mb-2">Availability</h5>
                          <div className="text-xs space-y-1">
                            {Object.entries(user.availability).filter(([_, day]) => day.available).map(([dayName, day]) => (
                              <div key={dayName}>
                                <span className="capitalize">{dayName}:</span> {day.start} - {day.end}
                              </div>
                            ))}
                          </div>
                        </div>
                      )}
                    </div>
                    
                    {user.notes && (
                      <div className="mt-4">
                        <h5 className="font-medium mb-1">Notes</h5>
                        <p className="text-sm text-gray-600">{user.notes}</p>
                      </div>
                    )}
                  </div>
                )}
              </div>
            ))}
          </div>
        ) : (
          <div className="p-8 text-center text-gray-500">
            <User size={48} className="mx-auto mb-2 text-gray-300" />
            <p>No users found</p>
          </div>
        )}
      </div>
    </div>
  );
};

export default UserManagementTab;