import { useParams, useNavigate } from 'react-router-dom';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import {
  Box,
  Typography,
  Card,
  CardContent,
  Grid,
  Chip,
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
  Button,
  Divider,
} from '@mui/material';
import {
  ArrowBack as BackIcon,
  Security as CertIcon,
  Apps as AppIcon,
  CheckCircle as OnlineIcon,
  Cancel as OfflineIcon,
  Help as UnknownIcon,
  Search as ScanIcon,
} from '@mui/icons-material';
import { format, differenceInDays } from 'date-fns';
import api from '../../services/api';
import { useAuth } from '../../context/AuthContext';

const certStatusColors: Record<string, 'success' | 'warning' | 'error' | 'default' | 'info'> = {
  active:   'success',
  expiring: 'warning',
  expired:  'error',
  revoked:  'default',
  reissued: 'info',
  rebound:  'error',
};

const roleColors: Record<string, 'default' | 'primary' | 'secondary' | 'warning' | 'info'> = {
  IIS:      'primary',
  F5:       'warning',
  Exchange: 'secondary',
  ADFS:     'info',
  RDS:      'info',
  SQL:      'secondary',
  Other:    'default',
};

export default function ServerDetail() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const { isOperator } = useAuth();

  const { data: server, isLoading, error } = useQuery({
    queryKey: ['server', id],
    queryFn: async () => {
      const response = await api.get(`/servers/${id}`);
      return response.data;
    },
    enabled: !!id,
  });

  const discoverMutation = useMutation({
    mutationFn: async () => {
      // Run discovery scoped to just the certs on this server
      await api.post('/certificates/discover');
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['server', id] });
    },
  });

  if (isLoading) {
    return (
      <Box sx={{ display: 'flex', justifyContent: 'center', mt: 4 }}>
        <CircularProgress />
      </Box>
    );
  }

  if (error || !server) {
    return <Alert severity="error">Server not found</Alert>;
  }

  const certs: any[] = server.certificates || [];

  // Collect unique applications from certs
  const appMap = new Map<string, any>();
  for (const cert of certs) {
    const app = cert.applicationId;
    if (app && typeof app === 'object' && app._id) {
      appMap.set(app._id, app);
    }
  }
  const applications = Array.from(appMap.values());

  const StatusIcon = server.status === 'online'
    ? <OnlineIcon color="success" fontSize="small" />
    : server.status === 'offline'
    ? <OfflineIcon color="error" fontSize="small" />
    : <UnknownIcon color="disabled" fontSize="small" />;

  return (
    <Box>
      {/* Header */}
      <Box sx={{ display: 'flex', alignItems: 'center', gap: 2, mb: 3 }}>
        <IconButton onClick={() => navigate('/servers')}>
          <BackIcon />
        </IconButton>
        <Box sx={{ flexGrow: 1 }}>
          <Typography variant="h4">{server.hostname}</Typography>
          <Typography variant="body2" color="text.secondary" sx={{ fontFamily: 'monospace' }}>
            {server.fqdn}
          </Typography>
        </Box>
        <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
          {StatusIcon}
          <Chip
            label={server.status}
            color={server.status === 'online' ? 'success' : server.status === 'offline' ? 'error' : 'default'}
            sx={{ textTransform: 'capitalize' }}
          />
        </Box>
        {isOperator && (
          <Tooltip title="Run a full discovery scan to refresh certificate assignments">
            <Button
              variant="outlined"
              size="small"
              startIcon={discoverMutation.isPending ? <CircularProgress size={16} /> : <ScanIcon />}
              onClick={() => discoverMutation.mutate()}
              disabled={discoverMutation.isPending}
            >
              {discoverMutation.isPending ? 'Scanning...' : 'Run Discovery'}
            </Button>
          </Tooltip>
        )}
      </Box>

      <Grid container spacing={3}>

        {/* Server Details */}
        <Grid item xs={12} md={6}>
          <Card>
            <CardContent>
              <Typography variant="h6" gutterBottom>Server Details</Typography>

              <Box sx={{ display: 'flex', flexDirection: 'column', gap: 1.5 }}>
                <Box>
                  <Typography variant="caption" color="text.secondary">IP Address</Typography>
                  <Typography variant="body2" sx={{ fontFamily: 'monospace' }}>{server.ipAddress}</Typography>
                </Box>

                {server.domain && (
                  <Box>
                    <Typography variant="caption" color="text.secondary">Domain</Typography>
                    <Typography variant="body2">{server.domain}</Typography>
                  </Box>
                )}

                <Box>
                  <Typography variant="caption" color="text.secondary">Operating System</Typography>
                  <Typography variant="body2">{server.operatingSystem || 'Unknown'}</Typography>
                </Box>

                <Box>
                  <Typography variant="caption" color="text.secondary">Roles</Typography>
                  <Box sx={{ display: 'flex', flexWrap: 'wrap', gap: 0.5, mt: 0.5 }}>
                    {server.roles?.length > 0 ? server.roles.map((role: string) => (
                      <Chip
                        key={role}
                        label={role}
                        size="small"
                        color={roleColors[role] ?? 'default'}
                        variant="outlined"
                      />
                    )) : (
                      <Typography variant="body2" color="text.secondary">No roles assigned</Typography>
                    )}
                  </Box>
                </Box>

                <Box>
                  <Typography variant="caption" color="text.secondary">Remote Management</Typography>
                  <Box sx={{ display: 'flex', gap: 0.5, mt: 0.5 }}>
                    <Chip
                      label={server.remoteManagement?.winRMEnabled ? 'WinRM Enabled' : 'WinRM Disabled'}
                      size="small"
                      color={server.remoteManagement?.winRMEnabled ? 'success' : 'default'}
                      variant="outlined"
                    />
                  </Box>
                </Box>

                {server.lastSyncedAt && (
                  <Box>
                    <Typography variant="caption" color="text.secondary">Last Discovery</Typography>
                    <Typography variant="body2">{format(new Date(server.lastSyncedAt), 'PPP p')}</Typography>
                  </Box>
                )}
              </Box>
            </CardContent>
          </Card>
        </Grid>

        {/* Applications */}
        <Grid item xs={12} md={6}>
          <Card sx={{ height: '100%' }}>
            <CardContent>
              <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, mb: 2 }}>
                <AppIcon color="primary" fontSize="small" />
                <Typography variant="h6">Applications ({applications.length})</Typography>
              </Box>
              <Typography variant="body2" color="text.secondary" sx={{ mb: 2 }}>
                Applications linked to certificates deployed on this server.
              </Typography>

              {applications.length > 0 ? (
                <Box sx={{ display: 'flex', flexDirection: 'column', gap: 1 }}>
                  {applications.map((app: any) => (
                    <Box
                      key={app._id}
                      sx={{
                        display: 'flex',
                        alignItems: 'center',
                        gap: 1,
                        p: 1,
                        borderRadius: 1,
                        border: '1px solid',
                        borderColor: 'divider',
                        cursor: 'pointer',
                        '&:hover': { bgcolor: 'action.hover' },
                      }}
                      onClick={() => navigate(`/applications/${app._id}`)}
                    >
                      <AppIcon fontSize="small" color="action" />
                      <Typography variant="body2" fontWeight={500}>{app.name}</Typography>
                      <Chip
                        label={app.status}
                        size="small"
                        color={app.status === 'active' ? 'success' : 'default'}
                        sx={{ ml: 'auto', textTransform: 'capitalize' }}
                      />
                    </Box>
                  ))}
                </Box>
              ) : (
                <Typography variant="body2" color="text.secondary">
                  No applications linked. Assign an application to one of this server's certificates.
                </Typography>
              )}
            </CardContent>
          </Card>
        </Grid>

        {/* Certificates */}
        <Grid item xs={12}>
          <Card>
            <CardContent>
              <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, mb: 2 }}>
                <CertIcon color="primary" />
                <Typography variant="h6">
                  Certificates ({certs.length})
                </Typography>
              </Box>
              <Typography variant="body2" color="text.secondary" sx={{ mb: 2 }}>
                Certificates discovered serving on this server via TLS probe.
              </Typography>

              {certs.length > 0 ? (
                <TableContainer component={Paper} variant="outlined">
                  <Table size="small">
                    <TableHead>
                      <TableRow>
                        <TableCell><strong>Common Name</strong></TableCell>
                        <TableCell><strong>Application</strong></TableCell>
                        <TableCell><strong>Issuer</strong></TableCell>
                        <TableCell><strong>Valid To</strong></TableCell>
                        <TableCell><strong>Days Left</strong></TableCell>
                        <TableCell><strong>Status</strong></TableCell>
                      </TableRow>
                    </TableHead>
                    <TableBody>
                      {certs.map((cert: any) => {
                        const daysLeft = differenceInDays(new Date(cert.validTo), new Date());
                        const app = cert.applicationId && typeof cert.applicationId === 'object'
                          ? cert.applicationId
                          : null;
                        return (
                          <TableRow
                            key={cert._id}
                            hover
                            sx={{ cursor: 'pointer' }}
                            onClick={() => navigate(`/certificates/${cert._id}`)}
                          >
                            <TableCell>
                              <Typography variant="body2" fontWeight={500}>{cert.commonName}</Typography>
                              <Typography variant="caption" color="text.secondary" sx={{ fontFamily: 'monospace' }}>
                                {cert.thumbprint?.substring(0, 16)}…
                              </Typography>
                            </TableCell>
                            <TableCell>
                              {app ? (
                                <Chip
                                  icon={<AppIcon />}
                                  label={app.name}
                                  size="small"
                                  variant="outlined"
                                  onClick={(e) => { e.stopPropagation(); navigate(`/applications/${app._id}`); }}
                                />
                              ) : (
                                <Typography variant="caption" color="text.secondary">Unassigned</Typography>
                              )}
                            </TableCell>
                            <TableCell>
                              <Typography variant="body2">{cert.issuer?.commonName}</Typography>
                            </TableCell>
                            <TableCell>
                              <Typography variant="body2">{format(new Date(cert.validTo), 'PP')}</Typography>
                            </TableCell>
                            <TableCell>
                              <Typography
                                variant="body2"
                                color={daysLeft <= 7 ? 'error' : daysLeft <= 30 ? 'warning.main' : 'inherit'}
                                fontWeight={daysLeft <= 30 ? 600 : 400}
                              >
                                {daysLeft > 0 ? daysLeft : 'Expired'}
                              </Typography>
                            </TableCell>
                            <TableCell>
                              <Chip
                                label={cert.status}
                                size="small"
                                color={certStatusColors[cert.status] ?? 'default'}
                                sx={{ textTransform: 'capitalize' }}
                              />
                            </TableCell>
                          </TableRow>
                        );
                      })}
                    </TableBody>
                  </Table>
                </TableContainer>
              ) : (
                <Alert severity="info">
                  No certificates linked to this server yet. Run discovery to detect active certificates.
                </Alert>
              )}
            </CardContent>
          </Card>
        </Grid>

      </Grid>
    </Box>
  );
}