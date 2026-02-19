import { useNavigate } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import {
  Box,
  Typography,
  Button,
  Chip,
  Alert,
} from '@mui/material';
import { DataGrid, GridColDef, GridRenderCellParams } from '@mui/x-data-grid';
import { Add as AddIcon } from '@mui/icons-material';
import { format } from 'date-fns';
import api from '../../services/api';
import { CSRRequest, PaginatedResponse } from '../../types';
import { useAuth } from '../../context/AuthContext';
import { useState } from 'react';

const statusColors: Record<string, 'default' | 'primary' | 'secondary' | 'success' | 'error' | 'warning'> = {
  draft: 'default',
  pending: 'primary',
  submitted: 'secondary',
  issued: 'success',
  failed: 'error',
  cancelled: 'warning',
};

export default function CSRList() {
  const navigate = useNavigate();
  const { isOperator } = useAuth();
  const [paginationModel, setPaginationModel] = useState({
    page: 0,
    pageSize: 25,
  });

  const { data, isLoading, error } = useQuery({
    queryKey: ['csrRequests', paginationModel.page, paginationModel.pageSize],
    queryFn: async () => {
      const response = await api.get<PaginatedResponse<CSRRequest>>(
        `/csr?page=${paginationModel.page + 1}&limit=${paginationModel.pageSize}`
      );
      return response.data;
    },
  });

  if (error) {
    return <Alert severity="error">Failed to load CSR requests</Alert>;
  }

  const columns: GridColDef[] = [
    {
      field: 'commonName',
      headerName: 'Common Name',
      flex: 1,
      minWidth: 200,
    },
    {
      field: 'status',
      headerName: 'Status',
      width: 120,
      renderCell: (params: GridRenderCellParams<CSRRequest>) => (
        <Chip
          label={params.value}
          color={statusColors[params.value as string] || 'default'}
          size="small"
          sx={{ textTransform: 'capitalize' }}
        />
      ),
    },
    {
      field: 'templateName',
      headerName: 'Template',
      width: 150,
      renderCell: (params: GridRenderCellParams<CSRRequest>) =>
        params.row.templateName || 'WebServer',
    },
    {
      field: 'keySize',
      headerName: 'Key Size',
      width: 100,
      renderCell: (params: GridRenderCellParams<CSRRequest>) =>
        `${params.row.keySize} bit`,
    },
    {
      field: 'requestedBy',
      headerName: 'Requested By',
      width: 150,
    },
    {
      field: 'requestedAt',
      headerName: 'Requested',
      width: 180,
      renderCell: (params: GridRenderCellParams<CSRRequest>) =>
        format(new Date(params.row.requestedAt), 'PPp'),
    },
    {
      field: 'subjectAlternativeNames',
      headerName: 'SANs',
      width: 100,
      renderCell: (params: GridRenderCellParams<CSRRequest>) =>
        params.row.subjectAlternativeNames?.length || 0,
    },
  ];

  return (
    <Box>
      <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', mb: 3 }}>
        <Typography variant="h4">CSR Requests</Typography>
        {isOperator && (
          <Button
            variant="contained"
            startIcon={<AddIcon />}
            onClick={() => navigate('/csr/new')}
          >
            New CSR
          </Button>
        )}
      </Box>

      <DataGrid
        rows={data?.data || []}
        columns={columns}
        loading={isLoading}
        paginationModel={paginationModel}
        onPaginationModelChange={setPaginationModel}
        pageSizeOptions={[10, 25, 50]}
        rowCount={data?.pagination.total || 0}
        paginationMode="server"
        getRowId={(row) => row._id}
        sx={{
          height: 'calc(100vh - 200px)',
        }}
        disableRowSelectionOnClick
      />
    </Box>
  );
}
