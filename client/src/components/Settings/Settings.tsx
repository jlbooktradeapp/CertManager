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
import { Delete as DeleteIcon, Send as SendIcon } from '@mui/icons-material';
import api from '../../services/api';

interface NotificationSettings {
  enabled: boolean;
  smtpConfig: {
    host: string;
    port: number;
    secure: boolean;
    auth: {
      user: string;
      encryptedPassword: string;
    };
    from: string;
  };
  thresholds: { days: number; enabled: boolean }[];
  recipients: { type: string; value: string }[];
  scheduleHour: number;
  _smtpPasswordChanged?: boolean;
}

export default function Settings() {
  const queryClient = useQueryClient();
  const [testEmail, setTestEmail] = useState('');
  const [newRecipient, setNewRecipient] = useState({ type: 'email', value: '' });

  const { data: settings, isLoading } = useQuery({
    queryKey: ['notificationSettings'],
    queryFn: async () => {
      const response = await api.get<NotificationSettings>('/settings/notifications');
      return response.data;
    },
  });

  const [formData, setFormData] = useState<NotificationSettings | null>(null);

  useEffect(() => {
    if (settings) {
      setFormData(settings);
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

  const handleSave = () => {
    if (formData) {
      const dataToSend = { ...formData };
      // Only send password if it was actually changed by the user
      if (!dataToSend._smtpPasswordChanged) {
        dataToSend.smtpConfig = {
          ...dataToSend.smtpConfig,
          auth: { ...dataToSend.smtpConfig.auth, encryptedPassword: '********' },
        };
      }
      delete dataToSend._smtpPasswordChanged;
      updateMutation.mutate(dataToSend);
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
                <Grid item xs={6}>
                  <TextField
                    fullWidth
                    size="small"
                    label="Username"
                    value={formData.smtpConfig.auth.user}
                    onChange={(e) =>
                      setFormData({
                        ...formData,
                        smtpConfig: {
                          ...formData.smtpConfig,
                          auth: { ...formData.smtpConfig.auth, user: e.target.value },
                        },
                      })
                    }
                  />
                </Grid>
                <Grid item xs={6}>
                  <TextField
                    fullWidth
                    size="small"
                    label="Password"
                    type="password"
                    placeholder={formData.smtpConfig.auth.encryptedPassword === '********' ? 'Leave blank to keep current' : ''}
                    value={formData._smtpPasswordChanged ? formData.smtpConfig.auth.encryptedPassword : ''}
                    onChange={(e) =>
                      setFormData({
                        ...formData,
                        _smtpPasswordChanged: true,
                        smtpConfig: {
                          ...formData.smtpConfig,
                          auth: { ...formData.smtpConfig.auth, encryptedPassword: e.target.value },
                        },
                      })
                    }
                  />
                </Grid>
                <Grid item xs={12}>
                  <TextField
                    fullWidth
                    size="small"
                    label="From Address"
                    value={formData.smtpConfig.from}
                    onChange={(e) =>
                      setFormData({
                        ...formData,
                        smtpConfig: { ...formData.smtpConfig, from: e.target.value },
                      })
                    }
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
