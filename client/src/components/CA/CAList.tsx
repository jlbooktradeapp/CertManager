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
  Switch,
  FormControlLabel,
} from '@mui/material';
import {
  Add as AddIcon,
  Sync as SyncIcon,
  Delete as DeleteIcon,
  Edit as EditIcon,
} from '@mui/icons-material';
import api from '../../services/api';
import { CertificateAuthority } from '../../types';
import { useAuth } from '../../context/AuthContext';

const emptyForm = {
  name: '',
  displayName: '',
  type: 'issuing' as const,
  hostname: '',
  configString: '',
};

interface EditFormData {
  displayName: string;
  hostname: string;
  configString: string;
  syncEnabled: boolean;
  syncIntervalMinutes: number;
  issuanceEnabled: boolean;
}

export default function CAList() {
  const queryClient = useQueryClient();
  const { isAdmin, isOperator } = useAuth();

  // Add dialog state
  const [addDialogOpen, setAddDialogOpen] = useState(false);
  const [formData, setFormData] = useState(emptyForm);

  // Edit dialog state
  const [editDialogOpen, setEditDialogOpen] = useState(false);
  const [editingCA, setEditingCA] = useState<CertificateAuthority | null>(null);
  const [editFormData, setEditFormData] = useState<EditFormData>({
    displayName: '',
    hostname: '',
    configString: '',
    syncEnabled: true,
    syncIntervalMinutes: 60,
    issuanceEnabled: false,
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
      setAddDialogOpen(false);
      setFormData(emptyForm);
    },
  });

  const updateMutation = useMutation({
    mutationFn: async ({ id, data }: { id: string; data: EditFormData }) => {
      const response = await api.put(`/ca/${id}`, data);
      return response.data;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['certificateAuthorities'] });
      setEditDialogOpen(false);
      setEditingCA(null);
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

  const handleAddSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    createMutation.mutate(formData);
  };

  const handleEditOpen = (ca: CertificateAuthority) => {
    setEditingCA(ca);
    setEditFormData({
      displayName: ca.displayName,
      hostname: ca.hostname,
      configString: ca.configString,
      syncEnabled: ca.syncEnabled,
      syncIntervalMinutes: ca.syncIntervalMinutes,
      issuanceEnabled: ca.issuanceEnabled,
    });
    setEditDialogOpen(true);
  };

  const handleEditSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (editingCA) {
      updateMutation.mutate({ id: editingCA._id, data: editFormData });
    }
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
          <Button variant="contained" startIcon={<AddIcon />} onClick={() => setAddDialogOpen(true)}>
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
                  {ca.issuanceEnabled && (
                    <Chip label="Issuance" variant="outlined" size="small" color="success" sx={{ ml: 0.5 }} />
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
                      color="primary"
                      onClick={() => handleEditOpen(ca)}
                    >
                      <EditIcon />
                    </IconButton>
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
      <Dialog open={addDialogOpen} onClose={() => setAddDialogOpen(false)} maxWidth="sm" fullWidth>
        <form onSubmit={handleAddSubmit}>
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
            <Button onClick={() => setAddDialogOpen(false)}>Cancel</Button>
            <Button type="submit" variant="contained" disabled={createMutation.isPending}>
              Add CA
            </Button>
          </DialogActions>
        </form>
      </Dialog>

      {/* Edit CA Dialog */}
      <Dialog open={editDialogOpen} onClose={() => setEditDialogOpen(false)} maxWidth="sm" fullWidth>
        <form onSubmit={handleEditSubmit}>
          <DialogTitle>Edit Certificate Authority: {editingCA?.name}</DialogTitle>
          <DialogContent>
            <TextField
              fullWidth
              label="Display Name"
              value={editFormData.displayName}
              onChange={(e) => setEditFormData({ ...editFormData, displayName: e.target.value })}
              margin="normal"
              required
            />
            <TextField
              fullWidth
              label="Hostname"
              value={editFormData.hostname}
              onChange={(e) => setEditFormData({ ...editFormData, hostname: e.target.value })}
              margin="normal"
              required
              placeholder="ca-server.domain.local"
            />
            <TextField
              fullWidth
              label="Config String"
              value={editFormData.configString}
              onChange={(e) => setEditFormData({ ...editFormData, configString: e.target.value })}
              margin="normal"
              required
              placeholder="ca-server.domain.local\CA-Name"
              helperText="Format: hostname\CA-Name"
            />
            <FormControlLabel
              control={
                <Switch
                  checked={editFormData.syncEnabled}
                  onChange={(e) => setEditFormData({ ...editFormData, syncEnabled: e.target.checked })}
                />
              }
              label="Auto-sync enabled"
              sx={{ mt: 1, display: 'block' }}
            />
            {editFormData.syncEnabled && (
              <TextField
                fullWidth
                label="Sync Interval (minutes)"
                type="number"
                value={editFormData.syncIntervalMinutes}
                onChange={(e) => setEditFormData({ ...editFormData, syncIntervalMinutes: parseInt(e.target.value) || 60 })}
                margin="normal"
                inputProps={{ min: 5, max: 1440 }}
                helperText="How often to automatically sync certificates (5-1440 minutes)"
              />
            )}
            <FormControlLabel
              control={
                <Switch
                  checked={editFormData.issuanceEnabled}
                  onChange={(e) => setEditFormData({ ...editFormData, issuanceEnabled: e.target.checked })}
                />
              }
              label="Enable for Certificate Issuance"
              sx={{ mt: 1, display: 'block' }}
            />
          </DialogContent>
          <DialogActions>
            <Button onClick={() => setEditDialogOpen(false)}>Cancel</Button>
            <Button type="submit" variant="contained" disabled={updateMutation.isPending}>
              Save Changes
            </Button>
          </DialogActions>
        </form>
      </Dialog>
    </Box>
  );
}