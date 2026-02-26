import { useState, useRef } from 'react';
import { useNavigate } from 'react-router-dom';
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
  CircularProgress,
  Alert,
  IconButton,
  Table,
  TableBody,
  TableCell,
  TableContainer,
  TableHead,
  TableRow,
  Paper,
  Tooltip,
  InputAdornment,
} from '@mui/material';
import {
  Add as AddIcon,
  Edit as EditIcon,
  Delete as DeleteIcon,
  Upload as UploadIcon,
  Search as SearchIcon,
  Person as PersonIcon,
  Business as VendorIcon,
} from '@mui/icons-material';
import api from '../../services/api';
import { Application, ApplicationOwner, PaginatedResponse } from '../../types';
import { useAuth } from '../../context/AuthContext';

interface AppFormData {
  name: string;
  description: string;
  owners: ApplicationOwner[];
  vendor: {
    name: string;
    contactName: string;
    contactEmail: string;
  };
}

const emptyForm: AppFormData = {
  name: '',
  description: '',
  owners: [],
  vendor: { name: '', contactName: '', contactEmail: '' },
};

export default function ApplicationList() {
  const queryClient = useQueryClient();
  const { isAdmin } = useAuth();
  const fileInputRef = useRef<HTMLInputElement>(null);
  const navigate = useNavigate();

  const [search, setSearch] = useState('');
  const [addDialogOpen, setAddDialogOpen] = useState(false);
  const [editDialogOpen, setEditDialogOpen] = useState(false);
  const [editingApp, setEditingApp] = useState<Application | null>(null);
  const [formData, setFormData] = useState<AppFormData>(emptyForm);
  const [importResult, setImportResult] = useState<{ imported: number; skipped: number; errors: string[] } | null>(null);

  // New owner fields
  const [newOwner, setNewOwner] = useState<ApplicationOwner>({ name: '', email: '', role: 'Owner' });

  const { data, isLoading, error } = useQuery({
    queryKey: ['applications', search],
    queryFn: async () => {
      const params = new URLSearchParams();
      params.set('limit', '100');
      if (search) params.set('search', search);
      const response = await api.get<PaginatedResponse<Application>>(`/applications?${params}`);
      return response.data;
    },
  });

  const createMutation = useMutation({
    mutationFn: async (data: AppFormData) => {
      const payload = {
        ...data,
        vendor: data.vendor.name ? data.vendor : undefined,
      };
      const response = await api.post('/applications', payload);
      return response.data;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['applications'] });
      setAddDialogOpen(false);
      setFormData(emptyForm);
    },
  });

  const updateMutation = useMutation({
    mutationFn: async ({ id, data }: { id: string; data: AppFormData }) => {
      const payload = {
        ...data,
        vendor: data.vendor.name ? data.vendor : undefined,
      };
      const response = await api.put(`/applications/${id}`, payload);
      return response.data;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['applications'] });
      setEditDialogOpen(false);
      setEditingApp(null);
    },
  });

  const deleteMutation = useMutation({
    mutationFn: async (id: string) => {
      await api.delete(`/applications/${id}`);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['applications'] });
    },
  });

  const importMutation = useMutation({
    mutationFn: async (applications: Record<string, string>[]) => {
      const response = await api.post('/applications/import', { applications });
      return response.data;
    },
    onSuccess: (data) => {
      queryClient.invalidateQueries({ queryKey: ['applications'] });
      setImportResult(data);
    },
  });

  const handleAddOpen = () => {
    setFormData(emptyForm);
    setNewOwner({ name: '', email: '', role: 'Owner' });
    setAddDialogOpen(true);
  };

  const handleEditOpen = (app: Application) => {
    setEditingApp(app);
    setFormData({
      name: app.name,
      description: app.description || '',
      owners: [...app.owners],
      vendor: {
        name: app.vendor?.name || '',
        contactName: app.vendor?.contactName || '',
        contactEmail: app.vendor?.contactEmail || '',
      },
    });
    setNewOwner({ name: '', email: '', role: 'Owner' });
    setEditDialogOpen(true);
  };

  const handleAddOwner = () => {
    if (newOwner.name && newOwner.email) {
      setFormData({ ...formData, owners: [...formData.owners, { ...newOwner }] });
      setNewOwner({ name: '', email: '', role: 'Owner' });
    }
  };

  const handleRemoveOwner = (index: number) => {
    const owners = [...formData.owners];
    owners.splice(index, 1);
    setFormData({ ...formData, owners });
  };

  const handleAddSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    createMutation.mutate(formData);
  };

  const handleEditSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (editingApp) {
      updateMutation.mutate({ id: editingApp._id, data: formData });
    }
  };

  const handleCSVUpload = (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (!file) return;

    const reader = new FileReader();
    reader.onload = (e) => {
      try {
        const text = e.target?.result as string;
        const lines = text.split('\n').filter(l => l.trim());
        if (lines.length < 2) {
          alert('CSV file must have a header row and at least one data row');
          return;
        }

        const headers = lines[0].split(',').map(h => h.trim().replace(/^"|"$/g, ''));
        const applications = lines.slice(1).map(line => {
          const values = line.split(',').map(v => v.trim().replace(/^"|"$/g, ''));
          const row: Record<string, string> = {};
          headers.forEach((header, i) => {
            row[header] = values[i] || '';
          });
          return row;
        });

        importMutation.mutate(applications);
      } catch {
        alert('Failed to parse CSV file');
      }
    };
    reader.readAsText(file);

    // Reset file input
    if (fileInputRef.current) {
      fileInputRef.current.value = '';
    }
  };

  const statusColors: Record<string, 'success' | 'error' | 'default'> = {
    active: 'success',
    inactive: 'default',
    retired: 'error',
  };

  if (isLoading) {
    return (
      <Box sx={{ display: 'flex', justifyContent: 'center', mt: 4 }}>
        <CircularProgress />
      </Box>
    );
  }

  if (error) {
    return <Alert severity="error">Failed to load applications</Alert>;
  }

  // Form dialog content (shared between add and edit)
  const formDialogContent = (
    <>
      <TextField
        fullWidth
        label="Application Name"
        value={formData.name}
        onChange={(e) => setFormData({ ...formData, name: e.target.value })}
        margin="normal"
        required
        disabled={!!editingApp}
      />
      <TextField
        fullWidth
        label="Description"
        value={formData.description}
        onChange={(e) => setFormData({ ...formData, description: e.target.value })}
        margin="normal"
        multiline
        rows={2}
      />

      {/* Owners Section */}
      <Typography variant="subtitle2" sx={{ mt: 2, mb: 1 }}>
        Application Owners
      </Typography>

      {formData.owners.length > 0 && (
        <Table size="small" sx={{ mb: 1 }}>
          <TableBody>
            {formData.owners.map((owner, index) => (
              <TableRow key={index}>
                <TableCell>{owner.name}</TableCell>
                <TableCell>{owner.email}</TableCell>
                <TableCell>{owner.role}</TableCell>
                <TableCell align="right" sx={{ width: 40 }}>
                  <IconButton size="small" onClick={() => handleRemoveOwner(index)}>
                    <DeleteIcon fontSize="small" />
                  </IconButton>
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      )}

      <Box sx={{ display: 'flex', gap: 1, mb: 2 }}>
        <TextField
          size="small"
          label="Name"
          value={newOwner.name}
          onChange={(e) => setNewOwner({ ...newOwner, name: e.target.value })}
          sx={{ flex: 1 }}
        />
        <TextField
          size="small"
          label="Email"
          value={newOwner.email}
          onChange={(e) => setNewOwner({ ...newOwner, email: e.target.value })}
          sx={{ flex: 1 }}
        />
        <TextField
          size="small"
          label="Role"
          value={newOwner.role}
          onChange={(e) => setNewOwner({ ...newOwner, role: e.target.value })}
          sx={{ width: 120 }}
        />
        <Button variant="outlined" size="small" onClick={handleAddOwner} disabled={!newOwner.name || !newOwner.email}>
          Add
        </Button>
      </Box>

      {/* Vendor Section */}
      <Typography variant="subtitle2" sx={{ mt: 2, mb: 1 }}>
        Vendor Information (optional)
      </Typography>

      <Grid container spacing={2}>
        <Grid item xs={12}>
          <TextField
            fullWidth
            size="small"
            label="Vendor Name"
            value={formData.vendor.name}
            onChange={(e) => setFormData({ ...formData, vendor: { ...formData.vendor, name: e.target.value } })}
          />
        </Grid>
        <Grid item xs={6}>
          <TextField
            fullWidth
            size="small"
            label="Vendor Contact Name"
            value={formData.vendor.contactName}
            onChange={(e) => setFormData({ ...formData, vendor: { ...formData.vendor, contactName: e.target.value } })}
          />
        </Grid>
        <Grid item xs={6}>
          <TextField
            fullWidth
            size="small"
            label="Vendor Contact Email"
            value={formData.vendor.contactEmail}
            onChange={(e) => setFormData({ ...formData, vendor: { ...formData.vendor, contactEmail: e.target.value } })}
          />
        </Grid>
      </Grid>
    </>
  );

  return (
    <Box>
      <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', mb: 3 }}>
        <Typography variant="h4">Applications</Typography>
        {isAdmin && (
          <Box sx={{ display: 'flex', gap: 1 }}>
            <input
              type="file"
              accept=".csv"
              ref={fileInputRef}
              style={{ display: 'none' }}
              onChange={handleCSVUpload}
            />
            <Button
              variant="outlined"
              startIcon={<UploadIcon />}
              onClick={() => fileInputRef.current?.click()}
              disabled={importMutation.isPending}
            >
              Import CSV
            </Button>
            <Button variant="contained" startIcon={<AddIcon />} onClick={handleAddOpen}>
              Add Application
            </Button>
          </Box>
        )}
      </Box>

      {importResult && (
        <Alert
          severity={importResult.errors.length > 0 ? 'warning' : 'success'}
          onClose={() => setImportResult(null)}
          sx={{ mb: 2 }}
        >
          Imported {importResult.imported} application(s), skipped {importResult.skipped}.
          {importResult.errors.length > 0 && (
            <Box sx={{ mt: 1, fontSize: '0.85em' }}>
              {importResult.errors.slice(0, 5).map((err, i) => (
                <div key={i}>{err}</div>
              ))}
              {importResult.errors.length > 5 && <div>...and {importResult.errors.length - 5} more</div>}
            </Box>
          )}
        </Alert>
      )}

      <TextField
        placeholder="Search applications..."
        value={search}
        onChange={(e) => setSearch(e.target.value)}
        size="small"
        sx={{ mb: 3, minWidth: 300 }}
        InputProps={{
          startAdornment: (
            <InputAdornment position="start">
              <SearchIcon />
            </InputAdornment>
          ),
        }}
      />

      {data?.data && data.data.length > 0 ? (
        <TableContainer component={Paper}>
          <Table>
            <TableHead>
              <TableRow>
                <TableCell><strong>Application</strong></TableCell>
                <TableCell><strong>Owners</strong></TableCell>
                <TableCell><strong>Vendor</strong></TableCell>
                <TableCell><strong>Certificates</strong></TableCell>
                <TableCell><strong>Status</strong></TableCell>
                {isAdmin && <TableCell align="right"><strong>Actions</strong></TableCell>}
              </TableRow>
            </TableHead>
            <TableBody>
              {data.data.map((app) => (
                <TableRow key={app._id} hover sx={{ cursor: 'pointer' }}
                  onClick={() => navigate(`/applications/${app._id}`)}
                >
                  <TableCell>
                    <Typography variant="body1" fontWeight={500}>{app.name}</Typography>
                    {app.description && (
                      <Typography variant="caption" color="textSecondary">{app.description}</Typography>
                    )}
                  </TableCell>
                  <TableCell>
                    {app.owners.length > 0 ? (
                      <Box sx={{ display: 'flex', flexDirection: 'column', gap: 0.5 }}>
                        {app.owners.map((owner, i) => (
                          <Tooltip key={i} title={owner.email}>
                            <Chip
                              icon={<PersonIcon />}
                              label={owner.name}
                              size="small"
                              variant="outlined"
                            />
                          </Tooltip>
                        ))}
                      </Box>
                    ) : (
                      <Typography variant="caption" color="textSecondary">No owners</Typography>
                    )}
                  </TableCell>
                  <TableCell>
                    {app.vendor?.name ? (
                      <Tooltip title={app.vendor.contactEmail || ''}>
                        <Chip
                          icon={<VendorIcon />}
                          label={app.vendor.name}
                          size="small"
                          variant="outlined"
                        />
                      </Tooltip>
                    ) : (
                      <Typography variant="caption" color="textSecondary">None</Typography>
                    )}
                  </TableCell>
                  <TableCell>
                    <Chip
                      label={`${app.certificateCount ?? app.certificates?.length ?? 0} cert(s)`}
                      size="small"
                      color={(app.certificateCount ?? app.certificates?.length ?? 0) > 0 ? 'primary' : 'default'}
                      variant="outlined"
                    />
                  </TableCell>
                  <TableCell>
                    <Chip
                      label={app.status}
                      size="small"
                      color={statusColors[app.status]}
                      sx={{ textTransform: 'capitalize' }}
                    />
                  </TableCell>
                  {isAdmin && (
                    <TableCell align="right">
                      <IconButton size="small" color="primary" onClick={(e) => { e.stopPropagation(); handleEditOpen(app); }}>
                        <EditIcon />
                      </IconButton>
                      <IconButton
                        size="small"
                        color="error"
                        onClick={(e) => {
                          e.stopPropagation();
                          if (confirm(`Delete application "${app.name}"?`)) {
                            deleteMutation.mutate(app._id);
                          }
                        }}
                      >
                        <DeleteIcon />
                      </IconButton>
                    </TableCell>
                  )}
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </TableContainer>
      ) : (
        <Alert severity="info">
          No applications found. Add applications to group and manage certificates by business function.
        </Alert>
      )}

      {/* Add Application Dialog */}
      <Dialog open={addDialogOpen} onClose={() => setAddDialogOpen(false)} maxWidth="sm" fullWidth>
        <form onSubmit={handleAddSubmit}>
          <DialogTitle>Add Application</DialogTitle>
          <DialogContent>{formDialogContent}</DialogContent>
          <DialogActions>
            <Button onClick={() => setAddDialogOpen(false)}>Cancel</Button>
            <Button type="submit" variant="contained" disabled={createMutation.isPending}>
              Add Application
            </Button>
          </DialogActions>
        </form>
      </Dialog>

      {/* Edit Application Dialog */}
      <Dialog open={editDialogOpen} onClose={() => setEditDialogOpen(false)} maxWidth="sm" fullWidth>
        <form onSubmit={handleEditSubmit}>
          <DialogTitle>Edit Application: {editingApp?.name}</DialogTitle>
          <DialogContent>{formDialogContent}</DialogContent>
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