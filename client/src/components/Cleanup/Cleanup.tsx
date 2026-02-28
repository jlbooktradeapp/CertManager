import { useState, useCallback } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import {
  Box,
  Typography,
  TextField,
  InputAdornment,
  Chip,
  Button,
  Alert,
  Dialog,
  DialogTitle,
  DialogContent,
  DialogContentText,
  DialogActions,
  LinearProgress,
  Card,
  CardContent,
  Grid,
} from '@mui/material';
import { DataGrid, GridColDef, GridRenderCellParams, GridRowSelectionModel } from '@mui/x-data-grid';
import {
  Search as SearchIcon,
  DeleteSweep as CleanupIcon,
  Warning as WarningIcon,
  Email as EmailIcon,
} from '@mui/icons-material';
import { format, differenceInDays } from 'date-fns';
import {
  getEligibleCertificates,
  getCleanupStats,
  revokeAndDeleteCertificates,
  triggerCleanupDigest,
  CleanupResult,
} from '../../services/cleanup';
import { Certificate } from '../../types';

export default function Cleanup() {
  const queryClient = useQueryClient();

  const [paginationModel, setPaginationModel] = useState({ page: 0, pageSize: 25 });
  const [search, setSearch] = useState('');
  const [selectedIds, setSelectedIds] = useState<GridRowSelectionModel>([]);
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [processing, setProcessing] = useState(false);
  const [result, setResult] = useState<CleanupResult | null>(null);

  // Fetch stats
  const { data: stats } = useQuery({
    queryKey: ['cleanupStats'],
    queryFn: getCleanupStats,
  });

  // Fetch eligible certificates
  const { data: eligible, isLoading } = useQuery({
    queryKey: ['cleanupEligible', paginationModel.page, paginationModel.pageSize, search],
    queryFn: () =>
      getEligibleCertificates({
        page: paginationModel.page + 1,
        limit: paginationModel.pageSize,
        search: search || undefined,
      }),
  });

  const handleSearch = useCallback((value: string) => {
    setSearch(value);
    setPaginationModel((prev) => ({ ...prev, page: 0 }));
  }, []);

  const handleCleanup = async () => {
    setConfirmOpen(false);
    setProcessing(true);
    setResult(null);

    try {
      const ids = selectedIds.map(String);
      const cleanupResult = await revokeAndDeleteCertificates(ids);
      setResult(cleanupResult);
      setSelectedIds([]);

      // Refresh data
      queryClient.invalidateQueries({ queryKey: ['cleanupEligible'] });
      queryClient.invalidateQueries({ queryKey: ['cleanupStats'] });
      queryClient.invalidateQueries({ queryKey: ['certificateStats'] });
    } catch (error) {
      setResult({
        total: selectedIds.length,
        revoked: 0,
        deleted: 0,
        failed: selectedIds.length,
        errors: [{ serialNumber: '', commonName: '', error: 'Request failed' }],
      });
    } finally {
      setProcessing(false);
    }
  };

  const handleSendDigest = async () => {
    try {
      await triggerCleanupDigest();
    } catch {
      // handled silently
    }
  };

  const columns: GridColDef[] = [
    {
      field: 'commonName',
      headerName: 'Common Name',
      flex: 2,
      minWidth: 200,
    },
    {
      field: 'status',
      headerName: 'Status',
      width: 120,
      renderCell: (params: GridRenderCellParams) => (
        <Chip
          label={params.value === 'reissued' ? 'Reissued' : 'Expired'}
          size="small"
          color={params.value === 'reissued' ? 'info' : 'error'}
        />
      ),
    },
    {
      field: 'templateName',
      headerName: 'Template',
      flex: 1,
      minWidth: 150,
      renderCell: (params: GridRenderCellParams) => params.value || 'N/A',
    },
    {
      field: 'serialNumber',
      headerName: 'Serial Number',
      flex: 1,
      minWidth: 150,
    },
    {
      field: 'validTo',
      headerName: 'Expired',
      flex: 1,
      minWidth: 120,
      renderCell: (params: GridRenderCellParams) => {
        try {
          return format(new Date(params.value), 'MMM d, yyyy');
        } catch {
          return 'Invalid';
        }
      },
    },
    {
      field: 'daysExpired',
      headerName: 'Days Expired',
      width: 120,
      renderCell: (params: GridRenderCellParams<Certificate>) => {
        const days = differenceInDays(new Date(), new Date(params.row.validTo));
        return (
          <Chip
            label={`${days}d`}
            size="small"
            color={days > 365 ? 'error' : days > 180 ? 'warning' : 'default'}
          />
        );
      },
    },
    {
      field: 'issuer',
      headerName: 'Issuing CA',
      flex: 1,
      minWidth: 150,
      valueGetter: (value: any) => value?.commonName || 'Unknown',
    },
  ];

  const rows = (eligible?.data || []).map((cert) => ({
    ...cert,
    id: cert._id,
  }));

  return (
    <Box>
      <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', mb: 3 }}>
        <Typography variant="h4">Certificate Cleanup</Typography>
        <Button
          variant="outlined"
          startIcon={<EmailIcon />}
          onClick={handleSendDigest}
          size="small"
        >
          Send Digest
        </Button>
      </Box>

      {/* Stats Cards */}
      <Grid container spacing={3} sx={{ mb: 3 }}>
        <Grid item xs={12} sm={4}>
          <Card>
            <CardContent>
              <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, mb: 1 }}>
                <CleanupIcon color="warning" />
                <Typography variant="subtitle2" color="textSecondary">
                  Eligible for Cleanup
                </Typography>
              </Box>
              <Typography variant="h4" color="warning.main">
                {stats?.eligible ?? '—'}
              </Typography>
            </CardContent>
          </Card>
        </Grid>
        <Grid item xs={12} sm={4}>
          <Card>
            <CardContent>
              <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, mb: 1 }}>
                <WarningIcon color="info" />
                <Typography variant="subtitle2" color="textSecondary">
                  Retention Policy
                </Typography>
              </Box>
              <Typography variant="h4">
                {stats?.retentionDays ?? '—'} days
              </Typography>
            </CardContent>
          </Card>
        </Grid>
        <Grid item xs={12} sm={4}>
          <Card>
            <CardContent>
              <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, mb: 1 }}>
                <CleanupIcon color="primary" />
                <Typography variant="subtitle2" color="textSecondary">
                  Selected
                </Typography>
              </Box>
              <Typography variant="h4" color="primary.main">
                {selectedIds.length}
              </Typography>
            </CardContent>
          </Card>
        </Grid>
      </Grid>

      {/* Result Alert */}
      {result && (
        <Alert
          severity={result.failed === 0 ? 'success' : 'warning'}
          onClose={() => setResult(null)}
          sx={{ mb: 2 }}
        >
          Cleanup complete: {result.deleted} deleted, {result.revoked} revoked on CA
          {result.failed > 0 && `, ${result.failed} failed`}
          {result.errors.length > 0 && (
            <Box sx={{ mt: 1, fontSize: '0.85em' }}>
              {result.errors.slice(0, 5).map((err, i) => (
                <div key={i}>{err.commonName}: {err.error}</div>
              ))}
              {result.errors.length > 5 && <div>...and {result.errors.length - 5} more errors</div>}
            </Box>
          )}
        </Alert>
      )}

      {/* Progress */}
      {processing && (
        <Box sx={{ mb: 2 }}>
          <Typography variant="body2" color="textSecondary" sx={{ mb: 1 }}>
            Processing cleanup... This may take a moment.
          </Typography>
          <LinearProgress />
        </Box>
      )}

      {/* Search and Actions */}
      <Box sx={{ display: 'flex', gap: 2, mb: 2, alignItems: 'center' }}>
        <TextField
          size="small"
          placeholder="Search by name, serial, or template..."
          value={search}
          onChange={(e) => handleSearch(e.target.value)}
          sx={{ minWidth: 350 }}
          InputProps={{
            startAdornment: (
              <InputAdornment position="start">
                <SearchIcon />
              </InputAdornment>
            ),
          }}
        />
        <Box sx={{ flexGrow: 1 }} />
        <Button
          variant="contained"
          color="error"
          startIcon={<CleanupIcon />}
          disabled={selectedIds.length === 0 || processing}
          onClick={() => setConfirmOpen(true)}
        >
          Clean Up Selected ({selectedIds.length})
        </Button>
      </Box>

      <Typography variant="body2" color="textSecondary" sx={{ mb: 2 }}>
        Showing expired certificates older than {stats?.retentionDays ?? '...'} days
        and reissued certificates past their expiration date.
        Select certificates to revoke on the CA and remove from tracking.
        Configure the retention period in Settings.
      </Typography>

      {/* Data Grid */}
      <Box sx={{ height: 500 }}>
        <DataGrid
          rows={rows}
          columns={columns}
          loading={isLoading}
          checkboxSelection
          disableRowSelectionOnClick
          rowSelectionModel={selectedIds}
          onRowSelectionModelChange={setSelectedIds}
          paginationModel={paginationModel}
          onPaginationModelChange={setPaginationModel}
          pageSizeOptions={[25, 50, 100]}
          rowCount={eligible?.pagination?.total || 0}
          paginationMode="server"
          sx={{
            '& .MuiDataGrid-row:hover': {
              backgroundColor: 'action.hover',
            },
          }}
        />
      </Box>

      {/* Confirmation Dialog */}
      <Dialog open={confirmOpen} onClose={() => setConfirmOpen(false)}>
        <DialogTitle>Confirm Certificate Cleanup</DialogTitle>
        <DialogContent>
          <DialogContentText>
            You are about to revoke and delete <strong>{selectedIds.length}</strong> expired
            certificate{selectedIds.length !== 1 ? 's' : ''}. This action will:
          </DialogContentText>
          <Box component="ul" sx={{ mt: 1 }}>
            <li>Revoke each certificate on the issuing Certificate Authority</li>
            <li>Permanently remove each certificate from the CertManager database</li>
          </Box>
          <DialogContentText sx={{ mt: 1, color: 'error.main' }}>
            This action cannot be undone.
          </DialogContentText>
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setConfirmOpen(false)}>Cancel</Button>
          <Button
            onClick={handleCleanup}
            color="error"
            variant="contained"
            startIcon={<CleanupIcon />}
          >
            Revoke &amp; Delete ({selectedIds.length})
          </Button>
        </DialogActions>
      </Dialog>
    </Box>
  );
}