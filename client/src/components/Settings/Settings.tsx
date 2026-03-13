import { useState, useEffect } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import {
  Box,
  Typography,
  Card,
  CardContent,
  Grid,
  TextField,
  Button,
  Switch,
  FormControlLabel,
  Alert,
  Divider,
  Chip,
  IconButton,
  Table,
  TableBody,
  TableCell,
  TableRow,
  CircularProgress,
} from '@mui/material';
import { Delete as DeleteIcon, Send as SendIcon, Add as AddIcon, CalendarMonth as CalendarIcon, Summarize as DigestIcon, Search as ScanIcon } from '@mui/icons-material';
import api from '../../services/api';
import { getTemplateNames } from '../../services/certificates';

interface NotificationSettings {
  enabled: boolean;
  smtpConfig: {
    host: string;
    port: number;
    secure: boolean;
    from: string;
  };
  thresholds: { days: number; enabled: boolean }[];
  recipients: { type: string; value: string }[];
  scheduleHour: number;
  excludedTemplates: string[];
  calendarConfig: {
    enabled: boolean;
    method: 'ics' | 'graph' | 'both';
    icsTargetEmail: string;
    graphTenantId: string;
    graphClientId: string;
    graphClientSecret: string;
    graphCalendarEmail: string;
  };
  cleanupConfig: {
    retentionDays: number;
    digestEnabled: boolean;
    digestFrequency: 'daily' | 'weekly';
    digestDay: number;
    lastDigestSent?: string;
  };
  discoveryConfig: {
    enabled: boolean;
    probePorts: number[];
    probeTimeoutMs: number;
    concurrency: number;
    f5IpRanges: string[];
    lastRunAt?: string;
    lastRunStats?: {
      probed: number;
      matched: number;
      mismatched: number;
      errors: number;
      reboundFound: number;
    };
  };
}

