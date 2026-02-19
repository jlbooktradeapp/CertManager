import { Request, Response } from 'express';
import { Server } from '../models/Server';
import { Certificate } from '../models/Certificate';
import { testConnection, testWinRM, getRemoteCertificates, installCertificate, bindIISCertificate } from '../services/powershellService';
import { logger } from '../utils/logger';
import { AuthenticatedRequest } from '../middleware/auth';

export async function listServers(req: Request, res: Response): Promise<void> {
  try {
    const { status, role, page = '1', limit = '25' } = req.query;

    const pageNum = parseInt(page as string, 10);
    const limitNum = parseInt(limit as string, 10);
    const skip = (pageNum - 1) * limitNum;

    const query: Record<string, any> = {};
    if (status) query.status = status;
    if (role) query.roles = role;

    const [servers, total] = await Promise.all([
      Server.find(query)
        .sort({ hostname: 1 })
        .skip(skip)
        .limit(limitNum)
        .populate('certificates', 'commonName validTo status'),
      Server.countDocuments(query),
    ]);

    res.json({
      data: servers,
      pagination: {
        page: pageNum,
        limit: limitNum,
        total,
        pages: Math.ceil(total / limitNum),
      },
    });
  } catch (error) {
    logger.error('List servers error:', error);
    res.status(500).json({ error: 'Failed to list servers' });
  }
}

export async function getServer(req: Request, res: Response): Promise<void> {
  try {
    const { id } = req.params;

    const server = await Server.findById(id)
      .populate('certificates');

    if (!server) {
      res.status(404).json({ error: 'Server not found' });
      return;
    }

    res.json(server);
  } catch (error) {
    logger.error('Get server error:', error);
    res.status(500).json({ error: 'Failed to get server' });
  }
}

export async function createServer(req: AuthenticatedRequest, res: Response): Promise<void> {
  try {
    const {
      hostname,
      fqdn,
      ipAddress,
      operatingSystem,
      roles = [],
      domainJoined = true,
      domain,
      ou,
    } = req.body;

    if (!hostname || !fqdn || !ipAddress) {
      res.status(400).json({ error: 'Hostname, FQDN, and IP address are required' });
      return;
    }

    // Check for duplicate
    const existing = await Server.findOne({ fqdn });
    if (existing) {
      res.status(409).json({ error: 'Server with this FQDN already exists' });
      return;
    }

    const server = await Server.create({
      hostname,
      fqdn,
      ipAddress,
      operatingSystem,
      roles,
      domainJoined,
      domain,
      ou,
      status: 'unknown',
      remoteManagement: {
        winRMEnabled: false,
        psRemotingEnabled: false,
      },
    });

    logger.info(`Server ${fqdn} created by ${req.user?.username}`);

    res.status(201).json(server);
  } catch (error) {
    logger.error('Create server error:', error);
    res.status(500).json({ error: 'Failed to create server' });
  }
}

export async function updateServer(req: AuthenticatedRequest, res: Response): Promise<void> {
  try {
    const { id } = req.params;
    const updates = req.body;

    delete updates._id;
    delete updates.certificates;
    delete updates.createdAt;
    delete updates.updatedAt;

    const server = await Server.findByIdAndUpdate(
      id,
      { $set: updates },
      { new: true, runValidators: true }
    );

    if (!server) {
      res.status(404).json({ error: 'Server not found' });
      return;
    }

    logger.info(`Server ${server.fqdn} updated by ${req.user?.username}`);

    res.json(server);
  } catch (error) {
    logger.error('Update server error:', error);
    res.status(500).json({ error: 'Failed to update server' });
  }
}

export async function deleteServer(req: AuthenticatedRequest, res: Response): Promise<void> {
  try {
    const { id } = req.params;

    const server = await Server.findById(id);

    if (!server) {
      res.status(404).json({ error: 'Server not found' });
      return;
    }

    await server.deleteOne();

    logger.info(`Server ${server.fqdn} deleted by ${req.user?.username}`);

    res.json({ message: 'Server deleted' });
  } catch (error) {
    logger.error('Delete server error:', error);
    res.status(500).json({ error: 'Failed to delete server' });
  }
}

