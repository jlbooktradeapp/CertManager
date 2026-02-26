import mongoose, { Schema, Document } from 'mongoose';

export interface IOwner {
  name: string;
  email: string;
  role?: string;
}

export interface IApplication extends Document {
  name: string;
  description?: string;
  owners: IOwner[];
  vendor?: {
    name: string;
    contactName?: string;
    contactEmail?: string;
  };
  status: 'active' | 'inactive' | 'retired';
  certificates: mongoose.Types.ObjectId[];
  createdAt: Date;
  updatedAt: Date;
}

const OwnerSchema = new Schema<IOwner>({
  name: { type: String, required: true },
  email: { type: String, required: true },
  role: String,
}, { _id: false });

const ApplicationSchema = new Schema<IApplication>({
  name: { type: String, required: true, unique: true, index: true },
  description: String,
  owners: [OwnerSchema],
  vendor: {
    name: String,
    contactName: String,
    contactEmail: String,
  },
  status: {
    type: String,
    enum: ['active', 'inactive', 'retired'],
    default: 'active',
    index: true,
  },
  certificates: [{ type: Schema.Types.ObjectId, ref: 'Certificate' }],
}, {
  timestamps: true,
});

export const Application = mongoose.model<IApplication>('Application', ApplicationSchema);