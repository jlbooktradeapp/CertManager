import mongoose, { Schema, Document } from 'mongoose';

export interface IWorkflowStep {
  step: string;
  status: 'pending' | 'completed' | 'failed';
  completedAt?: Date;
  error?: string;
}

export interface ICSRRequest extends Document {
  commonName: string;
  subjectAlternativeNames: string[];
  subject: {
    organization?: string;
    organizationalUnit?: string;
    locality?: string;
    state?: string;
    country?: string;
  };
  serverType: 'apache' | 'iis';
  keySize: 2048 | 4096;
  keyAlgorithm: 'RSA' | 'ECDSA';
  hashAlgorithm: 'SHA256' | 'SHA384' | 'SHA512';
  keyUsage: string[];
  extendedKeyUsage: string[];
  templateName?: string;
  targetCAId?: mongoose.Types.ObjectId;
  targetServerId?: mongoose.Types.ObjectId;
  applicationId?: mongoose.Types.ObjectId;
  deliveryEmails: string[];
  status: 'draft' | 'generating' | 'pending' | 'submitted' | 'issued' | 'delivering' | 'completed' | 'failed' | 'cancelled';
  csrPEM?: string;
  privateKeyLocation?: string;
  issuedCertificateId?: mongoose.Types.ObjectId;
  issuedCertPEM?: string;
  deliveredAt?: Date;
  requestedBy: string;
  requestedAt: Date;
  processedAt?: Date;
  errorMessage?: string;
  workflowSteps: IWorkflowStep[];
}

const WorkflowStepSchema = new Schema<IWorkflowStep>({
  step: { type: String, required: true },
  status: {
    type: String,
    enum: ['pending', 'completed', 'failed'],
    default: 'pending',
  },
  completedAt: Date,
  error: String,
}, { _id: false });

const CSRRequestSchema = new Schema<ICSRRequest>({
  commonName: { type: String, required: true, index: true },
  subjectAlternativeNames: [{ type: String }],
  subject: {
    organization: String,
    organizationalUnit: String,
    locality: String,
    state: String,
    country: String,
  },
  serverType: {
    type: String,
    enum: ['apache', 'iis'],
    required: true,
  },
  keySize: {
    type: Number,
    enum: [2048, 4096],
    default: 2048,
  },
  keyAlgorithm: {
    type: String,
    enum: ['RSA', 'ECDSA'],
    default: 'RSA',
  },
  hashAlgorithm: {
    type: String,
    enum: ['SHA256', 'SHA384', 'SHA512'],
    default: 'SHA256',
  },
  keyUsage: {
    type: [String],
    default: ['digitalSignature', 'keyEncipherment'],
  },
  extendedKeyUsage: {
    type: [String],
    default: ['serverAuth', 'clientAuth'],
  },
  templateName: String,
  targetCAId: { type: Schema.Types.ObjectId, ref: 'CertificateAuthority' },
  targetServerId: { type: Schema.Types.ObjectId, ref: 'Server' },
  applicationId: { type: Schema.Types.ObjectId, ref: 'Application', index: true },
  deliveryEmails: [{ type: String }],
  status: {
    type: String,
    enum: ['draft', 'generating', 'pending', 'submitted', 'issued', 'delivering', 'completed', 'failed', 'cancelled'],
    default: 'draft',
    index: true,
  },
  csrPEM: String,
  privateKeyLocation: String,
  issuedCertificateId: { type: Schema.Types.ObjectId, ref: 'Certificate' },
  issuedCertPEM: String,
  deliveredAt: Date,
  requestedBy: { type: String, required: true },
  requestedAt: { type: Date, default: Date.now },
  processedAt: Date,
  errorMessage: String,
  workflowSteps: [WorkflowStepSchema],
}, {
  timestamps: true,
});

export const CSRRequest = mongoose.model<ICSRRequest>('CSRRequest', CSRRequestSchema);