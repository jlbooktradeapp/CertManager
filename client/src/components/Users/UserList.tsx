import { useQuery } from '@tanstack/react-query';
import {
  Box,
  Typography,
  Card,
  CardContent,
  Table,
  TableBody,
  TableCell,
  TableContainer,
  TableHead,
  TableRow,
  Paper,
  Chip,
  CircularProgress,
  Alert,
  TextField,
  InputAdornment,
} from '@mui/material';
import {
  Search as SearchIcon,
  AdminPanelSettings as AdminIcon,
  ManageAccounts as OperatorIcon,
  Visibility as ViewerIcon,
} from '@mui/icons-material';
import { useState } from 'react';
import { format } from 'date-fns';
import api from '../../services/api';

interface User {
  _id: string;
  username: string;
  email: string;
  displayName: string;
  roles: string[];
  lastLogin?: string;
  createdAt: string;
}

const roleConfig: Record<string, { label: string; color: 'error' | 'warning' | 'default'; icon: JSX.Element }> = {
  admin:    { label: 'Admin',    color: 'error',   icon: <AdminIcon fontSize="small" />    },
  operator: { label: 'Operator', color: 'warning', icon: <OperatorIcon fontSize="small" /> },
  viewer:   { label: 'Viewer',   color: 'default', icon: <ViewerIcon fontSize="small" />   },
};

export default function UserList() {
  const [search, setSearch] = useState('');

  const { data, isLoading, error } = useQuery({
    queryKey: ['users'],
    queryFn: async () => {
      const response = await api.get<{ data: User[]; total: number }>('/users');
      return response.data;
    },
  });

  const users = (data?.data ?? []).filter(u =>
    !search ||
    u.displayName.toLowerCase().includes(search.toLowerCase()) ||
    u.email.toLowerCase().includes(search.toLowerCase()) ||
    u.username.toLowerCase().includes(search.toLowerCase())
  );

  if (isLoading) {
    return (
      <Box sx={{ display: 'flex', justifyContent: 'center', mt: 4 }}>
        <CircularProgress />
      </Box>
    );
  }

  if (error) {
    return <Alert severity="error">Failed to load users</Alert>;
  }

  return (
    <Box>
      <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', mb: 3 }}>
        <Box>
          <Typography variant="h4">Users</Typography>
          <Typography variant="body2" color="text.secondary" sx={{ mt: 0.5 }}>
            All users who have authenticated into CertManager via SAML SSO.
            Roles are managed through Azure Entra group membership and update on next login.
          </Typography>
        </Box>
        <Chip
          label={`${data?.total ?? 0} user${data?.total !== 1 ? 's' : ''}`}
          color="primary"
          variant="outlined"
        />
      </Box>

      <TextField
        placeholder="Search by name, email, or username..."
        value={search}
        onChange={(e) => setSearch(e.target.value)}
        size="small"
        sx={{ mb: 3, minWidth: 320 }}
        InputProps={{
          startAdornment: (
            <InputAdornment position="start">
              <SearchIcon />
            </InputAdornment>
          ),
        }}
      />

      {users.length > 0 ? (
        <TableContainer component={Paper}>
          <Table>
            <TableHead>
              <TableRow>
                <TableCell><strong>Display Name</strong></TableCell>
                <TableCell><strong>Username</strong></TableCell>
                <TableCell><strong>Email</strong></TableCell>
                <TableCell><strong>Role(s)</strong></TableCell>
                <TableCell><strong>Last Login</strong></TableCell>
                <TableCell><strong>First Seen</strong></TableCell>
              </TableRow>
            </TableHead>
            <TableBody>
              {users.map((user) => (
                <TableRow key={user._id} hover>
                  <TableCell>
                    <Typography variant="body2" fontWeight={500}>
                      {user.displayName}
                    </Typography>
                  </TableCell>
                  <TableCell>
                    <Typography variant="body2" sx={{ fontFamily: 'monospace' }}>
                      {user.username}
                    </Typography>
                  </TableCell>
                  <TableCell>
                    <Typography variant="body2" color="text.secondary">
                      {user.email}
                    </Typography>
                  </TableCell>
                  <TableCell>
                    <Box sx={{ display: 'flex', gap: 0.5, flexWrap: 'wrap' }}>
                      {user.roles.map((role) => {
                        const cfg = roleConfig[role] ?? { label: role, color: 'default', icon: null };
                        return (
                          <Chip
                            key={role}
                            label={cfg.label}
                            color={cfg.color}
                            size="small"
                            icon={cfg.icon}
                            variant="outlined"
                          />
                        );
                      })}
                    </Box>
                  </TableCell>
                  <TableCell>
                    <Typography variant="body2" color="text.secondary">
                      {user.lastLogin
                        ? format(new Date(user.lastLogin), 'MMM d, yyyy h:mm a')
                        : 'Never'}
                    </Typography>
                  </TableCell>
                  <TableCell>
                    <Typography variant="body2" color="text.secondary">
                      {format(new Date(user.createdAt), 'MMM d, yyyy')}
                    </Typography>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </TableContainer>
      ) : (
        <Alert severity="info">
          {search ? `No users match "${search}".` : 'No users found.'}
        </Alert>
      )}

      <Card sx={{ mt: 3 }}>
        <CardContent>
          <Typography variant="subtitle2" gutterBottom>Role Management</Typography>
          <Typography variant="body2" color="text.secondary">
            Roles are assigned automatically via Azure Entra group membership when a user logs in.
            To change a user's role, update their group membership in Azure Entra
            (CertManager-Admins, CertManager-Operators, or CertManager-Viewers).
            The change takes effect on their next login.
          </Typography>
        </CardContent>
      </Card>
    </Box>
  );
}