// src/gcs/gcs.service.ts
import { Injectable } from '@nestjs/common';
import { Storage } from '@google-cloud/storage';
import { createHash } from 'crypto';
import * as path from 'path';

@Injectable()
export class GcsService {
  private storage: Storage;
  private bucketName: string;

  constructor() {
    this.storage = new Storage({
      projectId: process.env.BIGQUERY_PROJECT_ID,
      keyFilename: process.env.GOOGLE_APPLICATION_CREDENTIALS,
    });
    this.bucketName = process.env.GCS_BUCKET_NAME; // Make sure to create a bucket in GCS and set its name here
  }

  // Generate a unique filename based on the lat, lng, and radius
  private generateCacheFileName(lat: number, lng: number, radius: number): string {
    const hash = createHash('md5').update(`${lat}-${lng}-${radius}`).digest('hex');
    return `${hash}.json`;
  }

  async getCachedPlaces(lat: number, lng: number, radius: number): Promise<any | null> {
    const fileName = this.generateCacheFileName(lat, lng, radius);
    const file = this.storage.bucket(this.bucketName).file(fileName);

    try {
      const exists = await file.exists();
      if (exists[0]) {
        const [content] = await file.download();
        return JSON.parse(content.toString());
      }
    } catch (error) {
      console.error('Error fetching cached places:', error);
      return null;
    }
    return null;
  }

  async cachePlaces(lat: number, lng: number, radius: number, data: any): Promise<void> {
    const fileName = this.generateCacheFileName(lat, lng, radius);
    const file = this.storage.bucket(this.bucketName).file(fileName);
    
    try {
      await file.save(JSON.stringify(data), {
        contentType: 'application/json',
        resumable: false,
      });
      console.log('Cached places saved to GCS.');
    } catch (error) {
      console.error('Error saving cached places:', error);
    }
  }
}
