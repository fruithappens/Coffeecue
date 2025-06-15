import React, { useState, useEffect } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '../ui/card';
import { Button } from '../ui/button';
import { Badge } from '../ui/badge';
import { Input } from '../ui/input';
import { Select } from '../ui/select';
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
      const response = await ApiService.get('/api/users');
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
      await ApiService.post('/api/users', newUser);
      await loadUsers();
      setShowAddUser(false);
      setNewUser({ username: '', email: '', role: 'barista', password: '' });
    } catch (error) {
      console.error('Error adding user:', error);
    } finally {
      setLoading(false);
    }
  };

  const handleUpdateUser = async (userId, updates) => {
    setLoading(true);
    try {
      await ApiService.put(`/api/users/${userId}`, updates);
      await loadUsers();
      setEditingUser(null);
    } catch (error) {
      console.error('Error updating user:', error);
    } finally {
      setLoading(false);
    }
  };

  const handleDeleteUser = async (userId) => {
    if (!window.confirm('Are you sure you want to delete this user?')) return;
    
    setLoading(true);
    try {
      await ApiService.delete(`/api/users/${userId}`);
      await loadUsers();
    } catch (error) {
      console.error('Error deleting user:', error);
    } finally {
      setLoading(false);
    }
  };

  const handleResetPassword = async (userId) => {
    if (!window.confirm('Reset password for this user?')) return;
    
    setLoading(true);
    try {
      const response = await ApiService.post(`/api/users/${userId}/reset-password`);
      alert(`New password: ${response.data.newPassword}`);
    } catch (error) {
      console.error('Error resetting password:', error);
    } finally {
      setLoading(false);
    }
  };

  const toggleUserStatus = async (userId, currentStatus) => {
    setLoading(true);
    try {
      await ApiService.post(`/api/users/${userId}/toggle-status`, {
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
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center justify-between">
            <span className="flex items-center gap-2">
              <Users className="h-5 w-5" />
              User Management
            </span>
            <div className="flex gap-2">
              <Button 
                variant="outline" 
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
            </div>
          </CardTitle>
        </CardHeader>
        <CardContent>
          {/* Search and Filter */}
          <div className="flex gap-4 mb-4">
            <div className="flex-1 relative">
              <Search className="absolute left-3 top-1/2 transform -translate-y-1/2 h-4 w-4 text-gray-400" />
              <Input
                placeholder="Search users..."
                value={searchTerm}
                onChange={(e) => setSearchTerm(e.target.value)}
                className="pl-10"
              />
            </div>
            <select
              value={filterRole}
              onChange={(e) => setFilterRole(e.target.value)}
              className="px-3 py-2 border rounded-md"
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
                  <tr key={user.id} className="border-b hover:bg-gray-50">
                    <td className="p-2">
                      {editingUser === user.id ? (
                        <Input
                          value={user.username}
                          onChange={(e) => {
                            const updated = users.map(u => 
                              u.id === user.id ? { ...u, username: e.target.value } : u
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
                        <Input
                          value={user.email || ''}
                          onChange={(e) => {
                            const updated = users.map(u => 
                              u.id === user.id ? { ...u, email: e.target.value } : u
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
                          className="px-2 py-1 border rounded"
                        >
                          {roles.map(role => (
                            <option key={role} value={role}>
                              {role.charAt(0).toUpperCase() + role.slice(1)}
                            </option>
                          ))}
                        </select>
                      ) : (
                        <Badge variant="secondary">
                          {user.role}
                        </Badge>
                      )}
                    </td>
                    <td className="p-2">
                      <Badge variant={user.is_active ? 'success' : 'secondary'}>
                        {user.is_active ? 'Active' : 'Inactive'}
                      </Badge>
                    </td>
                    <td className="p-2 text-sm text-gray-600">
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
                              className="text-red-600"
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
        </CardContent>
      </Card>

      {/* Add User Modal */}
      {showAddUser && (
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center justify-between">
              Add New User
              <Button 
                variant="ghost" 
                size="sm"
                onClick={() => setShowAddUser(false)}
              >
                ×
              </Button>
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="space-y-4">
              <div>
                <label className="block text-sm font-medium mb-1">Username</label>
                <Input
                  value={newUser.username}
                  onChange={(e) => setNewUser({ ...newUser, username: e.target.value })}
                  placeholder="Enter username"
                />
              </div>
              <div>
                <label className="block text-sm font-medium mb-1">Email</label>
                <Input
                  type="email"
                  value={newUser.email}
                  onChange={(e) => setNewUser({ ...newUser, email: e.target.value })}
                  placeholder="Enter email (optional)"
                />
              </div>
              <div>
                <label className="block text-sm font-medium mb-1">Password</label>
                <Input
                  type="password"
                  value={newUser.password}
                  onChange={(e) => setNewUser({ ...newUser, password: e.target.value })}
                  placeholder="Enter password"
                />
              </div>
              <div>
                <label className="block text-sm font-medium mb-1">Role</label>
                <select
                  value={newUser.role}
                  onChange={(e) => setNewUser({ ...newUser, role: e.target.value })}
                  className="w-full px-3 py-2 border rounded-md"
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
                  variant="outline"
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
          </CardContent>
        </Card>
      )}

      {/* Access Control */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Shield className="h-5 w-5" />
            Access Control
          </CardTitle>
        </CardHeader>
        <CardContent>
          <div className="space-y-4">
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              {roles.map(role => (
                <div key={role} className="border rounded-lg p-4">
                  <h3 className="font-medium mb-2 capitalize">{role}</h3>
                  <div className="space-y-1 text-sm text-gray-600">
                    <p>Active Users: {users.filter(u => u.role === role && u.is_active).length}</p>
                    <p>Total Users: {users.filter(u => u.role === role).length}</p>
                  </div>
                </div>
              ))}
            </div>
          </div>
        </CardContent>
      </Card>
    </div>
  );
};

export default UsersAccessTab;