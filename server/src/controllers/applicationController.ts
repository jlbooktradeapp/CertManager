import { Request, Response } from 'express';
import { Application } from '../models/Application';
import { Certificate } from '../models/Certificate';
import { logger } from '../utils/logger';
import { AuthenticatedRequest } from '../middleware/auth';

export async function listApplications(req: Request, res: Response): Promise<void> {
  try {
    const { status, search, page = '1', limit = '25' } = req.query;

    const pageNum = parseInt(page as string, 10);
    const limitNum = parseInt(limit as string, 10);
    const skip = (pageNum - 1) * limitNum;

    const query: Record<string, any> = {};
    if (status) query.status = status;
    if (search) {
      const escapedSearch = (search as string).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
      const searchRegex = new RegExp(escapedSearch, 'i');
      query.$or = [
        { name: searchRegex },
        { 'owners.name': searchRegex },
        { 'owners.email': searchRegex },
        { 'vendor.name': searchRegex },
      ];
    }

    const [applications, total] = await Promise.all([
      Application.find(query)
        .sort({ name: 1 })
        .skip(skip)
        .limit(limitNum)
        .lean(),
      Application.countDocuments(query),
    ]);

    // Attach certificate counts from Certificate collection
    const appIds = applications.map(a => a._id);
    const certCounts = await Certificate.aggregate([
      { $match: { applicationId: { $in: appIds } } },
      { $group: { _id: '$applicationId', count: { $sum: 1 } } },
    ]);
    const countMap = new Map(certCounts.map((c: any) => [c._id.toString(), c.count]));

    const enriched = applications.map(app => ({
      ...app,
      certificateCount: countMap.get(app._id.toString()) || 0,
    }));

    res.json({
      data: enriched,
      pagination: {
        page: pageNum,
        limit: limitNum,
        total,
        pages: Math.ceil(total / limitNum),
      },
    });
  } catch (error) {
    logger.error('List applications error:', error);
    res.status(500).json({ error: 'Failed to list applications' });
  }
}

export async function getApplication(req: Request, res: Response): Promise<void> {
  try {
    const { id } = req.params;

    const application = await Application.findById(id).lean();

    if (!application) {
      res.status(404).json({ error: 'Application not found' });
      return;
    }

    // Query certificates assigned to this application
    const certificates = await Certificate.find({ applicationId: id })
      .select('commonName serialNumber thumbprint status validFrom validTo templateName issuer')
      .sort({ validTo: 1 })
      .populate('issuer.caId', 'name displayName');

    res.json({ ...application, certificates });
  } catch (error) {
    logger.error('Get application error:', error);
    res.status(500).json({ error: 'Failed to get application' });
  }
}

export async function createApplication(req: AuthenticatedRequest, res: Response): Promise<void> {
  try {
    const { name, description, owners = [], vendor, status = 'active' } = req.body;

    if (!name) {
      res.status(400).json({ error: 'Application name is required' });
      return;
    }

    const existing = await Application.findOne({ name });
    if (existing) {
      res.status(409).json({ error: 'Application with this name already exists' });
      return;
    }

    const application = await Application.create({
      name,
      description,
      owners,
      vendor: vendor || undefined,
      status,
    });

    logger.info(`Application ${name} created by ${req.user?.username}`);

    res.status(201).json(application);
  } catch (error) {
    logger.error('Create application error:', error);
    res.status(500).json({ error: 'Failed to create application' });
  }
}

export async function updateApplication(req: AuthenticatedRequest, res: Response): Promise<void> {
  try {
    const { id } = req.params;

    const allowedFields = ['name', 'description', 'owners', 'vendor', 'status'] as const;
    const updates: Record<string, unknown> = {};
    for (const field of allowedFields) {
      if (req.body[field] !== undefined) {
        updates[field] = req.body[field];
      }
    }

    const application = await Application.findByIdAndUpdate(
      id,
      { $set: updates },
      { new: true, runValidators: true }
    );

    if (!application) {
      res.status(404).json({ error: 'Application not found' });
      return;
    }

    logger.info(`Application ${application.name} updated by ${req.user?.username}`);

    res.json(application);
  } catch (error) {
    logger.error('Update application error:', error);
    res.status(500).json({ error: 'Failed to update application' });
  }
}

export async function deleteApplication(req: AuthenticatedRequest, res: Response): Promise<void> {
  try {
    const { id } = req.params;

    const application = await Application.findById(id);

    if (!application) {
      res.status(404).json({ error: 'Application not found' });
      return;
    }

    await application.deleteOne();

    // Unassign any certificates linked to this application
    await Certificate.updateMany(
      { applicationId: id },
      { $set: { applicationId: null } }
    );

    logger.info(`Application ${application.name} deleted by ${req.user?.username}`);

    res.json({ message: 'Application deleted' });
  } catch (error) {
    logger.error('Delete application error:', error);
    res.status(500).json({ error: 'Failed to delete application' });
  }
}

export async function importApplicationsCSV(req: AuthenticatedRequest, res: Response): Promise<void> {
  try {
    const { applications } = req.body;

    if (!Array.isArray(applications) || applications.length === 0) {
      res.status(400).json({ error: 'Applications array is required' });
      return;
    }

    let imported = 0;
    let skipped = 0;
    const errors: string[] = [];

    for (const app of applications) {
      try {
        if (!app.name) {
          errors.push(`Skipped row: missing application name`);
          skipped++;
          continue;
        }

        const existing = await Application.findOne({ name: app.name });
        if (existing) {
          errors.push(`Skipped "${app.name}": already exists`);
          skipped++;
          continue;
        }

        // Parse owners from CSV format: "Name <email>" or just "email"
        const owners = [];
        if (app.ownerName || app.ownerEmail) {
          owners.push({
            name: app.ownerName || app.ownerEmail,
            email: app.ownerEmail || '',
            role: app.ownerRole || 'Owner',
          });
        }

        await Application.create({
          name: app.name,
          description: app.description || '',
          owners,
          vendor: app.vendorName ? {
            name: app.vendorName,
            contactName: app.vendorContactName || '',
            contactEmail: app.vendorContactEmail || '',
          } : undefined,
          status: app.status || 'active',
        });

        imported++;
      } catch (err) {
        errors.push(`Failed to import "${app.name}": ${err}`);
        skipped++;
      }
    }

    logger.info(`CSV import by ${req.user?.username}: ${imported} imported, ${skipped} skipped`);

    res.json({
      message: 'Import completed',
      imported,
      skipped,
      errors: errors.slice(0, 50),
    });
  } catch (error) {
    logger.error('Import applications error:', error);
    res.status(500).json({ error: 'Failed to import applications' });
  }
}