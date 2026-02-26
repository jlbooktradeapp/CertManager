import { useParams, useNavigate } from 'react-router-dom';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import {
  Box,
  Typography,
  Card,
  CardContent,
  Grid,
  Chip,
  Button,
  CircularProgress,
  Alert,
  Divider,
  IconButton,
  Dialog,
  DialogTitle,
  DialogContent,
  DialogActions,
  TextField,
  Autocomplete,
  Tooltip,
} from '@mui/material';
import {
  ArrowBack as BackIcon,
  Delete as DeleteIcon,
  Email as EmailIcon,
  Add as AddIcon,
  Apps as AppsIcon,
  Person as PersonIcon,
  Business as VendorIcon,
  Clear as ClearIcon,
} from '@mui/icons-material';
import { format, differenceInDays } from 'date-fns';
import { useState } from 'react';
import { getCertificate, deleteCertificate, updateCertificate } from '../../services/certificates';
import api from '../../services/api';
import { Application, PaginatedResponse } from '../../types';
import { useAuth } from '../../context/AuthContext';

const statusColors: Record<string, 'success' | 'warning' | 'error' | 'default'> = {
  active: 'success',
  expiring: 'warning',
  expired: 'error',
  revoked: 'default',
};

export default function CertificateDetail() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const { isOperator } = useAuth();
  const [deleteDialogOpen, setDeleteDialogOpen] = useState(false);
  const [newEmail, setNewEmail] = useState('');
  const [emailError, setEmailError] = useState('');
  const [appSearchInput, setAppSearchInput] = useState('');

  const { data: cert, isLoading, error } = useQuery({
    queryKey: ['certificate', id],
    queryFn: () => getCertificate(id!),
    enabled: !!id,
  });

  const { data: appResults } = useQuery({
    queryKey: ['applications-search', appSearchInput],
    queryFn: async () => {
      const params = new URLSearchParams({ limit: '10' });
      if (appSearchInput) params.set('search', appSearchInput);
      const response = await api.get<PaginatedResponse<Application>>(`/applications?${params}`);
      return response.data.data;
    },
  });

  const deleteMutation = useMutation({
    mutationFn: () => deleteCertificate(id!),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['certificates'] });
      navigate('/certificates');
    },
  });

  const updateRecipientsMutation = useMutation({
    mutationFn: (recipients: string[]) => updateCertificate(id!, { notificationRecipients: recipients }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['certificate', id] });
    },
  });

  const updateApplicationMutation = useMutation({
    mutationFn: (applicationId: string | null) => updateCertificate(id!, { applicationId }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['certificate', id] });
      queryClient.invalidateQueries({ queryKey: ['applications'] });
    },
  });

  const handleAddRecipient = () => {
    const email = newEmail.trim();
    if (!email) return;
    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    if (!emailRegex.test(email)) { setEmailError('Invalid email address'); return; }
    const current = cert?.notificationRecipients || [];
    if (current.includes(email)) { setEmailError('Email already added'); return; }
    updateRecipientsMutation.mutate([...current, email]);
    setNewEmail('');
    setEmailError('');
  };

  const handleRemoveRecipient = (email: string) => {
    const current = cert?.notificationRecipients || [];
    updateRecipientsMutation.mutate(current.filter(e => e !== email));
  };

  if (isLoading) {
    return (
      <Box sx={{ display: 'flex', justifyContent: 'center', mt: 4 }}>
        <CircularProgress />
      </Box>
    );
  }

  if (error || !cert) {
    return <Alert severity="error">Certificate not found</Alert>;
  }

  const daysLeft = differenceInDays(new Date(cert.validTo), new Date());
  const assignedApp = cert.applicationId && typeof cert.applicationId === 'object'
    ? cert.applicationId as Application
    : null;

  return (
    <Box>
      <Box sx={{ display: 'flex', alignItems: 'center', gap: 2, mb: 3 }}>
        <IconButton onClick={() => navigate('/certificates')}>
          <BackIcon />
        </IconButton>
        <Typography variant="h4" sx={{ flexGrow: 1 }}>
          {cert.commonName}
        </Typography>
        <Chip label={cert.status} color={statusColors[cert.status]} sx={{ textTransform: 'capitalize' }} />
        {isOperator && (
          <Button color="error" startIcon={<DeleteIcon />} onClick={() => setDeleteDialogOpen(true)}>
            Remove
          </Button>
        )}
      </Box>

      <Grid container spacing={3}>
        {/* Certificate Details */}
        <Grid item xs={12} md={6}>
          <Card>
            <CardContent>
              <Typography variant="h6" gutterBottom>Certificate Details</Typography>
              <Grid container spacing={2}>
                <Grid item xs={4}>
                  <Typography variant="caption" color="textSecondary">Serial Number</Typography>
                  <Typography variant="body2" sx={{ wordBreak: 'break-all' }}>{cert.serialNumber}</Typography>
                </Grid>
                <Grid item xs={8}>
                  <Typography variant="caption" color="textSecondary">Thumbprint</Typography>
                  <Typography variant="body2" sx={{ wordBreak: 'break-all', fontFamily: 'monospace' }}>{cert.thumbprint}</Typography>
                </Grid>
                <Grid item xs={6}>
                  <Typography variant="caption" color="textSecondary">Valid From</Typography>
                  <Typography variant="body2">{format(new Date(cert.validFrom), 'PPP')}</Typography>
                </Grid>
                <Grid item xs={6}>
                  <Typography variant="caption" color="textSecondary">Valid To</Typography>
                  <Typography variant="body2" color={daysLeft <= 7 ? 'error' : daysLeft <= 30 ? 'warning.main' : 'inherit'}>
                    {format(new Date(cert.validTo), 'PPP')}
                    <Typography variant="caption" component="span" sx={{ ml: 1 }}>
                      ({daysLeft > 0 ? `${daysLeft} days left` : 'Expired'})
                    </Typography>
                  </Typography>
                </Grid>
                <Grid item xs={12}>
                  <Typography variant="caption" color="textSecondary">Issuer</Typography>
                  <Typography variant="body2">{cert.issuer.commonName}</Typography>
                </Grid>
                {cert.templateName && (
                  <Grid item xs={12}>
                    <Typography variant="caption" color="textSecondary">Template</Typography>
                    <Typography variant="body2">{cert.templateName}</Typography>
                  </Grid>
                )}
              </Grid>
            </CardContent>
          </Card>
        </Grid>

        {/* Subject */}
        <Grid item xs={12} md={6}>
          <Card>
            <CardContent>
              <Typography variant="h6" gutterBottom>Subject Information</Typography>
              <Grid container spacing={2}>
                <Grid item xs={12}>
                  <Typography variant="caption" color="textSecondary">Common Name (CN)</Typography>
                  <Typography variant="body2">{cert.subject.commonName}</Typography>
                </Grid>
                {cert.subject.organization && (
                  <Grid item xs={6}>
                    <Typography variant="caption" color="textSecondary">Organization (O)</Typography>
                    <Typography variant="body2">{cert.subject.organization}</Typography>
                  </Grid>
                )}
                {cert.subject.organizationalUnit && (
                  <Grid item xs={6}>
                    <Typography variant="caption" color="textSecondary">Organizational Unit (OU)</Typography>
                    <Typography variant="body2">{cert.subject.organizationalUnit}</Typography>
                  </Grid>
                )}
                {cert.subject.locality && (
                  <Grid item xs={4}>
                    <Typography variant="caption" color="textSecondary">Locality (L)</Typography>
                    <Typography variant="body2">{cert.subject.locality}</Typography>
                  </Grid>
                )}
                {cert.subject.state && (
                  <Grid item xs={4}>
                    <Typography variant="caption" color="textSecondary">State (S)</Typography>
                    <Typography variant="body2">{cert.subject.state}</Typography>
                  </Grid>
                )}
                {cert.subject.country && (
                  <Grid item xs={4}>
                    <Typography variant="caption" color="textSecondary">Country (C)</Typography>
                    <Typography variant="body2">{cert.subject.country}</Typography>
                  </Grid>
                )}
              </Grid>
              {cert.subjectAlternativeNames.length > 0 && (
                <>
                  <Divider sx={{ my: 2 }} />
                  <Typography variant="subtitle2" gutterBottom>Subject Alternative Names (SANs)</Typography>
                  <Box sx={{ display: 'flex', flexWrap: 'wrap', gap: 1 }}>
                    {cert.subjectAlternativeNames.map((san, index) => (
                      <Chip key={index} label={san} size="small" variant="outlined" />
                    ))}
                  </Box>
                </>
              )}
            </CardContent>
          </Card>
        </Grid>

        {/* Application Assignment */}
        <Grid item xs={12}>
          <Card>
            <CardContent>
              <Typography variant="h6" gutterBottom>Application</Typography>
              <Typography variant="body2" color="textSecondary" sx={{ mb: 2 }}>
                Assigning a certificate to an application automatically includes application owners and vendor contacts as notification recipients for expiration warnings.
              </Typography>

              {assignedApp ? (
                <Box sx={{ p: 2, border: 1, borderColor: 'divider', borderRadius: 1 }}>
                  <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
                    <Box>
                      <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, mb: 1 }}>
                        <AppsIcon color="primary" />
                        <Typography variant="h6"
                          sx={{ cursor: 'pointer', '&:hover': { textDecoration: 'underline' } }}
                          onClick={() => navigate(`/applications/${assignedApp._id}`)}
                        >
                          {assignedApp.name}
                        </Typography>
                        <Chip label={assignedApp.status} size="small" color={assignedApp.status === 'active' ? 'success' : 'default'} sx={{ textTransform: 'capitalize' }} />
                      </Box>
                      {assignedApp.description && (
                        <Typography variant="body2" color="textSecondary" sx={{ mb: 1 }}>{assignedApp.description}</Typography>
                      )}
                      {assignedApp.owners && assignedApp.owners.length > 0 && (
                        <Box sx={{ mt: 1 }}>
                          <Typography variant="caption" color="textSecondary" fontWeight={600}>Owners (will be notified):</Typography>
                          <Box sx={{ display: 'flex', flexWrap: 'wrap', gap: 0.5, mt: 0.5 }}>
                            {assignedApp.owners.map((owner, i) => (
                              <Tooltip key={i} title={owner.email}>
                                <Chip icon={<PersonIcon />} label={`${owner.name} (${owner.email})`} size="small" variant="outlined" />
                              </Tooltip>
                            ))}
                          </Box>
                        </Box>
                      )}
                      {assignedApp.vendor?.name && (
                        <Box sx={{ mt: 1 }}>
                          <Typography variant="caption" color="textSecondary" fontWeight={600}>Vendor:</Typography>
                          <Box sx={{ display: 'flex', flexWrap: 'wrap', gap: 0.5, mt: 0.5 }}>
                            <Chip icon={<VendorIcon />} label={assignedApp.vendor.name} size="small" variant="outlined" />
                            {assignedApp.vendor.contactEmail && (
                              <Chip icon={<EmailIcon />} label={`${assignedApp.vendor.contactName || ''} (${assignedApp.vendor.contactEmail})`} size="small" variant="outlined" />
                            )}
                          </Box>
                        </Box>
                      )}
                    </Box>
                    {isOperator && (
                      <Tooltip title="Unassign application">
                        <IconButton color="error"
                          onClick={() => { if (confirm(`Unassign "${assignedApp.name}" from this certificate?`)) updateApplicationMutation.mutate(null); }}
                          disabled={updateApplicationMutation.isPending}
                        >
                          <ClearIcon />
                        </IconButton>
                      </Tooltip>
                    )}
                  </Box>
                </Box>
              ) : (
                <>
                  <Typography color="textSecondary" sx={{ mb: 2 }}>No application assigned.</Typography>
                  {isOperator && (
                    <Autocomplete
                      options={appResults || []}
                      getOptionLabel={(option) => option.name}
                      onInputChange={(_e, value) => setAppSearchInput(value)}
                      onChange={(_e, value) => { if (value) updateApplicationMutation.mutate(value._id); }}
                      loading={!appResults}
                      renderOption={(props, option) => (
                        <li {...props} key={option._id}>
                          <Box>
                            <Typography variant="body2" fontWeight={500}>{option.name}</Typography>
                            {option.owners.length > 0 && (
                              <Typography variant="caption" color="textSecondary">
                                Owner: {option.owners.map(o => o.name).join(', ')}
                              </Typography>
                            )}
                          </Box>
                        </li>
                      )}
                      renderInput={(params) => (
                        <TextField {...params} label="Search and assign an application" placeholder="Type to search..." size="small" sx={{ maxWidth: 500 }} />
                      )}
                      noOptionsText="No applications found"
                      disabled={updateApplicationMutation.isPending}
                    />
                  )}
                </>
              )}
            </CardContent>
          </Card>
        </Grid>

        {/* Deployments - Hidden until Phase 2 (WinRM/gMSA) */}

        {/* Notification Recipients */}
        <Grid item xs={12}>
          <Card>
            <CardContent>
              <Typography variant="h6" gutterBottom>Notification Recipients</Typography>
              <Typography variant="body2" color="textSecondary" sx={{ mb: 2 }}>
                These email addresses receive expiration warnings for this certificate, in addition to global recipients from Settings{assignedApp ? ' and application owner emails' : ''}.
              </Typography>
              {(cert.notificationRecipients && cert.notificationRecipients.length > 0) ? (
                <Box sx={{ display: 'flex', flexWrap: 'wrap', gap: 1, mb: 2 }}>
                  {cert.notificationRecipients.map((email) => (
                    <Chip key={email} icon={<EmailIcon />} label={email} onDelete={isOperator ? () => handleRemoveRecipient(email) : undefined} variant="outlined" />
                  ))}
                </Box>
              ) : (
                <Typography color="textSecondary" sx={{ mb: 2 }}>
                  No per-certificate recipients configured. Only global notification recipients{assignedApp ? ' and application owners' : ''} will be notified.
                </Typography>
              )}
              {isOperator && (
                <Box sx={{ display: 'flex', gap: 1, alignItems: 'flex-start' }}>
                  <TextField size="small" label="Email address" type="email" value={newEmail}
                    onChange={(e) => { setNewEmail(e.target.value); setEmailError(''); }}
                    onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); handleAddRecipient(); } }}
                    error={!!emailError} helperText={emailError} sx={{ minWidth: 300 }}
                  />
                  <Button variant="outlined" startIcon={<AddIcon />} onClick={handleAddRecipient}
                    disabled={!newEmail.trim() || updateRecipientsMutation.isPending}>Add</Button>
                </Box>
              )}
            </CardContent>
          </Card>
        </Grid>
      </Grid>

      {/* Delete Dialog */}
      <Dialog open={deleteDialogOpen} onClose={() => setDeleteDialogOpen(false)}>
        <DialogTitle>Remove Certificate from Tracking?</DialogTitle>
        <DialogContent>
          <Typography>
            This will remove the certificate "{cert.commonName}" from the Certificate Manager. The actual certificate will not be affected.
          </Typography>
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setDeleteDialogOpen(false)}>Cancel</Button>
          <Button color="error" onClick={() => deleteMutation.mutate()} disabled={deleteMutation.isPending}>Remove</Button>
        </DialogActions>
      </Dialog>
    </Box>
  );
}