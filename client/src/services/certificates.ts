import api from './api';
import { Certificate, CertificateStats, PaginatedResponse } from '../types';

export interface CertificateFilters {
  page?: number;
  limit?: number;
  status?: string;
  search?: string;
  sortBy?: string;
  sortOrder?: 'asc' | 'desc';
  maxDays?: number;
  excludeTemplates?: string;
  templateName?: string;
}

export async function getCertificates(filters: CertificateFilters = {}) {
  const params = new URLSearchParams();
  if (filters.page) params.set('page', String(filters.page));
  if (filters.limit) params.set('limit', String(filters.limit));
  if (filters.status) params.set('status', filters.status);
  if (filters.search) params.set('search', filters.search);
  if (filters.sortBy) params.set('sortBy', filters.sortBy);
  if (filters.sortOrder) params.set('sortOrder', filters.sortOrder);
  if (filters.maxDays) params.set('maxDays', String(filters.maxDays));
  if (filters.excludeTemplates) params.set('excludeTemplates', filters.excludeTemplates);
  if (filters.templateName) params.set('templateName', filters.templateName);

  const response = await api.get<PaginatedResponse<Certificate>>(`/certificates?${params}`);
  return response.data;
}

export async function getCertificate(id: string) {
  const response = await api.get<Certificate>(`/certificates/${id}`);
  return response.data;
}

export async function getExpiringCertificates(days: number = 30) {
  const response = await api.get<Certificate[]>(`/certificates/expiring?days=${days}`);
  return response.data;
}

export async function getCertificateStats() {
  const response = await api.get<CertificateStats>('/certificates/stats');
  return response.data;
}

export async function getTemplateNames() {
  const response = await api.get<string[]>('/certificates/templates');
  return response.data;
}

export async function triggerSync() {
  const response = await api.post('/certificates/sync');
  return response.data;
}

export async function deleteCertificate(id: string) {
  const response = await api.delete(`/certificates/${id}`);
  return response.data;
}

export async function updateCertificate(id: string, data: { notificationRecipients?: string[]; applicationId?: string | null; status?: string }) {
  const response = await api.put<Certificate>(`/certificates/${id}`, data);
  return response.data;
}

export interface ReissueOptions {
  serverType: 'apache' | 'iis';
  deliveryEmails?: string[];
  targetCAId?: string;
  targetServerId?: string;
}

export interface ReissueResponse {
  message: string;
  csrId: string;
  commonName: string;
  serverType: string;
}

export async function reissueCertificate(id: string, options: ReissueOptions): Promise<ReissueResponse> {
  const response = await api.post<ReissueResponse>(`/certificates/${id}/reissue`, options);
  return response.data;
}