export default function Settings() {
  const queryClient = useQueryClient();
  const [testEmail, setTestEmail] = useState('');
  const [newRecipient, setNewRecipient] = useState({ type: 'email', value: '' });
  const [newTemplate, setNewTemplate] = useState('');

  const { data: settings, isLoading } = useQuery({
    queryKey: ['notificationSettings'],
    queryFn: async () => {
      const response = await api.get<NotificationSettings>('/settings/notifications');
      return response.data;
    },
  });

  // Fetch all known template names for autocomplete
  const { data: allTemplates } = useQuery({
    queryKey: ['templateNames'],
    queryFn: getTemplateNames,
  });

  const [formData, setFormData] = useState<NotificationSettings | null>(null);

  useEffect(() => {
    if (settings) {
      setFormData(settings);
      setPortsInput((settings.discoveryConfig?.probePorts ?? [443, 8443]).join(', '));
      setF5RangesInput((settings.discoveryConfig?.f5IpRanges ?? []).join(', '));
    }
  }, [settings]);

  const updateMutation = useMutation({
    mutationFn: async (data: Partial<NotificationSettings>) => {
      const response = await api.put('/settings/notifications', data);
      return response.data;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['notificationSettings'] });
    },
  });

  const testMutation = useMutation({
    mutationFn: async (email: string) => {
      const response = await api.post('/settings/notifications/test', { email });
      return response.data;
    },
  });

  const triggerDigestMutation = useMutation({
    mutationFn: async () => {
      const response = await api.post('/settings/notifications/trigger');
      return response.data;
    },
  });

  const calendarSyncMutation = useMutation({
    mutationFn: async () => {
      const response = await api.post('/settings/calendar/sync');
      return response.data;
    },
  });

  const discoveryMutation = useMutation({
    mutationFn: async () => {
      const response = await api.post('/certificates/discover');
      return response.data;
    },
  });

  const [portsInput, setPortsInput] = useState('');
  const [f5RangesInput, setF5RangesInput] = useState('');

  const handleSave = () => {
    if (formData) {
      updateMutation.mutate(formData);
    }
  };

  const handleAddRecipient = () => {
    if (formData && newRecipient.value) {
      setFormData({
        ...formData,
        recipients: [...formData.recipients, newRecipient],
      });
      setNewRecipient({ type: 'email', value: '' });
    }
  };

  const handleRemoveRecipient = (index: number) => {
    if (formData) {
      const newRecipients = [...formData.recipients];
      newRecipients.splice(index, 1);
      setFormData({ ...formData, recipients: newRecipients });
    }
  };

  const handleToggleThreshold = (days: number) => {
    if (formData) {
      const newThresholds = formData.thresholds.map((t) =>
        t.days === days ? { ...t, enabled: !t.enabled } : t
      );
      setFormData({ ...formData, thresholds: newThresholds });
    }
  };

  const handleAddExcludedTemplate = () => {
    if (formData && newTemplate.trim()) {
      const template = newTemplate.trim();
      if (!formData.excludedTemplates.includes(template)) {
        setFormData({
          ...formData,
          excludedTemplates: [...formData.excludedTemplates, template].sort(),
        });
      }
      setNewTemplate('');
    }
  };

  const handleRemoveExcludedTemplate = (template: string) => {
    if (formData) {
      setFormData({
        ...formData,
        excludedTemplates: formData.excludedTemplates.filter(t => t !== template),
      });
    }
  };

  if (isLoading || !formData) {
    return (
      <Box sx={{ display: 'flex', justifyContent: 'center', mt: 4 }}>
        <CircularProgress />
      </Box>
    );
  }

  return (
    <Box>
      <Typography variant="h4" gutterBottom>
        Settings
      </Typography>

      <Grid container spacing={3}>
        {/* Notification Settings */}
        <Grid item xs={12} lg={6}>
          <Card>
            <CardContent>
              <Typography variant="h6" gutterBottom>
                Email Notifications
              </Typography>

              <FormControlLabel
                control={
                  <Switch
                    checked={formData.enabled}
                    onChange={(e) => setFormData({ ...formData, enabled: e.target.checked })}
                  />
                }
                label="Enable email notifications"
              />

              <Divider sx={{ my: 2 }} />

              <Typography variant="subtitle2" gutterBottom>
                SMTP Configuration
              </Typography>
              <Typography variant="caption" color="textSecondary" display="block" sx={{ mb: 2 }}>
                Anonymous relay — no authentication required
              </Typography>

              <Grid container spacing={2}>
                <Grid item xs={8}>
                  <TextField
                    fullWidth
                    size="small"
                    label="SMTP Host"
                    value={formData.smtpConfig.host}
                    onChange={(e) =>
                      setFormData({
                        ...formData,
                        smtpConfig: { ...formData.smtpConfig, host: e.target.value },
                      })
                    }
                  />
                </Grid>
                <Grid item xs={4}>
                  <TextField
                    fullWidth
                    size="small"
                    label="Port"
                    type="number"
                    value={formData.smtpConfig.port}
                    onChange={(e) =>
                      setFormData({
                        ...formData,
                        smtpConfig: { ...formData.smtpConfig, port: parseInt(e.target.value) },
                      })
                    }
                  />
                </Grid>
                <Grid item xs={12}>
                  <TextField
                    fullWidth
                    size="small"
                    label="Send As (From Address)"
                    value={formData.smtpConfig.from}
                    onChange={(e) =>
                      setFormData({
                        ...formData,
                        smtpConfig: { ...formData.smtpConfig, from: e.target.value },
                      })
                    }
                    placeholder='Certificate Manager <certmanager@tuhs.temple.edu>'
                    helperText='Display Name <email@domain.com>'
                  />
                </Grid>
              </Grid>

              <Box sx={{ mt: 2, display: 'flex', gap: 1 }}>
                <TextField
                  size="small"
                  label="Test Email"
                  value={testEmail}
                  onChange={(e) => setTestEmail(e.target.value)}
                  sx={{ flexGrow: 1 }}
                />
                <Button
                  variant="outlined"
                  startIcon={<SendIcon />}
                  onClick={() => testMutation.mutate(testEmail)}
                  disabled={!testEmail || testMutation.isPending}
                >
                  Test
                </Button>
              </Box>

              {testMutation.isSuccess && (
                <Alert severity="success" sx={{ mt: 1 }}>
                  Test email sent successfully
                </Alert>
              )}

              {testMutation.isError && (
                <Alert severity="error" sx={{ mt: 1 }}>
                  Failed to send test email
                </Alert>
              )}

              <Divider sx={{ my: 2 }} />

              <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
                <Button
                  variant="outlined"
                  startIcon={<DigestIcon />}
                  onClick={() => triggerDigestMutation.mutate()}
                  disabled={triggerDigestMutation.isPending}
                >
                  {triggerDigestMutation.isPending ? 'Sending...' : 'Send Admin Digest Now'}
                </Button>
                <Typography variant="body2" color="text.secondary">
                  Sends the daily digest and owner notifications immediately
                </Typography>
              </Box>

              {triggerDigestMutation.isSuccess && (
                <Alert severity="success" sx={{ mt: 1 }}>
                  Notifications sent: {(triggerDigestMutation.data as any)?.sent || 0} sent, {(triggerDigestMutation.data as any)?.failed || 0} failed
                </Alert>
              )}

              {triggerDigestMutation.isError && (
                <Alert severity="error" sx={{ mt: 1 }}>
                  Failed to trigger notifications
                </Alert>
              )}
            </CardContent>
          </Card>
        </Grid>

        {/* Thresholds */}
        <Grid item xs={12} lg={6}>
          <Card>
            <CardContent>
              <Typography variant="h6" gutterBottom>
                Notification Thresholds
              </Typography>
              <Typography variant="body2" color="textSecondary" gutterBottom>
                Select which expiration warnings to send
              </Typography>

              <Box sx={{ display: 'flex', flexWrap: 'wrap', gap: 1, my: 2 }}>
                {formData.thresholds.map((threshold) => (
                  <Chip
                    key={threshold.days}
                    label={`${threshold.days} days`}
                    color={threshold.enabled ? 'primary' : 'default'}
                    variant={threshold.enabled ? 'filled' : 'outlined'}
                    onClick={() => handleToggleThreshold(threshold.days)}
                  />
                ))}
              </Box>

              <TextField
                size="small"
                label="Check Time (Hour)"
                type="number"
                value={formData.scheduleHour}
                onChange={(e) =>
                  setFormData({ ...formData, scheduleHour: parseInt(e.target.value) })
                }
                inputProps={{ min: 0, max: 23 }}
                helperText="Hour of day to check for expiring certificates (0-23)"
                sx={{ mt: 2 }}
              />
            </CardContent>
          </Card>
        </Grid>

        {/* Recipients */}
        <Grid item xs={12}>
          <Card>
            <CardContent>
              <Typography variant="h6" gutterBottom>
                Notification Recipients
              </Typography>

              <Table size="small">
                <TableBody>
                  {formData.recipients.map((recipient, index) => (
                    <TableRow key={index}>
                      <TableCell>
                        <Chip
                          label={recipient.type}
                          size="small"
                          variant="outlined"
                        />
                      </TableCell>
                      <TableCell>{recipient.value}</TableCell>
                      <TableCell align="right">
                        <IconButton size="small" onClick={() => handleRemoveRecipient(index)}>
                          <DeleteIcon fontSize="small" />
                        </IconButton>
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>

              <Box sx={{ display: 'flex', gap: 1, mt: 2 }}>
                <TextField
                  select
                  size="small"
                  value={newRecipient.type}
                  onChange={(e) => setNewRecipient({ ...newRecipient, type: e.target.value })}
                  SelectProps={{ native: true }}
                  sx={{ width: 120 }}
                >
                  <option value="email">Email</option>
                  <option value="user">User</option>
                  <option value="role">Role</option>
                </TextField>
                <TextField
                  size="small"
                  placeholder={
                    newRecipient.type === 'email'
                      ? 'user@example.com'
                      : newRecipient.type === 'user'
                      ? 'username'
                      : 'admin'
                  }
                  value={newRecipient.value}
                  onChange={(e) => setNewRecipient({ ...newRecipient, value: e.target.value })}
                  sx={{ flexGrow: 1 }}
                />
                <Button variant="outlined" onClick={handleAddRecipient}>
                  Add
                </Button>
              </Box>
            </CardContent>
          </Card>
        </Grid>

        {/* Excluded Templates */}
        <Grid item xs={12}>
          <Card>
            <CardContent>
              <Typography variant="h6" gutterBottom>
                Hidden Certificate Templates
              </Typography>
              <Typography variant="body2" color="textSecondary" gutterBottom>
                Certificates with these templates are hidden by default on the Certificates page.
                Machine certificates, domain controller certs, and other auto-enrolled templates
                are typically excluded so you can focus on web and application certificates.
              </Typography>

              <Box sx={{ display: 'flex', flexWrap: 'wrap', gap: 1, my: 2 }}>
                {(formData.excludedTemplates || []).map((template) => (
                  <Chip
                    key={template}
                    label={template}
                    onDelete={() => handleRemoveExcludedTemplate(template)}
                    variant="outlined"
                  />
                ))}
                {(formData.excludedTemplates || []).length === 0 && (
                  <Typography variant="body2" color="textSecondary">
                    No templates excluded — all certificates will be shown.
                  </Typography>
                )}
              </Box>

              <Box sx={{ display: 'flex', gap: 1, mt: 1 }}>
                <TextField
                  size="small"
                  label="Template name"
                  value={newTemplate}
                  onChange={(e) => setNewTemplate(e.target.value)}
                  onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); handleAddExcludedTemplate(); } }}
                  placeholder="e.g., Machine"
                  sx={{ minWidth: 250 }}
                  select={!!(allTemplates && allTemplates.length > 0)}
                  SelectProps={{ native: true }}
                >
                  {allTemplates && allTemplates.length > 0 && (
                    <>
                      <option value="">Select a template...</option>
                      {allTemplates
                        .filter(t => !(formData.excludedTemplates || []).includes(t))
                        .map(t => (
                          <option key={t} value={t}>{t}</option>
                        ))
                      }
                    </>
                  )}
                </TextField>
                <Button
                  variant="outlined"
                  startIcon={<AddIcon />}
                  onClick={handleAddExcludedTemplate}
                  disabled={!newTemplate.trim()}
                >
                  Exclude
                </Button>
              </Box>
            </CardContent>
          </Card>
        </Grid>

        {/* Calendar Integration */}
        <Grid item xs={12}>
          <Card>
            <CardContent>
              <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', mb: 1 }}>
                <Typography variant="h6">
                  Teams Calendar Integration
                </Typography>
                <Button
                  variant="outlined"
                  startIcon={<CalendarIcon />}
                  onClick={() => calendarSyncMutation.mutate()}
                  disabled={calendarSyncMutation.isPending || !formData.calendarConfig?.enabled}
                >
                  Sync Now
                </Button>
              </Box>

              <Typography variant="body2" color="textSecondary" gutterBottom>
                Create calendar events for web certificate expirations on your team's shared calendar.
                Only certificates not in the excluded templates list will be synced.
              </Typography>

              {calendarSyncMutation.isSuccess && (
                <Alert severity="success" sx={{ my: 1 }}>
                  Calendar sync complete: {(calendarSyncMutation.data as any)?.icsCreated || 0} ICS events,{' '}
                  {(calendarSyncMutation.data as any)?.graphCreated || 0} Graph events
                  {(calendarSyncMutation.data as any)?.errors?.length > 0 &&
                    ` (${(calendarSyncMutation.data as any).errors.length} errors)`}
                </Alert>
              )}
              {calendarSyncMutation.isError && (
                <Alert severity="error" sx={{ my: 1 }}>Failed to sync calendar</Alert>
              )}

              <FormControlLabel
                control={
                  <Switch
                    checked={formData.calendarConfig?.enabled || false}
                    onChange={(e) => setFormData({
                      ...formData,
                      calendarConfig: { ...formData.calendarConfig, enabled: e.target.checked },
                    })}
                  />
                }
                label="Enable calendar integration"
                sx={{ mt: 1 }}
              />

              {formData.calendarConfig?.enabled && (
                <>
                  <Divider sx={{ my: 2 }} />

                  <Typography variant="subtitle2" gutterBottom>Delivery Method</Typography>
                  <TextField
                    select
                    size="small"
                    value={formData.calendarConfig?.method || 'ics'}
                    onChange={(e) => setFormData({
                      ...formData,
                      calendarConfig: { ...formData.calendarConfig, method: e.target.value as any },
                    })}
                    SelectProps={{ native: true }}
                    sx={{ mb: 2, minWidth: 250 }}
                  >
                    <option value="ics">ICS Calendar Invites via SMTP</option>
                    <option value="graph">Microsoft Graph API</option>
                    <option value="both">Both Methods</option>
                  </TextField>

                  {(formData.calendarConfig?.method === 'ics' || formData.calendarConfig?.method === 'both') && (
                    <Box sx={{ mb: 3 }}>
                      <Typography variant="subtitle2" gutterBottom>ICS via SMTP</Typography>
                      <Typography variant="caption" color="textSecondary" display="block" sx={{ mb: 1 }}>
                        Sends calendar invite emails to a shared mailbox. Events appear on the mailbox calendar automatically.
                      </Typography>
                      <TextField
                        fullWidth
                        size="small"
                        label="Target Calendar Email (shared mailbox)"
                        value={formData.calendarConfig?.icsTargetEmail || ''}
                        onChange={(e) => setFormData({
                          ...formData,
                          calendarConfig: { ...formData.calendarConfig, icsTargetEmail: e.target.value },
                        })}
                        placeholder="certsteam@yourdomain.com"
                      />
                    </Box>
                  )}

                  {(formData.calendarConfig?.method === 'graph' || formData.calendarConfig?.method === 'both') && (
                    <Box>
                      <Typography variant="subtitle2" gutterBottom>Microsoft Graph API</Typography>
                      <Typography variant="caption" color="textSecondary" display="block" sx={{ mb: 1 }}>
                        Requires an Azure AD app registration with Calendars.ReadWrite permission (Application type).
                      </Typography>
                      <Grid container spacing={2}>
                        <Grid item xs={12}>
                          <TextField
                            fullWidth
                            size="small"
                            label="Tenant ID"
                            value={formData.calendarConfig?.graphTenantId || ''}
                            onChange={(e) => setFormData({
                              ...formData,
                              calendarConfig: { ...formData.calendarConfig, graphTenantId: e.target.value },
                            })}
                          />
                        </Grid>
                        <Grid item xs={6}>
                          <TextField
                            fullWidth
                            size="small"
                            label="Client ID"
                            value={formData.calendarConfig?.graphClientId || ''}
                            onChange={(e) => setFormData({
                              ...formData,
                              calendarConfig: { ...formData.calendarConfig, graphClientId: e.target.value },
                            })}
                          />
                        </Grid>
                        <Grid item xs={6}>
                          <TextField
                            fullWidth
                            size="small"
                            label="Client Secret"
                            type="password"
                            value={formData.calendarConfig?.graphClientSecret || ''}
                            onChange={(e) => setFormData({
                              ...formData,
                              calendarConfig: { ...formData.calendarConfig, graphClientSecret: e.target.value },
                            })}
                          />
                        </Grid>
                        <Grid item xs={12}>
                          <TextField
                            fullWidth
                            size="small"
                            label="Calendar User Email"
                            value={formData.calendarConfig?.graphCalendarEmail || ''}
                            onChange={(e) => setFormData({
                              ...formData,
                              calendarConfig: { ...formData.calendarConfig, graphCalendarEmail: e.target.value },
                            })}
                            placeholder="certsteam@yourdomain.com"
                            helperText="The user/shared mailbox whose calendar events will be created on"
                          />
                        </Grid>
                      </Grid>
                    </Box>
                  )}
                </>
              )}
            </CardContent>
          </Card>
        </Grid>

        {/* Cleanup Configuration */}
        <Grid item xs={12}>
          <Card>
            <CardContent>
              <Typography variant="h6" gutterBottom>Certificate Cleanup</Typography>
              <Divider sx={{ mb: 2 }} />

              <Grid container spacing={2}>
                <Grid item xs={12} sm={6}>
                  <TextField
                    fullWidth
                    size="small"
                    type="number"
                    label="Retention Period (days)"
                    value={formData?.cleanupConfig?.retentionDays ?? 90}
                    onChange={(e) => {
                      const val = parseInt(e.target.value, 10);
                      if (formData && val >= 1) {
                        setFormData({
                          ...formData,
                          cleanupConfig: { ...formData.cleanupConfig, retentionDays: val },
                        });
                      }
                    }}
                    helperText="Expired certificates older than this become eligible for cleanup"
                    inputProps={{ min: 1 }}
                  />
                </Grid>
                <Grid item xs={12}>
                  <FormControlLabel
                    control={
                      <Switch
                        checked={formData?.cleanupConfig?.digestEnabled ?? false}
                        onChange={(e) => formData && setFormData({
                          ...formData,
                          cleanupConfig: { ...formData.cleanupConfig, digestEnabled: e.target.checked },
                        })}
                      />
                    }
                    label="Send cleanup digest emails to notification recipients"
                  />
                </Grid>
                {formData?.cleanupConfig?.digestEnabled && (
                  <>
                    <Grid item xs={12} sm={6}>
                      <TextField
                        fullWidth
                        size="small"
                        select
                        label="Digest Frequency"
                        value={formData.cleanupConfig?.digestFrequency ?? 'weekly'}
                        onChange={(e) => setFormData({
                          ...formData,
                          cleanupConfig: { ...formData.cleanupConfig, digestFrequency: e.target.value as 'daily' | 'weekly' },
                        })}
                        SelectProps={{ native: true }}
                      >
                        <option value="daily">Daily</option>
                        <option value="weekly">Weekly</option>
                      </TextField>
                    </Grid>
                    {formData.cleanupConfig?.digestFrequency === 'weekly' && (
                      <Grid item xs={12} sm={6}>
                        <TextField
                          fullWidth
                          size="small"
                          select
                          label="Day of Week"
                          value={formData.cleanupConfig?.digestDay ?? 1}
                          onChange={(e) => setFormData({
                            ...formData,
                            cleanupConfig: { ...formData.cleanupConfig, digestDay: parseInt(e.target.value, 10) },
                          })}
                          SelectProps={{ native: true }}
                        >
                          <option value={0}>Sunday</option>
                          <option value={1}>Monday</option>
                          <option value={2}>Tuesday</option>
                          <option value={3}>Wednesday</option>
                          <option value={4}>Thursday</option>
                          <option value={5}>Friday</option>
                          <option value={6}>Saturday</option>
                        </TextField>
                      </Grid>
                    )}
                  </>
                )}
              </Grid>
            </CardContent>
          </Card>
        </Grid>

        {/* Discovery Configuration */}
        <Grid item xs={12}>
          <Card>
            <CardContent>
              <Box sx={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', mb: 2 }}>
                <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
                  <ScanIcon color="primary" />
                  <Typography variant="h6">Certificate Discovery</Typography>
                </Box>
                <Button
                  variant="outlined"
                  startIcon={discoveryMutation.isPending ? <CircularProgress size={16} /> : <ScanIcon />}
                  onClick={() => discoveryMutation.mutate()}
                  disabled={discoveryMutation.isPending}
                  size="small"
                >
                  {discoveryMutation.isPending ? 'Starting...' : 'Run Discovery Now'}
                </Button>
              </Box>
              <Typography variant="body2" color="text.secondary" sx={{ mb: 2 }}>
                Probes each certificate's hostname and SANs over TLS to discover where certs are actively
                deployed and whether the served certificate matches what's in the CA. Runs automatically
                daily at 2 AM when enabled. Also detects rebound — certificates marked as reissued that
                are still serving.
              </Typography>

              {formData?.discoveryConfig?.lastRunAt && (
                <Alert severity="info" sx={{ mb: 2 }}>
                  Last run: {format(new Date(formData.discoveryConfig.lastRunAt), 'MMM d, yyyy h:mm a')}
                  {formData.discoveryConfig.lastRunStats && (
                    <> — probed {formData.discoveryConfig.lastRunStats.probed}, matched {formData.discoveryConfig.lastRunStats.matched}, mismatched {formData.discoveryConfig.lastRunStats.mismatched}{formData.discoveryConfig.lastRunStats.reboundFound > 0 ? `, ⚠️ ${formData.discoveryConfig.lastRunStats.reboundFound} rebound` : ''}</>
                  )}
                </Alert>
              )}
              {discoveryMutation.isSuccess && (
                <Alert severity="success" sx={{ mb: 2 }}>Discovery scan started — results will appear on certificate records as probes complete.</Alert>
              )}
              {discoveryMutation.isError && (
                <Alert severity="error" sx={{ mb: 2 }}>Failed to start discovery scan.</Alert>
              )}

              <Divider sx={{ mb: 2 }} />

              <Grid container spacing={2}>
                <Grid item xs={12}>
                  <FormControlLabel
                    control={
                      <Switch
                        checked={formData?.discoveryConfig?.enabled ?? false}
                        onChange={(e) => setFormData(prev => prev ? {
                          ...prev,
                          discoveryConfig: { ...prev.discoveryConfig, enabled: e.target.checked },
                        } : prev)}
                      />
                    }
                    label="Enable scheduled daily discovery (runs at 2:00 AM)"
                  />
                </Grid>

                <Grid item xs={12} sm={6}>
                  <TextField
                    label="Probe Ports"
                    helperText="Comma-separated port numbers (e.g. 443, 8443)"
                    fullWidth
                    value={portsInput}
                    onChange={(e) => {
                      setPortsInput(e.target.value);
                      const parsed = e.target.value
                        .split(',')
                        .map((s) => parseInt(s.trim(), 10))
                        .filter((n) => !isNaN(n) && n > 0 && n <= 65535);
                      if (parsed.length > 0) {
                        setFormData(prev => prev ? {
                          ...prev,
                          discoveryConfig: { ...prev.discoveryConfig, probePorts: parsed },
                        } : prev);
                      }
                    }}
                    size="small"
                  />
                </Grid>

                <Grid item xs={12} sm={3}>
                  <TextField
                    label="Probe Timeout (ms)"
                    helperText="1000–30000 ms per host"
                    fullWidth
                    type="number"
                    inputProps={{ min: 1000, max: 30000, step: 500 }}
                    value={formData?.discoveryConfig?.probeTimeoutMs ?? 5000}
                    onChange={(e) => {
                      const val = parseInt(e.target.value, 10);
                      if (!isNaN(val)) setFormData(prev => prev ? {
                        ...prev,
                        discoveryConfig: { ...prev.discoveryConfig, probeTimeoutMs: val },
                      } : prev);
                    }}
                    size="small"
                  />
                </Grid>

                <Grid item xs={12} sm={3}>
                  <TextField
                    label="Concurrency"
                    helperText="Parallel probes (1–50)"
                    fullWidth
                    type="number"
                    inputProps={{ min: 1, max: 50 }}
                    value={formData?.discoveryConfig?.concurrency ?? 10}
                    onChange={(e) => {
                      const val = parseInt(e.target.value, 10);
                      if (!isNaN(val)) setFormData(prev => prev ? {
                        ...prev,
                        discoveryConfig: { ...prev.discoveryConfig, concurrency: val },
                      } : prev);
                    }}
                    size="small"
                  />
                </Grid>

                <Grid item xs={12}>
                  <TextField
                    label="F5 Load Balancer IP Ranges"
                    helperText="Comma-separated CIDRs or exact IPs (e.g. 10.50.0.0/16, 192.168.10.5). Any discovered server whose IP matches will be classified as F5."
                    fullWidth
                    value={f5RangesInput}
                    onChange={(e) => {
                      setF5RangesInput(e.target.value);
                      const parsed = e.target.value
                        .split(',')
                        .map((s) => s.trim())
                        .filter(Boolean);
                      setFormData(prev => prev ? {
                        ...prev,
                        discoveryConfig: { ...prev.discoveryConfig, f5IpRanges: parsed },
                      } : prev);
                    }}
                    placeholder="10.50.0.0/16, 10.51.0.0/16"
                    size="small"
                  />
                </Grid>
              </Grid>
            </CardContent>
          </Card>
        </Grid>

        {/* Save Button */}
        <Grid item xs={12}>
          <Box sx={{ display: 'flex', justifyContent: 'flex-end', gap: 2 }}>
            {updateMutation.isSuccess && (
              <Alert severity="success">Settings saved successfully</Alert>
            )}
            {updateMutation.isError && (
              <Alert severity="error">Failed to save settings</Alert>
            )}
            <Button
              variant="contained"
              onClick={handleSave}
              disabled={updateMutation.isPending}
            >
              Save Settings
            </Button>
          </Box>
        </Grid>
      </Grid>
    </Box>
  );
}