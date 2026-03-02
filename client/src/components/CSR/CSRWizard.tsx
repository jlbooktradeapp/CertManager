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
  FormControlLabel,
  FormGroup,
  FormLabel,
  InputLabel,
  Select,
  MenuItem,
  Grid,
  Chip,
  Checkbox,
  IconButton,
  Alert,
  Divider,
} from '@mui/material';
import { Add as AddIcon, ArrowBack as BackIcon } from '@mui/icons-material';
import api from '../../services/api';
import { CertificateAuthority, Server } from '../../types';

const steps = ['Subject Information', 'Certificate Options', 'Target & Review'];

// ─── Key Usage & Extended Key Usage definitions ─────────────────────────────────

const KEY_USAGE_OPTIONS = [
  { value: 'digitalSignature', label: 'Digital Signature' },
  { value: 'nonRepudiation', label: 'Non-Repudiation' },
  { value: 'keyEncipherment', label: 'Key Encipherment' },
  { value: 'dataEncipherment', label: 'Data Encipherment' },
  { value: 'keyAgreement', label: 'Key Agreement' },
  { value: 'keyCertSign', label: 'Certificate Signing' },
  { value: 'crlSign', label: 'CRL Signing' },
  { value: 'encipherOnly', label: 'Encipher Only' },
  { value: 'decipherOnly', label: 'Decipher Only' },
] as const;

const EXTENDED_KEY_USAGE_OPTIONS = [
  { value: 'serverAuth', label: 'Server Authentication' },
  { value: 'clientAuth', label: 'Client Authentication' },
  { value: 'codeSigning', label: 'Code Signing' },
  { value: 'emailProtection', label: 'Email Protection (S/MIME)' },
  { value: 'timeStamping', label: 'Time Stamping' },
  { value: 'ocspSigning', label: 'OCSP Signing' },
  { value: 'smartCardLogon', label: 'Smart Card Logon' },
  { value: 'kdcAuthentication', label: 'KDC Authentication' },
] as const;

const DEFAULT_KEY_USAGE = ['digitalSignature', 'keyEncipherment'];
const DEFAULT_EKU = ['serverAuth', 'clientAuth'];

interface FormData {
  commonName: string;
  subjectAlternativeNames: string[];
  organization: string;
  organizationalUnit: string;
  locality: string;
  state: string;
  country: string;
  serverType: 'apache' | 'iis';
  keySize: 2048 | 4096;
  keyAlgorithm: 'RSA' | 'ECDSA';
  hashAlgorithm: 'SHA256' | 'SHA384' | 'SHA512';
  keyUsage: string[];
  extendedKeyUsage: string[];
  templateName: string;
  targetCAId: string;
  targetServerId: string;
  deliveryEmails: string[];
}

