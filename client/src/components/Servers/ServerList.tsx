import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import {
  Box,
  Typography,
  Card,
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
  Table,
  TableBody,
  TableCell,
  TableContainer,
  TableHead,
  TableRow,
  Paper,
  InputAdornment,
  Tooltip,
} from '@mui/material';
import {
  Add as AddIcon,
  Delete as DeleteIcon,
  CheckCircle as OnlineIcon,
  Cancel as OfflineIcon,
  Help as UnknownIcon,
  Search as SearchIcon,
} from '@mui/icons-material';
import api from '../../services/api';
import { Server, PaginatedResponse } from '../../types';
import { useAuth } from '../../context/AuthContext';

const serverRoles = ['IIS', 'F5', 'Exchange', 'ADFS', 'RDS', 'SQL', 'Other'];

const roleColors: Record<string, 'default' | 'primary' | 'secondary' | 'warning' | 'info'> = {
  IIS:      'primary',
  F5:       'warning',
  Exchange: 'secondary',
  ADFS:     'info',
  RDS:      'info',
  SQL:      'secondary',
  Other:    'default',
};

export default function ServerList() {
  const queryClient = useQueryClient();
  const navigate    = useNavigate();
  const { isAdmin } = useAuth();
  const [search, setSearch]       = useState('');
  const [dialogOpen, setDialogOpen] = useState(false);
  const [formData, setFormData]   = useState({
    hostname:        '',
    fqdn:            '',
    ipAddress:       '',
    operatingSystem: 'Windows Server 2022',
    roles:           [] as string[],
    domain:          '',
  });

  const { data, isLoading, error } = useQuery({
    queryKey: ['servers', search],
    queryFn: async () => {
      const params = new URLSearchParams({ limit: '200' });
      const response = await api.get<PaginatedResponse<Server>>(`/servers?${params}`);
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

  const deleteMutation = useMutation({
    mutationFn: async (id: string) => {
      await api.delete(`/servers/${id}`);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['servers'] });
    },
  });

  const resetForm = () => setFormData({
    hostname: '', fqdn: '', ipAddress: '',
    operatingSystem: 'Windows Server 2022', roles: [], domain: '',
  });

  // Client-side filter by search
  const servers = (data?.data ?? []).filter(s =>
    !search ||
    s.hostname.toLowerCase().includes(search.toLowerCase()) ||
    s.fqdn.toLowerCase().includes(search.toLowerCase()) ||
    s.ipAddress.includes(search)
  );

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

      <TextField
        placeholder="Search by hostname, FQDN, or IP..."
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

      {servers.length > 0 ? (
        <TableContainer component={Paper}>
          <Table>
            <TableHead>
              <TableRow>
                <TableCell><strong>Server</strong></TableCell>
                <TableCell><strong>IP Address</strong></TableCell>
                <TableCell><strong>Roles</strong></TableCell>
                <TableCell><strong>Certificates</strong></TableCell>
                <TableCell><strong>Status</strong></TableCell>
                {isAdmin && <TableCell align="right"><strong>Actions</strong></TableCell>}
              </TableRow>
            </TableHead>
            <TableBody>
              {servers.map((server) => {
                const StatusIcon = server.status === 'online'
                  ? <OnlineIcon color="success" fontSize="small" sx={{ mr: 0.5, verticalAlign: 'middle' }} />
                  : server.status === 'offline'
                  ? <OfflineIcon color="error" fontSize="small" sx={{ mr: 0.5, verticalAlign: 'middle' }} />
                  : <UnknownIcon color="disabled" fontSize="small" sx={{ mr: 0.5, verticalAlign: 'middle' }} />;

                return (
                  <TableRow
                    key={server._id}
                    hover
                    sx={{ cursor: 'pointer' }}
                    onClick={() => navigate(`/servers/${server._id}`)}
                  >
                    <TableCell>
                      <Typography variant="body1" fontWeight={500}>{server.hostname}</Typography>
                      <Typography variant="caption" color="text.secondary" sx={{ fontFamily: 'monospace' }}>
                        {server.fqdn}
                      </Typography>
                      {server.domain && (
                        <Typography variant="caption" color="text.secondary" display="block">
                          {server.domain}
                        </Typography>
                      )}
                    </TableCell>
                    <TableCell>
                      <Typography variant="body2" sx={{ fontFamily: 'monospace' }}>{server.ipAddress}</Typography>
                    </TableCell>
                    <TableCell>
                      <Box sx={{ display: 'flex', flexWrap: 'wrap', gap: 0.5 }}>
                        {server.roles?.map((role) => (
                          <Chip
                            key={role}
                            label={role}
                            size="small"
                            color={roleColors[role] ?? 'default'}
                            variant="outlined"
                          />
                        ))}
                      </Box>
                    </TableCell>
                    <TableCell>
                      <Chip
                        label={`${server.certificates?.length ?? 0} cert(s)`}
                        size="small"
                        color={(server.certificates?.length ?? 0) > 0 ? 'primary' : 'default'}
                        variant="outlined"
                      />
                    </TableCell>
                    <TableCell>
                      <Box sx={{ display: 'flex', alignItems: 'center' }}>
                        {StatusIcon}
                        <Typography variant="body2" sx={{ textTransform: 'capitalize' }}>
                          {server.status}
                        </Typography>
                      </Box>
                    </TableCell>
                    {isAdmin && (
                      <TableCell align="right">
                        <Tooltip title="Remove server from tracking">
                          <IconButton
                            size="small"
                            color="error"
                            onClick={(e) => {
                              e.stopPropagation();
                              if (confirm(`Remove server "${server.hostname}" from tracking?`)) {
                                deleteMutation.mutate(server._id);
                              }
                            }}
                          >
                            <DeleteIcon />
                          </IconButton>
                        </Tooltip>
                      </TableCell>
                    )}
                  </TableRow>
                );
              })}
            </TableBody>
          </Table>
        </TableContainer>
      ) : (
        <Alert severity="info">
          {search
            ? `No servers match "${search}".`
            : 'No servers yet. Run discovery to automatically detect servers from active certificates, or add one manually.'}
        </Alert>
      )}

      {/* Add Server Dialog */}
      <Dialog open={dialogOpen} onClose={() => { setDialogOpen(false); resetForm(); }} maxWidth="sm" fullWidth>
        <DialogTitle>Add Server</DialogTitle>
        <DialogContent>
          <TextField fullWidth label="Hostname" value={formData.hostname}
            onChange={(e) => setFormData({ ...formData, hostname: e.target.value })}
            margin="normal" required placeholder="server01" />
          <TextField fullWidth label="FQDN" value={formData.fqdn}
            onChange={(e) => setFormData({ ...formData, fqdn: e.target.value })}
            margin="normal" required placeholder="server01.tuhs.prv" />
          <TextField fullWidth label="IP Address" value={formData.ipAddress}
            onChange={(e) => setFormData({ ...formData, ipAddress: e.target.value })}
            margin="normal" required placeholder="10.0.0.1" />
          <TextField fullWidth label="Operating System" value={formData.operatingSystem}
            onChange={(e) => setFormData({ ...formData, operatingSystem: e.target.value })}
            margin="normal" />
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
          <TextField fullWidth label="Domain" value={formData.domain}
            onChange={(e) => setFormData({ ...formData, domain: e.target.value })}
            margin="normal" placeholder="tuhs.prv" />
        </DialogContent>
        <DialogActions>
          <Button onClick={() => { setDialogOpen(false); resetForm(); }}>Cancel</Button>
          <Button
            variant="contained"
            onClick={() => createMutation.mutate(formData)}
            disabled={createMutation.isPending || !formData.hostname || !formData.fqdn || !formData.ipAddress}
          >
            Add Server
          </Button>
        </DialogActions>
      </Dialog>
    </Box>
  );
}