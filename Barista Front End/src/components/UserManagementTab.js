// components/UserManagementTab.js
import React, { useState, useEffect } from 'react';
import { 
  UserPlus, Edit2, Trash2, Save, X, Coffee, Star, 
  Clock, Award, Calendar, Shield, Eye, EyeOff, 
  ChevronDown, ChevronUp, Search, Filter, User
} from 'lucide-react';

const UserManagementTab = () => {
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

  // Load users from localStorage on mount
  useEffect(() => {
    loadUsers();
  }, []);

  const loadUsers = () => {
    try {
      const savedUsers = localStorage.getItem('coffee_system_users');
      if (savedUsers) {
        setUsers(JSON.parse(savedUsers));
      } else {
        // Initialize with some default users
        const defaultUsers = [
          {
            id: 'user_1',
            username: 'barista1',
            email: 'barista1@coffee.com',
            fullName: 'John Smith',
            role: 'barista',
            phone: '555-0101',
            experience: 'intermediate',
            skills: {
              espresso: true,
              latte_art: true,
              customer_service: true,
              inventory_management: false,
              speed: true,
              training_others: false
            },
            preferredStation: '1',
            active: true,
            createdAt: new Date().toISOString(),
            stats: {
              totalOrders: 156,
              avgPrepTime: 3.5,
              rating: 4.8
            }
          }
        ];
        setUsers(defaultUsers);
        localStorage.setItem('coffee_system_users', JSON.stringify(defaultUsers));
      }
    } catch (error) {
      console.error('Error loading users:', error);
    }
  };

  const saveUsers = (updatedUsers) => {
    try {
      localStorage.setItem('coffee_system_users', JSON.stringify(updatedUsers));
      setUsers(updatedUsers);
    } catch (error) {
      console.error('Error saving users:', error);
      alert('Failed to save users');
    }
  };

  const handleAddUser = () => {
    if (!userForm.username || !userForm.password || !userForm.fullName) {
      alert('Please fill in all required fields');
      return;
    }

    if (userForm.password !== userForm.confirmPassword) {
      alert('Passwords do not match');
      return;
    }

    // Check if username already exists
    if (users.some(u => u.username === userForm.username)) {
      alert('Username already exists');
      return;
    }

    const newUser = {
      id: `user_${Date.now()}`,
      ...userForm,
      createdAt: new Date().toISOString(),
      stats: {
        totalOrders: 0,
        avgPrepTime: 0,
        rating: 0
      }
    };

    // Don't store actual password in localStorage (in real app, this would be hashed)
    delete newUser.confirmPassword;
    newUser.password = '***'; // Placeholder

    saveUsers([...users, newUser]);
    resetForm();
    setShowAddUser(false);
  };

  const handleUpdateUser = () => {
    if (!userForm.username || !userForm.fullName) {
      alert('Please fill in all required fields');
      return;
    }

    const updatedUsers = users.map(user => 
      user.id === editingUser 
        ? { 
            ...user, 
            ...userForm,
            password: userForm.password || user.password,
            updatedAt: new Date().toISOString()
          }
        : user
    );

    saveUsers(updatedUsers);
    resetForm();
    setEditingUser(null);
  };

  const handleDeleteUser = (userId) => {
    if (window.confirm('Are you sure you want to delete this user?')) {
      saveUsers(users.filter(u => u.id !== userId));
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
      {/* Header and Actions */}
      <div className="flex justify-between items-center">
        <div>
          <h2 className="text-2xl font-bold">User Management</h2>
          <p className="text-gray-600">Manage barista profiles, skills, and schedules</p>
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
                  <option value="1">Station 1</option>
                  <option value="2">Station 2</option>
                  <option value="3">Station 3</option>
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