// src/gcs/gcs.service.ts
import { Injectable, Logger } from '@nestjs/common';
import { Storage, Bucket } from '@google-cloud/storage';
import { createHash } from 'crypto';
import * as path from 'path';

@Injectable()
export class GcsService {
  private storage: Storage;
  private bucket: Bucket;

  logger = new Logger('GcsService');

  constructor() {
    this.storage = new Storage({
      projectId: process.env.BIGQUERY_PROJECT_ID,
      keyFilename: process.env.GOOGLE_APPLICATION_CREDENTIALS,
    });

    this.bucket = this.storage.bucket(process.env.GCS_BUCKET_NAME);

    // Apply lifecycle rule to auto-delete objects after 90 days
    //this.setLifecyclePolicy();
  }

  // Method to generate unique cache file names
  private generateCacheFileName(filename): string {
    const hash = createHash('md5').update(filename).digest('hex');
    return `${hash}.json`;
  }

  async getJSON(fileName: string): Promise<any | null> {
    const file = this.bucket.file(this.generateCacheFileName(fileName));

    try {
      const exists = await file.exists();
      if (exists[0]) {
        const [content] = await file.download();
        return JSON.parse(content.toString());
      }
    } catch (error) {
      this.logger.error('Error fetching cached places:', error);
      return null;
    }
    return null;
  }

  async storeJSON(data: any, fileName: string): Promise<void> {
    const file = this.bucket.file(this.generateCacheFileName(fileName));

    try {
      await file.save(JSON.stringify(data), {
        contentType: 'application/json',
        resumable: false,
      });
      this.logger.log('Cached places saved to GCS.');
    } catch (error) {
        this.logger.error('Error saving cached places:', error);
    }
  }
  // Method to set lifecycle policy on the bucket
  private async setLifecyclePolicy(): Promise<void> {
    try {
      await this.bucket.setMetadata({
        lifecycle: {
          rule: [
            {
              action: { type: 'Delete' },
              condition: { age: 90 } // Automatically delete objects older than 90 days
            }
          ]
        }
      });
      this.logger.log('Lifecycle policy set to auto-delete objects after 90 days.');
    } catch (error) {
        this.logger.error('Error setting lifecycle policy:', error);
    }
  }
}
