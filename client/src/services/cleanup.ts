import api from './api';
import { Certificate, PaginatedResponse } from '../types';

export interface CleanupStats {
  eligible: number;
  retentionDays: number;
}

export interface CleanupResult {
  total: number;
  revoked: number;
  deleted: number;
  failed: number;
  errors: { serialNumber: string; commonName: string; error: string }[];
}

export interface CleanupFilters {
  page?: number;
  limit?: number;
  search?: string;
  retentionDays?: number;
}

export async function getEligibleCertificates(filters: CleanupFilters = {}) {
  const params = new URLSearchParams();
  if (filters.page) params.set('page', String(filters.page));
  if (filters.limit) params.set('limit', String(filters.limit));
  if (filters.search) params.set('search', filters.search);
  if (filters.retentionDays) params.set('retentionDays', String(filters.retentionDays));

  const response = await api.get<PaginatedResponse<Certificate> & { retentionDays: number }>(
    `/cleanup/eligible?${params}`
  );
  return response.data;
}

export async function getCleanupStats() {
  const response = await api.get<CleanupStats>('/cleanup/stats');
  return response.data;
}

export async function revokeAndDeleteCertificates(certIds: string[]) {
  const response = await api.post<CleanupResult>('/cleanup/revoke-and-delete', { certIds });
  return response.data;
}

export async function triggerCleanupDigest() {
  const response = await api.post<{ message: string }>('/cleanup/digest');
  return response.data;
}