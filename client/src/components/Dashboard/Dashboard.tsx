import { useQuery } from '@tanstack/react-query';
import {
  Box,
  Grid,
  Card,
  CardContent,
  Typography,
  CircularProgress,
  Alert,
  Chip,
  List,
  ListItem,
  ListItemText,
  Button,
} from '@mui/material';
import {
  Security as CertIcon,
  Warning as WarningIcon,
  Error as ErrorIcon,
  CheckCircle as CheckIcon,
  Sync as SyncIcon,
} from '@mui/icons-material';
import { useNavigate } from 'react-router-dom';
import { PieChart, Pie, Cell, ResponsiveContainer, Legend, Tooltip } from 'recharts';
import { getCertificateStats, getExpiringCertificates, triggerSync } from '../../services/certificates';
import { format, differenceInDays } from 'date-fns';
import { useAuth } from '../../context/AuthContext';

const COLORS = ['#4caf50', '#ff9800', '#f44336', '#9e9e9e'];

export default function Dashboard() {
  const navigate = useNavigate();
  const { isOperator } = useAuth();

  const { data: stats, isLoading: statsLoading, error: statsError } = useQuery({
    queryKey: ['certificateStats'],
    queryFn: getCertificateStats,
  });

  const { data: expiring, isLoading: expiringLoading } = useQuery({
    queryKey: ['expiringCertificates'],
    queryFn: () => getExpiringCertificates(30),
  });

  const handleSync = async () => {
    await triggerSync();
  };

  if (statsLoading || expiringLoading) {
    return (
      <Box sx={{ display: 'flex', justifyContent: 'center', mt: 4 }}>
        <CircularProgress />
      </Box>
    );
  }

  if (statsError) {
    return (
      <Alert severity="error">Failed to load dashboard data</Alert>
    );
  }

  const chartData = [
    { name: 'Active', value: stats?.active || 0 },
    { name: 'Expiring', value: stats?.expiring || 0 },
    { name: 'Expired', value: stats?.expired || 0 },
    { name: 'Revoked', value: stats?.revoked || 0 },
  ].filter(item => item.value > 0);

  return (
    <Box>
      <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', mb: 3 }}>
        <Typography variant="h4">Dashboard</Typography>
        {isOperator && (
          <Button
            variant="outlined"
            startIcon={<SyncIcon />}
            onClick={handleSync}
          >
            Sync Now
          </Button>
        )}
      </Box>

      <Grid container spacing={3}>
        {/* Stats Cards */}
        <Grid item xs={12} sm={6} md={3}>
          <Card>
            <CardContent>
              <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, mb: 1 }}>
                <CertIcon color="primary" />
                <Typography variant="subtitle2" color="textSecondary">
                  Total Certificates
                </Typography>
              </Box>
              <Typography variant="h4">{stats?.total || 0}</Typography>
            </CardContent>
          </Card>
        </Grid>

        <Grid item xs={12} sm={6} md={3}>
          <Card>
            <CardContent>
              <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, mb: 1 }}>
                <CheckIcon color="success" />
                <Typography variant="subtitle2" color="textSecondary">
                  Active
                </Typography>
              </Box>
              <Typography variant="h4" color="success.main">
                {stats?.active || 0}
              </Typography>
            </CardContent>
          </Card>
        </Grid>

        <Grid item xs={12} sm={6} md={3}>
          <Card>
            <CardContent>
              <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, mb: 1 }}>
                <WarningIcon color="warning" />
                <Typography variant="subtitle2" color="textSecondary">
                  Expiring (30 days)
                </Typography>
              </Box>
              <Typography variant="h4" color="warning.main">
                {stats?.expiringIn30Days || 0}
              </Typography>
            </CardContent>
          </Card>
        </Grid>

        <Grid item xs={12} sm={6} md={3}>
          <Card>
            <CardContent>
              <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, mb: 1 }}>
                <ErrorIcon color="error" />
                <Typography variant="subtitle2" color="textSecondary">
                  Critical (7 days)
                </Typography>
              </Box>
              <Typography variant="h4" color="error.main">
                {stats?.expiringIn7Days || 0}
              </Typography>
            </CardContent>
          </Card>
        </Grid>

        {/* Chart */}
        <Grid item xs={12} md={6}>
          <Card sx={{ height: 350 }}>
            <CardContent>
              <Typography variant="h6" gutterBottom>
                Certificate Status Distribution
              </Typography>
              {chartData.length > 0 ? (
                <ResponsiveContainer width="100%" height={280}>
                  <PieChart>
                    <Pie
                      data={chartData}
                      cx="50%"
                      cy="50%"
                      innerRadius={60}
                      outerRadius={100}
                      paddingAngle={2}
                      dataKey="value"
                      label={({ name, value }) => `${name}: ${value}`}
                    >
                      {chartData.map((_, index) => (
                        <Cell key={`cell-${index}`} fill={COLORS[index % COLORS.length]} />
                      ))}
                    </Pie>
                    <Tooltip />
                    <Legend />
                  </PieChart>
                </ResponsiveContainer>
              ) : (
                <Box sx={{ display: 'flex', justifyContent: 'center', alignItems: 'center', height: 280 }}>
                  <Typography color="textSecondary">No certificates found</Typography>
                </Box>
              )}
            </CardContent>
          </Card>
        </Grid>

        {/* Expiring Soon */}
        <Grid item xs={12} md={6}>
          <Card sx={{ height: 350 }}>
            <CardContent>
              <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', mb: 2 }}>
                <Typography variant="h6">Expiring Soon</Typography>
                <Button size="small" onClick={() => navigate('/certificates?status=expiring')}>
                  View All
                </Button>
              </Box>
              {expiring && expiring.length > 0 ? (
                <List dense sx={{ maxHeight: 260, overflow: 'auto' }}>
                  {expiring.slice(0, 5).map((cert) => {
                    const daysLeft = differenceInDays(new Date(cert.validTo), new Date());
                    return (
                      <ListItem
                        key={cert._id}
                        sx={{ cursor: 'pointer' }}
                        onClick={() => navigate(`/certificates/${cert._id}`)}
                      >
                        <ListItemText
                          primary={cert.commonName}
                          secondary={`Expires: ${format(new Date(cert.validTo), 'MMM d, yyyy')}`}
                        />
                        <Chip
                          label={`${daysLeft}d`}
                          size="small"
                          color={daysLeft <= 7 ? 'error' : daysLeft <= 14 ? 'warning' : 'default'}
                        />
                      </ListItem>
                    );
                  })}
                </List>
              ) : (
                <Box sx={{ display: 'flex', justifyContent: 'center', alignItems: 'center', height: 260 }}>
                  <Typography color="textSecondary">No certificates expiring soon</Typography>
                </Box>
              )}
            </CardContent>
          </Card>
        </Grid>
      </Grid>
    </Box>
  );
}
