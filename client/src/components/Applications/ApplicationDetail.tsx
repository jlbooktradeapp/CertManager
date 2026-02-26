import { useParams, useNavigate } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
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
} from '@mui/material';
import {
  ArrowBack as BackIcon,
  Person as PersonIcon,
  Business as VendorIcon,
  Email as EmailIcon,
  Security as CertIcon,
} from '@mui/icons-material';
import { format, differenceInDays } from 'date-fns';
import api from '../../services/api';
import { Application } from '../../types';

const certStatusColors: Record<string, 'success' | 'warning' | 'error' | 'default'> = {
  active: 'success',
  expiring: 'warning',
  expired: 'error',
  revoked: 'default',
};

export default function ApplicationDetail() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();

  const { data: app, isLoading, error } = useQuery({
    queryKey: ['application', id],
    queryFn: async () => {
      const response = await api.get<Application>(`/applications/${id}`);
      return response.data;
    },
    enabled: !!id,
  });

  if (isLoading) {
    return (
      <Box sx={{ display: 'flex', justifyContent: 'center', mt: 4 }}>
        <CircularProgress />
      </Box>
    );
  }

  if (error || !app) {
    return <Alert severity="error">Application not found</Alert>;
  }

  return (
    <Box>
      <Box sx={{ display: 'flex', alignItems: 'center', gap: 2, mb: 3 }}>
        <IconButton onClick={() => navigate('/applications')}>
          <BackIcon />
        </IconButton>
        <Typography variant="h4" sx={{ flexGrow: 1 }}>
          {app.name}
        </Typography>
        <Chip
          label={app.status}
          size="small"
          color={app.status === 'active' ? 'success' : app.status === 'retired' ? 'error' : 'default'}
          sx={{ textTransform: 'capitalize' }}
        />
      </Box>

      <Grid container spacing={3}>
        {/* Application Info */}
        <Grid item xs={12} md={6}>
          <Card>
            <CardContent>
              <Typography variant="h6" gutterBottom>Application Details</Typography>
              {app.description && (
                <Typography variant="body2" color="textSecondary" sx={{ mb: 2 }}>
                  {app.description}
                </Typography>
              )}

              <Typography variant="subtitle2" sx={{ mt: 2, mb: 1 }}>Owners</Typography>
              {app.owners.length > 0 ? (
                <Box sx={{ display: 'flex', flexDirection: 'column', gap: 1 }}>
                  {app.owners.map((owner, i) => (
                    <Box key={i} sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
                      <PersonIcon fontSize="small" color="action" />
                      <Typography variant="body2">{owner.name}</Typography>
                      <Chip icon={<EmailIcon />} label={owner.email} size="small" variant="outlined" />
                      {owner.role && (
                        <Chip label={owner.role} size="small" variant="outlined" color="primary" />
                      )}
                    </Box>
                  ))}
                </Box>
              ) : (
                <Typography variant="body2" color="textSecondary">No owners assigned</Typography>
              )}
            </CardContent>
          </Card>
        </Grid>

        {/* Vendor Info */}
        <Grid item xs={12} md={6}>
          <Card>
            <CardContent>
              <Typography variant="h6" gutterBottom>Vendor Information</Typography>
              {app.vendor?.name ? (
                <Box>
                  <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, mb: 1 }}>
                    <VendorIcon fontSize="small" color="action" />
                    <Typography variant="body1" fontWeight={500}>{app.vendor.name}</Typography>
                  </Box>
                  {app.vendor.contactName && (
                    <Typography variant="body2" sx={{ ml: 4 }}>
                      Contact: {app.vendor.contactName}
                    </Typography>
                  )}
                  {app.vendor.contactEmail && (
                    <Box sx={{ ml: 4, mt: 0.5 }}>
                      <Chip icon={<EmailIcon />} label={app.vendor.contactEmail} size="small" variant="outlined" />
                    </Box>
                  )}
                </Box>
              ) : (
                <Typography variant="body2" color="textSecondary">No vendor information</Typography>
              )}

              <Typography variant="caption" color="textSecondary" display="block" sx={{ mt: 3 }}>
                Created: {format(new Date(app.createdAt), 'PPP')}
              </Typography>
              <Typography variant="caption" color="textSecondary" display="block">
                Updated: {format(new Date(app.updatedAt), 'PPP')}
              </Typography>
            </CardContent>
          </Card>
        </Grid>

        {/* Associated Certificates */}
        <Grid item xs={12}>
          <Card>
            <CardContent>
              <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, mb: 2 }}>
                <CertIcon color="primary" />
                <Typography variant="h6">
                  Associated Certificates ({app.certificates?.length || 0})
                </Typography>
              </Box>
              <Typography variant="body2" color="textSecondary" sx={{ mb: 2 }}>
                All application owners and vendor contacts automatically receive expiration notifications for these certificates.
              </Typography>

              {app.certificates && app.certificates.length > 0 ? (
                <TableContainer component={Paper} variant="outlined">
                  <Table size="small">
                    <TableHead>
                      <TableRow>
                        <TableCell><strong>Common Name</strong></TableCell>
                        <TableCell><strong>Serial Number</strong></TableCell>
                        <TableCell><strong>Issuer</strong></TableCell>
                        <TableCell><strong>Valid To</strong></TableCell>
                        <TableCell><strong>Days Left</strong></TableCell>
                        <TableCell><strong>Status</strong></TableCell>
                      </TableRow>
                    </TableHead>
                    <TableBody>
                      {app.certificates.map((cert) => {
                        const daysLeft = differenceInDays(new Date(cert.validTo), new Date());
                        return (
                          <TableRow
                            key={cert._id}
                            hover
                            sx={{ cursor: 'pointer' }}
                            onClick={() => navigate(`/certificates/${cert._id}`)}
                          >
                            <TableCell>
                              <Typography variant="body2" fontWeight={500}>{cert.commonName}</Typography>
                            </TableCell>
                            <TableCell>
                              <Typography variant="caption" sx={{ fontFamily: 'monospace' }}>
                                {cert.serialNumber?.substring(0, 16)}...
                              </Typography>
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
                                color={certStatusColors[cert.status]}
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
                  No certificates are assigned to this application yet. Assign certificates from the certificate detail page.
                </Alert>
              )}
            </CardContent>
          </Card>
        </Grid>
      </Grid>
    </Box>
  );
}