/**
 * Import certificates from a JSON file into MongoDB.
 * Replicates the exact same logic as syncCA() in certificateService.ts,
 * but uses bulkWrite for dramatically faster performance at scale.
 * Also stores the RequestID watermark on the CA for future incremental syncs.
 *
 * Usage: node import-root-ca.js <json-file> <ca-name>
 * Example: node import-root-ca.js D:\CertManager\test-root.json TSCERAPPPRD01
 */

const mongoose = require('mongoose');
const fs = require('fs');
const path = require('path');

// Load .env from server directory
require('dotenv').config({ path: path.join(__dirname, 'server', '.env') });

const MONGO_URI = process.env.MONGODB_URI || 'mongodb://localhost:27017/certmanager';
const BULK_BATCH_SIZE = 1000; // Documents per bulkWrite call

// ---- Minimal schema matching the app's Certificate model ----
const certificateSchema = new mongoose.Schema({}, { strict: false, collection: 'certificates' });
const Certificate = mongoose.model('Certificate', certificateSchema);

const caSchema = new mongoose.Schema({}, { strict: false, collection: 'certificateauthorities' });
const CertificateAuthority = mongoose.model('CertificateAuthority', caSchema);

// ---- Subject parser (same as certificateService.ts) ----
function parseSubject(subject) {
  const result = {};
  if (!subject) return result;

  const parts = subject.split(',').map(p => p.trim());
  for (const part of parts) {
    const [key, ...valueParts] = part.split('=');
    const value = valueParts.join('=');
    switch (key.toUpperCase()) {
      case 'CN': result.commonName = value; break;
      case 'O': result.organization = value; break;
      case 'OU': result.organizationalUnit = value; break;
      case 'L': result.locality = value; break;
      case 'S': case 'ST': result.state = value; break;
      case 'C': result.country = value; break;
    }
  }
  return result;
}

function extractCN(subject) {
  const match = subject?.match(/CN=([^,]+)/i);
  return match ? match[1] : subject || 'Unknown';
}

