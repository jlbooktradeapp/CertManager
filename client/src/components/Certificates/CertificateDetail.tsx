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
  List,
  ListItem,
  ListItemText,
  IconButton,
  Dialog,
  DialogTitle,
  DialogContent,
  DialogActions,
} from '@mui/material';
import {
  ArrowBack as BackIcon,
  Delete as DeleteIcon,
  Computer as ServerIcon,
} from '@mui/icons-material';
import { format, differenceInDays } from 'date-fns';
import { useState } from 'react';
import { getCertificate, deleteCertificate } from '../../services/certificates';
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

  const { data: cert, isLoading, error } = useQuery({
    queryKey: ['certificate', id],
    queryFn: () => getCertificate(id!),
    enabled: !!id,
  });

  const deleteMutation = useMutation({
    mutationFn: () => deleteCertificate(id!),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['certificates'] });
      navigate('/certificates');
    },
  });

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

  return (
    <Box>
      <Box sx={{ display: 'flex', alignItems: 'center', gap: 2, mb: 3 }}>
        <IconButton onClick={() => navigate('/certificates')}>
          <BackIcon />
        </IconButton>
        <Typography variant="h4" sx={{ flexGrow: 1 }}>
          {cert.commonName}
        </Typography>
        <Chip
          label={cert.status}
          color={statusColors[cert.status]}
          sx={{ textTransform: 'capitalize' }}
        />
        {isOperator && (
          <Button
            color="error"
            startIcon={<DeleteIcon />}
            onClick={() => setDeleteDialogOpen(true)}
          >
            Remove
          </Button>
        )}
      </Box>

      <Grid container spacing={3}>
        {/* Basic Info */}
        <Grid item xs={12} md={6}>
          <Card>
            <CardContent>
              <Typography variant="h6" gutterBottom>
                Certificate Details
              </Typography>
              <Grid container spacing={2}>
                <Grid item xs={4}>
                  <Typography variant="caption" color="textSecondary">
                    Serial Number
                  </Typography>
                  <Typography variant="body2" sx={{ wordBreak: 'break-all' }}>
                    {cert.serialNumber}
                  </Typography>
                </Grid>
                <Grid item xs={8}>
                  <Typography variant="caption" color="textSecondary">
                    Thumbprint
                  </Typography>
                  <Typography variant="body2" sx={{ wordBreak: 'break-all', fontFamily: 'monospace' }}>
                    {cert.thumbprint}
                  </Typography>
                </Grid>
                <Grid item xs={6}>
                  <Typography variant="caption" color="textSecondary">
                    Valid From
                  </Typography>
                  <Typography variant="body2">
                    {format(new Date(cert.validFrom), 'PPP')}
                  </Typography>
                </Grid>
                <Grid item xs={6}>
                  <Typography variant="caption" color="textSecondary">
                    Valid To
                  </Typography>
                  <Typography
                    variant="body2"
                    color={daysLeft <= 7 ? 'error' : daysLeft <= 30 ? 'warning.main' : 'inherit'}
                  >
                    {format(new Date(cert.validTo), 'PPP')}
                    <Typography variant="caption" component="span" sx={{ ml: 1 }}>
                      ({daysLeft > 0 ? `${daysLeft} days left` : 'Expired'})
                    </Typography>
                  </Typography>
                </Grid>
                <Grid item xs={12}>
                  <Typography variant="caption" color="textSecondary">
                    Issuer
                  </Typography>
                  <Typography variant="body2">{cert.issuer.commonName}</Typography>
                </Grid>
                {cert.templateName && (
                  <Grid item xs={12}>
                    <Typography variant="caption" color="textSecondary">
                      Template
                    </Typography>
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
              <Typography variant="h6" gutterBottom>
                Subject Information
              </Typography>
              <Grid container spacing={2}>
                <Grid item xs={12}>
                  <Typography variant="caption" color="textSecondary">
                    Common Name (CN)
                  </Typography>
                  <Typography variant="body2">{cert.subject.commonName}</Typography>
                </Grid>
                {cert.subject.organization && (
                  <Grid item xs={6}>
                    <Typography variant="caption" color="textSecondary">
                      Organization (O)
                    </Typography>
                    <Typography variant="body2">{cert.subject.organization}</Typography>
                  </Grid>
                )}
                {cert.subject.organizationalUnit && (
                  <Grid item xs={6}>
                    <Typography variant="caption" color="textSecondary">
                      Organizational Unit (OU)
                    </Typography>
                    <Typography variant="body2">{cert.subject.organizationalUnit}</Typography>
                  </Grid>
                )}
                {cert.subject.locality && (
                  <Grid item xs={4}>
                    <Typography variant="caption" color="textSecondary">
                      Locality (L)
                    </Typography>
                    <Typography variant="body2">{cert.subject.locality}</Typography>
                  </Grid>
                )}
                {cert.subject.state && (
                  <Grid item xs={4}>
                    <Typography variant="caption" color="textSecondary">
                      State (S)
                    </Typography>
                    <Typography variant="body2">{cert.subject.state}</Typography>
                  </Grid>
                )}
                {cert.subject.country && (
                  <Grid item xs={4}>
                    <Typography variant="caption" color="textSecondary">
                      Country (C)
                    </Typography>
                    <Typography variant="body2">{cert.subject.country}</Typography>
                  </Grid>
                )}
              </Grid>

              {cert.subjectAlternativeNames.length > 0 && (
                <>
                  <Divider sx={{ my: 2 }} />
                  <Typography variant="subtitle2" gutterBottom>
                    Subject Alternative Names (SANs)
                  </Typography>
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

        {/* Deployments */}
        <Grid item xs={12}>
          <Card>
            <CardContent>
              <Typography variant="h6" gutterBottom>
                Deployments
              </Typography>
              {cert.deployedTo.length > 0 ? (
                <List>
                  {cert.deployedTo.map((deployment, index) => (
                    <ListItem key={index}>
                      <ServerIcon sx={{ mr: 2, color: 'text.secondary' }} />
                      <ListItemText
                        primary={deployment.serverName}
                        secondary={
                          deployment.binding
                            ? `${deployment.binding.type} - ${deployment.binding.siteName || ''} :${deployment.binding.port || 443}`
                            : 'Installed'
                        }
                      />
                      <Typography variant="caption" color="textSecondary">
                        {format(new Date(deployment.deployedAt), 'PPp')}
                      </Typography>
                    </ListItem>
                  ))}
                </List>
              ) : (
                <Typography color="textSecondary">
                  This certificate is not deployed to any managed servers.
                </Typography>
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
            This will remove the certificate "{cert.commonName}" from the Certificate Manager.
            The actual certificate will not be affected.
          </Typography>
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setDeleteDialogOpen(false)}>Cancel</Button>
          <Button
            color="error"
            onClick={() => deleteMutation.mutate()}
            disabled={deleteMutation.isPending}
          >
            Remove
          </Button>
        </DialogActions>
      </Dialog>
    </Box>
  );
}
