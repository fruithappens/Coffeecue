import React, { useState, useEffect } from 'react';
import { Panel, Button, Pill, TextField } from '../../design';
import { 
  Users, 
  UserPlus, 
  Edit, 
  Trash2, 
  Key,
  Shield,
  Search,
  Filter,
  Download,
  UserCheck,
  UserX
} from 'lucide-react';
import ApiServiceClass from '../../services/ApiService';
import { showToast } from '../shared/Toast';
import { askConfirm, tell } from '../shared/ConfirmDialog';

// Turn a raw API/DB error into something an operator can act on. The most
// common one here is a duplicate email/username — the DB throws a unique-
// constraint violation that used to be swallowed to the console, so a save
// just silently did nothing (Steve).
const friendlyUserError = (error, fallback) => {
  const raw = String((error && (error.message || error.error)) || '').toLowerCase();
  if (raw.includes('users_email_key') || (raw.includes('email') && (raw.includes('duplicate') || raw.includes('already exists') || raw.includes('unique')))) {
    return 'That email is already used by another account. Use a different email, or leave it blank.';
  }
  if (raw.includes('users_username_key') || (raw.includes('username') && (raw.includes('duplicate') || raw.includes('already exists') || raw.includes('unique')))) {
    return 'That username is already taken. Pick a different username.';
  }
  if (raw.includes('401') || raw.includes('unauthor') || raw.includes('token')) {
    return 'Your session expired — please log out and back in, then try again.';
  }
  return (error && error.message) ? `${fallback}: ${error.message}` : fallback;
};

// Create an instance of ApiService
const ApiService = new ApiServiceClass();

