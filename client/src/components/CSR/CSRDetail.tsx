import { useState } from 'react';
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
  Alert,
  CircularProgress,
  Stepper,
  Step,
  StepLabel,
  StepContent,
  Divider,
  IconButton,
  Tooltip,
} from '@mui/material';
import {
  ArrowBack as BackIcon,
  PlayArrow as RunIcon,
  CheckCircle as SuccessIcon,
  Error as ErrorIcon,
  HourglassEmpty as PendingIcon,
  Delete as DeleteIcon,
  Email as EmailIcon,
} from '@mui/icons-material';
import api from '../../services/api';
import { CSRRequest } from '../../types';
import { useAuth } from '../../context/AuthContext';

const statusColors: Record<string, 'default' | 'primary' | 'secondary' | 'success' | 'error' | 'warning' | 'info'> = {
  draft: 'default',
  generating: 'info',
  pending: 'primary',
  submitted: 'secondary',
  issued: 'success',
  delivering: 'info',
  completed: 'success',
  failed: 'error',
  cancelled: 'warning',
};

export default function CSRDetail() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const { isOperator } = useAuth();
  const [actionError, setActionError] = useState<string | null>(null);

  const { data: csr, isLoading, error } = useQuery({
    queryKey: ['csr', id],
    queryFn: async () => {
      const response = await api.get<CSRRequest>(`/csr/${id}`);
      return response.data;
    },
    refetchInterval: (query) => {
      // Auto-refresh while processing
      const status = query.state.data?.status;
      if (status === 'generating' || status === 'submitted' || status === 'delivering') {
        return 3000;
      }
      return false;
    },
  });

  const generateMutation = useMutation({
    mutationFn: async () => {
      const response = await api.post(`/csr/${id}/generate`);
      return response.data;
    },
    onSuccess: () => {
      setActionError(null);
      queryClient.invalidateQueries({ queryKey: ['csr', id] });
    },
    onError: (err: any) => {
      setActionError(err.response?.data?.error || err.message);
      queryClient.invalidateQueries({ queryKey: ['csr', id] });
    },
  });

  const submitMutation = useMutation({
    mutationFn: async () => {
      const response = await api.post(`/csr/${id}/submit`);
      return response.data;
    },
    onSuccess: () => {
      setActionError(null);
      queryClient.invalidateQueries({ queryKey: ['csr', id] });
    },
    onError: (err: any) => {
      setActionError(err.response?.data?.error || err.message);
      queryClient.invalidateQueries({ queryKey: ['csr', id] });
    },
  });

  const deliverMutation = useMutation({
    mutationFn: async () => {
      const response = await api.post(`/csr/${id}/deliver`);
      return response.data;
    },
    onSuccess: () => {
      setActionError(null);
      queryClient.invalidateQueries({ queryKey: ['csr', id] });
    },
    onError: (err: any) => {
      setActionError(err.response?.data?.error || err.message);
      queryClient.invalidateQueries({ queryKey: ['csr', id] });
    },
  });

  const deleteMutation = useMutation({
    mutationFn: async () => {
      await api.delete(`/csr/${id}`);
    },
    onSuccess: () => {
      navigate('/csr');
    },
    onError: (err: any) => {
      setActionError(err.response?.data?.error || err.message);
    },
  });

  if (isLoading) {
    return (
      <Box sx={{ display: 'flex', justifyContent: 'center', mt: 4 }}>
        <CircularProgress />
      </Box>
    );
  }

  if (error || !csr) {
    return <Alert severity="error">Failed to load CSR request</Alert>;
  }

  const isProcessing = generateMutation.isPending || submitMutation.isPending || deliverMutation.isPending;

  // Determine which step is active for the stepper
  const getActiveStep = (): number => {
    const steps = csr.workflowSteps;
    for (let i = 0; i < steps.length; i++) {
      if (steps[i].status === 'pending' || steps[i].status === 'failed') return i;
    }
    return steps.length; // All completed
  };

  const canGenerate = csr.status === 'draft' && isOperator;
  const canSubmit = csr.status === 'pending' && isOperator;
  const canDeliver = csr.status === 'issued' && csr.serverType === 'apache' && isOperator;
  const canDelete = !['submitted', 'delivering'].includes(csr.status) && isOperator;

  return (
    <Box>
      <Box sx={{ display: 'flex', alignItems: 'center', gap: 2, mb: 3 }}>
        <IconButton onClick={() => navigate('/csr')}>
          <BackIcon />
        </IconButton>
        <Box sx={{ flex: 1 }}>
          <Typography variant="h5">{csr.commonName}</Typography>
          <Typography variant="body2" color="textSecondary">
            CSR Request · {csr.serverType === 'apache' ? 'Apache (OpenSSL)' : 'IIS (certreq)'}
          </Typography>
        </Box>
        <Chip
          label={csr.status}
          color={statusColors[csr.status] || 'default'}
          sx={{ textTransform: 'capitalize', fontWeight: 600 }}
        />
      </Box>

      {actionError && (
        <Alert severity="error" sx={{ mb: 2 }} onClose={() => setActionError(null)}>
          {actionError}
        </Alert>
      )}

      <Grid container spacing={3}>
        {/* Workflow Progress */}
        <Grid item xs={12} md={5}>
          <Card>
            <CardContent>
              <Typography variant="h6" gutterBottom>Workflow</Typography>
              <Stepper activeStep={getActiveStep()} orientation="vertical">
                {csr.workflowSteps.map((step, index) => (
                  <Step key={step.step} completed={step.status === 'completed'}>
                    <StepLabel
                      error={step.status === 'failed'}
                      icon={
                        step.status === 'completed' ? <SuccessIcon color="success" /> :
                        step.status === 'failed' ? <ErrorIcon color="error" /> :
                        <PendingIcon color="disabled" />
                      }
                    >
                      <Typography variant="subtitle2">{step.step}</Typography>
                      {step.completedAt && (
                        <Typography variant="caption" color="textSecondary">
                          {new Date(step.completedAt).toLocaleString()}
                        </Typography>
                      )}
                    </StepLabel>
                    <StepContent>
                      {step.error && (
                        <Alert severity="error" sx={{ mt: 1, mb: 1 }} variant="outlined">
                          {step.error}
                        </Alert>
                      )}

                      {/* Action buttons for current step */}
                      {index === 0 && canGenerate && (
                        <Button
                          variant="contained"
                          size="small"
                          startIcon={isProcessing ? <CircularProgress size={16} /> : <RunIcon />}
                          onClick={() => generateMutation.mutate()}
                          disabled={isProcessing}
                          sx={{ mt: 1 }}
                        >
                          Generate CSR
                        </Button>
                      )}

                      {index === 1 && canSubmit && (
                        <Button
                          variant="contained"
                          size="small"
                          startIcon={isProcessing ? <CircularProgress size={16} /> : <RunIcon />}
                          onClick={() => submitMutation.mutate()}
                          disabled={isProcessing}
                          sx={{ mt: 1 }}
                        >
                          Submit to CA
                        </Button>
                      )}

                      {index === 2 && canDeliver && (
                        <Button
                          variant="contained"
                          size="small"
                          color="success"
                          startIcon={isProcessing ? <CircularProgress size={16} /> : <EmailIcon />}
                          onClick={() => deliverMutation.mutate()}
                          disabled={isProcessing}
                          sx={{ mt: 1 }}
                        >
                          Deliver via Email
                        </Button>
                      )}
                    </StepContent>
                  </Step>
                ))}
              </Stepper>

              {csr.status === 'completed' && (
                <Alert severity="success" sx={{ mt: 2 }}>
                  Certificate has been {csr.serverType === 'apache' ? 'delivered via email' : 'installed on target server'}.
                  {csr.deliveredAt && ` Delivered at ${new Date(csr.deliveredAt).toLocaleString()}.`}
                </Alert>
              )}
            </CardContent>
          </Card>

          {/* Actions */}
          {canDelete && (
            <Box sx={{ mt: 2 }}>
              <Button
                variant="outlined"
                color="error"
                size="small"
                startIcon={<DeleteIcon />}
                onClick={() => {
                  if (confirm(`Delete CSR request for "${csr.commonName}"?`)) {
                    deleteMutation.mutate();
                  }
                }}
              >
                Delete Request
              </Button>
            </Box>
          )}
        </Grid>

        {/* Certificate Details */}
        <Grid item xs={12} md={7}>
          <Card>
            <CardContent>
              <Typography variant="h6" gutterBottom>Request Details</Typography>

              <Grid container spacing={2}>
                <Grid item xs={12}>
                  <Typography variant="caption" color="textSecondary">Common Name</Typography>
                  <Typography>{csr.commonName}</Typography>
                </Grid>

                {csr.subjectAlternativeNames.length > 0 && (
                  <Grid item xs={12}>
                    <Typography variant="caption" color="textSecondary">Subject Alternative Names</Typography>
                    <Box sx={{ display: 'flex', flexWrap: 'wrap', gap: 0.5, mt: 0.5 }}>
                      {csr.subjectAlternativeNames.map((san) => (
                        <Chip key={san} label={san} size="small" variant="outlined" />
                      ))}
                    </Box>
                  </Grid>
                )}

                <Grid item xs={6}>
                  <Typography variant="caption" color="textSecondary">Server Type</Typography>
                  <Typography sx={{ textTransform: 'uppercase' }}>{csr.serverType}</Typography>
                </Grid>

                <Grid item xs={6}>
                  <Typography variant="caption" color="textSecondary">Key</Typography>
                  <Typography>{csr.keyAlgorithm} {csr.keySize}-bit · {csr.hashAlgorithm}</Typography>
                </Grid>

                {csr.subject && (
                  <>
                    {csr.subject.organization && (
                      <Grid item xs={6}>
                        <Typography variant="caption" color="textSecondary">Organization</Typography>
                        <Typography>{csr.subject.organization}</Typography>
                      </Grid>
                    )}
                    {csr.subject.organizationalUnit && (
                      <Grid item xs={6}>
                        <Typography variant="caption" color="textSecondary">Organizational Unit</Typography>
                        <Typography>{csr.subject.organizationalUnit}</Typography>
                      </Grid>
                    )}
                    {csr.subject.locality && (
                      <Grid item xs={4}>
                        <Typography variant="caption" color="textSecondary">Locality</Typography>
                        <Typography>{csr.subject.locality}</Typography>
                      </Grid>
                    )}
                    {csr.subject.state && (
                      <Grid item xs={4}>
                        <Typography variant="caption" color="textSecondary">State</Typography>
                        <Typography>{csr.subject.state}</Typography>
                      </Grid>
                    )}
                    {csr.subject.country && (
                      <Grid item xs={4}>
                        <Typography variant="caption" color="textSecondary">Country</Typography>
                        <Typography>{csr.subject.country}</Typography>
                      </Grid>
                    )}
                  </>
                )}

                <Grid item xs={12}>
                  <Divider sx={{ my: 1 }} />
                </Grid>

                {csr.templateName && (
                  <Grid item xs={6}>
                    <Typography variant="caption" color="textSecondary">Template</Typography>
                    <Typography>{csr.templateName}</Typography>
                  </Grid>
                )}

                <Grid item xs={6}>
                  <Typography variant="caption" color="textSecondary">Requested By</Typography>
                  <Typography>{csr.requestedBy}</Typography>
                </Grid>

                <Grid item xs={6}>
                  <Typography variant="caption" color="textSecondary">Requested At</Typography>
                  <Typography>{new Date(csr.requestedAt).toLocaleString()}</Typography>
                </Grid>

                {csr.serverType === 'apache' && csr.deliveryEmails && csr.deliveryEmails.length > 0 && (
                  <Grid item xs={12}>
                    <Typography variant="caption" color="textSecondary">Delivery Emails</Typography>
                    <Box sx={{ display: 'flex', flexWrap: 'wrap', gap: 0.5, mt: 0.5 }}>
                      {csr.deliveryEmails.map((email) => (
                        <Chip key={email} label={email} size="small" variant="outlined" icon={<EmailIcon />} />
                      ))}
                    </Box>
                  </Grid>
                )}

                {csr.errorMessage && (
                  <Grid item xs={12}>
                    <Alert severity="error" variant="outlined">
                      {csr.errorMessage}
                    </Alert>
                  </Grid>
                )}
              </Grid>
            </CardContent>
          </Card>

          {/* CSR PEM (collapsible) */}
          {csr.csrPEM && (
            <Card sx={{ mt: 2 }}>
              <CardContent>
                <Typography variant="h6" gutterBottom>CSR PEM</Typography>
                <Box
                  component="pre"
                  sx={{
                    backgroundColor: '#f5f5f5',
                    padding: 2,
                    borderRadius: 1,
                    overflow: 'auto',
                    fontSize: '0.75rem',
                    maxHeight: 200,
                    fontFamily: 'monospace',
                  }}
                >
                  {csr.csrPEM}
                </Box>
              </CardContent>
            </Card>
          )}
        </Grid>
      </Grid>
    </Box>
  );
}