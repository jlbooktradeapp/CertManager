import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useQuery, useMutation } from '@tanstack/react-query';
import {
  Box,
  Typography,
  Stepper,
  Step,
  StepLabel,
  Card,
  CardContent,
  TextField,
  Button,
  FormControl,
  InputLabel,
  Select,
  MenuItem,
  Grid,
  Chip,
  IconButton,
  Alert,
} from '@mui/material';
import { Add as AddIcon, ArrowBack as BackIcon } from '@mui/icons-material';
import api from '../../services/api';
import { CertificateAuthority, Server } from '../../types';

const steps = ['Subject Information', 'Certificate Options', 'Target & Review'];

interface FormData {
  commonName: string;
  subjectAlternativeNames: string[];
  organization: string;
  organizationalUnit: string;
  locality: string;
  state: string;
  country: string;
  keySize: 2048 | 4096;
  keyAlgorithm: 'RSA' | 'ECDSA';
  hashAlgorithm: 'SHA256' | 'SHA384' | 'SHA512';
  templateName: string;
  targetCAId: string;
  targetServerId: string;
}

export default function CSRWizard() {
  const navigate = useNavigate();
  const [activeStep, setActiveStep] = useState(0);
  const [sanInput, setSanInput] = useState('');
  const [formData, setFormData] = useState<FormData>({
    commonName: '',
    subjectAlternativeNames: [],
    organization: '',
    organizationalUnit: '',
    locality: '',
    state: '',
    country: '',
    keySize: 2048,
    keyAlgorithm: 'RSA',
    hashAlgorithm: 'SHA256',
    templateName: 'WebServer',
    targetCAId: '',
    targetServerId: '',
  });

  const { data: cas } = useQuery({
    queryKey: ['certificateAuthorities'],
    queryFn: async () => {
      const response = await api.get<CertificateAuthority[]>('/ca');
      return response.data;
    },
  });

  const { data: servers } = useQuery({
    queryKey: ['servers'],
    queryFn: async () => {
      const response = await api.get<{ data: Server[] }>('/servers');
      return response.data.data;
    },
  });

  const createMutation = useMutation({
    mutationFn: async () => {
      const payload = {
        commonName: formData.commonName,
        subjectAlternativeNames: formData.subjectAlternativeNames,
        subject: {
          organization: formData.organization || undefined,
          organizationalUnit: formData.organizationalUnit || undefined,
          locality: formData.locality || undefined,
          state: formData.state || undefined,
          country: formData.country || undefined,
        },
        keySize: formData.keySize,
        keyAlgorithm: formData.keyAlgorithm,
        hashAlgorithm: formData.hashAlgorithm,
        templateName: formData.templateName || undefined,
        targetCAId: formData.targetCAId || undefined,
        targetServerId: formData.targetServerId || undefined,
      };
      const response = await api.post('/csr', payload);
      return response.data;
    },
    onSuccess: () => {
      navigate('/csr');
    },
  });

  const handleAddSAN = () => {
    if (sanInput && !formData.subjectAlternativeNames.includes(sanInput)) {
      setFormData({
        ...formData,
        subjectAlternativeNames: [...formData.subjectAlternativeNames, sanInput],
      });
      setSanInput('');
    }
  };

  const handleRemoveSAN = (san: string) => {
    setFormData({
      ...formData,
      subjectAlternativeNames: formData.subjectAlternativeNames.filter((s) => s !== san),
    });
  };

  const handleNext = () => {
    setActiveStep((prev) => prev + 1);
  };

  const handleBack = () => {
    setActiveStep((prev) => prev - 1);
  };

  const handleSubmit = () => {
    createMutation.mutate();
  };

  const renderStepContent = (step: number) => {
    switch (step) {
      case 0:
        return (
          <Grid container spacing={3}>
            <Grid item xs={12}>
              <TextField
                fullWidth
                label="Common Name (CN)"
                value={formData.commonName}
                onChange={(e) => setFormData({ ...formData, commonName: e.target.value })}
                required
                placeholder="www.example.com"
                helperText="The primary domain name for this certificate"
              />
            </Grid>
            <Grid item xs={12}>
              <Box sx={{ display: 'flex', gap: 1 }}>
                <TextField
                  fullWidth
                  label="Subject Alternative Name (SAN)"
                  value={sanInput}
                  onChange={(e) => setSanInput(e.target.value)}
                  placeholder="api.example.com"
                  onKeyPress={(e) => e.key === 'Enter' && (e.preventDefault(), handleAddSAN())}
                />
                <Button variant="outlined" onClick={handleAddSAN}>
                  <AddIcon />
                </Button>
              </Box>
              <Box sx={{ mt: 1, display: 'flex', flexWrap: 'wrap', gap: 1 }}>
                {formData.subjectAlternativeNames.map((san) => (
                  <Chip
                    key={san}
                    label={san}
                    onDelete={() => handleRemoveSAN(san)}
                    size="small"
                  />
                ))}
              </Box>
            </Grid>
            <Grid item xs={12} sm={6}>
              <TextField
                fullWidth
                label="Organization (O)"
                value={formData.organization}
                onChange={(e) => setFormData({ ...formData, organization: e.target.value })}
              />
            </Grid>
            <Grid item xs={12} sm={6}>
              <TextField
                fullWidth
                label="Organizational Unit (OU)"
                value={formData.organizationalUnit}
                onChange={(e) => setFormData({ ...formData, organizationalUnit: e.target.value })}
              />
            </Grid>
            <Grid item xs={12} sm={4}>
              <TextField
                fullWidth
                label="Locality (L)"
                value={formData.locality}
                onChange={(e) => setFormData({ ...formData, locality: e.target.value })}
              />
            </Grid>
            <Grid item xs={12} sm={4}>
              <TextField
                fullWidth
                label="State (S)"
                value={formData.state}
                onChange={(e) => setFormData({ ...formData, state: e.target.value })}
              />
            </Grid>
            <Grid item xs={12} sm={4}>
              <TextField
                fullWidth
                label="Country (C)"
                value={formData.country}
                onChange={(e) => setFormData({ ...formData, country: e.target.value })}
                placeholder="US"
                inputProps={{ maxLength: 2 }}
              />
            </Grid>
          </Grid>
        );

      case 1:
        return (
          <Grid container spacing={3}>
            <Grid item xs={12} sm={6}>
              <FormControl fullWidth>
                <InputLabel>Key Size</InputLabel>
                <Select
                  value={formData.keySize}
                  label="Key Size"
                  onChange={(e) => setFormData({ ...formData, keySize: e.target.value as any })}
                >
                  <MenuItem value={2048}>2048 bit (Standard)</MenuItem>
                  <MenuItem value={4096}>4096 bit (High Security)</MenuItem>
                </Select>
              </FormControl>
            </Grid>
            <Grid item xs={12} sm={6}>
              <FormControl fullWidth>
                <InputLabel>Key Algorithm</InputLabel>
                <Select
                  value={formData.keyAlgorithm}
                  label="Key Algorithm"
                  onChange={(e) => setFormData({ ...formData, keyAlgorithm: e.target.value as any })}
                >
                  <MenuItem value="RSA">RSA</MenuItem>
                  <MenuItem value="ECDSA">ECDSA</MenuItem>
                </Select>
              </FormControl>
            </Grid>
            <Grid item xs={12} sm={6}>
              <FormControl fullWidth>
                <InputLabel>Hash Algorithm</InputLabel>
                <Select
                  value={formData.hashAlgorithm}
                  label="Hash Algorithm"
                  onChange={(e) => setFormData({ ...formData, hashAlgorithm: e.target.value as any })}
                >
                  <MenuItem value="SHA256">SHA-256</MenuItem>
                  <MenuItem value="SHA384">SHA-384</MenuItem>
                  <MenuItem value="SHA512">SHA-512</MenuItem>
                </Select>
              </FormControl>
            </Grid>
            <Grid item xs={12} sm={6}>
              <TextField
                fullWidth
                label="Certificate Template"
                value={formData.templateName}
                onChange={(e) => setFormData({ ...formData, templateName: e.target.value })}
                placeholder="WebServer"
                helperText="Windows CA certificate template name"
              />
            </Grid>
          </Grid>
        );

      case 2:
        return (
          <Grid container spacing={3}>
            <Grid item xs={12} sm={6}>
              <FormControl fullWidth>
                <InputLabel>Target CA</InputLabel>
                <Select
                  value={formData.targetCAId}
                  label="Target CA"
                  onChange={(e) => setFormData({ ...formData, targetCAId: e.target.value })}
                >
                  <MenuItem value="">Select later</MenuItem>
                  {cas?.map((ca) => (
                    <MenuItem key={ca._id} value={ca._id}>
                      {ca.displayName}
                    </MenuItem>
                  ))}
                </Select>
              </FormControl>
            </Grid>
            <Grid item xs={12} sm={6}>
              <FormControl fullWidth>
                <InputLabel>Target Server</InputLabel>
                <Select
                  value={formData.targetServerId}
                  label="Target Server"
                  onChange={(e) => setFormData({ ...formData, targetServerId: e.target.value })}
                >
                  <MenuItem value="">Select later</MenuItem>
                  {servers?.map((server) => (
                    <MenuItem key={server._id} value={server._id}>
                      {server.fqdn}
                    </MenuItem>
                  ))}
                </Select>
              </FormControl>
            </Grid>

            <Grid item xs={12}>
              <Typography variant="h6" gutterBottom sx={{ mt: 2 }}>
                Review
              </Typography>
              <Card variant="outlined">
                <CardContent>
                  <Grid container spacing={2}>
                    <Grid item xs={12}>
                      <Typography variant="subtitle2" color="textSecondary">Common Name</Typography>
                      <Typography>{formData.commonName}</Typography>
                    </Grid>
                    {formData.subjectAlternativeNames.length > 0 && (
                      <Grid item xs={12}>
                        <Typography variant="subtitle2" color="textSecondary">SANs</Typography>
                        <Typography>{formData.subjectAlternativeNames.join(', ')}</Typography>
                      </Grid>
                    )}
                    <Grid item xs={6}>
                      <Typography variant="subtitle2" color="textSecondary">Key</Typography>
                      <Typography>{formData.keyAlgorithm} {formData.keySize} bit</Typography>
                    </Grid>
                    <Grid item xs={6}>
                      <Typography variant="subtitle2" color="textSecondary">Hash</Typography>
                      <Typography>{formData.hashAlgorithm}</Typography>
                    </Grid>
                  </Grid>
                </CardContent>
              </Card>
            </Grid>
          </Grid>
        );

      default:
        return null;
    }
  };

  return (
    <Box>
      <Box sx={{ display: 'flex', alignItems: 'center', gap: 2, mb: 3 }}>
        <IconButton onClick={() => navigate('/csr')}>
          <BackIcon />
        </IconButton>
        <Typography variant="h4">New Certificate Request</Typography>
      </Box>

      <Stepper activeStep={activeStep} sx={{ mb: 4 }}>
        {steps.map((label) => (
          <Step key={label}>
            <StepLabel>{label}</StepLabel>
          </Step>
        ))}
      </Stepper>

      <Card>
        <CardContent sx={{ p: 3 }}>
          {createMutation.isError && (
            <Alert severity="error" sx={{ mb: 3 }}>
              Failed to create CSR request
            </Alert>
          )}

          {renderStepContent(activeStep)}

          <Box sx={{ display: 'flex', justifyContent: 'flex-end', gap: 2, mt: 4 }}>
            {activeStep > 0 && (
              <Button onClick={handleBack}>Back</Button>
            )}
            {activeStep < steps.length - 1 ? (
              <Button
                variant="contained"
                onClick={handleNext}
                disabled={!formData.commonName}
              >
                Next
              </Button>
            ) : (
              <Button
                variant="contained"
                onClick={handleSubmit}
                disabled={createMutation.isPending || !formData.commonName}
              >
                Create CSR
              </Button>
            )}
          </Box>
        </CardContent>
      </Card>
    </Box>
  );
}