const UsersAccessTab = () => {
  const [users, setUsers] = useState([]);
  const [filteredUsers, setFilteredUsers] = useState([]);
  const [roles, setRoles] = useState(['admin', 'organizer', 'barista', 'support']);
  const [searchTerm, setSearchTerm] = useState('');
  const [filterRole, setFilterRole] = useState('all');
  const [showAddUser, setShowAddUser] = useState(false);
  const [editingUser, setEditingUser] = useState(null);
  const [loading, setLoading] = useState(false);
  
  const [newUser, setNewUser] = useState({
    username: '',
    email: '',
    role: 'barista',
    password: ''
  });

  useEffect(() => {
    loadUsers();
  }, []);

  useEffect(() => {
    filterUsers();
  }, [users, searchTerm, filterRole]);

  const loadUsers = async () => {
    try {
      const response = await ApiService.get('/users');
      setUsers(response.data || []);
    } catch (error) {
      console.error('Error loading users:', error);
    }
  };

  const filterUsers = () => {
    let filtered = users;
    
    if (searchTerm) {
      filtered = filtered.filter(user => 
        user.username.toLowerCase().includes(searchTerm.toLowerCase()) ||
        user.email?.toLowerCase().includes(searchTerm.toLowerCase())
      );
    }
    
    if (filterRole !== 'all') {
      filtered = filtered.filter(user => user.role === filterRole);
    }
    
    setFilteredUsers(filtered);
  };

  const handleAddUser = async () => {
    if (!newUser.username || !newUser.password) return;
    
    setLoading(true);
    try {
      await ApiService.post('/users', newUser);
      await loadUsers();
      setShowAddUser(false);
      setNewUser({ username: '', email: '', role: 'barista', password: '' });
      showToast('User added', 'success');
    } catch (error) {
      console.error('Error adding user:', error);
      showToast(friendlyUserError(error, 'Could not add that user'), 'error', 7000);
    } finally {
      setLoading(false);
    }
  };

  const handleUpdateUser = async (userId, updates) => {
    setLoading(true);
    try {
      await ApiService.put(`/users/${userId}`, updates);
      await loadUsers();
      setEditingUser(null);
      showToast('User updated', 'success');
    } catch (error) {
      console.error('Error updating user:', error);
      showToast(friendlyUserError(error, 'Could not save that change'), 'error', 7000);
    } finally {
      setLoading(false);
    }
  };

  const handleDeleteUser = async (userId) => {
    if (!(await askConfirm({ title: 'Delete this user?', message: 'They will not be able to sign in again. This cannot be undone.', confirmLabel: 'Delete', danger: true }))) return;

    setLoading(true);
    try {
      await ApiService.delete(`/users/${userId}`);
      await loadUsers();
      showToast('User deleted', 'success');
    } catch (error) {
      console.error('Error deleting user:', error);
      showToast(friendlyUserError(error, 'Could not delete that user'), 'error', 7000);
    } finally {
      setLoading(false);
    }
  };

  const handleResetPassword = async (userId) => {
    if (!(await askConfirm({ title: 'Reset this password?', message: 'A new password is generated and shown to you once. The old one stops working immediately.', confirmLabel: 'Reset' }))) return;

    setLoading(true);
    try {
      const response = await ApiService.post(`/users/${userId}/reset-password`);
      // A box, not a toast: this has to be read and copied before it is gone.
      await tell({ title: 'New password', message: `${response.data.newPassword}\n\nGive it to them now — it is not shown again.`, confirmLabel: 'Done' });
    } catch (error) {
      console.error('Error resetting password:', error);
      showToast(friendlyUserError(error, 'Could not reset the password'), 'error', 7000);
    } finally {
      setLoading(false);
    }
  };

  const toggleUserStatus = async (userId, currentStatus) => {
    setLoading(true);
    try {
      await ApiService.post(`/users/${userId}/toggle-status`, {
        is_active: !currentStatus
      });
      await loadUsers();
    } catch (error) {
      console.error('Error toggling user status:', error);
    } finally {
      setLoading(false);
    }
  };

  const exportUsers = () => {
    const csv = [
      ['Username', 'Email', 'Role', 'Status', 'Last Login'],
      ...filteredUsers.map(user => [
        user.username,
        user.email || '',
        user.role,
        user.is_active ? 'Active' : 'Inactive',
        user.last_login || 'Never'
      ])
    ].map(row => row.join(',')).join('\n');
    
    const blob = new Blob([csv], { type: 'text/csv' });
    const url = window.URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = 'users_export.csv';
    a.click();
  };

  return (
    <div className="space-y-6">
      {/* User Management Header */}
      <Panel title={<span className="flex items-center justify-between"><span className="flex items-center gap-2">
              <Users className="h-5 w-5" />
              User Management
            </span>
            <span className="flex gap-2">
              <Button 
                variant="secondary" 
                size="sm"
                onClick={exportUsers}
              >
                <Download className="h-4 w-4 mr-2" />
                Export
              </Button>
              <Button 
                size="sm"
                onClick={() => setShowAddUser(true)}
              >
                <UserPlus className="h-4 w-4 mr-2" />
                Add User
              </Button>
            </span></span>}>
          {/* Search and Filter */}
          <div className="flex gap-4 mb-4">
            <div className="flex-1 relative">
              <Search className="absolute left-3 top-1/2 transform -translate-y-1/2 h-4 w-4 text-cq-ink-3" />
              <TextField width="w-full"
                placeholder="Search users..."
                value={searchTerm}
                onChange={(v) => setSearchTerm(v)}
                className="pl-10"
              />
            </div>
            <select
              value={filterRole}
              onChange={(e) => setFilterRole(e.target.value)}
              className="px-3 py-2 border-2 border-cq-line rounded-cq-md bg-cq-milk"
            >
              <option value="all">All Roles</option>
              {roles.map(role => (
                <option key={role} value={role}>
                  {role.charAt(0).toUpperCase() + role.slice(1)}
                </option>
              ))}
            </select>
          </div>

          {/* Users Table */}
          <div className="overflow-x-auto">
            <table className="w-full">
              <thead className="border-b">
                <tr>
                  <th className="text-left p-2">Username</th>
                  <th className="text-left p-2">Email</th>
                  <th className="text-left p-2">Role</th>
                  <th className="text-left p-2">Status</th>
                  <th className="text-left p-2">Last Login</th>
                  <th className="text-left p-2">Actions</th>
                </tr>
              </thead>
              <tbody>
                {filteredUsers.map(user => (
                  <tr key={user.id} className="border-b hover:bg-cq-wash">
                    <td className="p-2">
                      {editingUser === user.id ? (
                        <TextField width="w-full"
                          value={user.username}
                          onChange={(v) => {
                            const updated = users.map(u => 
                              u.id === user.id ? { ...u, username: v } : u
                            );
                            setUsers(updated);
                          }}
                          className="w-32"
                        />
                      ) : (
                        user.username
                      )}
                    </td>
                    <td className="p-2">
                      {editingUser === user.id ? (
                        <TextField width="w-full"
                          value={user.email || ''}
                          onChange={(v) => {
                            const updated = users.map(u => 
                              u.id === user.id ? { ...u, email: v } : u
                            );
                            setUsers(updated);
                          }}
                          className="w-48"
                        />
                      ) : (
                        user.email || '-'
                      )}
                    </td>
                    <td className="p-2">
                      {editingUser === user.id ? (
                        <select
                          value={user.role}
                          onChange={(e) => {
                            const updated = users.map(u => 
                              u.id === user.id ? { ...u, role: e.target.value } : u
                            );
                            setUsers(updated);
                          }}
                          className="px-2 py-1 border-2 border-cq-line rounded-cq-md bg-cq-milk"
                        >
                          {roles.map(role => (
                            <option key={role} value={role}>
                              {role.charAt(0).toUpperCase() + role.slice(1)}
                            </option>
                          ))}
                        </select>
                      ) : (
                        <Pill size="sm" tone="neutral">
                          {user.role}
                        </Pill>
                      )}
                    </td>
                    <td className="p-2">
                      <Pill size="sm" tone={user.is_active ? 'ready' : 'neutral'}>
                        {user.is_active ? 'Active' : 'Inactive'}
                      </Pill>
                    </td>
                    <td className="p-2 text-sm text-cq-ink-2">
                      {user.last_login ? new Date(user.last_login).toLocaleDateString() : 'Never'}
                    </td>
                    <td className="p-2">
                      <div className="flex gap-1">
                        {editingUser === user.id ? (
                          <>
                            <Button
                              size="sm"
                              variant="ghost"
                              onClick={() => handleUpdateUser(user.id, {
                                username: user.username,
                                email: user.email,
                                role: user.role
                              })}
                              disabled={loading}
                            >
                              Save
                            </Button>
                            <Button
                              size="sm"
                              variant="ghost"
                              onClick={() => {
                                setEditingUser(null);
                                loadUsers();
                              }}
                            >
                              Cancel
                            </Button>
                          </>
                        ) : (
                          <>
                            <Button
                              size="sm"
                              variant="ghost"
                              onClick={() => setEditingUser(user.id)}
                            >
                              <Edit className="h-4 w-4" />
                            </Button>
                            <Button
                              size="sm"
                              variant="ghost"
                              onClick={() => handleResetPassword(user.id)}
                              disabled={loading}
                            >
                              <Key className="h-4 w-4" />
                            </Button>
                            <Button
                              size="sm"
                              variant="ghost"
                              onClick={() => toggleUserStatus(user.id, user.is_active)}
                              disabled={loading}
                            >
                              {user.is_active ? 
                                <UserX className="h-4 w-4" /> : 
                                <UserCheck className="h-4 w-4" />
                              }
                            </Button>
                            <Button
                              size="sm"
                              variant="ghost"
                              onClick={() => handleDeleteUser(user.id)}
                              disabled={loading}
                              className="text-cq-alert"
                            >
                              <Trash2 className="h-4 w-4" />
                            </Button>
                          </>
                        )}
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Panel>

      {/* Add User Modal */}
      {showAddUser && (
        <Panel title={<span className="flex items-center justify-between">Add New User
              <Button 
                variant="ghost" 
                size="sm"
                onClick={() => setShowAddUser(false)}
              >
                ×
              </Button></span>}>
            <div className="space-y-4">
              <div>
                <label className="block text-sm font-medium mb-1">Username</label>
                <TextField width="w-full"
                  value={newUser.username}
                  onChange={(v) => setNewUser({ ...newUser, username: v })}
                  placeholder="Enter username"
                />
              </div>
              <div>
                <label className="block text-sm font-medium mb-1">Email</label>
                <TextField width="w-full"
                  type="email"
                  value={newUser.email}
                  onChange={(v) => setNewUser({ ...newUser, email: v })}
                  placeholder="Enter email (optional)"
                />
              </div>
              <div>
                <label className="block text-sm font-medium mb-1">Password</label>
                <TextField width="w-full"
                  type="password"
                  value={newUser.password}
                  onChange={(v) => setNewUser({ ...newUser, password: v })}
                  placeholder="Enter password"
                />
              </div>
              <div>
                <label className="block text-sm font-medium mb-1">Role</label>
                <select
                  value={newUser.role}
                  onChange={(e) => setNewUser({ ...newUser, role: e.target.value })}
                  className="w-full px-3 py-2 border-2 border-cq-line rounded-cq-md bg-cq-milk"
                >
                  {roles.map(role => (
                    <option key={role} value={role}>
                      {role.charAt(0).toUpperCase() + role.slice(1)}
                    </option>
                  ))}
                </select>
              </div>
              <div className="flex justify-end gap-2">
                <Button 
                  variant="secondary"
                  onClick={() => setShowAddUser(false)}
                >
                  Cancel
                </Button>
                <Button 
                  onClick={handleAddUser}
                  disabled={loading || !newUser.username || !newUser.password}
                >
                  Add User
                </Button>
              </div>
            </div>
          </Panel>
      )}

      {/* Access Control */}
      <Panel title={<span className="flex items-center gap-2"><Shield className="h-5 w-5" />
            Access Control</span>}>
          <div className="space-y-4">
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              {roles.map(role => (
                <div key={role} className="border-2 border-cq-line rounded-cq-md bg-cq-milk p-4">
                  <h3 className="font-medium mb-2 capitalize">{role}</h3>
                  <div className="space-y-1 text-sm text-cq-ink-2">
                    <p>Active Users: {users.filter(u => u.role === role && u.is_active).length}</p>
                    <p>Total Users: {users.filter(u => u.role === role).length}</p>
                  </div>
                </div>
              ))}
            </div>
          </div>
        </Panel>
    </div>
  );
};

export default UsersAccessTab;