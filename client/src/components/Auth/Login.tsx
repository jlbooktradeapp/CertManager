import { useState, useEffect } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import {
  Box,
  Card,
  CardContent,
  TextField,
  Button,
  Typography,
  Alert,
  CircularProgress,
  Divider,
} from '@mui/material';
import { Security as SecurityIcon } from '@mui/icons-material';
import { useAuth } from '../../context/AuthContext';

export default function Login() {
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const { login, isAuthenticated } = useAuth();
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();

  // Check for SAML error in URL params
  useEffect(() => {
    const samlError = searchParams.get('error');
    if (samlError) {
      const errorMessages: Record<string, string> = {
        saml_auth_failed: 'SSO authentication failed. Please try again.',
        saml_no_profile: 'SSO authentication failed — no user profile returned.',
        saml_init_failed: 'Could not initiate SSO login. Please try again.',
        saml_processing_failed: 'An error occurred processing your login. Please try again.',
      };
      setError(errorMessages[samlError] || 'Login failed. Please try again.');
    }
  }, [searchParams]);

  // Redirect if already authenticated
  useEffect(() => {
    if (isAuthenticated) {
      navigate('/');
    }
  }, [isAuthenticated, navigate]);

  const handleSSOLogin = () => {
    window.location.href = '/api/auth/saml/login';
  };

  const handleLocalLogin = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    setIsLoading(true);

    try {
      await login(username, password);
      navigate('/');
    } catch (err: any) {
      const serverError = err.response?.data?.error;
      const safeErrors: Record<string, string> = {
        'Invalid credentials': 'Invalid credentials',
        'Username and password are required': 'Username and password are required',
        'Too many login attempts. Please try again in 15 minutes.': 'Too many login attempts. Please try again in 15 minutes.',
        'Local login is disabled in production. Use SSO to sign in.': 'Local login is disabled in production. Use SSO to sign in.',
        'No local credentials configured. Set LOCAL_ADMIN_USER/PASSWORD in .env for development.': 'Local login is not configured.',
      };
      setError(safeErrors[serverError] || 'Login failed. Please try again.');
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <Box
      sx={{
        minHeight: '100vh',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        bgcolor: 'background.default',
        p: 2,
      }}
    >
      <Card sx={{ maxWidth: 400, width: '100%' }}>
        <CardContent sx={{ p: 4 }}>
          <Box sx={{ textAlign: 'center', mb: 4 }}>
            <SecurityIcon sx={{ fontSize: 48, color: 'primary.main', mb: 1 }} />
            <Typography variant="h5" component="h1" gutterBottom>
              Certificate Manager
            </Typography>
            <Typography variant="body2" color="textSecondary">
              Sign in to manage certificates
            </Typography>
          </Box>

          {error && (
            <Alert severity="error" sx={{ mb: 3 }}>
              {error}
            </Alert>
          )}

          {/* SSO Login Button */}
          <Button
            fullWidth
            variant="contained"
            size="large"
            onClick={handleSSOLogin}
            sx={{ mb: 2 }}
          >
            Sign in with SSO
          </Button>

          {/* Dev-only local login form */}
          {process.env.NODE_ENV !== 'production' && (
            <>
              <Divider sx={{ my: 3 }}>
                <Typography variant="caption" color="textSecondary">
                  Development Only
                </Typography>
              </Divider>

              <form onSubmit={handleLocalLogin}>
                <TextField
                  fullWidth
                  label="Username"
                  value={username}
                  onChange={(e) => setUsername(e.target.value)}
                  margin="normal"
                  required
                  size="small"
                  autoComplete="username"
                />
                <TextField
                  fullWidth
                  label="Password"
                  type="password"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  margin="normal"
                  required
                  size="small"
                  autoComplete="current-password"
                />
                <Button
                  type="submit"
                  fullWidth
                  variant="outlined"
                  size="small"
                  disabled={isLoading}
                  sx={{ mt: 2 }}
                >
                  {isLoading ? (
                    <CircularProgress size={20} color="inherit" />
                  ) : (
                    'Local Dev Login'
                  )}
                </Button>
              </form>
            </>
          )}
        </CardContent>
      </Card>
    </Box>
  );
}