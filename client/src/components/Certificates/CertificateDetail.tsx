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
  Select,
  MenuItem,
  FormControl,
  InputLabel,
  FormHelperText,
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
  Replay as ReissuedIcon,
  Refresh as ReissueIcon,
} from '@mui/icons-material';
import { format, differenceInDays } from 'date-fns';
import { useState } from 'react';
import { getCertificate, deleteCertificate, updateCertificate, reissueCertificate } from '../../services/certificates';
import api from '../../services/api';
import { Application, PaginatedResponse } from '../../types';
import { useAuth } from '../../context/AuthContext';

const statusColors: Record<string, 'success' | 'warning' | 'error' | 'default' | 'info'> = {
  active: 'success',
  expiring: 'warning',
  expired: 'error',
  revoked: 'default',
  reissued: 'info',
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

  // Re-issue dialog state
  const [reissueDialogOpen, setReissueDialogOpen] = useState(false);
  const [reissueServerType, setReissueServerType] = useState<'apache' | 'iis'>('apache');
  const [reissueEmails, setReissueEmails] = useState('');
  const [reissueEmailError, setReissueEmailError] = useState('');

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

  const markReissuedMutation = useMutation({
    mutationFn: () => updateCertificate(id!, { status: 'reissued' }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['certificate', id] });
      queryClient.invalidateQueries({ queryKey: ['certificates'] });
      queryClient.invalidateQueries({ queryKey: ['certificateStats'] });
    },
  });

  const reissueMutation = useMutation({
    mutationFn: () => {
      const emails = reissueServerType === 'apache'
        ? reissueEmails.split(',').map(e => e.trim()).filter(Boolean)
        : [];
      return reissueCertificate(id!, { serverType: reissueServerType, deliveryEmails: emails });
    },
    onSuccess: (data) => {
      setReissueDialogOpen(false);
      navigate(`/csr/${data.csrId}`);
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

  const handleOpenReissueDialog = () => {
    // Pre-populate server type: prefer explicit serverType, then infer from deployedLocations
    let detectedType: 'apache' | 'iis' = 'iis'; // Default to IIS for TUHS Windows estate
    if (cert?.serverType) {
      detectedType = cert.serverType;
    }
    setReissueServerType(detectedType);
    setReissueEmails('');
    setReissueEmailError('');
    setReissueDialogOpen(true);
  };

  const handleReissueSubmit = () => {
    if (reissueServerType === 'apache') {
      const emails = reissueEmails.split(',').map(e => e.trim()).filter(Boolean);
      const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
      const invalid = emails.filter(e => !emailRegex.test(e));
      if (invalid.length > 0) {
        setReissueEmailError(`Invalid address(es): ${invalid.join(', ')}`);
        return;
      }
    }
    reissueMutation.mutate();
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
        {isOperator && cert.status !== 'reissued' && cert.status !== 'revoked' && (
          <Button
            color="primary"
            variant="contained"
            startIcon={<ReissueIcon />}
            onClick={handleOpenReissueDialog}
          >
            Re-issue Certificate
          </Button>
        )}
        {isOperator && cert.status !== 'reissued' && (
          <Tooltip title="Manually flag this certificate as already reissued (does not create a new certificate)">
            <Button
              color="info"
              variant="outlined"
              startIcon={<ReissuedIcon />}
              onClick={() => {
                if (confirm(`Mark "${cert.commonName}" as reissued? This will flag it for cleanup.`)) {
                  markReissuedMutation.mutate();
                }
              }}
              disabled={markReissuedMutation.isPending}
            >
              Mark Reissued
            </Button>
          </Tooltip>
        )}
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
                {cert.keySize && (
                  <Grid item xs={6}>
                    <Typography variant="caption" color="textSecondary">Key Size</Typography>
                    <Typography variant="body2">{cert.keySize} bits</Typography>
                  </Grid>
                )}
                {cert.encryptionType && (
                  <Grid item xs={6}>
                    <Typography variant="caption" color="textSecondary">Encryption Type</Typography>
                    <Typography variant="body2">{cert.encryptionType}</Typography>
                  </Grid>
                )}
                <Grid item xs={6}>
                  <Typography variant="caption" color="textSecondary">Web Server Type</Typography>
                  {cert.serverType ? (
                    <Chip
                      size="small"
                      label={cert.serverType === 'iis' ? 'IIS / F5' : 'Apache'}
                      color={cert.serverType === 'iis' ? 'primary' : 'default'}
                      variant="outlined"
                      sx={{ mt: 0.5 }}
                    />
                  ) : (
                    <Typography variant="body2" color="text.secondary">Unknown — run discovery</Typography>
                  )}
                </Grid>
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
              {cert.keyUsage && cert.keyUsage.length > 0 && (
                <>
                  <Divider sx={{ my: 2 }} />
                  <Typography variant="subtitle2" gutterBottom>Key Usage</Typography>
                  <Box sx={{ display: 'flex', flexWrap: 'wrap', gap: 1 }}>
                    {cert.keyUsage.map((usage, index) => (
                      <Chip key={index} label={usage} size="small" variant="outlined" color="primary" />
                    ))}
                  </Box>
                </>
              )}
              {cert.extendedKeyUsage && cert.extendedKeyUsage.length > 0 && (
                <>
                  <Divider sx={{ my: 2 }} />
                  <Typography variant="subtitle2" gutterBottom>Extended Key Usage</Typography>
                  <Box sx={{ display: 'flex', flexWrap: 'wrap', gap: 1 }}>
                    {cert.extendedKeyUsage.map((usage, index) => (
                      <Chip key={index} label={usage} size="small" variant="outlined" color="secondary" />
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

        {/* Deployed Locations - Discovery Results */}
        <Grid item xs={12}>
          <Card>
            <CardContent>
              <Box sx={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', mb: 1 }}>
                <Typography variant="h6">Deployed Locations</Typography>
                {isOperator && (
                  <Tooltip title="Probe this certificate's hostname and SANs over TLS to discover where it's currently being served">
                    <Button
                      size="small"
                      variant="outlined"
                      onClick={() => {
                        api.post(`/certificates/discover?certId=${cert._id}`).then(() => {
                          queryClient.invalidateQueries({ queryKey: ['certificate', id] });
                        });
                      }}
                    >
                      Run Discovery
                    </Button>
                  </Tooltip>
                )}
              </Box>
              <Typography variant="body2" color="textSecondary" sx={{ mb: 2 }}>
                TLS probe results showing where this certificate is actively being served. A <strong>match</strong> means
                the live cert fingerprint matches this record. <strong>Mismatch</strong> means a different cert is being served —
                likely a renewed cert that hasn't propagated, or a different cert on that host.
              </Typography>

              {(!cert.deployedLocations || cert.deployedLocations.length === 0) ? (
                <Typography color="textSecondary" variant="body2">
                  No discovery data yet. Click "Run Discovery" to probe this certificate's hostname and SANs.
                </Typography>
              ) : (
                <Box component="table" sx={{ width: '100%', borderCollapse: 'collapse' }}>
                  <Box component="thead">
                    <Box component="tr" sx={{ borderBottom: '1px solid', borderColor: 'divider' }}>
                      {['Hostname', 'Port', 'Status', 'Served Thumbprint', 'Last Probed'].map(h => (
                        <Box component="th" key={h} sx={{ textAlign: 'left', pb: 1, pr: 2, typography: 'caption', fontWeight: 600, color: 'text.secondary' }}>{h}</Box>
                      ))}
                    </Box>
                  </Box>
                  <Box component="tbody">
                    {cert.deployedLocations.map((loc: any, idx: number) => (
                      <Box component="tr" key={idx} sx={{ borderBottom: '1px solid', borderColor: 'divider', '&:last-child': { borderBottom: 0 } }}>
                        <Box component="td" sx={{ py: 1, pr: 2 }}>
                          <Typography variant="body2" sx={{ fontFamily: 'monospace' }}>{loc.hostname}</Typography>
                          {loc.resolvedIP && <Typography variant="caption" color="text.secondary">{loc.resolvedIP}</Typography>}
                        </Box>
                        <Box component="td" sx={{ py: 1, pr: 2 }}>
                          <Typography variant="body2">{loc.port}</Typography>
                        </Box>
                        <Box component="td" sx={{ py: 1, pr: 2 }}>
                          <Chip
                            size="small"
                            label={loc.matchStatus || 'unknown'}
                            color={
                              loc.matchStatus === 'match' ? 'success' :
                              loc.matchStatus === 'mismatch' ? 'warning' :
                              loc.matchStatus === 'error' ? 'error' : 'default'
                            }
                          />
                        </Box>
                        <Box component="td" sx={{ py: 1, pr: 2 }}>
                          <Typography variant="body2" sx={{ fontFamily: 'monospace', fontSize: '0.7rem' }}>
                            {loc.servedThumbprint
                              ? loc.servedThumbprint.match(/.{1,8}/g)?.join(' ') ?? loc.servedThumbprint
                              : '—'}
                          </Typography>
                        </Box>
                        <Box component="td" sx={{ py: 1 }}>
                          <Typography variant="body2" color="text.secondary">
                            {loc.lastProbeAt ? format(new Date(loc.lastProbeAt), 'MMM d, h:mm a') : '—'}
                          </Typography>
                        </Box>
                      </Box>
                    ))}
                  </Box>
                </Box>
              )}
            </CardContent>
          </Card>
        </Grid>

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

      {/* Re-issue Dialog */}
      <Dialog open={reissueDialogOpen} onClose={() => setReissueDialogOpen(false)} maxWidth="sm" fullWidth>
        <DialogTitle>Re-issue Certificate</DialogTitle>
        <DialogContent>
          <Typography variant="body2" color="textSecondary" sx={{ mb: 3 }}>
            This creates a new CSR pre-filled with <strong>{cert.commonName}</strong>'s current attributes.
            You'll be taken to the CSR wizard to review, generate, and submit to the CA.
          </Typography>

          {/* Discovery context — show matched locations if we have them */}
          {cert.deployedLocations && cert.deployedLocations.filter((l: any) => l.matchStatus === 'match').length > 0 && (
            <Alert severity="info" sx={{ mb: 2 }}>
              Discovery found this certificate actively serving on:{' '}
              {cert.deployedLocations
                .filter((l: any) => l.matchStatus === 'match')
                .map((l: any) => `${l.hostname}:${l.port}`)
                .join(', ')}
              . After re-issue, run discovery again to confirm the new cert is deployed.
            </Alert>
          )}

          <FormControl fullWidth sx={{ mb: 3 }}>
            <InputLabel>Server Type</InputLabel>
            <Select
              value={reissueServerType}
              label="Server Type"
              onChange={(e) => setReissueServerType(e.target.value as 'apache' | 'iis')}
            >
              <MenuItem value="apache">Apache — generate CSR locally, deliver cert+key by email</MenuItem>
              <MenuItem value="iis">IIS — generate CSR on target server, install automatically</MenuItem>
            </Select>
            {!cert.serverType && (
              <FormHelperText>
                No server type on record — defaulting to IIS. Change if this is an Apache/Linux cert.
              </FormHelperText>
            )}
          </FormControl>

          {reissueServerType === 'apache' && (
            <TextField
              fullWidth
              label="Delivery email addresses"
              placeholder="user@tuhs.org, other@tuhs.org"
              value={reissueEmails}
              onChange={(e) => { setReissueEmails(e.target.value); setReissueEmailError(''); }}
              error={!!reissueEmailError}
              helperText={reissueEmailError || 'Comma-separated. The cert + key zip will be emailed here when issued.'}
              multiline
              rows={2}
            />
          )}

          {reissueMutation.isError && (
            <Alert severity="error" sx={{ mt: 2 }}>
              {(reissueMutation.error as any)?.response?.data?.error || 'Failed to create re-issue request'}
            </Alert>
          )}
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setReissueDialogOpen(false)} disabled={reissueMutation.isPending}>Cancel</Button>
          <Button
            variant="contained"
            onClick={handleReissueSubmit}
            disabled={reissueMutation.isPending}
          >
            {reissueMutation.isPending ? 'Creating...' : 'Create Re-issue CSR'}
          </Button>
        </DialogActions>
      </Dialog>
    </Box>
  );
}