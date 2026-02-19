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
  keySize: 2048 | 4096;
  keyAlgorithm: 'RSA' | 'ECDSA';
  hashAlgorithm: 'SHA256' | 'SHA384' | 'SHA512';
  templateName?: string;
  targetCAId?: mongoose.Types.ObjectId;
  targetServerId?: mongoose.Types.ObjectId;
  status: 'draft' | 'pending' | 'submitted' | 'issued' | 'failed' | 'cancelled';
  csrPEM?: string;
  privateKeyLocation?: string;
  issuedCertificateId?: mongoose.Types.ObjectId;
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
  templateName: String,
  targetCAId: { type: Schema.Types.ObjectId, ref: 'CertificateAuthority' },
  targetServerId: { type: Schema.Types.ObjectId, ref: 'Server' },
  status: {
    type: String,
    enum: ['draft', 'pending', 'submitted', 'issued', 'failed', 'cancelled'],
    default: 'draft',
    index: true,
  },
  csrPEM: String,
  privateKeyLocation: String,
  issuedCertificateId: { type: Schema.Types.ObjectId, ref: 'Certificate' },
  requestedBy: { type: String, required: true },
  requestedAt: { type: Date, default: Date.now },
  processedAt: Date,
  errorMessage: String,
  workflowSteps: [WorkflowStepSchema],
}, {
  timestamps: true,
});

export const CSRRequest = mongoose.model<ICSRRequest>('CSRRequest', CSRRequestSchema);
