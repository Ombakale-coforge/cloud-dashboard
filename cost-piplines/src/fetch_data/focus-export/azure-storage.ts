import zlib from 'node:zlib';
import os from 'node:os';
import path from 'node:path';
import fs from 'node:fs';
import { Readable } from 'node:stream';
import { ClientSecretCredential } from '@azure/identity';
import { BlobServiceClient, ContainerClient } from '@azure/storage-blob';
import {
    AZURE_TENANT_ID,
    AZURE_CLIENT_ID,
    AZURE_CLIENT_SECRET,
    AZURE_STORAGE_ACCOUNT_NAME,
    AZURE_STORAGE_CONTAINER_NAME,
    exportPrefix,
} from './config';
import { BlobItemSummary, PeriodRunDescriptor } from './types';

let containerClientInstance: ContainerClient | null = null;

export function getContainerClient(): ContainerClient {
    if (!containerClientInstance) {
        const credential = new ClientSecretCredential(AZURE_TENANT_ID, AZURE_CLIENT_ID, AZURE_CLIENT_SECRET);
        const blobServiceClient = new BlobServiceClient(
            `https://${AZURE_STORAGE_ACCOUNT_NAME}.blob.core.windows.net`,
            credential
        );
        containerClientInstance = blobServiceClient.getContainerClient(AZURE_STORAGE_CONTAINER_NAME);
    }
    return containerClientInstance;
}

export async function streamToBuffer(readableStream: NodeJS.ReadableStream): Promise<Buffer> {
    const chunks: Buffer[] = [];
    for await (const chunk of readableStream) {
        chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
    }
    return Buffer.concat(chunks);
}

// Discovers export periods and finds the latest run per period
export async function discoverLatestRunsPerPeriod(containerClient = getContainerClient()): Promise<PeriodRunDescriptor[]> {
    const allBlobs: BlobItemSummary[] = [];

    for await (const blob of containerClient.listBlobsFlat({ prefix: exportPrefix })) {
        if (blob.properties.lastModified) {
            allBlobs.push({
                name: blob.name,
                lastModified: blob.properties.lastModified,
            });
        }
    }

    const periods = new Map<string, Map<string, BlobItemSummary[]>>();

    for (const blob of allBlobs) {
        const rest = blob.name.slice(exportPrefix.length);
        const parts = rest.split('/');
        if (parts.length < 3) continue;
        const [period, runId] = parts;
        if (!periods.has(period)) periods.set(period, new Map());
        const runs = periods.get(period)!;
        if (!runs.has(runId)) runs.set(runId, []);
        runs.get(runId)!.push(blob);
    }

    const result: PeriodRunDescriptor[] = [];
    for (const [period, runs] of periods.entries()) {
        let latestRunId: string | null = null;
        let latestTime = 0;

        for (const [runId, blobs] of runs.entries()) {
            const maxTime = Math.max(...blobs.map((b) => b.lastModified.getTime()));
            if (maxTime > latestTime) {
                latestTime = maxTime;
                latestRunId = runId;
            }
        }

        if (latestRunId) {
            result.push({
                exportPeriod: period,
                exportRunId: latestRunId,
                blobs: runs.get(latestRunId) || [],
            });
        }
    }

    return result.sort((a, b) => a.exportPeriod.localeCompare(b.exportPeriod));
}

// Downloads blob stream, handling .gz transparently
export async function getBlobReadStream(blobName: string, containerClient = getContainerClient()): Promise<Readable> {
    const blobClient = containerClient.getBlobClient(blobName);
    const downloadResp = await blobClient.download();
    if (!downloadResp.readableStreamBody) {
        throw new Error(`Blob ${blobName} returned empty readable stream`);
    }

    let stream = downloadResp.readableStreamBody as Readable;
    if (blobName.endsWith('.gz')) {
        stream = stream.pipe(zlib.createGunzip());
    }
    return stream;
}

// Downloads a blob directly to a local temporary file using parallel chunking and automatic retries.
// This decouples the Azure network download from the database ingestion, preventing live socket idle timeouts.
export async function downloadBlobToTempFile(
    blobName: string,
    containerClient = getContainerClient()
): Promise<{ filePath: string; cleanup: () => void }> {
    const blobClient = containerClient.getBlobClient(blobName);
    const tempDir = os.tmpdir();
    const tempFileName = `azure-focus-${Date.now()}-${Math.random().toString(36).slice(2)}.tmp`;
    const tempFilePath = path.join(tempDir, tempFileName);

    await blobClient.downloadToFile(tempFilePath);

    const cleanup = () => {
        try {
            if (fs.existsSync(tempFilePath)) {
                fs.unlinkSync(tempFilePath);
            }
        } catch {
            // ignore cleanup errors
        }
    };

    return { filePath: tempFilePath, cleanup };
}

// Reads manifest.json to extract the list of CSV part blob names
export async function getManifestCsvBlobNames(manifestBlobName: string, containerClient = getContainerClient()): Promise<string[] | null> {
    try {
        const blobClient = containerClient.getBlobClient(manifestBlobName);
        const downloadResp = await blobClient.download();
        if (!downloadResp.readableStreamBody) return null;

        const buf = await streamToBuffer(downloadResp.readableStreamBody);
        const manifest = JSON.parse(buf.toString('utf8'));
        if (Array.isArray(manifest.blobs) && manifest.blobs.length > 0) {
            return manifest.blobs.map((b: { blobName: string }) => b.blobName);
        }
    } catch {
        // Fall back to default blob listing
    }
    return null;
}