export async function testServerConnectivity(req: AuthenticatedRequest, res: Response): Promise<void> {
  try {
    const { id } = req.params;

    const server = await Server.findById(id);

    if (!server) {
      res.status(404).json({ error: 'Server not found' });
      return;
    }

    logger.info(`Testing connectivity to ${server.fqdn}`);

    const [pingResult, winrmResult] = await Promise.all([
      testConnection(server.fqdn),
      testWinRM(server.fqdn),
    ]);

    server.status = pingResult ? 'online' : 'offline';
    server.remoteManagement = {
      winRMEnabled: winrmResult,
      psRemotingEnabled: winrmResult,
      lastChecked: new Date(),
    };
    await server.save();

    res.json({
      hostname: server.fqdn,
      ping: pingResult,
      winRM: winrmResult,
      status: server.status,
    });
  } catch (error) {
    logger.error('Test connectivity error:', error);
    res.status(500).json({ error: 'Failed to test server connectivity' });
  }
}

export async function getServerCertificates(req: Request, res: Response): Promise<void> {
  try {
    const { id } = req.params;

    const server = await Server.findById(id);

    if (!server) {
      res.status(404).json({ error: 'Server not found' });
      return;
    }

    // Get certificates from remote server
    const result = await getRemoteCertificates(server.fqdn);

    if (result.success && result.output) {
      try {
        let remoteCerts = JSON.parse(result.output);
        if (!Array.isArray(remoteCerts)) {
          remoteCerts = [remoteCerts];
        }
        res.json(remoteCerts);
      } catch {
        res.json([]);
      }
    } else {
      // Return cached certificates from database
      await server.populate('certificates');
      res.json(server.certificates);
    }
  } catch (error) {
    logger.error('Get server certificates error:', error);
    res.status(500).json({ error: 'Failed to get server certificates' });
  }
}

export async function deployCertificate(req: AuthenticatedRequest, res: Response): Promise<void> {
  try {
    const { id } = req.params;
    const { certificatePath } = req.body;

    if (!certificatePath) {
      res.status(400).json({ error: 'Certificate path is required' });
      return;
    }

    const server = await Server.findById(id);

    if (!server) {
      res.status(404).json({ error: 'Server not found' });
      return;
    }

    logger.info(`Deploying certificate to ${server.fqdn} by ${req.user?.username}`);

    const result = await installCertificate(server.fqdn, certificatePath);

    if (result.success) {
      res.json({ message: 'Certificate deployed successfully', output: result.output });
    } else {
      res.status(500).json({ error: 'Failed to deploy certificate', details: result.error });
    }
  } catch (error) {
    logger.error('Deploy certificate error:', error);
    res.status(500).json({ error: 'Failed to deploy certificate' });
  }
}

export async function bindCertificate(req: AuthenticatedRequest, res: Response): Promise<void> {
  try {
    const { id } = req.params;
    const { siteName, thumbprint, port = 443 } = req.body;

    if (!siteName || !thumbprint) {
      res.status(400).json({ error: 'Site name and certificate thumbprint are required' });
      return;
    }

    const server = await Server.findById(id);

    if (!server) {
      res.status(404).json({ error: 'Server not found' });
      return;
    }

    if (!server.roles.includes('IIS')) {
      res.status(400).json({ error: 'Server does not have IIS role' });
      return;
    }

    logger.info(`Binding certificate to ${siteName} on ${server.fqdn} by ${req.user?.username}`);

    const result = await bindIISCertificate(server.fqdn, siteName, thumbprint, port);

    if (result.success) {
      // Update certificate deployment info
      const cert = await Certificate.findOne({ thumbprint });
      if (cert) {
        const existingDeployment = cert.deployedTo.find(
          d => d.serverId.toString() === server._id.toString()
        );

        if (existingDeployment) {
          existingDeployment.binding = { type: 'IIS', siteName, port };
          existingDeployment.deployedAt = new Date();
        } else {
          cert.deployedTo.push({
            serverId: server._id,
            serverName: server.fqdn,
            binding: { type: 'IIS', siteName, port },
            deployedAt: new Date(),
          });
        }

        await cert.save();

        // Update server certificates list
        if (!server.certificates.includes(cert._id)) {
          server.certificates.push(cert._id);
          await server.save();
        }
      }

      res.json({ message: 'Certificate bound successfully' });
    } else {
      res.status(500).json({ error: 'Failed to bind certificate', details: result.error });
    }
  } catch (error) {
    logger.error('Bind certificate error:', error);
    res.status(500).json({ error: 'Failed to bind certificate' });
  }
}
