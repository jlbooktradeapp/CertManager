import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import {
  Box,
  Typography,
  Card,
  CardContent,
  Grid,
  Chip,
  Button,
  Dialog,
  DialogTitle,
  DialogContent,
  DialogActions,
  TextField,
  FormControl,
  InputLabel,
  Select,
  MenuItem,
  CircularProgress,
  Alert,
  IconButton,
  Checkbox,
  ListItemText,
  OutlinedInput,
} from '@mui/material';
import {
  Add as AddIcon,
  Refresh as RefreshIcon,
  Delete as DeleteIcon,
  CheckCircle as OnlineIcon,
  Cancel as OfflineIcon,
} from '@mui/icons-material';
import api from '../../services/api';
import { Server, PaginatedResponse } from '../../types';
import { useAuth } from '../../context/AuthContext';

const serverRoles = ['IIS', 'Exchange', 'ADFS', 'RDS', 'SQL', 'Other'];

export default function ServerList() {
  const queryClient = useQueryClient();
  const { isAdmin, isOperator } = useAuth();
  const [dialogOpen, setDialogOpen] = useState(false);
  const [formData, setFormData] = useState({
    hostname: '',
    fqdn: '',
    ipAddress: '',
    operatingSystem: 'Windows Server 2022',
    roles: [] as string[],
    domain: '',
  });

  const { data, isLoading, error } = useQuery({
    queryKey: ['servers'],
    queryFn: async () => {
      const response = await api.get<PaginatedResponse<Server>>('/servers');
      return response.data;
    },
  });

  const createMutation = useMutation({
    mutationFn: async (data: typeof formData) => {
      const response = await api.post('/servers', data);
      return response.data;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['servers'] });
      setDialogOpen(false);
      resetForm();
    },
  });

  const testMutation = useMutation({
    mutationFn: async (id: string) => {
      const response = await api.post(`/servers/${id}/test`);
      return response.data;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['servers'] });
    },
  });

  const deleteMutation = useMutation({
    mutationFn: async (id: string) => {
      await api.delete(`/servers/${id}`);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['servers'] });
    },
  });

  const resetForm = () => {
    setFormData({
      hostname: '',
      fqdn: '',
      ipAddress: '',
      operatingSystem: 'Windows Server 2022',
      roles: [],
      domain: '',
    });
  };

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    createMutation.mutate(formData);
  };

  if (isLoading) {
    return (
      <Box sx={{ display: 'flex', justifyContent: 'center', mt: 4 }}>
        <CircularProgress />
      </Box>
    );
  }

  if (error) {
    return <Alert severity="error">Failed to load servers</Alert>;
  }

  return (
    <Box>
      <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', mb: 3 }}>
        <Typography variant="h4">Servers</Typography>
        {isAdmin && (
          <Button variant="contained" startIcon={<AddIcon />} onClick={() => setDialogOpen(true)}>
            Add Server
          </Button>
        )}
      </Box>

      <Grid container spacing={3}>
        {data?.data.map((server) => (
          <Grid item xs={12} md={6} lg={4} key={server._id}>
            <Card>
              <CardContent>
                <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', mb: 2 }}>
                  <Box>
                    <Typography variant="h6">{server.hostname}</Typography>
                    <Typography variant="body2" color="textSecondary">
                      {server.fqdn}
                    </Typography>
                  </Box>
                  <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.5 }}>
                    {server.status === 'online' ? (
                      <OnlineIcon color="success" fontSize="small" />
                    ) : server.status === 'offline' ? (
                      <OfflineIcon color="error" fontSize="small" />
                    ) : null}
                    <Chip
                      label={server.status}
                      color={server.status === 'online' ? 'success' : server.status === 'offline' ? 'error' : 'default'}
                      size="small"
                    />
                  </Box>
                </Box>

                <Box sx={{ mb: 2 }}>
                  <Typography variant="caption" color="textSecondary">
                    IP: {server.ipAddress}
                  </Typography>
                  {server.domain && (
                    <Typography variant="caption" color="textSecondary" sx={{ ml: 2 }}>
                      Domain: {server.domain}
                    </Typography>
                  )}
                </Box>

                <Box sx={{ mb: 2 }}>
                  {server.roles.map((role) => (
                    <Chip
                      key={role}
                      label={role}
                      variant="outlined"
                      size="small"
                      sx={{ mr: 0.5, mb: 0.5 }}
                    />
                  ))}
                </Box>

                {server.remoteManagement && (
                  <Box sx={{ mb: 2 }}>
                    <Chip
                      label={server.remoteManagement.winRMEnabled ? 'WinRM OK' : 'WinRM Off'}
                      color={server.remoteManagement.winRMEnabled ? 'success' : 'default'}
                      size="small"
                      variant="outlined"
                    />
                  </Box>
                )}

                <Typography variant="caption" color="textSecondary" display="block">
                  Certificates: {server.certificates?.length || 0}
                </Typography>

                <Box sx={{ mt: 2, display: 'flex', gap: 1 }}>
                  {isOperator && (
                    <Button
                      size="small"
                      startIcon={<RefreshIcon />}
                      onClick={() => testMutation.mutate(server._id)}
                      disabled={testMutation.isPending}
                    >
                      Test
                    </Button>
                  )}
                  {isAdmin && (
                    <IconButton
                      size="small"
                      color="error"
                      onClick={() => {
                        if (confirm(`Delete server "${server.hostname}"?`)) {
                          deleteMutation.mutate(server._id);
                        }
                      }}
                    >
                      <DeleteIcon />
                    </IconButton>
                  )}
                </Box>
              </CardContent>
            </Card>
          </Grid>
        ))}

        {data?.data.length === 0 && (
          <Grid item xs={12}>
            <Alert severity="info">
              No servers configured. Add a server to start managing certificates.
            </Alert>
          </Grid>
        )}
      </Grid>

      {/* Add Server Dialog */}
      <Dialog open={dialogOpen} onClose={() => setDialogOpen(false)} maxWidth="sm" fullWidth>
        <form onSubmit={handleSubmit}>
          <DialogTitle>Add Server</DialogTitle>
          <DialogContent>
            <TextField
              fullWidth
              label="Hostname"
              value={formData.hostname}
              onChange={(e) => setFormData({ ...formData, hostname: e.target.value })}
              margin="normal"
              required
              placeholder="server01"
            />
            <TextField
              fullWidth
              label="FQDN"
              value={formData.fqdn}
              onChange={(e) => setFormData({ ...formData, fqdn: e.target.value })}
              margin="normal"
              required
              placeholder="server01.domain.local"
            />
            <TextField
              fullWidth
              label="IP Address"
              value={formData.ipAddress}
              onChange={(e) => setFormData({ ...formData, ipAddress: e.target.value })}
              margin="normal"
              required
              placeholder="192.168.1.100"
            />
            <TextField
              fullWidth
              label="Operating System"
              value={formData.operatingSystem}
              onChange={(e) => setFormData({ ...formData, operatingSystem: e.target.value })}
              margin="normal"
            />
            <FormControl fullWidth margin="normal">
              <InputLabel>Roles</InputLabel>
              <Select
                multiple
                value={formData.roles}
                onChange={(e) => setFormData({ ...formData, roles: e.target.value as string[] })}
                input={<OutlinedInput label="Roles" />}
                renderValue={(selected) => selected.join(', ')}
              >
                {serverRoles.map((role) => (
                  <MenuItem key={role} value={role}>
                    <Checkbox checked={formData.roles.indexOf(role) > -1} />
                    <ListItemText primary={role} />
                  </MenuItem>
                ))}
              </Select>
            </FormControl>
            <TextField
              fullWidth
              label="Domain"
              value={formData.domain}
              onChange={(e) => setFormData({ ...formData, domain: e.target.value })}
              margin="normal"
              placeholder="domain.local"
            />
          </DialogContent>
          <DialogActions>
            <Button onClick={() => { setDialogOpen(false); resetForm(); }}>Cancel</Button>
            <Button type="submit" variant="contained" disabled={createMutation.isPending}>
              Add Server
            </Button>
          </DialogActions>
        </form>
      </Dialog>
    </Box>
  );
}
