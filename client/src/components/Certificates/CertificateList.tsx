import { useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import {
  Box,
  Typography,
  TextField,
  InputAdornment,
  Chip,
  Button,
  ToggleButton,
  ToggleButtonGroup,
  FormControlLabel,
  Switch,
  Tooltip,
} from '@mui/material';
import { DataGrid, GridColDef, GridRenderCellParams } from '@mui/x-data-grid';
import { Search as SearchIcon, Sync as SyncIcon } from '@mui/icons-material';
import { format, differenceInDays } from 'date-fns';
import { getCertificates, triggerSync } from '../../services/certificates';
import api from '../../services/api';
import { Certificate } from '../../types';
import { useAuth } from '../../context/AuthContext';

const statusColors: Record<string, 'success' | 'warning' | 'error' | 'default' | 'info'> = {
  active: 'success',
  expiring: 'warning',
  expired: 'error',
  revoked: 'default',
  reissued: 'info',
};

export default function CertificateList() {
  const navigate = useNavigate();
  const [searchParams, setSearchParams] = useSearchParams();
  const { isOperator } = useAuth();

  const [paginationModel, setPaginationModel] = useState({
    page: 0,
    pageSize: 25,
  });
  const [search, setSearch] = useState(searchParams.get('search') || '');
  const [status, setStatus] = useState<string | null>(searchParams.get('status'));
  const [showAll, setShowAll] = useState(false);
  const maxDays = searchParams.get('maxDays');

  const filterLabel = maxDays
    ? `Expiring within ${maxDays} days`
    : null;

  // Fetch excluded templates from settings
  const { data: settings } = useQuery({
    queryKey: ['settings'],
    queryFn: async () => {
      const response = await api.get('/settings/notifications');
      return response.data;
    },
  });

  const excludedTemplates = settings?.excludedTemplates || [];

  const { data, isLoading, refetch } = useQuery({
    queryKey: ['certificates', paginationModel.page, paginationModel.pageSize, status, search, maxDays, showAll, excludedTemplates],
    queryFn: () =>
      getCertificates({
        page: paginationModel.page + 1,
        limit: paginationModel.pageSize,
        status: status || undefined,
        search: search || undefined,
        sortBy: 'validTo',
        sortOrder: 'asc',
        maxDays: maxDays ? parseInt(maxDays, 10) : undefined,
        excludeTemplates: !showAll && excludedTemplates.length > 0
          ? excludedTemplates.join(',')
          : undefined,
      }),
  });

  const handleStatusChange = (_: React.MouseEvent<HTMLElement>, newStatus: string | null) => {
    const effectiveStatus = newStatus === 'all' ? null : newStatus;
    setStatus(effectiveStatus);
    const newParams = new URLSearchParams(searchParams);
    if (effectiveStatus) {
      newParams.set('status', effectiveStatus);
    } else {
      newParams.delete('status');
    }
    newParams.delete('maxDays');
    setSearchParams(newParams);
  };

  const handleClearFilters = () => {
    setStatus(null);
    setSearch('');
    setSearchParams({});
  };

  const handleSync = async () => {
    await triggerSync();
    refetch();
  };

  const columns: GridColDef[] = [
    {
      field: 'commonName',
      headerName: 'Common Name',
      flex: 1,
      minWidth: 200,
    },
    {
      field: 'templateName',
      headerName: 'Template',
      width: 180,
      renderCell: (params: GridRenderCellParams<Certificate>) =>
        params.value || 'N/A',
    },
    {
      field: 'status',
      headerName: 'Status',
      width: 120,
      renderCell: (params: GridRenderCellParams<Certificate>) => (
        <Chip
          label={params.value}
          color={statusColors[params.value as string] || 'default'}
          size="small"
        />
      ),
    },
    {
      field: 'validTo',
      headerName: 'Expires',
      width: 150,
      renderCell: (params: GridRenderCellParams<Certificate>) => {
        const date = new Date(params.value as string);
        const daysLeft = differenceInDays(date, new Date());
        return (
          <Box>
            <Typography variant="body2">
              {format(date, 'MMM d, yyyy')}
            </Typography>
            <Typography variant="caption" color={daysLeft <= 7 ? 'error' : daysLeft <= 30 ? 'warning.main' : 'textSecondary'}>
              {daysLeft > 0 ? `${daysLeft} days left` : 'Expired'}
            </Typography>
          </Box>
        );
      },
    },
    {
      field: 'issuer',
      headerName: 'Issuer',
      width: 180,
      renderCell: (params: GridRenderCellParams<Certificate>) =>
        params.row.issuer?.commonName || 'Unknown',
    },
    {
      field: 'serialNumber',
      headerName: 'Serial Number',
      width: 180,
    },
  ];

  return (
    <Box>
      <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', mb: 3 }}>
        <Typography variant="h4">Certificates</Typography>
        {isOperator && (
          <Button variant="outlined" startIcon={<SyncIcon />} onClick={handleSync}>
            Sync Now
          </Button>
        )}
      </Box>

      <Box sx={{ display: 'flex', gap: 2, mb: 3, flexWrap: 'wrap', alignItems: 'center' }}>
        <TextField
          placeholder="Search certificates..."
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          size="small"
          sx={{ minWidth: 250 }}
          InputProps={{
            startAdornment: (
              <InputAdornment position="start">
                <SearchIcon />
              </InputAdornment>
            ),
          }}
        />

        <ToggleButtonGroup
          value={status || 'all'}
          exclusive
          onChange={handleStatusChange}
          size="small"
        >
          <ToggleButton value="all">All</ToggleButton>
          <ToggleButton value="active">Active</ToggleButton>
          <ToggleButton value="expiring">Expiring</ToggleButton>
          <ToggleButton value="expired">Expired</ToggleButton>
          <ToggleButton value="reissued">Reissued</ToggleButton>
          <ToggleButton value="revoked">Revoked</ToggleButton>
        </ToggleButtonGroup>

        <Tooltip title={showAll
          ? 'Showing all certificate templates'
          : `Hiding ${excludedTemplates.length} auto-enroll template(s). Configure in Settings.`
        }>
          <FormControlLabel
            control={
              <Switch
                checked={showAll}
                onChange={(e) => setShowAll(e.target.checked)}
                size="small"
              />
            }
            label="Show all templates"
            sx={{ ml: 1 }}
          />
        </Tooltip>

        {filterLabel && (
          <Chip
            label={filterLabel}
            onDelete={handleClearFilters}
            color="primary"
            size="small"
          />
        )}
      </Box>

      <DataGrid
        rows={data?.data || []}
        columns={columns}
        loading={isLoading}
        paginationModel={paginationModel}
        onPaginationModelChange={setPaginationModel}
        pageSizeOptions={[10, 25, 50, 100]}
        rowCount={data?.pagination.total || 0}
        paginationMode="server"
        getRowId={(row) => row._id}
        onRowClick={(params) => navigate(`/certificates/${params.id}`)}
        sx={{
          height: 'calc(100vh - 280px)',
          '& .MuiDataGrid-row': {
            cursor: 'pointer',
          },
        }}
        disableRowSelectionOnClick
      />
    </Box>
  );
}