async function main() {
  const args = process.argv.slice(2);
  if (args.length < 2) {
    console.error('Usage: node import-root-ca.js <json-file> <ca-name>');
    console.error('Example: node import-root-ca.js D:\\CertManager\\test-root.json TSCERAPPPRD01');
    process.exit(1);
  }

  const jsonFile = args[0];
  const caName = args[1];

  // Read and parse the JSON file
  console.log(`Reading ${jsonFile}...`);
  const raw = fs.readFileSync(jsonFile, 'utf-8');
  console.log(`File size: ${(Buffer.byteLength(raw) / 1024 / 1024).toFixed(1)} MB`);

  console.log('Parsing JSON...');
  let certificates = JSON.parse(raw);
  if (!Array.isArray(certificates)) certificates = [certificates];
  console.log(`Parsed ${certificates.length} certificates\n`);

  // Connect to MongoDB
  console.log(`Connecting to MongoDB: ${MONGO_URI}`);
  await mongoose.connect(MONGO_URI);
  console.log('Connected\n');

  // Find the CA
  const ca = await CertificateAuthority.findOne({ name: new RegExp(caName, 'i') });
  if (!ca) {
    console.error(`CA "${caName}" not found in database. Available CAs:`);
    const allCAs = await CertificateAuthority.find({}, { name: 1 });
    allCAs.forEach(c => console.error(`  - ${c.name}`));
    process.exit(1);
  }
  console.log(`Found CA: ${ca.name} (${ca._id})\n`);

  // ---- Find highest RequestID for watermark ----
  let maxRequestID = 0;
  for (const cert of certificates) {
    if (cert.RequestID && cert.RequestID > maxRequestID) {
      maxRequestID = cert.RequestID;
    }
  }
  console.log(`Highest RequestID in data: ${maxRequestID}\n`);

  // ---- Bulk upsert certificates ----
  const now = new Date();
  const totalCerts = certificates.length;
  let processedCount = 0;
  let upsertedCount = 0;
  let modifiedCount = 0;
  let errorCount = 0;
  const startTime = Date.now();

  console.log(`Starting bulk upsert of ${totalCerts} certificates (batch size: ${BULK_BATCH_SIZE})...\n`);

  for (let i = 0; i < totalCerts; i += BULK_BATCH_SIZE) {
    const batch = certificates.slice(i, i + BULK_BATCH_SIZE);
    const operations = [];

    for (const certData of batch) {
      const commonName = certData.CommonName || extractCN(certData.Subject);
      const subject = parseSubject(certData.Subject);

      // Ensure subject.commonName is set (required field)
      if (!subject.commonName) {
        subject.commonName = commonName || 'Unknown';
      }

      operations.push({
        updateOne: {
          filter: { serialNumber: certData.SerialNumber },
          update: {
            $set: {
              serialNumber: certData.SerialNumber,
              thumbprint: certData.Thumbprint || '',
              commonName: commonName,
              subjectAlternativeNames: certData.SANs || [],
              issuer: {
                caId: ca._id,
                commonName: ca.displayName || ca.name,
              },
              subject: subject,
              validFrom: new Date(certData.NotBefore),
              validTo: new Date(certData.NotAfter),
              keyUsage: certData.KeyUsage || [],
              extendedKeyUsage: certData.ExtendedKeyUsage || [],
              templateName: certData.Template,
              keySize: certData.KeySize || undefined,
              encryptionType: certData.EncryptionType || undefined,
              'metadata.lastSyncedAt': now,
            },
            $setOnInsert: {
              status: 'active',
              deployedTo: [],
              notificationsSent: [],
              notificationRecipients: [],
              'metadata.discoveredAt': now,
            },
          },
          upsert: true,
        },
      });
    }

    try {
      const result = await Certificate.bulkWrite(operations, { ordered: false });
      upsertedCount += result.upsertedCount || 0;
      modifiedCount += result.modifiedCount || 0;
      processedCount += batch.length;
    } catch (error) {
      // With ordered: false, bulkWrite continues past individual errors
      if (error.result) {
        upsertedCount += error.result.nUpserted || 0;
        modifiedCount += error.result.nModified || 0;
        const batchErrors = (error.writeErrors || []).length;
        errorCount += batchErrors;
        processedCount += batch.length - batchErrors;
      } else {
        errorCount += batch.length;
        console.error(`\n  Batch error: ${error.message}`);
      }
    }

    // Progress every batch
    const elapsed = ((Date.now() - startTime) / 1000).toFixed(0);
    const rate = Math.round(processedCount / ((Date.now() - startTime) / 1000));
    const pct = ((i + batch.length) / totalCerts * 100).toFixed(1);
    const remaining = rate > 0 ? Math.round((totalCerts - i - batch.length) / rate) : '?';
    process.stdout.write(`\r  ${i + batch.length}/${totalCerts} (${pct}%) | ${upsertedCount} new, ${modifiedCount} updated, ${errorCount} errors | ${rate}/sec | ${elapsed}s elapsed, ~${remaining}s remaining   `);
  }

  console.log(`\n\nBulk upsert complete: ${upsertedCount} new, ${modifiedCount} updated, ${errorCount} errors`);

  // Update CA: lastSyncedAt and lastRequestID watermark
  ca.lastSyncedAt = new Date();
  if (maxRequestID > (ca.lastRequestID || 0)) {
    ca.lastRequestID = maxRequestID;
  }
  await ca.save();
  console.log(`Updated ${ca.name}: lastSyncedAt=${ca.lastSyncedAt}, lastRequestID=${ca.lastRequestID}\n`);

  // ---- Update certificate statuses — same as updateCertificateStatuses() ----
  console.log('Updating certificate statuses...');
  const in30Days = new Date(now.getTime() + 30 * 24 * 60 * 60 * 1000);

  const expiredResult = await Certificate.updateMany(
    { status: { $nin: ['expired', 'revoked', 'reissued'] }, validTo: { $lt: now } },
    { $set: { status: 'expired' } }
  );
  console.log(`  Marked ${expiredResult.modifiedCount} as expired`);

  const expiringResult = await Certificate.updateMany(
    { status: 'active', validTo: { $gte: now, $lte: in30Days } },
    { $set: { status: 'expiring' } }
  );
  console.log(`  Marked ${expiringResult.modifiedCount} as expiring`);

  const activeResult = await Certificate.updateMany(
    { status: 'expiring', validTo: { $gt: in30Days } },
    { $set: { status: 'active' } }
  );
  console.log(`  Marked ${activeResult.modifiedCount} as active`);

  // ---- Detect reissued certificates — same as detectReissuedCertificates() ----
  console.log('\nDetecting reissued certificates...');
  const groups = await Certificate.aggregate([
    { $match: { status: { $ne: 'revoked' } } },
    {
      $addFields: {
        sanKey: {
          $cond: {
            if: { $gt: [{ $size: { $ifNull: ['$subjectAlternativeNames', []] } }, 0] },
            then: {
              $reduce: {
                input: { $sortArray: { input: { $ifNull: ['$subjectAlternativeNames', []] }, sortBy: 1 } },
                initialValue: '',
                in: { $concat: ['$$value', '|', '$$this'] },
              },
            },
            else: '',
          },
        },
      },
    },
    {
      $group: {
        _id: { cn: '$commonName', sans: '$sanKey' },
        certs: { $push: { _id: '$_id', validTo: '$validTo', status: '$status' } },
        count: { $sum: 1 },
      },
    },
    { $match: { count: { $gt: 1 } } },
  ], { allowDiskUse: true });

  let markedCount = 0;
  let groupsProcessed = 0;
  const totalGroups = groups.length;
  console.log(`  Found ${totalGroups} certificate groups with duplicates`);

  // Batch the reissue updates
  const reissueBulkOps = [];

  for (const group of groups) {
    const sorted = group.certs.sort(
      (a, b) => new Date(b.validTo).getTime() - new Date(a.validTo).getTime()
    );
    const reissuedIds = sorted
      .slice(1)
      .filter(c => c.status !== 'reissued')
      .map(c => c._id);

    if (reissuedIds.length > 0) {
      reissueBulkOps.push({
        updateMany: {
          filter: { _id: { $in: reissuedIds } },
          update: { $set: { status: 'reissued' } },
        },
      });
    }

    groupsProcessed++;
    if (groupsProcessed % 5000 === 0) {
      process.stdout.write(`\r  Processing groups: ${groupsProcessed}/${totalGroups}   `);
    }
  }

  if (reissueBulkOps.length > 0) {
    for (let i = 0; i < reissueBulkOps.length; i += BULK_BATCH_SIZE) {
      const batch = reissueBulkOps.slice(i, i + BULK_BATCH_SIZE);
      const result = await Certificate.bulkWrite(batch, { ordered: false });
      markedCount += result.modifiedCount || 0;
    }
  }
  console.log(`\n  Marked ${markedCount} as reissued`);

  // ---- Summary ----
  const totalInDB = await Certificate.countDocuments({ 'issuer.caId': ca._id });
  const totalAll = await Certificate.countDocuments({});
  const totalElapsed = ((Date.now() - startTime) / 1000 / 60).toFixed(1);

  console.log(`\n========================================`);
  console.log(`  Import complete`);
  console.log(`  ${ca.name} certificates: ${totalInDB}`);
  console.log(`  Total certificates in DB: ${totalAll}`);
  console.log(`  RequestID watermark: ${ca.lastRequestID}`);
  console.log(`  Total time: ${totalElapsed} minutes`);
  console.log(`========================================`);

  await mongoose.disconnect();
}

main().catch(err => {
  console.error('Fatal error:', err);
  process.exit(1);
});