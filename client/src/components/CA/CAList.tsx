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
} from '@mui/material';
import {
  Add as AddIcon,
  Sync as SyncIcon,
  Delete as DeleteIcon,
} from '@mui/icons-material';
import api from '../../services/api';
import { CertificateAuthority } from '../../types';
import { useAuth } from '../../context/AuthContext';

export default function CAList() {
  const queryClient = useQueryClient();
  const { isAdmin, isOperator } = useAuth();
  const [dialogOpen, setDialogOpen] = useState(false);
  const [formData, setFormData] = useState({
    name: '',
    displayName: '',
    type: 'issuing' as const,
    hostname: '',
    configString: '',
  });

  const { data: cas, isLoading, error } = useQuery({
    queryKey: ['certificateAuthorities'],
    queryFn: async () => {
      const response = await api.get<CertificateAuthority[]>('/ca');
      return response.data;
    },
  });

  const createMutation = useMutation({
    mutationFn: async (data: typeof formData) => {
      const response = await api.post('/ca', data);
      return response.data;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['certificateAuthorities'] });
      setDialogOpen(false);
      setFormData({ name: '', displayName: '', type: 'issuing', hostname: '', configString: '' });
    },
  });

  const syncMutation = useMutation({
    mutationFn: async (id: string) => {
      const response = await api.post(`/ca/${id}/sync`);
      return response.data;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['certificateAuthorities'] });
      queryClient.invalidateQueries({ queryKey: ['certificates'] });
    },
  });

  const deleteMutation = useMutation({
    mutationFn: async (id: string) => {
      await api.delete(`/ca/${id}`);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['certificateAuthorities'] });
    },
  });

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
    return <Alert severity="error">Failed to load certificate authorities</Alert>;
  }

  const statusColors: Record<string, 'success' | 'error' | 'default'> = {
    online: 'success',
    offline: 'error',
    unknown: 'default',
  };

  return (
    <Box>
      <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', mb: 3 }}>
        <Typography variant="h4">Certificate Authorities</Typography>
        {isAdmin && (
          <Button variant="contained" startIcon={<AddIcon />} onClick={() => setDialogOpen(true)}>
            Add CA
          </Button>
        )}
      </Box>

      <Grid container spacing={3}>
        {cas?.map((ca) => (
          <Grid item xs={12} md={6} lg={4} key={ca._id}>
            <Card>
              <CardContent>
                <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', mb: 2 }}>
                  <Box>
                    <Typography variant="h6">{ca.displayName}</Typography>
                    <Typography variant="body2" color="textSecondary">
                      {ca.hostname}
                    </Typography>
                  </Box>
                  <Chip
                    label={ca.status}
                    color={statusColors[ca.status]}
                    size="small"
                  />
                </Box>

                <Box sx={{ mb: 2 }}>
                  <Chip
                    label={ca.type}
                    variant="outlined"
                    size="small"
                    sx={{ mr: 1, textTransform: 'capitalize' }}
                  />
                  {ca.syncEnabled && (
                    <Chip label="Auto-sync" variant="outlined" size="small" color="primary" />
                  )}
                </Box>

                <Typography variant="caption" color="textSecondary" display="block">
                  Config: {ca.configString}
                </Typography>

                {ca.lastSyncedAt && (
                  <Typography variant="caption" color="textSecondary" display="block">
                    Last synced: {new Date(ca.lastSyncedAt).toLocaleString()}
                  </Typography>
                )}

                <Box sx={{ mt: 2, display: 'flex', gap: 1 }}>
                  {isOperator && (
                    <Button
                      size="small"
                      startIcon={<SyncIcon />}
                      onClick={() => syncMutation.mutate(ca._id)}
                      disabled={syncMutation.isPending}
                    >
                      Sync
                    </Button>
                  )}
                  {isAdmin && (
                    <IconButton
                      size="small"
                      color="error"
                      onClick={() => {
                        if (confirm(`Delete CA "${ca.displayName}"?`)) {
                          deleteMutation.mutate(ca._id);
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

        {cas?.length === 0 && (
          <Grid item xs={12}>
            <Alert severity="info">
              No certificate authorities configured. Add a CA to start managing certificates.
            </Alert>
          </Grid>
        )}
      </Grid>

      {/* Add CA Dialog */}
      <Dialog open={dialogOpen} onClose={() => setDialogOpen(false)} maxWidth="sm" fullWidth>
        <form onSubmit={handleSubmit}>
          <DialogTitle>Add Certificate Authority</DialogTitle>
          <DialogContent>
            <TextField
              fullWidth
              label="Name (unique identifier)"
              value={formData.name}
              onChange={(e) => setFormData({ ...formData, name: e.target.value })}
              margin="normal"
              required
            />
            <TextField
              fullWidth
              label="Display Name"
              value={formData.displayName}
              onChange={(e) => setFormData({ ...formData, displayName: e.target.value })}
              margin="normal"
              required
            />
            <FormControl fullWidth margin="normal">
              <InputLabel>Type</InputLabel>
              <Select
                value={formData.type}
                label="Type"
                onChange={(e) => setFormData({ ...formData, type: e.target.value as any })}
              >
                <MenuItem value="root">Root CA</MenuItem>
                <MenuItem value="subordinate">Subordinate CA</MenuItem>
                <MenuItem value="issuing">Issuing CA</MenuItem>
              </Select>
            </FormControl>
            <TextField
              fullWidth
              label="Hostname"
              value={formData.hostname}
              onChange={(e) => setFormData({ ...formData, hostname: e.target.value })}
              margin="normal"
              required
              placeholder="ca-server.domain.local"
            />
            <TextField
              fullWidth
              label="Config String"
              value={formData.configString}
              onChange={(e) => setFormData({ ...formData, configString: e.target.value })}
              margin="normal"
              required
              placeholder="ca-server.domain.local\CA-Name"
              helperText="Format: hostname\CA-Name"
            />
          </DialogContent>
          <DialogActions>
            <Button onClick={() => setDialogOpen(false)}>Cancel</Button>
            <Button type="submit" variant="contained" disabled={createMutation.isPending}>
              Add CA
            </Button>
          </DialogActions>
        </form>
      </Dialog>
    </Box>
  );
}