export default function CSRWizard() {
  const navigate = useNavigate();
  const [activeStep, setActiveStep] = useState(0);
  const [sanInput, setSanInput] = useState('');
  const [emailInput, setEmailInput] = useState('');
  const [formData, setFormData] = useState<FormData>({
    commonName: '',
    subjectAlternativeNames: [],
    organization: 'Temple University Health Systems',
    organizationalUnit: '',
    locality: 'Philadelphia',
    state: 'Pennsylvania',
    country: 'US',
    serverType: 'iis',
    keySize: 2048,
    keyAlgorithm: 'RSA',
    hashAlgorithm: 'SHA256',
    keyUsage: [...DEFAULT_KEY_USAGE],
    extendedKeyUsage: [...DEFAULT_EKU],
    templateName: '',
    targetCAId: '',
    targetServerId: '',
    deliveryEmails: [],
  });

  const { data: cas } = useQuery({
    queryKey: ['certificateAuthorities'],
    queryFn: async () => {
      const response = await api.get<CertificateAuthority[]>('/ca');
      return response.data;
    },
  });

  const { data: ous } = useQuery({
    queryKey: ['organizationalUnits'],
    queryFn: async () => {
      const response = await api.get<string[]>('/certificates/ous');
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

  // Fetch templates filtered by global excluded list — includes raw values for CA submission
  const { data: templates } = useQuery({
    queryKey: ['templates-filtered-raw'],
    queryFn: async () => {
      const response = await api.get<{ displayName: string; rawValue: string }[]>(
        '/certificates/templates?excludeHidden=true&includeRaw=true'
      );
      return response.data;
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
        serverType: formData.serverType,
        keySize: formData.keySize,
        keyAlgorithm: formData.keyAlgorithm,
        hashAlgorithm: formData.hashAlgorithm,
        keyUsage: formData.keyUsage,
        extendedKeyUsage: formData.extendedKeyUsage,
        templateName: formData.templateName || undefined,
        targetCAId: formData.targetCAId || undefined,
        targetServerId: formData.serverType === 'iis' ? (formData.targetServerId || undefined) : undefined,
        deliveryEmails: formData.serverType === 'apache' ? formData.deliveryEmails : [],
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

  const handleToggleKeyUsage = (value: string) => {
    const current = formData.keyUsage;
    const updated = current.includes(value)
      ? current.filter((v) => v !== value)
      : [...current, value];
    setFormData({ ...formData, keyUsage: updated });
  };

  const handleToggleEKU = (value: string) => {
    const current = formData.extendedKeyUsage;
    const updated = current.includes(value)
      ? current.filter((v) => v !== value)
      : [...current, value];
    setFormData({ ...formData, extendedKeyUsage: updated });
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

  // Helpers for display labels in the review section
  const getKULabel = (value: string) => KEY_USAGE_OPTIONS.find(o => o.value === value)?.label || value;
  const getEKULabel = (value: string) => EXTENDED_KEY_USAGE_OPTIONS.find(o => o.value === value)?.label || value;

  const renderStepContent = (step: number) => {
    switch (step) {
      case 0:
        return (
          <Grid container spacing={3}>
            <Grid item xs={12}>
              <FormControl fullWidth>
                <InputLabel>Web Server Type</InputLabel>
                <Select
                  value={formData.serverType}
                  label="Web Server Type"
                  onChange={(e) => setFormData({ ...formData, serverType: e.target.value as 'apache' | 'iis' })}
                >
                  <MenuItem value="iis">IIS (Windows / certreq)</MenuItem>
                  <MenuItem value="apache">Apache (OpenSSL)</MenuItem>
                </Select>
              </FormControl>
            </Grid>
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
              <FormControl fullWidth>
                <InputLabel>Organization (O)</InputLabel>
                <Select
                  value={formData.organization}
                  label="Organization (O)"
                  onChange={(e) => setFormData({ ...formData, organization: e.target.value })}
                >
                  <MenuItem value="Temple University Health Systems">Temple University Health Systems</MenuItem>
                  <MenuItem value="Fox Chase Cancer Center">Fox Chase Cancer Center</MenuItem>
                </Select>
              </FormControl>
            </Grid>
            <Grid item xs={12} sm={6}>
              <FormControl fullWidth>
                <InputLabel>Organizational Unit (OU)</InputLabel>
                <Select
                  value={formData.organizationalUnit}
                  label="Organizational Unit (OU)"
                  onChange={(e) => setFormData({ ...formData, organizationalUnit: e.target.value })}
                >
                  <MenuItem value="">None</MenuItem>
                  {ous?.map((ou) => (
                    <MenuItem key={ou} value={ou}>{ou}</MenuItem>
                  ))}
                </Select>
              </FormControl>
            </Grid>
            <Grid item xs={12} sm={4}>
              <TextField
                fullWidth
                label="Locality (L)"
                value={formData.locality}
                InputProps={{ readOnly: true }}
              />
            </Grid>
            <Grid item xs={12} sm={4}>
              <TextField
                fullWidth
                label="State (S)"
                value={formData.state}
                InputProps={{ readOnly: true }}
              />
            </Grid>
            <Grid item xs={12} sm={4}>
              <TextField
                fullWidth
                label="Country (C)"
                value={formData.country}
                InputProps={{ readOnly: true }}
                inputProps={{ maxLength: 2 }}
              />
            </Grid>
          </Grid>
        );

      case 1:
        return (
          <Grid container spacing={3}>
            {/* Row 1: Key Size + Key Algorithm */}
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

            {/* Row 2: Hash Algorithm + Certificate Template (required by Enterprise CA) */}
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
              <FormControl fullWidth required>
                <InputLabel>Certificate Template</InputLabel>
                <Select
                  value={formData.templateName}
                  label="Certificate Template"
                  onChange={(e) => setFormData({ ...formData, templateName: e.target.value })}
                >
                  {templates?.map((t) => (
                    <MenuItem key={t.rawValue} value={t.rawValue}>{t.displayName}</MenuItem>
                  ))}
                </Select>
              </FormControl>
            </Grid>

            {/* Divider before Key Usage sections */}
            <Grid item xs={12}>
              <Divider sx={{ my: 1 }} />
            </Grid>

            {/* Key Usage checkboxes */}
            <Grid item xs={12} md={6}>
              <FormControl component="fieldset">
                <FormLabel component="legend" sx={{ fontWeight: 600, mb: 1 }}>Key Usage</FormLabel>
                <FormGroup>
                  {KEY_USAGE_OPTIONS.map((option) => (
                    <FormControlLabel
                      key={option.value}
                      control={
                        <Checkbox
                          checked={formData.keyUsage.includes(option.value)}
                          onChange={() => handleToggleKeyUsage(option.value)}
                          size="small"
                        />
                      }
                      label={option.label}
                      sx={{ height: 32 }}
                    />
                  ))}
                </FormGroup>
              </FormControl>
            </Grid>

            {/* Extended Key Usage checkboxes */}
            <Grid item xs={12} md={6}>
              <FormControl component="fieldset">
                <FormLabel component="legend" sx={{ fontWeight: 600, mb: 1 }}>Extended Key Usage</FormLabel>
                <FormGroup>
                  {EXTENDED_KEY_USAGE_OPTIONS.map((option) => (
                    <FormControlLabel
                      key={option.value}
                      control={
                        <Checkbox
                          checked={formData.extendedKeyUsage.includes(option.value)}
                          onChange={() => handleToggleEKU(option.value)}
                          size="small"
                        />
                      }
                      label={option.label}
                      sx={{ height: 32 }}
                    />
                  ))}
                </FormGroup>
              </FormControl>
            </Grid>
          </Grid>
        );

      case 2:
        // Filter CAs to only issuance-enabled ones
        const issuanceCAs = cas?.filter((ca) => ca.issuanceEnabled) || [];
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
                  {issuanceCAs.map((ca) => (
                    <MenuItem key={ca._id} value={ca._id}>
                      {ca.displayName}
                    </MenuItem>
                  ))}
                </Select>
                {issuanceCAs.length === 0 && (
                  <Typography variant="caption" color="warning.main" sx={{ mt: 0.5 }}>
                    No CAs are enabled for issuance. Enable a CA in Certificate Authorities settings.
                  </Typography>
                )}
              </FormControl>
            </Grid>

            {formData.serverType === 'iis' && (
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
            )}

            {formData.serverType === 'apache' && (
              <Grid item xs={12}>
                <Box sx={{ display: 'flex', gap: 1 }}>
                  <TextField
                    fullWidth
                    label="Delivery Email Address"
                    value={emailInput}
                    onChange={(e) => setEmailInput(e.target.value)}
                    placeholder="admin@example.com"
                    helperText="Certificate and private key will be emailed to these addresses"
                    onKeyPress={(e) => {
                      if (e.key === 'Enter') {
                        e.preventDefault();
                        if (emailInput && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(emailInput) && !formData.deliveryEmails.includes(emailInput)) {
                          setFormData({ ...formData, deliveryEmails: [...formData.deliveryEmails, emailInput] });
                          setEmailInput('');
                        }
                      }
                    }}
                  />
                  <Button
                    variant="outlined"
                    onClick={() => {
                      if (emailInput && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(emailInput) && !formData.deliveryEmails.includes(emailInput)) {
                        setFormData({ ...formData, deliveryEmails: [...formData.deliveryEmails, emailInput] });
                        setEmailInput('');
                      }
                    }}
                  >
                    <AddIcon />
                  </Button>
                </Box>
                <Box sx={{ mt: 1, display: 'flex', flexWrap: 'wrap', gap: 1 }}>
                  {formData.deliveryEmails.map((email) => (
                    <Chip
                      key={email}
                      label={email}
                      onDelete={() => setFormData({ ...formData, deliveryEmails: formData.deliveryEmails.filter((e) => e !== email) })}
                    />
                  ))}
                </Box>
              </Grid>
            )}

            <Grid item xs={12}>
              <Typography variant="h6" gutterBottom sx={{ mt: 2 }}>
                Review
              </Typography>
              <Card variant="outlined">
                <CardContent>
                  <Grid container spacing={2}>
                    <Grid item xs={12}>
                      <Typography variant="subtitle2" color="textSecondary">Server Type</Typography>
                      <Typography sx={{ textTransform: 'uppercase' }}>{formData.serverType}</Typography>
                    </Grid>
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
                    {formData.templateName && (
                      <Grid item xs={12}>
                        <Typography variant="subtitle2" color="textSecondary">Certificate Template</Typography>
                        <Typography>
                          {templates?.find(t => t.rawValue === formData.templateName)?.displayName || formData.templateName}
                        </Typography>
                      </Grid>
                    )}
                    {formData.keyUsage.length > 0 && (
                      <Grid item xs={6}>
                        <Typography variant="subtitle2" color="textSecondary">Key Usage</Typography>
                        <Box sx={{ display: 'flex', flexWrap: 'wrap', gap: 0.5, mt: 0.5 }}>
                          {formData.keyUsage.map((ku) => (
                            <Chip key={ku} label={getKULabel(ku)} size="small" variant="outlined" />
                          ))}
                        </Box>
                      </Grid>
                    )}
                    {formData.extendedKeyUsage.length > 0 && (
                      <Grid item xs={6}>
                        <Typography variant="subtitle2" color="textSecondary">Extended Key Usage</Typography>
                        <Box sx={{ display: 'flex', flexWrap: 'wrap', gap: 0.5, mt: 0.5 }}>
                          {formData.extendedKeyUsage.map((eku) => (
                            <Chip key={eku} label={getEKULabel(eku)} size="small" variant="outlined" />
                          ))}
                        </Box>
                      </Grid>
                    )}
                    {formData.serverType === 'apache' && formData.deliveryEmails.length > 0 && (
                      <Grid item xs={12}>
                        <Typography variant="subtitle2" color="textSecondary">Delivery Emails</Typography>
                        <Typography>{formData.deliveryEmails.join(', ')}</Typography>
                      </Grid>
                    )}
                    {formData.serverType === 'iis' && formData.targetServerId && (
                      <Grid item xs={12}>
                        <Typography variant="subtitle2" color="textSecondary">Target Server</Typography>
                        <Typography>
                          {servers?.find(s => s._id === formData.targetServerId)?.fqdn || 'Unknown'}
                        </Typography>
                      </Grid>
                    )}
                    {formData.targetCAId && (
                      <Grid item xs={12}>
                        <Typography variant="subtitle2" color="textSecondary">Certificate Authority</Typography>
                        <Typography>
                          {cas?.find(ca => ca._id === formData.targetCAId)?.displayName || 'Unknown'}
                        </Typography>
                      </Grid>
                    )}
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